/*
 * clipboard-bridge —— XP 侧桥（Windows XP，32 位，用户态）。
 *
 * 文本通道（v3，原有）：系统剪贴板 CF_UNICODETEXT ↔ ivm-shm.sys 共享内存信箱。
 * 文件通道（v4，todo/vm-remote-control 文件传输计划）：双向「元数据先行，
 * 数据粘贴时才流」——剪贴板里放的是引用，字节在粘贴动作发生时才过信箱：
 *
 *   [宿主→XP] 宿主复制文件 → H2G PENDING{session,mode,files}（只有名字+大小）
 *             → 本桥 OleSetClipboard 挂 OLE 虚拟文件（FileGroupDescriptorW/A +
 *             FileContents，无 CF_HDROP）→ 用户在 Explorer 里 Ctrl+V →
 *             Explorer 调 IDataObject::GetData(FileContents) 拿 IStream →
 *             每次 IStream::Read = 写 G2H REQ → 轮询 H2G 等 DATA（一轮信箱
 *             往返；期间不泵消息——Explorer 的调用本就串行进 STA，且中途
 *             碰 OLE 有重入风险）→ Explorer 自己把字节写进粘贴目的地。
 *             全部文件读完 → G2H DONE{ok}（cut 模式宿主据此删源）；
 *             Explorer 取消/中途失败 → 流析构时补 DONE{cancel}。
 *   [XP→宿主] 用户在 XP 复制文件 → 序列号变化 → 读 CF_HDROP 元数据 →
 *             G2H OFFER → 宿主（文件APP粘贴）逐块 H2G REQ{path,offset} →
 *             本桥 ReadFile 后 G2H DATA 应答 → 宿主 H2G DONE 结束会话。
 *   [文本]    采集路径不变；写剪贴板改走统一 OLE 数据对象（文本与虚拟文件
 *             同挂一个对象——裸 SetClipboardData 会把对方的格式踢出剪贴板）。
 *             OleInitialize 失败时退回纯文本裸写模式（v3 行为）。
 *
 * 回环防护：文本按内容（g_self_text）；文件按「序列号变了但剪贴板里既无
 * CF_HDROP 也无 CF_UNICODETEXT → 是自己刚挂的虚拟文件（延迟渲染）」判定。
 * 用户复制了图片等第三类内容时本桥不认识也不回发（roadmap §4 未排期）。
 *
 * 信箱布局与 ivm-shm.sys / Instant-virtual-machine src/ivm-shm.ts 一一对应：
 *   块内 +0 magic 'IVMX' / +4 seq / +8 status(0空 1就绪 2已读) / +12 len / +16 data
 *   status 高 16 位 = op（0=文本 1=文件帧）；文件帧 data 首个 u32 是子类型。
 *   本桥所有握手判断都按低 16 位比较——宿主 ACK 保留 op 位（如 0x20002），
 *   按 ==2 精确比较会永远等不到。
 *
 * 构建：scripts/build-ivm-agent.sh 合编进 ivm-agent.exe（zig cc 交叉编译，
 * -nostdlib；memset/memcpy 共用 res-agent.c 的实现，主循环 bridge_main 由
 * 合并入口在登录会话里调用，PE 版本补 5.01；导入 kernel32/user32/ole32）。
 * 日志走 OutputDebugStringA。安装：install-agent-v2.bat 写 HKCU Run 自启
 * （剪贴板在交互会话里，服务摸不到）。
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <ole2.h>
#include <shlobj.h>
#include <stdarg.h>
#include <stddef.h>

#define POLL_IDLE_MS 150            /* 稳态轮询周期 */
#define POLL_ACTIVE_MS 4            /* 文件会话活跃期主循环轮询周期 */
#define POLL_WAIT_MS 1              /* 阻塞等待循环的节拍（定时器精度已提到 1ms） */
#define G2H_ACK_TIMEOUT_MS 3000     /* 宿主不确认就复位 G2H 信箱 */
#define STREAM_DATA_TIMEOUT_MS 5000 /* Explorer 拉一块等宿主 DATA 的上限 */

#define SHM_BLOCK_SIZE 0x8000 /* 单个信箱 32KB；G2H 在 +0，H2G 在 +0x8000 */
#define SHM_MAILBOX_DATA (SHM_BLOCK_SIZE - 16)

#define SHM_MAGIC 0x584D5649u /* 'IVMX' 小端 */
#define SHM_STATUS_EMPTY 0u
#define SHM_STATUS_READY 1u
#define SHM_STATUS_READ 2u

/* status 高 16 位 op（与 ivm-shm.ts 一致） */
#define SHM_OP_TEXT 0u
#define SHM_OP_FILE 1u
#define status_state(s) ((s) & 0xFFFFu)
#define status_op(s) (((s) >> 16) & 0xFFFFu)
#define status_pack(state, op) (((state) & 0xFFFFu) | ((op) << 16))

/* 文件帧子类型 / 标志（与 ivm-shm.ts IVM_FILE_* 一致） */
#define FILE_OP_OFFER 1u
#define FILE_OP_PENDING 2u
#define FILE_OP_CLEAR 3u
#define FILE_OP_REQ 4u
#define FILE_OP_DATA 5u
#define FILE_OP_DONE 6u
#define FILE_FLAG_START 1u
#define FILE_FLAG_END 1u

#define FILE_MODE_COPY 0u
#define FILE_MODE_CUT 1u
#define FILE_RESULT_OK 0u
#define FILE_RESULT_CANCEL 1u
#define FILE_RESULT_ERROR 2u

/* DATA 帧头 28 字节：sub/session/flags + offset(8)/len/crc32 */
#define FILE_DATA_HEADER 28u
#define FILE_MAX_CHUNK (SHM_MAILBOX_DATA - FILE_DATA_HEADER) /* 32724 */

#define MAX_OFFER_FILES 32
#define MAX_NAME_CHARS 260

/* 无 CRT（-nostdlib）：memset/memcpy 共用 res-agent.c 的实现（合编进同一个
 * ivm-agent.exe，两边都定义会撞符号）；这里只带桥自己用的 memcmp/wcslen
 * （IsEqualGUID 之类宏也会用到 memcmp）。 */
int memcmp(const void *a, const void *b, size_t count)
{
    const volatile unsigned char *x = (const volatile unsigned char *)a;
    const volatile unsigned char *y = (const volatile unsigned char *)b;
    while (count--) {
        if (*x != *y) {
            return *x - *y;
        }
        x++;
        y++;
    }
    return 0;
}

/* clang 会把 `while (*p) p++` 识别成 wcslen 惯用法直接外调；-nostdlib 没有
 * CRT，必须自带。-nostdlib 编译单元里它与用户定义无冲突。 */
size_t wcslen(const wchar_t *s)
{
    const wchar_t *p = s;
    while (*p) {
        p++;
    }
    return (size_t)(p - s);
}

static void log_line(const char *fmt, ...)
{
    char buffer[256];
    va_list args;
    va_start(args, fmt);
    wvsprintfA(buffer, fmt, args);
    va_end(args);
    for (char *p = buffer; *p; p++) {
        if (*p == '\n' || *p == '\r') {
            *p = ' ';
        }
    }
    lstrcatA(buffer, "\r\n");
    OutputDebugStringA(buffer);
}

static void fatal_box(const char *what, const char *detail)
{
    char text[256];
    lstrcpyA(text, what);
    lstrcatA(text, "\r\n");
    lstrcatA(text, detail);
    log_line("clip-bridge: %s (%s)", what, detail);
    MessageBoxA(NULL, text, "clipboard-bridge", MB_OK | MB_ICONERROR);
}

/* 前向声明（定义在文件后部；流 Read 与主循环共用 H2G 处理）。 */
static void h2g_process(void);
static void apply_text_raw(void);

/* ---- CRC32（IEEE 802.3，与 ivm-shm.ts ivmCrc32 逐位一致） ---- */

static unsigned long g_crc_table[256];

static void crc32_init(void)
{
    for (unsigned long n = 0; n < 256; n++) {
        unsigned long c = n;
        for (int k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
        }
        g_crc_table[n] = c;
    }
}

static unsigned long crc32_of(const unsigned char *bytes, unsigned long len)
{
    unsigned long c = 0xFFFFFFFFu;
    for (unsigned long i = 0; i < len; i++) {
        c = g_crc_table[(c ^ bytes[i]) & 0xFFu] ^ (c >> 8);
    }
    return c ^ 0xFFFFFFFFu;
}

/* ---- 信箱底层（volatile 32 位访问；写侧数据先落、status 最后发布） ---- */

static void *g_shm; /* 驱动给的 64KB 用户态映射 */

static volatile void *g2h(void)
{
    return g_shm;
}

static volatile void *h2g(void)
{
    return (volatile void *)((char *)g_shm + SHM_BLOCK_SIZE);
}

static unsigned long mb_read32(volatile void *base, int offset)
{
    return *(volatile unsigned long *)((char *)base + offset);
}

static void mb_write32(volatile void *base, int offset, unsigned long value)
{
    *(volatile unsigned long *)((char *)base + offset) = value;
}

/* 发布一帧（先 data/len/seq，status 最后）：block 0=G2H / 1=H2G。 */
static void mb_publish(int block, unsigned long op, const unsigned char *data, unsigned long len)
{
    volatile void *base = block ? h2g() : g2h();
    volatile unsigned char *dst = (volatile unsigned char *)((char *)base + 16);
    for (unsigned long i = 0; i < len; i++) {
        dst[i] = data[i];
    }
    mb_write32(base, 12, len);
    mb_write32(base, 4, mb_read32(base, 4) + 1);
    mb_write32(base, 8, status_pack(SHM_STATUS_READY, op));
}

/* 把系统定时器精度提到 1ms：Sleep(1) 在 XP 默认精度下实睡 ~15ms，
 * 文件会话的逐块等待会被放大一个数量级。动态取 winmm，不进导入表；
 * 失败（无 winmm）就退回系统默认，功能不受影响。 */
static void raise_timer_resolution(void)
{
    HMODULE winmm = LoadLibraryA("winmm.dll");
    if (winmm == NULL) {
        return;
    }
    DWORD (WINAPI *timeBeginPeriodPtr)(DWORD) =
        (DWORD (WINAPI *)(DWORD))(void *)GetProcAddress(winmm, "timeBeginPeriod");
    if (timeBeginPeriodPtr != NULL) {
        timeBeginPeriodPtr(1);
    }
}

/* G2H 事务：等槽位 → 发布 → 等 ACK（超时复位）。返回 1=被确认。 */
static int g2h_transact(unsigned long op, const unsigned char *data, unsigned long len)
{
    DWORD waited = 0;
    while (status_state(mb_read32(g2h(), 8)) == SHM_STATUS_READY) {
        if (waited >= G2H_ACK_TIMEOUT_MS) {
            mb_write32(g2h(), 8, SHM_STATUS_EMPTY);
            break;
        }
        Sleep(POLL_WAIT_MS);
        waited += POLL_WAIT_MS;
    }
    mb_publish(0, op, data, len);
    waited = 0;
    while (status_state(mb_read32(g2h(), 8)) == SHM_STATUS_READY) {
        if (waited >= G2H_ACK_TIMEOUT_MS) {
            mb_write32(g2h(), 8, SHM_STATUS_EMPTY);
            log_line("clip-bridge: G2H ack timeout op=%lu, reset", op);
            return 0;
        }
        Sleep(POLL_WAIT_MS);
        waited += POLL_WAIT_MS;
    }
    return 1;
}

/* ---- 文件帧字节编码（小端手工拼，布局与 ivm-shm.ts FrameWriter 一致） ---- */

typedef struct {
    unsigned char bytes[SHM_MAILBOX_DATA];
    unsigned long len;
} frame_buf;

static void fb_u32(frame_buf *f, unsigned long v)
{
    f->bytes[f->len] = (unsigned char)(v & 0xFF);
    f->bytes[f->len + 1] = (unsigned char)((v >> 8) & 0xFF);
    f->bytes[f->len + 2] = (unsigned char)((v >> 16) & 0xFF);
    f->bytes[f->len + 3] = (unsigned char)((v >> 24) & 0xFF);
    f->len += 4;
}

static void fb_u64(frame_buf *f, unsigned long long v)
{
    fb_u32(f, (unsigned long)(v & 0xFFFFFFFFu));
    fb_u32(f, (unsigned long)(v >> 32));
}

static void fb_utf16z(frame_buf *f, const wchar_t *text)
{
    while (*text) {
        unsigned long ch = (unsigned long)(*(const unsigned short *)text);
        f->bytes[f->len] = (unsigned char)(ch & 0xFF);
        f->bytes[f->len + 1] = (unsigned char)((ch >> 8) & 0xFF);
        f->len += 2;
        text++;
    }
    f->bytes[f->len] = 0;
    f->bytes[f->len + 1] = 0;
    f->len += 2;
}

static unsigned long rd_u32(const unsigned char *b, unsigned long offset)
{
    return (unsigned long)b[offset] | ((unsigned long)b[offset + 1] << 8) |
           ((unsigned long)b[offset + 2] << 16) | ((unsigned long)b[offset + 3] << 24);
}

static unsigned long long rd_u64(const unsigned char *b, unsigned long offset)
{
    return (unsigned long long)rd_u32(b, offset) |
           ((unsigned long long)rd_u32(b, offset + 4) << 32);
}

/* ---- 全局状态 ---- */

/* 宿主发来的文本（OLE 数据对象按需渲染 CF_UNICODETEXT）。 */
static wchar_t g_text[SHM_MAILBOX_DATA / 2];
static int g_text_ready;

/* XP 复制读出的文本（自设回环比较基准）。 */
static wchar_t g_self_text[SHM_MAILBOX_DATA / 2];
static DWORD g_self_text_wchars;

/* 宿主推来的待粘贴文件清单（PENDING）。 */
typedef struct {
    wchar_t name[MAX_NAME_CHARS];
    unsigned long long size;
    int done; /* 本轮粘贴中该文件已完整供给 */
} pending_file;

typedef struct {
    int active;
    unsigned long session;
    unsigned long mode; /* FILE_MODE_* */
    unsigned long count;
    pending_file files[MAX_OFFER_FILES];
    int done_sent;      /* 本轮粘贴的 DONE 已上报（重复粘贴要重置） */
    int streams_active; /* Explorer 手里还握着的流数量 */
} pending_state;

static pending_state g_pending;

/* XP→宿主拉取会话（宿主 H2G REQ 驱动）。 */
static struct {
    unsigned long session; /* 0 = 无会话 */
    HANDLE handle;
} g_pull;

/* 流 Read 等待中的 DATA 应答（阻塞期间由 Read 循环自取 H2G）。 */
static struct {
    int waiting;
    unsigned long session;
    unsigned long index;
    unsigned long long offset;
    unsigned char *dst;
    unsigned long cap;
    unsigned long got;
    int end;
    int failed; /* 宿主报会话错误：Read 立刻失败，不等超时 */
} g_await;

static int g_ole_ok; /* OleInitialize 成功 → 文件通道可用 */
static DWORD g_last_seq;
static CLIPFORMAT g_cfText;
static CLIPFORMAT g_cfFileDescA;
static CLIPFORMAT g_cfFileDescW;
static CLIPFORMAT g_cfFileContents;
static int g_busy_tick; /* 流/会话活动 → 主循环快轮询 */

/* 大缓冲一律静态（单线程 STA，无并发）：函数内 32KB 局部数组会把栈帧顶过
 * 4096 页阈值，clang 生成 __alloca 而 -nostdlib 没有运行时符号。
 * g_tx 是共享发送帧——所有使用点严格顺序执行（g2h_transact 同步完成，
 * 流 Read 与 h2g_process 虽嵌套但帧生命周期不重叠），可安全复用。 */
static frame_buf g_tx;
static unsigned char g_h2g_buf[SHM_MAILBOX_DATA];
static unsigned char g_pull_chunk[FILE_MAX_CHUNK];

static void own_clipboard(void);

/* ---- OLE 虚拟文件：IStream（Explorer 拉一块我们过一轮信箱） ---- */

typedef struct {
    IStreamVtbl *lpVtbl;
    ULONG refs;
    unsigned long session;
    unsigned long index; /* pending 文件下标 */
    wchar_t name[MAX_NAME_CHARS]; /* 建流时的名字副本（pending 中途被换也一致） */
    unsigned long long size;
    unsigned long long offset;
    int started; /* 是否已发过 start 帧（首拉带文件名） */
    int eof;     /* 宿主报了 END / 供尽 */
} vm_stream;

static ULONG STDMETHODCALLTYPE stream_AddRef(IStream *This)
{
    return ++((vm_stream *)This)->refs;
}

static ULONG STDMETHODCALLTYPE stream_Release(IStream *This)
{
    vm_stream *s = (vm_stream *)This;
    ULONG refs = --s->refs;
    if (refs == 0) {
        if (g_pending.active && g_pending.session == s->session && g_pending.streams_active > 0) {
            g_pending.streams_active--;
            /* 流全放掉但文件没读完 = Explorer 取消/失败 → 通知宿主 */
            if (g_pending.streams_active == 0 && !g_pending.done_sent) {
                int all_done = 1;
                for (unsigned long i = 0; i < g_pending.count; i++) {
                    if (!g_pending.files[i].done) {
                        all_done = 0;
                        break;
                    }
                }
                if (!all_done) {
                    frame_buf *f = &g_tx; /* 共享发送帧（见全局区注释：使用点严格顺序） */
                    f->len = 0;
                    fb_u32(f, FILE_OP_DONE);
                    fb_u32(f, s->session);
                    fb_u32(f, FILE_RESULT_CANCEL);
                    g_pending.done_sent = 1;
                    g2h_transact(SHM_OP_FILE, f->bytes, f->len);
                    log_line("clip-bridge: paste cancelled session=%lu", s->session);
                }
            }
        }
        log_line("clip-bridge: stream closed idx=%lu", s->index);
        HeapFree(GetProcessHeap(), 0, s);
    }
    return refs;
}

static HRESULT STDMETHODCALLTYPE stream_QueryInterface(IStream *This, REFIID riid, void **out)
{
    static const IID kIUnknown = {0x00000000u, 0x0000u, 0x0000u, {0xC0u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x46u}};
    static const IID kIStream = {0x0000000Cu, 0x0000u, 0x0000u, {0xC0u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x46u}};
    if (out == NULL) {
        return E_POINTER;
    }
    *out = NULL;
    if (memcmp(riid, &kIUnknown, sizeof(IID)) == 0 || memcmp(riid, &kIStream, sizeof(IID)) == 0) {
        *out = This;
        stream_AddRef(This);
        return S_OK;
    }
    return E_NOINTERFACE;
}

/* 核心：发 REQ 等 DATA。阻塞在 Explorer 的 Read 调用里（STA 本就串行），
 * 期间只轮询信箱，绝不碰 OLE（防重入）。 */
static HRESULT stream_fill(vm_stream *s, unsigned char *dst, unsigned long want, unsigned long *got)
{
    frame_buf *f = &g_tx; /* 共享发送帧（见全局区注释：使用点严格顺序） */
    int first = !s->started;
    f->len = 0;
    fb_u32(f, FILE_OP_REQ);
    fb_u32(f, s->session);
    fb_u32(f, first ? FILE_FLAG_START : 0);
    fb_u64(f, s->offset);
    fb_u32(f, want);
    if (first) {
        /* 首拉带文件名：宿主按名字在清单里定位（同一会话可切换文件） */
        s->started = 1;
        unsigned long chars = 0;
        while (s->name[chars] != 0) {
            chars++;
        }
        fb_u32(f, chars * 2 + 2);
        fb_utf16z(f, s->name);
    } else {
        fb_u32(f, 0);
    }
    if (!g2h_transact(SHM_OP_FILE, f->bytes, f->len)) {
        log_line("clip-bridge: REQ publish failed idx=%lu", s->index);
        return STG_E_READFAULT;
    }
    g_await.waiting = 1;
    g_await.session = s->session;
    g_await.index = s->index;
    g_await.offset = s->offset;
    g_await.dst = dst;
    g_await.cap = want;
    g_await.got = 0;
    g_await.end = 0;
    g_await.failed = 0;
    DWORD waited = 0;
    while (g_await.waiting) {
        if (waited >= STREAM_DATA_TIMEOUT_MS) {
            g_await.waiting = 0;
            log_line("clip-bridge: DATA timeout session=%lu offset=%lu",
                     s->session, (unsigned long)s->offset);
            return STG_E_READFAULT;
        }
        Sleep(POLL_WAIT_MS);
        waited += POLL_WAIT_MS;
        /* Read 阻塞期间主循环不在跑（单线程），DATA 必须自取。 */
        h2g_process();
    }
    if (g_await.failed) {
        log_line("clip-bridge: host aborted session=%lu", s->session);
        return STG_E_READFAULT;
    }
    if (g_await.end) {
        s->eof = 1;
    }
    s->offset += g_await.got;
    *got = g_await.got;
    return S_OK;
}

static HRESULT STDMETHODCALLTYPE stream_Read(IStream *This, void *pv, ULONG cb, ULONG *pcbRead)
{
    vm_stream *s = (vm_stream *)This;
    if (pcbRead != NULL) {
        *pcbRead = 0;
    }
    if (pv == NULL) {
        return STG_E_INVALIDPOINTER;
    }
    if (s->eof || s->offset >= s->size || cb == 0) {
        return S_FALSE; /* EOF */
    }
    unsigned long want =
        (unsigned long long)cb > s->size - s->offset ? (unsigned long)(s->size - s->offset) : cb;
    if (want > FILE_MAX_CHUNK) {
        want = FILE_MAX_CHUNK;
    }
    unsigned long got = 0;
    HRESULT hr = stream_fill(s, (unsigned char *)pv, want, &got);
    if (FAILED(hr)) {
        return hr;
    }
    if (pcbRead != NULL) {
        *pcbRead = got;
    }
    /* 短读≠结束：块上限（FILE_MAX_CHUNK）导致的短读必须回 S_OK，
     * S_FALSE 只留给真 EOF（上方 offset>=size / eof 分支），否则
     * Explorer 会把「还有数据」当成「文件完了」截断大文件。 */
    return got > 0 ? S_OK : S_FALSE;
}

static HRESULT STDMETHODCALLTYPE stream_Write(IStream *This, const void *pv, ULONG cb, ULONG *pcbWritten)
{
    (void)This;
    (void)pv;
    (void)cb;
    (void)pcbWritten;
    return STG_E_ACCESSDENIED; /* 只读流 */
}

static HRESULT STDMETHODCALLTYPE stream_Seek(IStream *This, LARGE_INTEGER move, DWORD origin, ULARGE_INTEGER *pos)
{
    vm_stream *s = (vm_stream *)This;
    long long m = (long long)move.QuadPart;
    long long target;
    if (origin == STREAM_SEEK_SET) {
        target = m;
    } else if (origin == STREAM_SEEK_CUR) {
        target = (long long)s->offset + m;
    } else if (origin == STREAM_SEEK_END) {
        target = (long long)s->size + m;
    } else {
        return STG_E_INVALIDFUNCTION;
    }
    if (target < 0 || (unsigned long long)target > s->size) {
        return STG_E_INVALIDFUNCTION;
    }
    s->offset = (unsigned long long)target;
    if (pos != NULL) {
        pos->QuadPart = (ULONGLONG)target;
    }
    return S_OK;
}

static HRESULT STDMETHODCALLTYPE stream_SetSize(IStream *This, ULARGE_INTEGER v)
{
    (void)This;
    (void)v;
    return STG_E_INVALIDFUNCTION;
}

static HRESULT STDMETHODCALLTYPE stream_CopyTo(IStream *This, IStream *t, ULARGE_INTEGER cb, ULARGE_INTEGER *r, ULARGE_INTEGER *w)
{
    (void)This;
    (void)t;
    (void)cb;
    (void)r;
    (void)w;
    return E_NOTIMPL;
}

static HRESULT STDMETHODCALLTYPE stream_Commit(IStream *This, DWORD flags)
{
    (void)This;
    (void)flags;
    return STG_E_INVALIDFUNCTION;
}

static HRESULT STDMETHODCALLTYPE stream_Revert(IStream *This)
{
    (void)This;
    return STG_E_INVALIDFUNCTION;
}

static HRESULT STDMETHODCALLTYPE stream_LockRegion(IStream *This, ULARGE_INTEGER a, ULARGE_INTEGER b, DWORD t)
{
    (void)This;
    (void)a;
    (void)b;
    (void)t;
    return STG_E_INVALIDFUNCTION;
}

static HRESULT STDMETHODCALLTYPE stream_UnlockRegion(IStream *This, ULARGE_INTEGER a, ULARGE_INTEGER b, DWORD t)
{
    (void)This;
    (void)a;
    (void)b;
    (void)t;
    return STG_E_INVALIDFUNCTION;
}

static HRESULT STDMETHODCALLTYPE stream_Stat(IStream *This, STATSTG *out, DWORD flag)
{
    vm_stream *s = (vm_stream *)This;
    if (out == NULL) {
        return STG_E_INVALIDPOINTER;
    }
    memset(out, 0, sizeof(*out));
    out->type = STGTY_STREAM;
    out->cbSize.QuadPart = (ULONGLONG)s->size;
    if ((flag & STATFLAG_NONAME) == 0) {
        wchar_t *name = (wchar_t *)CoTaskMemAlloc(sizeof(wchar_t) * MAX_NAME_CHARS);
        if (name == NULL) {
            return E_OUTOFMEMORY;
        }
        lstrcpynW(name, s->name, MAX_NAME_CHARS);
        out->pwcsName = name;
    }
    return S_OK;
}

static HRESULT STDMETHODCALLTYPE stream_Clone(IStream *This, IStream **out)
{
    (void)This;
    (void)out;
    return E_NOTIMPL;
}

static IStreamVtbl g_stream_vtbl = {
    stream_QueryInterface,
    stream_AddRef,
    stream_Release,
    stream_Read,
    stream_Write,
    stream_Seek,
    stream_SetSize,
    stream_CopyTo,
    stream_Commit,
    stream_Revert,
    stream_LockRegion,
    stream_UnlockRegion,
    stream_Stat,
    stream_Clone,
};

static vm_stream *stream_create(unsigned long session, unsigned long index, const wchar_t *name, unsigned long long size)
{
    vm_stream *s = (vm_stream *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*s));
    if (s == NULL) {
        return NULL;
    }
    s->lpVtbl = &g_stream_vtbl;
    s->refs = 1;
    s->session = session;
    s->index = index;
    lstrcpynW(s->name, name, MAX_NAME_CHARS);
    s->size = size;
    return s;
}

/* ---- OLE 虚拟文件：IDataObject + IEnumFORMATETC ---- */

typedef struct {
    IEnumFORMATETCVtbl *lpVtbl;
    ULONG refs;
    ULONG pos;
    ULONG count;
    FORMATETC formats[4];
} vm_enum;

static ULONG STDMETHODCALLTYPE enum_AddRef(IEnumFORMATETC *This)
{
    return ++((vm_enum *)This)->refs;
}

static ULONG STDMETHODCALLTYPE enum_Release(IEnumFORMATETC *This)
{
    vm_enum *e = (vm_enum *)This;
    ULONG refs = --e->refs;
    if (refs == 0) {
        HeapFree(GetProcessHeap(), 0, e);
    }
    return refs;
}

static HRESULT STDMETHODCALLTYPE enum_QueryInterface(IEnumFORMATETC *This, REFIID riid, void **out)
{
    static const IID kIUnknown = {0x00000000u, 0x0000u, 0x0000u, {0xC0u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x46u}};
    static const IID kIEnum = {0x00000103u, 0x0000u, 0x0000u, {0xC0u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x46u}};
    if (out == NULL) {
        return E_POINTER;
    }
    *out = NULL;
    if (memcmp(riid, &kIUnknown, sizeof(IID)) == 0 || memcmp(riid, &kIEnum, sizeof(IID)) == 0) {
        *out = This;
        enum_AddRef(This);
        return S_OK;
    }
    return E_NOINTERFACE;
}

static HRESULT STDMETHODCALLTYPE enum_Next(IEnumFORMATETC *This, ULONG celt, FORMATETC *rgelt, ULONG *fetched)
{
    vm_enum *e = (vm_enum *)This;
    ULONG n = 0;
    if (fetched != NULL) {
        *fetched = 0;
    }
    while (n < celt && e->pos < e->count) {
        rgelt[n] = e->formats[e->pos];
        n++;
        e->pos++;
    }
    if (fetched != NULL) {
        *fetched = n;
    }
    return (n == celt) ? S_OK : S_FALSE;
}

static HRESULT STDMETHODCALLTYPE enum_Skip(IEnumFORMATETC *This, ULONG celt)
{
    vm_enum *e = (vm_enum *)This;
    e->pos += celt;
    if (e->pos > e->count) {
        e->pos = e->count;
        return S_FALSE;
    }
    return S_OK;
}

static HRESULT STDMETHODCALLTYPE enum_Reset(IEnumFORMATETC *This)
{
    ((vm_enum *)This)->pos = 0;
    return S_OK;
}

static HRESULT STDMETHODCALLTYPE enum_Clone(IEnumFORMATETC *This, IEnumFORMATETC **out)
{
    vm_enum *e = (vm_enum *)This;
    if (out == NULL) {
        return E_POINTER;
    }
    *out = NULL;
    vm_enum *copy = (vm_enum *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*copy));
    if (copy == NULL) {
        return E_OUTOFMEMORY;
    }
    *copy = *e;
    copy->refs = 1;
    *out = (IEnumFORMATETC *)copy;
    return S_OK;
}

static IEnumFORMATETCVtbl g_enum_vtbl = {
    enum_QueryInterface,
    enum_AddRef,
    enum_Release,
    enum_Next,
    enum_Skip,
    enum_Reset,
    enum_Clone,
};

typedef struct {
    IDataObjectVtbl *lpVtbl;
    ULONG refs;
} vm_data;

/* 当前该暴露哪些格式：文本有就给文本，pending 有就给虚拟文件三件套。 */
static ULONG current_formats(FORMATETC *out)
{
    ULONG n = 0;
    if (g_text_ready) {
        out[n].cfFormat = g_cfText;
        out[n].ptd = NULL;
        out[n].dwAspect = DVASPECT_CONTENT;
        out[n].lindex = -1;
        out[n].tymed = TYMED_HGLOBAL;
        n++;
    }
    if (g_pending.active) {
        const CLIPFORMAT desc[2] = {g_cfFileDescW, g_cfFileDescA};
        for (int i = 0; i < 2; i++) {
            out[n].cfFormat = desc[i];
            out[n].ptd = NULL;
            out[n].dwAspect = DVASPECT_CONTENT;
            out[n].lindex = -1;
            out[n].tymed = TYMED_HGLOBAL;
            n++;
        }
        out[n].cfFormat = g_cfFileContents;
        out[n].ptd = NULL;
        out[n].dwAspect = DVASPECT_CONTENT;
        out[n].lindex = -1;
        out[n].tymed = TYMED_HGLOBAL | TYMED_ISTREAM;
        n++;
    }
    return n;
}

static ULONG STDMETHODCALLTYPE data_AddRef(IDataObject *This);

static HRESULT STDMETHODCALLTYPE data_QueryInterface(IDataObject *This, REFIID riid, void **out)
{
    static const IID kIUnknown = {0x00000000u, 0x0000u, 0x0000u, {0xC0u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x46u}};
    static const IID kIDataObject = {0x0000010Eu, 0x0000u, 0x0000u, {0xC0u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x46u}};
    if (out == NULL) {
        return E_POINTER;
    }
    *out = NULL;
    if (memcmp(riid, &kIUnknown, sizeof(IID)) == 0 || memcmp(riid, &kIDataObject, sizeof(IID)) == 0) {
        *out = This;
        data_AddRef(This);
        return S_OK;
    }
    return E_NOINTERFACE;
}

static ULONG STDMETHODCALLTYPE data_AddRef(IDataObject *This)
{
    return ++((vm_data *)This)->refs;
}

static ULONG STDMETHODCALLTYPE data_Release(IDataObject *This)
{
    vm_data *d = (vm_data *)This;
    ULONG refs = --d->refs;
    if (refs == 0) {
        HeapFree(GetProcessHeap(), 0, d);
    }
    return refs;
}

static HRESULT render_text_hglobal(HGLOBAL *out)
{
    unsigned long chars = 0;
    while (g_text[chars] != 0) {
        chars++;
    }
    HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, (chars + 1) * 2);
    if (h == NULL) {
        return STG_E_MEDIUMFULL;
    }
    wchar_t *dst = (wchar_t *)GlobalLock(h);
    if (dst == NULL) {
        GlobalFree(h);
        return E_OUTOFMEMORY;
    }
    memcpy(dst, g_text, chars * 2);
    GlobalUnlock(h);
    *out = h;
    return S_OK;
}

static HRESULT render_descriptor(HGLOBAL *out, int wide)
{
    unsigned long unit = wide ? sizeof(FILEDESCRIPTORW) : sizeof(FILEDESCRIPTORA);
    HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, sizeof(UINT) + unit * g_pending.count);
    if (h == NULL) {
        return STG_E_MEDIUMFULL;
    }
    void *base = GlobalLock(h);
    if (base == NULL) {
        GlobalFree(h);
        return E_OUTOFMEMORY;
    }
    *(UINT *)base = g_pending.count;
    for (unsigned long i = 0; i < g_pending.count; i++) {
        char *slot = (char *)base + sizeof(UINT) + unit * i;
        if (wide) {
            FILEDESCRIPTORW *d = (FILEDESCRIPTORW *)slot;
            d->dwFlags = FD_FILESIZE | FD_ATTRIBUTES | FD_PROGRESSUI;
            d->dwFileAttributes = FILE_ATTRIBUTE_NORMAL;
            d->nFileSizeHigh = (unsigned long)(g_pending.files[i].size >> 32);
            d->nFileSizeLow = (unsigned long)g_pending.files[i].size;
            lstrcpynW(d->cFileName, g_pending.files[i].name, MAX_NAME_CHARS);
        } else {
            FILEDESCRIPTORA *d = (FILEDESCRIPTORA *)slot;
            d->dwFlags = FD_FILESIZE | FD_ATTRIBUTES | FD_PROGRESSUI;
            d->dwFileAttributes = FILE_ATTRIBUTE_NORMAL;
            d->nFileSizeHigh = (unsigned long)(g_pending.files[i].size >> 32);
            d->nFileSizeLow = (unsigned long)g_pending.files[i].size;
            WideCharToMultiByte(CP_ACP, 0, g_pending.files[i].name, -1, d->cFileName, MAX_NAME_CHARS, NULL, NULL);
        }
    }
    GlobalUnlock(h);
    *out = h;
    return S_OK;
}

/* 全部文件供给完成后上报 DONE{ok}（cut 清理依据 + 宿主收尾）。 */
static void maybe_finish_paste(unsigned long session)
{
    if (!g_pending.active || g_pending.session != session || g_pending.done_sent) {
        return;
    }
    for (unsigned long i = 0; i < g_pending.count; i++) {
        if (!g_pending.files[i].done) {
            return;
        }
    }
    frame_buf *f = &g_tx; /* 共享发送帧（见全局区注释：使用点严格顺序） */
    f->len = 0;
    fb_u32(f, FILE_OP_DONE);
    fb_u32(f, session);
    fb_u32(f, FILE_RESULT_OK);
    g_pending.done_sent = 1;
    g2h_transact(SHM_OP_FILE, f->bytes, f->len);
    log_line("clip-bridge: paste complete session=%lu files=%lu mode=%s",
             session, g_pending.count, g_pending.mode == FILE_MODE_CUT ? "cut" : "copy");
}

static HRESULT STDMETHODCALLTYPE data_GetData(IDataObject *This, FORMATETC *fmt, STGMEDIUM *medium)
{
    (void)This;
    if (fmt == NULL || medium == NULL) {
        return E_POINTER;
    }
    if (fmt->dwAspect != DVASPECT_CONTENT) {
        return DV_E_DVASPECT;
    }
    if (fmt->cfFormat == g_cfText) {
        if (!g_text_ready || !(fmt->tymed & TYMED_HGLOBAL)) {
            return DV_E_TYMED;
        }
        HGLOBAL h = NULL;
        HRESULT hr = render_text_hglobal(&h);
        if (FAILED(hr)) {
            return hr;
        }
        medium->tymed = TYMED_HGLOBAL;
        medium->hGlobal = h;
        medium->pUnkForRelease = NULL;
        return S_OK;
    }
    if (!g_pending.active) {
        return DV_E_FORMATETC;
    }
    if ((fmt->cfFormat == g_cfFileDescW || fmt->cfFormat == g_cfFileDescA)) {
        if (!(fmt->tymed & TYMED_HGLOBAL)) {
            return DV_E_TYMED;
        }
        HGLOBAL h = NULL;
        HRESULT hr = render_descriptor(&h, fmt->cfFormat == g_cfFileDescW);
        if (FAILED(hr)) {
            return hr;
        }
        medium->tymed = TYMED_HGLOBAL;
        medium->hGlobal = h;
        medium->pUnkForRelease = NULL;
        return S_OK;
    }
    if (fmt->cfFormat == g_cfFileContents) {
        unsigned long index =
            (fmt->lindex >= 0 && (unsigned long)fmt->lindex < g_pending.count) ? (unsigned long)fmt->lindex : 0;
        if (fmt->tymed & TYMED_ISTREAM) {
            /* 重开一轮粘贴：完成态复位（复制语义可重复粘贴） */
            if (g_pending.done_sent) {
                g_pending.done_sent = 0;
                for (unsigned long i = 0; i < g_pending.count; i++) {
                    g_pending.files[i].done = 0;
                }
                g_pending.streams_active = 0;
            }
            vm_stream *s = stream_create(g_pending.session, index, g_pending.files[index].name, g_pending.files[index].size);
            if (s == NULL) {
                return E_OUTOFMEMORY;
            }
            g_pending.streams_active++;
            log_line("clip-bridge: stream open idx=%lu session=%lu sizeKB=%lu",
                     index, g_pending.session, (unsigned long)(g_pending.files[index].size >> 10));
            medium->tymed = TYMED_ISTREAM;
            medium->pstm = (IStream *)s;
            medium->pUnkForRelease = NULL;
            return S_OK;
        }
        if (fmt->tymed & TYMED_HGLOBAL) {
            /* 一次性 HGLOBAL 兜底：不走 IStream 的消费者（大文件不支持） */
            unsigned long long size = g_pending.files[index].size;
            if (size == 0 || size > FILE_MAX_CHUNK) {
                return STG_E_MEDIUMFULL;
            }
            HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, (size_t)size);
            if (h == NULL) {
                return STG_E_MEDIUMFULL;
            }
            unsigned char *dst = (unsigned char *)GlobalLock(h);
            if (dst == NULL) {
                GlobalFree(h);
                return E_OUTOFMEMORY;
            }
            unsigned long got = 0;
            vm_stream *s = stream_create(g_pending.session, index, g_pending.files[index].name, size);
            HRESULT hr = s != NULL ? stream_fill(s, dst, (unsigned long)size, &got) : E_OUTOFMEMORY;
            if (s != NULL) {
                HeapFree(GetProcessHeap(), 0, s); /* 手工流：不走 Release 的会话计数 */
            }
            GlobalUnlock(h);
            if (FAILED(hr) || got != (unsigned long)size) {
                GlobalFree(h);
                return STG_E_READFAULT;
            }
            pending_file *pf = &g_pending.files[index];
            if (!pf->done) {
                pf->done = 1;
                maybe_finish_paste(g_pending.session);
            }
            medium->tymed = TYMED_HGLOBAL;
            medium->hGlobal = h;
            medium->pUnkForRelease = NULL;
            return S_OK;
        }
        return DV_E_TYMED;
    }
    return DV_E_FORMATETC;
}

static HRESULT STDMETHODCALLTYPE data_GetDataHere(IDataObject *This, FORMATETC *fmt, STGMEDIUM *medium)
{
    (void)This;
    (void)fmt;
    (void)medium;
    return E_NOTIMPL;
}

static HRESULT STDMETHODCALLTYPE data_QueryGetData(IDataObject *This, FORMATETC *fmt)
{
    (void)This;
    if (fmt == NULL) {
        return E_POINTER;
    }
    if (fmt->dwAspect != DVASPECT_CONTENT) {
        return DV_E_DVASPECT;
    }
    FORMATETC formats[4];
    ULONG count = current_formats(formats);
    for (ULONG i = 0; i < count; i++) {
        if (formats[i].cfFormat == fmt->cfFormat && (formats[i].tymed & fmt->tymed)) {
            return S_OK;
        }
    }
    return DV_E_FORMATETC;
}

static HRESULT STDMETHODCALLTYPE data_GetCanonicalFormatEtc(IDataObject *This, FORMATETC *in, FORMATETC *out)
{
    (void)This;
    if (out == NULL) {
        return E_POINTER;
    }
    *out = *in;
    out->ptd = NULL;
    return DATA_S_SAMEFORMATETC;
}

static HRESULT STDMETHODCALLTYPE data_SetData(IDataObject *This, FORMATETC *fmt, STGMEDIUM *medium, BOOL release)
{
    (void)This;
    (void)fmt;
    (void)medium;
    (void)release;
    return E_NOTIMPL;
}

static HRESULT STDMETHODCALLTYPE data_EnumFormatEtc(IDataObject *This, DWORD direction, IEnumFORMATETC **out)
{
    (void)This;
    if (out == NULL) {
        return E_POINTER;
    }
    *out = NULL;
    if (direction != DATADIR_GET) {
        return E_NOTIMPL;
    }
    vm_enum *e = (vm_enum *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*e));
    if (e == NULL) {
        return E_OUTOFMEMORY;
    }
    e->lpVtbl = &g_enum_vtbl;
    e->refs = 1;
    e->count = current_formats(e->formats);
    *out = (IEnumFORMATETC *)e;
    return S_OK;
}

static HRESULT STDMETHODCALLTYPE data_DAdvise(IDataObject *This, FORMATETC *f, DWORD advf, IAdviseSink *sink, DWORD *conn)
{
    (void)This;
    (void)f;
    (void)advf;
    (void)sink;
    (void)conn;
    return OLE_E_ADVISENOTSUPPORTED;
}

static HRESULT STDMETHODCALLTYPE data_DUnadvise(IDataObject *This, DWORD conn)
{
    (void)This;
    (void)conn;
    return OLE_E_ADVISENOTSUPPORTED;
}

static HRESULT STDMETHODCALLTYPE data_EnumDAdvise(IDataObject *This, IEnumSTATDATA **out)
{
    (void)This;
    if (out != NULL) {
        *out = NULL;
    }
    return OLE_E_ADVISENOTSUPPORTED;
}

static IDataObjectVtbl g_data_vtbl = {
    data_QueryInterface,
    data_AddRef,
    data_Release,
    data_GetData,
    data_GetDataHere,
    data_QueryGetData,
    data_GetCanonicalFormatEtc,
    data_SetData,
    data_EnumFormatEtc,
    data_DAdvise,
    data_DUnadvise,
    data_EnumDAdvise,
};

/* OLE 数据对象单例（无堆分配；vtbl 即身份）。 */
static vm_data g_data_holder = {&g_data_vtbl, 1};

/* 重设 OLE 剪贴板所有权：只在宿主侧状态变化时调用（外部复制后我们不抢回）。 */
static void own_clipboard(void)
{
    if (!g_ole_ok) {
        return;
    }
    HRESULT hr = OleSetClipboard((IDataObject *)&g_data_holder);
    if (FAILED(hr)) {
        log_line("clip-bridge: OleSetClipboard hr=0x%08lX", (unsigned long)hr);
        return;
    }
    g_last_seq = GetClipboardSequenceNumber();
}

/* ---- H2G 消费：文本 / PENDING / CLEAR / REQ 应答 / DATA 派发 / DONE ---- */

/* 主循环与流 Read 都可能进来（Read 阻塞期间只有它跑）。 */
static void h2g_process(void)
{
    for (;;) {
        unsigned long status = mb_read32(h2g(), 8);
        unsigned long op = status_op(status);
        if (mb_read32(h2g(), 0) != SHM_MAGIC || status_state(status) != SHM_STATUS_READY) {
            return;
        }
        unsigned long len = mb_read32(h2g(), 12);
        if (len > SHM_MAILBOX_DATA) {
            mb_write32(h2g(), 8, status_pack(SHM_STATUS_READ, op)); /* 坏块确认掉 */
            continue;
        }
        unsigned char *buf = g_h2g_buf;
        volatile unsigned char *src = (volatile unsigned char *)((char *)h2g() + 16);
        for (unsigned long i = 0; i < len; i++) {
            buf[i] = src[i];
        }
        mb_write32(h2g(), 8, status_pack(SHM_STATUS_READ, op));

        if (op == SHM_OP_TEXT) {
            unsigned long chars = len / 2;
            if (chars > 0) {
                chars--; /* 去结尾 NUL */
            }
            if (chars > SHM_MAILBOX_DATA / 2 - 1) {
                chars = SHM_MAILBOX_DATA / 2 - 1;
            }
            if (chars == 0) {
                continue; /* 空文本：不覆盖剪贴板 */
            }
            memcpy(g_text, buf, chars * 2);
            g_text[chars] = 0;
            g_text_ready = 1;
            log_line("clip-bridge: host text(%lu chars) -> clipboard", chars);
            if (g_ole_ok) {
                own_clipboard();
            } else {
                apply_text_raw();
            }
            continue;
        }
        if (op != SHM_OP_FILE) {
            continue; /* 未知 op：已确认，丢弃 */
        }

        unsigned long sub = len >= 4 ? rd_u32(buf, 0) : 0;
        if (sub == FILE_OP_PENDING) {
            /* [sub][count][mode][session][entries{u64 size, utf16z name}] */
            unsigned long count = len >= 8 ? rd_u32(buf, 4) : 0;
            unsigned long mode = len >= 12 ? rd_u32(buf, 8) : 0;
            unsigned long session = len >= 16 ? rd_u32(buf, 12) : 0;
            if (count == 0 || count > MAX_OFFER_FILES || session == 0) {
                log_line("clip-bridge: bad PENDING count=%lu", count);
                continue;
            }
            static pending_state next; /* 大结构走静态（同上：栈帧阈值），单线程无并发 */
            memset(&next, 0, sizeof(next));
            next.active = 1;
            next.session = session;
            next.mode = mode;
            next.count = count;
            unsigned long off = 16;
            int ok = 1;
            for (unsigned long i = 0; i < count && ok; i++) {
                if (off + 8 > len) {
                    ok = 0;
                    break;
                }
                next.files[i].size = rd_u64(buf, off);
                off += 8;
                unsigned long n = 0;
                while (off + 1 < len && !(buf[off] == 0 && buf[off + 1] == 0) && n < MAX_NAME_CHARS - 1) {
                    next.files[i].name[n] = (wchar_t)(unsigned short)(buf[off] | (buf[off + 1] << 8));
                    n++;
                    off += 2;
                }
                if (off + 2 > len) {
                    ok = 0;
                    break;
                }
                next.files[i].name[n] = 0;
                off += 2;
            }
            if (!ok) {
                log_line("clip-bridge: bad PENDING entries session=%lu", session);
                continue;
            }
            g_pending = next; /* 上一轮会话状态整体作废（收尾由 done_sent 覆盖） */
            g_busy_tick = 1;
            log_line("clip-bridge: pending session=%lu files=%lu mode=%s",
                     session, count, mode == FILE_MODE_CUT ? "cut" : "copy");
            if (g_ole_ok) {
                own_clipboard();
                log_line("clip-bridge: virtual file(s) on clipboard (paste in Explorer)");
            }
            continue;
        }
        if (sub == FILE_OP_CLEAR) {
            if (g_pending.active) {
                memset(&g_pending, 0, sizeof(g_pending));
                if (g_ole_ok) {
                    OleSetClipboard(NULL); /* 虚拟文件随之下架 */
                    g_last_seq = GetClipboardSequenceNumber();
                }
                log_line("clip-bridge: pending cleared");
            }
            continue;
        }
        if (sub == FILE_OP_REQ) {
            /* [sub][session][flags][offset u64][len][pathBytes][path] —— 宿主来拉 */
            unsigned long session = len >= 8 ? rd_u32(buf, 4) : 0;
            unsigned long flags = len >= 12 ? rd_u32(buf, 8) : 0;
            unsigned long long offset = len >= 20 ? rd_u64(buf, 12) : 0;
            unsigned long want = len >= 24 ? rd_u32(buf, 20) : 0;
            unsigned long pathBytes = len >= 28 ? rd_u32(buf, 24) : 0;
            if (session == 0 || want == 0 || want > FILE_MAX_CHUNK) {
                log_line("clip-bridge: bad REQ session=%lu want=%lu", session, want);
                continue;
            }
            if ((flags & FILE_FLAG_START) && g_pull.session != session) {
                if (g_pull.handle != NULL) {
                    CloseHandle(g_pull.handle);
                    g_pull.handle = NULL;
                }
                wchar_t path[MAX_NAME_CHARS];
                unsigned long chars = 0;
                while (chars + 1 < pathBytes / 2 && chars < MAX_NAME_CHARS - 1) {
                    wchar_t ch = (wchar_t)(unsigned short)(buf[28 + chars * 2] | (buf[29 + chars * 2] << 8));
                    if (ch == 0) {
                        break;
                    }
                    path[chars] = ch;
                    chars++;
                }
                path[chars] = 0;
                g_pull.handle = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
                if (g_pull.handle == INVALID_HANDLE_VALUE) {
                    g_pull.handle = NULL;
                    frame_buf *f = &g_tx; /* 共享发送帧（见全局区注释：使用点严格顺序） */
                    f->len = 0;
                    fb_u32(f, FILE_OP_DONE);
                    fb_u32(f, session);
                    fb_u32(f, FILE_RESULT_ERROR);
                    g2h_transact(SHM_OP_FILE, f->bytes, f->len);
                    log_line("clip-bridge: pull open failed session=%lu", session);
                    continue;
                }
                g_pull.session = session;
                log_line("clip-bridge: pull session=%lu open ok", session);
            }
            if (g_pull.session != session || g_pull.handle == NULL) {
                log_line("clip-bridge: REQ for unknown session=%lu", session);
                continue;
            }
            LARGE_INTEGER li;
            li.QuadPart = (LONGLONG)offset;
            unsigned char *chunk = g_pull_chunk;
            DWORD got = 0;
            BOOL readOk = SetFilePointerEx(g_pull.handle, li, NULL, FILE_BEGIN);
            if (readOk) {
                readOk = ReadFile(g_pull.handle, chunk, want, &got, NULL);
            }
            if (!readOk) {
                got = 0;
            }
            frame_buf *f = &g_tx; /* 共享发送帧（见全局区注释：使用点严格顺序） */
            f->len = 0;
            fb_u32(f, FILE_OP_DATA);
            fb_u32(f, session);
            fb_u32(f, got < want ? FILE_FLAG_END : 0);
            fb_u64(f, offset);
            fb_u32(f, got);
            fb_u32(f, crc32_of(chunk, got));
            memcpy(f->bytes + f->len, chunk, got);
            f->len += got;
            g2h_transact(SHM_OP_FILE, f->bytes, f->len);
            g_busy_tick = 1;
            if (got < want) {
                /* 读尽/出错：XP→宿主会话终结 */
                CloseHandle(g_pull.handle);
                g_pull.handle = NULL;
                g_pull.session = 0;
            }
            continue;
        }
        if (sub == FILE_OP_DATA) {
            /* [sub][session][flags][offset u64][len][crc][bytes] —— 流 Read 在等 */
            if (!g_await.waiting) {
                continue;
            }
            unsigned long session = len >= 8 ? rd_u32(buf, 4) : 0;
            unsigned long flags = len >= 12 ? rd_u32(buf, 8) : 0;
            unsigned long long offset = len >= 20 ? rd_u64(buf, 12) : 0;
            unsigned long dlen = len >= 24 ? rd_u32(buf, 20) : 0;
            unsigned long crc = len >= 28 ? rd_u32(buf, 24) : 0;
            if (session != g_await.session || offset != g_await.offset || dlen > g_await.cap ||
                28 + dlen > len) {
                log_line("clip-bridge: stale DATA session=%lu offset=%lu", session, (unsigned long)offset);
                continue;
            }
            if (crc32_of(buf + 28, dlen) != crc) {
                log_line("clip-bridge: DATA crc mismatch session=%lu offset=%lu",
                         session, (unsigned long)offset);
                g_await.waiting = 0; /* 失败：Read 返回错误，Explorer 中止 */
                continue;
            }
            memcpy(g_await.dst, buf + 28, dlen);
            g_await.got = dlen;
            g_await.end = (flags & FILE_FLAG_END) != 0;
            g_await.waiting = 0;
            if (g_pending.active && g_pending.session == session && dlen > 0) {
                pending_file *pf = &g_pending.files[g_await.index];
                if (!pf->done && (g_await.end || g_await.offset + dlen >= pf->size)) {
                    pf->done = 1;
                    maybe_finish_paste(session);
                }
            }
            continue;
        }
        if (sub == FILE_OP_DONE) {
            /* [sub][session][result]：宿主结束 XP→宿主拉取会话，或报会话错误 */
            unsigned long session = len >= 8 ? rd_u32(buf, 4) : 0;
            unsigned long result = len >= 12 ? rd_u32(buf, 8) : 0;
            if (g_pull.session == session) {
                if (g_pull.handle != NULL) {
                    CloseHandle(g_pull.handle);
                    g_pull.handle = NULL;
                }
                g_pull.session = 0;
                log_line("clip-bridge: pull session=%lu closed by host", session);
            }
            /* 供块方报错（源读不了等）：等待中的 Read 立刻失败，别干等超时 */
            if (g_await.waiting && g_await.session == session && result == FILE_RESULT_ERROR) {
                g_await.failed = 1;
                g_await.got = 0;
                g_await.waiting = 0;
            }
            continue;
        }
        if (sub == FILE_OP_OFFER) {
            continue; /* 方向不对：已确认丢弃 */
        }
        log_line("clip-bridge: unknown FILE sub=%lu, drop", sub);
    }
}

/* ---- G2H 生产：文本 / OFFER ---- */

static int send_text_to_guest(const wchar_t *text, unsigned long chars)
{
    frame_buf *f = &g_tx; /* 共享发送帧（见全局区注释：使用点严格顺序） */
    f->len = 0;
    for (unsigned long i = 0; i < chars; i++) {
        unsigned long ch = (unsigned long)(unsigned short)text[i];
        f->bytes[f->len] = (unsigned char)(ch & 0xFF);
        f->bytes[f->len + 1] = (unsigned char)((ch >> 8) & 0xFF);
        f->len += 2;
    }
    f->bytes[f->len] = 0;
    f->bytes[f->len + 1] = 0;
    f->len += 2;
    return g2h_transact(SHM_OP_TEXT, f->bytes, f->len);
}

/* XP 用户复制了文件：读 CF_HDROP 元数据发 OFFER。 */
static void send_offer_from_clipboard(void)
{
    if (!OpenClipboard(NULL)) {
        return;
    }
    HANDLE data = GetClipboardData(CF_HDROP);
    if (data == NULL) {
        CloseClipboard();
        return;
    }
    DROPFILES *df = (DROPFILES *)GlobalLock(data);
    if (df == NULL || !df->fWide) {
        if (df != NULL) {
            GlobalUnlock(data);
        }
        CloseClipboard();
        return;
    }
    const wchar_t *list = (const wchar_t *)((char *)df + df->pFiles);
    /* 先数一遍（≤32 个），再逐个取尺寸拼帧。 */
    unsigned long count = 0;
    for (const wchar_t *c = list; *c && count < MAX_OFFER_FILES; c += lstrlenW(c) + 1) {
        count++;
    }
    frame_buf *f = &g_tx; /* 共享发送帧（见全局区注释：使用点严格顺序） */
    f->len = 0;
    fb_u32(f, FILE_OP_OFFER);
    fb_u32(f, count);
    fb_u32(f, FILE_MODE_COPY); /* XP 剪贴板的 cut 语义 v1 不区分（不删 XP 源） */
    for (const wchar_t *c = list; *c; c += lstrlenW(c) + 1) {
        WIN32_FIND_DATAW wfd;
        unsigned long long size = 0;
        HANDLE find = FindFirstFileW(c, &wfd);
        if (find != INVALID_HANDLE_VALUE) {
            size = ((unsigned long long)wfd.nFileSizeHigh << 32) | wfd.nFileSizeLow;
            FindClose(find);
        }
        fb_u64(f, size);
        fb_utf16z(f, c);
        if (count > 0) {
            count--;
        }
        if (f->len > SHM_MAILBOX_DATA - 2) {
            break; /* 防越界：条目太多就截断（count 已上报会偏大，宿主按帧内实有解析） */
        }
    }
    GlobalUnlock(data);
    CloseClipboard();
    if (g2h_transact(SHM_OP_FILE, f->bytes, f->len)) {
        log_line("clip-bridge: offer sent (%lu files)", rd_u32(f->bytes, 4));
    }
}

/* ---- XP 复制检测 + H2G 消费的组合 tick ---- */

/* ivm-shared-folder.c：登录会话内收敛宿主共享文件夹的 net use 映射。 */
void ivm_shared_folder_tick(void);

static void bridge_tick(void)
{
    h2g_process();

    /* 共享文件夹收敛：必须在剪贴板 seq 的提前 return 之前，否则空闲时
     * （seq 不变）轮询被跳过，宿主切换开关要等一次剪贴板动作才生效。 */
    ivm_shared_folder_tick();

    DWORD seq = GetClipboardSequenceNumber();
    if (seq == g_last_seq) {
        return;
    }
    g_last_seq = seq;
    int handled = 0;
    if (OpenClipboard(NULL)) {
        if (GetClipboardData(CF_HDROP) != NULL) {
            CloseClipboard();
            send_offer_from_clipboard();
            handled = 1;
        } else {
            HANDLE data = GetClipboardData(CF_UNICODETEXT);
            if (data != NULL) {
                wchar_t *text = (wchar_t *)GlobalLock(data);
                if (text != NULL) {
                    DWORD cap = (DWORD)(GlobalSize(data) / 2);
                    DWORD wchars = 0;
                    while (wchars + 1 < cap && text[wchars] != 0) {
                        wchars++;
                    }
                    GlobalUnlock(data);
                    /* 自设回环：内容和上次自己写的一致就不回发 */
                    if (!(wchars == g_self_text_wchars &&
                          (wchars == 0 || memcmp(text, g_self_text, wchars * 2) == 0))) {
                        memcpy(g_self_text, text, wchars * 2);
                        g_self_text_wchars = wchars;
                        g_busy_tick = 1;
                        send_text_to_guest(text, wchars);
                    }
                    handled = 1;
                }
            }
            CloseClipboard();
        }
    }
    if (!handled) {
        /* 既无文本也无文件：多半是自己刚挂的虚拟文件（延迟渲染读不出内容）。
         * 所有权不动；用户复制图片等第三类内容同样落在这里（不回发）。 */
        log_line("clip-bridge: seq change without text/files (own virtual file?), keep");
    }
}

/* ---- 文本裸写（OLE 不可用时的回退路径，v3 行为） ---- */

static void apply_text_raw(void)
{
    unsigned long len = 0;
    while (g_text[len] != 0) {
        len++;
    }
    if (len < 1) {
        return;
    }
    HGLOBAL mem = GlobalAlloc(GMEM_MOVEABLE, (len + 1) * 2);
    if (mem == NULL) {
        return;
    }
    void *dst = GlobalLock(mem);
    if (dst == NULL) {
        GlobalFree(mem);
        return;
    }
    memcpy(dst, g_text, (len + 1) * 2);
    GlobalUnlock(mem);
    if (!OpenClipboard(NULL)) {
        GlobalFree(mem);
        return;
    }
    int ok = EmptyClipboard() && SetClipboardData(CF_UNICODETEXT, mem) != NULL;
    CloseClipboard();
    if (!ok) {
        GlobalFree(mem);
        return;
    }
    /* 自设回环基准（按内容） */
    g_self_text_wchars = len < SHM_MAILBOX_DATA / 2 - 1 ? (DWORD)len : SHM_MAILBOX_DATA / 2 - 1;
    memcpy(g_self_text, g_text, g_self_text_wchars * 2);
    g_last_seq = GetClipboardSequenceNumber();
}

/* ---- 主循环 ---- */

/* 由 res-agent.c 的合并入口（ivm_agent_entry）在登录会话里调用；会话互斥
 * InstantVmClipboardBridge 由合并入口统一持有判定，这里不再自查退出。 */
void bridge_main(void)
{
    crc32_init();

    /* 信箱没就绪就退出（安装脚本负责驱动先起）——文本与文件共用这条数据面。 */
    const unsigned long ioctl_info =
        ((unsigned long)0x22 << 16) | ((unsigned long)1 << 14) | ((unsigned long)0x801 << 2);
    struct
    {
        unsigned long phys_addr;
        unsigned long user_va;
        unsigned long size;
    } info = {0, 0, 0};
    DWORD got = 0;
    HANDLE dev = CreateFileA("\\\\.\\IVMSHM", GENERIC_READ | GENERIC_WRITE, 0,
                             NULL, OPEN_EXISTING, 0, NULL);
    if (dev == INVALID_HANDLE_VALUE) {
        char detail[80];
        wsprintfA(detail, "CreateFileA GetLastError=%lu (2=driver not running)", GetLastError());
        fatal_box("cannot open mailbox device \\\\.\\IVMSHM", detail);
        ExitProcess(1);
    }
    int ok = DeviceIoControl(dev, ioctl_info, NULL, 0, &info, sizeof(info), &got, NULL);
    CloseHandle(dev);
    if (!ok || got < sizeof(info) || info.size < 2 * SHM_BLOCK_SIZE || info.user_va == 0) {
        char detail[128];
        wsprintfA(detail, "gle=%lu ok=%lu got=%lu size=%lu",
                  (unsigned long)GetLastError(), (unsigned long)ok, got, info.size);
        fatal_box("mailbox query failed", detail);
        ExitProcess(1);
    }
    g_shm = (void *)info.user_va;
    if (mb_read32(g2h(), 0) != SHM_MAGIC) {
        mb_write32(g2h(), 0, SHM_MAGIC);
        mb_write32(g2h(), 4, 0);
        mb_write32(g2h(), 8, SHM_STATUS_EMPTY);
        mb_write32(g2h(), 12, 0);
    }
    if (mb_read32(h2g(), 0) != SHM_MAGIC) {
        mb_write32(h2g(), 0, SHM_MAGIC);
        mb_write32(h2g(), 4, 0);
        mb_write32(h2g(), 8, SHM_STATUS_EMPTY);
        mb_write32(h2g(), 12, 0);
    }
    log_line("clip-bridge: mailbox ready at %p", g_shm);

    g_cfText = CF_UNICODETEXT;
    g_cfFileDescA = (CLIPFORMAT)RegisterClipboardFormatA("FileGroupDescriptor");
    g_cfFileDescW = (CLIPFORMAT)RegisterClipboardFormatA("FileGroupDescriptorW");
    g_cfFileContents = (CLIPFORMAT)RegisterClipboardFormatA("FileContents");

    /* OLE：成了 → 文本/文件统一走数据对象；败了 → 纯文本裸写回退。 */
    HRESULT hr = OleInitialize(NULL);
    g_ole_ok = SUCCEEDED(hr);
    if (!g_ole_ok) {
        log_line("clip-bridge: OleInitialize hr=0x%08lX, text-only raw mode", (unsigned long)hr);
    }
    g_last_seq = GetClipboardSequenceNumber();

    raise_timer_resolution();

    MSG msg;
    for (;;) {
        bridge_tick();
        DWORD timeout = g_busy_tick ? POLL_ACTIVE_MS : POLL_IDLE_MS;
        g_busy_tick = 0;
        DWORD wait = MsgWaitForMultipleObjects(0, NULL, FALSE, timeout, QS_ALLINPUT);
        if (wait == WAIT_OBJECT_0) {
            while (PeekMessageA(&msg, NULL, 0, 0, PM_REMOVE)) {
                TranslateMessage(&msg);
                DispatchMessageA(&msg);
            }
        }
    }
}
