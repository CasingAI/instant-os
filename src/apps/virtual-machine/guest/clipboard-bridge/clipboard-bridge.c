/*
 * clipboard-bridge —— XP 侧桥（Windows XP，32 位，用户态）。
 *
 * 文本通道（v3，原有）：系统剪贴板 CF_UNICODETEXT ↔ ivm-shm.sys 共享内存信箱。
 * 文件通道（v8，todo/vm-remote-control 文件传输计划）：「桥接管」方案。
 *
 *   [宿主→XP] 文件APP复制/剪切 → H2G PENDING{session,mode,files}（只有名字+大小，
 *         目录条目以 / 结尾且 size=0；大清单按同 session 多帧追加，桥 150ms 无新帧
 *         判定收齐）→ 桥 OleSetClipboard 挂一个空 CF_HDROP 占位（Explorer 粘贴
 *         按钮立刻亮）→ 用户在目标位置 Ctrl+V → Explorer 调 IDataObject::GetData
 *         读 CF_HDROP → 桥探测到粘贴动作，不返回真实文件列表，而是启动接管：
 *         探测目标路径、弹出 XP 风格自绘进度对话框、逐目录 CreateDirectory、
 *         逐文件 REQ↔DATA 拉回宿主字节并 WriteFile 直接落盘 → 全部完成发
 *         DONE{ok}（cut 模式宿主据此删源）；用户取消/失败发 DONE{cancel|error}，
 *         已写完的保留，半成品按对话框提示清理。
 *
 *   [XP→宿主] 用户在 XP 复制文件 → 序列号变化 → 读 CF_HDROP 元数据 →
 *         G2H OFFER → 宿主（文件APP粘贴）逐块 H2G REQ{path,offset} →
 *         本桥 ReadFile 后 G2H DATA 应答 → 宿主 H2G DONE 结束会话。
 *
 * 桥接管绕开了 CF_HDROP 必须源路径真实存在、以及 OLE 虚拟文件 FileContents
 * 无法表达目录树的死结：剪贴板里只放一枚空 HDROP 占位符，真正的写入由桥自己
 * 完成。用户层面看到的是一个与 XP 系统复制对话框视觉一致的进度窗口。
 *
 * 回环防护：文本按内容（g_self_text）；文件按 g_own_seq 记录桥自己设置剪贴板
 * 后的序列号，seq 变化处理时若与 g_own_seq 相同则跳过（空 HDROP 占位不触发
 * OFFER）。
 *
 * 信箱布局与 ivm-shm.sys / Instant-virtual-machine src/ivm-shm.ts 一一对应：
 *   块内 +0 magic 'IVMX' / +4 seq / +8 status(0空 1就绪 2已读) / +12 len / +16 data
 *   status 高 16 位 = op（0=文本 1=文件帧）；文件帧 data 首个 u32 是子类型。
 *   本桥所有握手判断都按低 16 位比较——宿主 ACK 保留 op 位（如 0x20002），
 *   按 ==2 精确比较会永远等不到。
 *
 * 构建：scripts/build-ivm-agent.sh 合编进 ivm-agent.exe（zig cc 交叉编译，
 * -nostdlib；memset/memcpy 共用 res-agent.c 的实现，主循环 bridge_main 由
 * 合并入口在登录会话里调用，PE 版本补 5.01；导入 kernel32/user32/gdi32
 * /advapi32/ole32/shell32/oleaut32）。
 * 日志走 OutputDebugStringA。安装：install-agent-v2.bat 写 HKCU Run 自启
 * （剪贴板在交互会话里，服务摸不到）。
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <ole2.h>
#include <shlobj.h>
#include <exdisp.h>
#include <shldisp.h>
#include <oaidl.h>
#include <oleauto.h>
#include <stdarg.h>
#include <stddef.h>

#define POLL_IDLE_MS 150            /* 稳态轮询周期 */
#define POLL_ACTIVE_MS 4            /* 文件会话活跃期主循环轮询周期 */
#define POLL_WAIT_MS 1              /* 阻塞等待循环的节拍（定时器精度已提到 1ms） */
#define G2H_ACK_TIMEOUT_MS 3000     /* 宿主不确认就复位 G2H 信箱 */
#define STREAM_DATA_TIMEOUT_MS 5000 /* 桥拉一块等宿主 DATA 的上限 */
#define PENDING_COLLECT_MS 150      /* 同 session 连续 PENDING 帧之间的收齐判定 */

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

#define MAX_OFFER_FILES 4096
#define MAX_NAME_CHARS 260

/* 无 CRT（-nostdlib）：memset/memcpy 共用 res-agent.c 的实现（合编进同一个
 * ivm-agent.exe，两边都定义会撞符号）；这里只带桥自己用的 memcmp/wcslen
 * /my_wcsrchr（目标路径拼接、目录判断会用到）。 */
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

size_t wcslen(const wchar_t *s)
{
    const wchar_t *p = s;
    while (*p) {
        p++;
    }
    return (size_t)(p - s);
}

static const wchar_t *my_wcsrchr(const wchar_t *s, wchar_t c)
{
    const wchar_t *last = NULL;
    while (*s) {
        if (*s == c) {
            last = s;
        }
        s++;
    }
    return last;
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

/* 前向声明。 */
static void h2g_process(void);
static void apply_text_raw(void);
static void own_clipboard(void);

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

static wchar_t rd_u16(const unsigned char *b, unsigned long offset)
{
    return (wchar_t)(unsigned short)((unsigned long)b[offset] |
                                     ((unsigned long)b[offset + 1] << 8));
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
    int is_dir;
    int done; /* 本轮粘贴中该条目已写入完成 */
} pending_file;

typedef struct {
    int active;
    unsigned long session;
    unsigned long mode; /* FILE_MODE_* */
    unsigned long count;
    unsigned long capacity;
    pending_file *files; /* HeapAlloc */
    int collected;       /* 150ms 无新帧判定收齐 */
    DWORD last_pending_ms;
    int done_sent;       /* 本轮粘贴的 DONE 已上报 */
    int cancelled;       /* 用户点了取消 */
    int in_progress;     /* 正在写入（防重复进入接管） */
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
    unsigned long index; /* pending 文件下标 */
    unsigned long long offset;
    unsigned char *dst;
    unsigned long cap;
    unsigned long got;
    int end;
    int failed; /* 宿主报会话错误：Read 立刻失败，不等超时 */
} g_await;

static int g_ole_ok; /* OleInitialize 成功 → 文件通道可用 */
static DWORD g_last_seq;
static DWORD g_own_seq; /* 桥自己设剪贴板后的 seq，跳过自触发 */
static int g_busy_tick; /* 流/会话活动 → 主循环快轮询 */

/* 大缓冲一律静态（单线程 STA，无并发）。 */
static frame_buf g_tx;
static unsigned char g_h2g_buf[SHM_MAILBOX_DATA];
static unsigned char g_pull_chunk[FILE_MAX_CHUNK];
static wchar_t g_target_path[MAX_NAME_CHARS];

/* ---- PENDING 清单分片管理 ---- */

static void pending_reset(void)
{
    if (g_pending.files) {
        HeapFree(GetProcessHeap(), 0, g_pending.files);
    }
    memset(&g_pending, 0, sizeof(g_pending));
}

static int pending_grow(void)
{
    unsigned long newcap = g_pending.capacity ? g_pending.capacity * 2 : 64;
        pending_file *next = (pending_file *)HeapReAlloc(
            GetProcessHeap(), HEAP_ZERO_MEMORY, g_pending.files,
            newcap * sizeof(pending_file));
    if (!next) {
        return 0;
    }
    g_pending.files = next;
    g_pending.capacity = newcap;
    return 1;
}

static int pending_append(unsigned long session, unsigned long mode,
                          const unsigned char *buf, unsigned long len)
{
    if (g_pending.active && g_pending.session != session) {
        pending_reset();
    }
    if (!g_pending.active) {
        g_pending.files = (pending_file *)HeapAlloc(
            GetProcessHeap(), HEAP_ZERO_MEMORY, 64 * sizeof(pending_file));
        if (!g_pending.files) {
            return 0;
        }
        g_pending.capacity = 64;
        g_pending.session = session;
        g_pending.mode = mode;
        g_pending.active = 1;
        g_pending.collected = 0;
        g_pending.done_sent = 0;
        g_pending.cancelled = 0;
        g_pending.in_progress = 0;
    }

    unsigned long count = len >= 8 ? rd_u32(buf, 4) : 0;
    unsigned long off = 16;
    int ok = 1;
    for (unsigned long i = 0; i < count && ok; i++) {
        if (off + 8 > len) {
            ok = 0;
            break;
        }
        unsigned long long size = rd_u64(buf, off);
        off += 8;
        wchar_t name[MAX_NAME_CHARS];
        unsigned long n = 0;
        while (off + 1 < len && !(buf[off] == 0 && buf[off + 1] == 0) && n < MAX_NAME_CHARS - 1) {
            name[n] = (wchar_t)(unsigned short)(buf[off] | (buf[off + 1] << 8));
            n++;
            off += 2;
        }
        if (off + 2 > len) {
            ok = 0;
            break;
        }
        name[n] = 0;
        off += 2;

        if (g_pending.count >= g_pending.capacity) {
            if (!pending_grow()) {
                ok = 0;
                break;
            }
        }
        pending_file *pf = &g_pending.files[g_pending.count++];
        lstrcpynW(pf->name, name, MAX_NAME_CHARS);
        pf->size = size;
        pf->is_dir = (n > 0 && name[n - 1] == L'/');
        pf->done = 0;
    }
    g_pending.last_pending_ms = GetTickCount();
    g_pending.collected = 0;
    return ok;
}

/* ---- CF_HDROP 空占位 + OLE 数据对象（仅暴露 CF_HDROP） ---- */

static HGLOBAL make_empty_hdrop(void)
{
    /* DROPFILES + 一个空的宽字符列表（双 NUL）。 */
    size_t bytes = sizeof(DROPFILES) + sizeof(wchar_t) * 2;
    HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, bytes);
    if (!h) {
        return NULL;
    }
    DROPFILES *df = (DROPFILES *)GlobalLock(h);
    if (!df) {
        GlobalFree(h);
        return NULL;
    }
    df->pFiles = sizeof(DROPFILES);
    df->fWide = TRUE;
    GlobalUnlock(h);
    return h;
}

/* Explorer 读 CF_HDROP 时触发接管探测。 */
static int g_takeover_probe;

static HRESULT render_empty_hdrop(HGLOBAL *out)
{
    HGLOBAL h = make_empty_hdrop();
    if (!h) {
        return STG_E_MEDIUMFULL;
    }
    *out = h;
    g_takeover_probe = 1;
    return S_OK;
}

typedef struct {
    IEnumFORMATETCVtbl *lpVtbl;
    ULONG refs;
    ULONG pos;
    FORMATETC format;
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
    while (n < celt && e->pos < 1) {
        rgelt[n] = e->format;
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
    if (e->pos > 1) {
        e->pos = 1;
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

static ULONG STDMETHODCALLTYPE data_AddRef(IDataObject *This);
static ULONG STDMETHODCALLTYPE data_Release(IDataObject *This);

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

static HRESULT STDMETHODCALLTYPE data_GetData(IDataObject *This, FORMATETC *fmt, STGMEDIUM *medium)
{
    (void)This;
    if (fmt == NULL || medium == NULL) {
        return E_POINTER;
    }
    if (fmt->dwAspect != DVASPECT_CONTENT) {
        return DV_E_DVASPECT;
    }
    if (fmt->cfFormat == CF_HDROP && (fmt->tymed & TYMED_HGLOBAL)) {
        HGLOBAL h = NULL;
        HRESULT hr = render_empty_hdrop(&h);
        if (FAILED(hr)) {
            return hr;
        }
        medium->tymed = TYMED_HGLOBAL;
        medium->hGlobal = h;
        medium->pUnkForRelease = NULL;
        return S_OK;
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
    if (fmt->cfFormat == CF_HDROP) {
        return S_OK;
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
    e->pos = 0;
    e->format.cfFormat = CF_HDROP;
    e->format.ptd = NULL;
    e->format.dwAspect = DVASPECT_CONTENT;
    e->format.lindex = -1;
    e->format.tymed = TYMED_HGLOBAL;
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
    g_own_seq = GetClipboardSequenceNumber();
    g_last_seq = g_own_seq;
}

/* COM 接口 GUID（-nostdlib 没有 uuid 库，自行静态定义）。 */
static const IID kIID_NULL = {0x00000000u, 0x0000u, 0x0000u,
                              {0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u}};
static const CLSID kCLSID_ShellWindows = {0x9BA05972u, 0xF6A8u, 0x11CFu,
                                           {0xA4u, 0x42u, 0x00u, 0xA0u, 0xC9u, 0x0Au, 0x8Fu, 0x39u}};
static const IID kIID_IShellWindows = {0x85CB6900u, 0x4D95u, 0x11CFu,
                                        {0x96u, 0x0Cu, 0x00u, 0x80u, 0xC7u, 0xF4u, 0xEEu, 0x85u}};

/* ---- 目标路径探测 ---- */

static int get_special_folder_path(int csidl, wchar_t *out, unsigned long cap)
{
    return SHGetFolderPathW(NULL, csidl, NULL, 0, out) == S_OK;
}

/* 通过 IShellWindows::FindWindowSW 拿前台 Explorer/桌面窗口对应的文件夹路径。 */
static int resolve_shell_window_path(HWND hwnd, wchar_t *out, unsigned long cap)
{
    (void)cap;
    IShellWindows *sw = NULL;
    if (FAILED(CoCreateInstance(&kCLSID_ShellWindows, NULL, CLSCTX_ALL,
                                &kIID_IShellWindows, (void **)&sw))) {
        return 0;
    }
    VARIANT vloc;
    VariantInit(&vloc);
    V_VT(&vloc) = VT_I4;
    V_I4(&vloc) = (LONG)(LONG_PTR)hwnd;
    long found_hwnd = 0;
    IDispatch *view = NULL;
    HRESULT hr = sw->lpVtbl->FindWindowSW(sw, &vloc, NULL, SWC_EXPLORER,
                                          &found_hwnd, 1, &view);
    VariantClear(&vloc);
    sw->lpVtbl->Release(sw);
    if (FAILED(hr) || view == NULL) {
        return 0;
    }

    DISPID dispid = 0;
    LPOLESTR name = (LPOLESTR)L"Folder";
    if (SUCCEEDED(view->lpVtbl->GetIDsOfNames(view, &kIID_NULL, &name, 1,
                                              LOCALE_USER_DEFAULT, &dispid))) {
        DISPPARAMS params = {NULL, NULL, 0, 0};
        VARIANT result;
        VariantInit(&result);
        hr = view->lpVtbl->Invoke(view, dispid, &kIID_NULL,
                                  LOCALE_USER_DEFAULT, DISPATCH_PROPERTYGET,
                                  &params, &result, NULL, NULL);
        if (SUCCEEDED(hr) && V_VT(&result) == VT_DISPATCH && V_DISPATCH(&result)) {
            IDispatch *folder = V_DISPATCH(&result);
            DISPID path_id = 0;
            LPOLESTR path_name = (LPOLESTR)L"Path";
            if (SUCCEEDED(folder->lpVtbl->GetIDsOfNames(folder, &kIID_NULL, &path_name, 1,
                                                        LOCALE_USER_DEFAULT, &path_id))) {
                VARIANT path;
                VariantInit(&path);
                if (SUCCEEDED(folder->lpVtbl->Invoke(folder, path_id, &kIID_NULL,
                                                       LOCALE_USER_DEFAULT, DISPATCH_PROPERTYGET,
                                                       &params, &path, NULL, NULL))) {
                    if (V_VT(&path) == VT_BSTR && V_BSTR(&path)) {
                        lstrcpynW(out, V_BSTR(&path), cap);
                        VariantClear(&path);
                        view->lpVtbl->Release(view);
                        return 1;
                    }
                    VariantClear(&path);
                }
            }
        }
        VariantClear(&result);
    }
    view->lpVtbl->Release(view);
    return 0;
}

/* 用 SHBrowseForFolderW 让用户手选目标位置（兜底）。 */
static int pick_target_folder(wchar_t *out, unsigned long cap)
{
    BROWSEINFOW bi;
    memset(&bi, 0, sizeof(bi));
    bi.lpszTitle = L"选择粘贴位置";
    bi.ulFlags = BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE;
    LPITEMIDLIST pidl = SHBrowseForFolderW(&bi);
    if (!pidl) {
        return 0;
    }
    int ok = SHGetPathFromIDListW(pidl, out) ? 1 : 0;
    CoTaskMemFree(pidl);
    return ok;
}

/* 从当前前台窗口/右键菜单所有者推导目标路径。 */
static int resolve_target_path(wchar_t *out, unsigned long cap)
{
    HWND hwnd = GetForegroundWindow();
    /* 桌面窗口（ShellWindow）→ 桌面目录。 */
    if (hwnd == GetShellWindow()) {
        return get_special_folder_path(CSIDL_DESKTOPDIRECTORY, out, cap);
    }
    if (hwnd) {
        if (resolve_shell_window_path(hwnd, out, cap)) {
            return 1;
        }
        /* 右键菜单所有者回溯（目标窗口是菜单的 owner）。 */
        HWND owner = GetWindow(hwnd, GW_OWNER);
        if (owner && resolve_shell_window_path(owner, out, cap)) {
            return 1;
        }
    }
    return 0;
}

/* ---- XP 风格自绘进度对话框 ---- */

#define IDC_PROGRESS_BAR 100
#define IDC_PROGRESS_TEXT 101
#define IDC_PROGRESS_FILE 102
#define IDCANCEL 2

static HWND g_progress_hwnd;

static LRESULT CALLBACK progress_wndproc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam)
{
    (void)lparam;
    switch (msg) {
        case WM_CREATE:
            return 0;
        case WM_COMMAND:
            if (LOWORD(wparam) == IDCANCEL) {
                g_pending.cancelled = 1;
            }
            return 0;
        case WM_CLOSE:
            g_pending.cancelled = 1;
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wparam, lparam);
}

static int init_common_controls(void)
{
    HMODULE mod = LoadLibraryW(L"comctl32.dll");
    if (!mod) {
        return 0;
    }
    BOOL (WINAPI *icc)(LPINITCOMMONCONTROLSEX) =
        (BOOL (WINAPI *)(LPINITCOMMONCONTROLSEX))GetProcAddress(mod, "InitCommonControlsEx");
    if (!icc) {
        return 0;
    }
    INITCOMMONCONTROLSEX iccex;
    iccex.dwSize = sizeof(iccex);
    iccex.dwICC = ICC_PROGRESS_CLASS;
    return icc(&iccex) ? 1 : 0;
}

static void progress_create(void)
{
    if (g_progress_hwnd) {
        return;
    }
    static int registered = 0;
    if (!registered) {
        WNDCLASSEXW wc;
        memset(&wc, 0, sizeof(wc));
        wc.cbSize = sizeof(wc);
        wc.lpfnWndProc = progress_wndproc;
        wc.hInstance = GetModuleHandleW(NULL);
        wc.hCursor = LoadCursorW(NULL, (LPCWSTR)IDC_ARROW);
        wc.hbrBackground = (HBRUSH)(COLOR_3DFACE + 1);
        wc.lpszClassName = L"InstantVmProgress";
        RegisterClassExW(&wc);
        registered = 1;
    }
    init_common_controls();
    HINSTANCE hinst = GetModuleHandleW(NULL);
    g_progress_hwnd = CreateWindowExW(
        WS_EX_DLGMODALFRAME,
        L"InstantVmProgress",
        L"正在复制...",
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_VISIBLE,
        CW_USEDEFAULT, CW_USEDEFAULT, 480, 140,
        NULL, NULL, hinst, NULL);
    if (!g_progress_hwnd) {
        return;
    }
    CreateWindowExW(0, L"msctls_progress32", NULL,
                    WS_CHILD | WS_VISIBLE | PBS_SMOOTH,
                    20, 60, 420, 18,
                    g_progress_hwnd, (HMENU)(UINT_PTR)IDC_PROGRESS_BAR, hinst, NULL);
    CreateWindowExW(0, L"STATIC", L"",
                    WS_CHILD | WS_VISIBLE | SS_LEFTNOWORDWRAP,
                    20, 20, 420, 18,
                    g_progress_hwnd, (HMENU)(UINT_PTR)IDC_PROGRESS_FILE, hinst, NULL);
    CreateWindowExW(0, L"STATIC", L"0%",
                    WS_CHILD | WS_VISIBLE | SS_RIGHT,
                    380, 20, 60, 18,
                    g_progress_hwnd, (HMENU)(UINT_PTR)IDC_PROGRESS_TEXT, hinst, NULL);
    CreateWindowExW(0, L"BUTTON", L"取消",
                    WS_CHILD | WS_VISIBLE | BS_DEFPUSHBUTTON,
                    360, 90, 80, 24,
                    g_progress_hwnd, (HMENU)(UINT_PTR)IDCANCEL, hinst, NULL);
}

static void progress_destroy(void)
{
    if (g_progress_hwnd) {
        DestroyWindow(g_progress_hwnd);
        g_progress_hwnd = NULL;
    }
}

static void progress_update(unsigned long long done, unsigned long long total, const wchar_t *name)
{
    if (!g_progress_hwnd) {
        return;
    }
    HWND bar = GetDlgItem(g_progress_hwnd, IDC_PROGRESS_BAR);
    if (bar) {
        DWORD range = total > 0xFFFFFFFFu ? 0xFFFFFFFFu : (DWORD)total;
        SendMessageW(bar, PBM_SETRANGE32, 0, (LPARAM)(LONG)range);
        DWORD pos = 0;
        if (total > 0) {
            /* 避免 64 位除法调用 CRT（-nostdlib）：32 位缩放足够 UI 精度。 */
            unsigned long long t = total;
            unsigned long long d = done;
            if (t > 0xFFFFFFFFu) {
                d >>= 1;
                t >>= 1;
            }
            DWORD p = (DWORD)((DWORD)d * 10000u / (DWORD)t);
            if (p > 10000) {
                p = 10000;
            }
            pos = p;
        }
        SendMessageW(bar, PBM_SETPOS, (WPARAM)pos, 0);
    }
    HWND file_label = GetDlgItem(g_progress_hwnd, IDC_PROGRESS_FILE);
    if (file_label) {
        SetWindowTextW(file_label, name ? name : L"");
    }
    HWND pct_label = GetDlgItem(g_progress_hwnd, IDC_PROGRESS_TEXT);
    if (pct_label) {
        wchar_t text[32];
        unsigned long pct = 0;
        if (total > 0) {
            unsigned long long t = total;
            unsigned long long d = done;
            if (t > 0xFFFFFFFFu) {
                d >>= 1;
                t >>= 1;
            }
            pct = (unsigned long)((DWORD)d * 100u / (DWORD)t);
            if (pct > 100) {
                pct = 100;
            }
        }
        wsprintfW(text, L"%lu%%", pct);
        SetWindowTextW(pct_label, text);
    }
}

/* 对话框消息泵（非阻塞，调用方循环里用）。 */
static void progress_pump(void)
{
    MSG msg;
    while (PeekMessageW(&msg, NULL, 0, 0, PM_REMOVE)) {
        if (!IsDialogMessageW(g_progress_hwnd, &msg)) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

/* ---- 写文件引擎：按清单创建目录 / REQ 拉数据写文件 ---- */

/* 去掉路径末尾的 \ 或 /，供 CreateDirectoryW 使用（带末尾分隔符会报
 * ERROR_INVALID_NAME/目录名无效）。 */
static void strip_trailing_seps(wchar_t *s)
{
    unsigned long len = 0;
    while (s[len]) {
        len++;
    }
    while (len > 0 && (s[len - 1] == L'\\' || s[len - 1] == L'/')) {
        s[len - 1] = 0;
        len--;
    }
}

static int ensure_directory(const wchar_t *path)
{
    wchar_t norm[MAX_NAME_CHARS];
    {
        unsigned long i = 0;
        while (path[i] && i < MAX_NAME_CHARS - 1) {
            norm[i] = path[i];
            i++;
        }
        norm[i] = 0;
    }
    strip_trailing_seps(norm);

    /* 空路径或者只剩盘符（如 C:）都认为已存在。 */
    if (norm[0] == 0 || (norm[1] == L':' && norm[2] == 0)) {
        return 1;
    }

    DWORD attr = GetFileAttributesW(norm);
    if (attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY)) {
        return 1;
    }

    /* 先建父目录。 */
    const wchar_t *slash = my_wcsrchr(norm, L'\\');
    if (!slash) {
        slash = my_wcsrchr(norm, L'/');
    }
    if (slash) {
        unsigned long parent_len = (unsigned long)(slash - norm);
        /* 根目录（C:\、\ 开头等）不递归。 */
        if (parent_len > 0 && !(norm[1] == L':' && parent_len == 2)) {
            wchar_t parent[MAX_NAME_CHARS];
            unsigned long j = 0;
            while (j < parent_len && j < MAX_NAME_CHARS - 1) {
                parent[j] = norm[j];
                j++;
            }
            parent[j] = 0;
            if (!ensure_directory(parent)) {
                return 0;
            }
        }
    }

    if (CreateDirectoryW(norm, NULL)) {
        return 1;
    }
    DWORD err = GetLastError();
    if (err == ERROR_ALREADY_EXISTS) {
        attr = GetFileAttributesW(norm);
        if (attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY)) {
            return 1;
        }
    }
    return 0;
}

static int pull_block(unsigned long session, const wchar_t *name,
                      unsigned long long offset, unsigned char *dst,
                      unsigned long want, unsigned long *got_out, int *end_out)
{
    frame_buf *f = &g_tx;
    f->len = 0;
    fb_u32(f, FILE_OP_REQ);
    fb_u32(f, session);
    fb_u32(f, offset == 0 ? FILE_FLAG_START : 0);
    fb_u64(f, offset);
    fb_u32(f, want);
    unsigned long name_chars = 0;
    while (name[name_chars]) {
        name_chars++;
    }
    fb_u32(f, name_chars * 2 + 2);
    fb_utf16z(f, name);
    if (!g2h_transact(SHM_OP_FILE, f->bytes, f->len)) {
        return 0;
    }
    g_await.waiting = 1;
    g_await.session = session;
    g_await.index = 0;
    g_await.offset = offset;
    g_await.dst = dst;
    g_await.cap = want;
    g_await.got = 0;
    g_await.end = 0;
    g_await.failed = 0;
    DWORD waited = 0;
    while (g_await.waiting) {
        if (waited >= STREAM_DATA_TIMEOUT_MS) {
            g_await.waiting = 0;
            return 0;
        }
        Sleep(POLL_WAIT_MS);
        waited += POLL_WAIT_MS;
        h2g_process();
        progress_pump();
    }
    if (g_await.failed) {
        return 0;
    }
    *got_out = g_await.got;
    *end_out = g_await.end;
    return 1;
}

static unsigned long long total_pending_bytes(void)
{
    unsigned long long total = 0;
    for (unsigned long i = 0; i < g_pending.count; i++) {
        total += g_pending.files[i].size;
    }
    return total;
}

static int write_file_to_target(const wchar_t *target_dir, const pending_file *pf,
                                unsigned long long *done_bytes)
{
    wchar_t full_path[MAX_NAME_CHARS * 2];
    wsprintfW(full_path, L"%s\\%s", target_dir, pf->name);
    /* 名字里的 / 换成 \ */
    for (wchar_t *p = full_path; *p; p++) {
        if (*p == L'/') {
            *p = L'\\';
        }
    }

    progress_update(*done_bytes, total_pending_bytes(), pf->name);

    HANDLE h = CreateFileW(full_path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
                           FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) {
        return 0;
    }

    unsigned long long offset = 0;
    int ok = 1;
    while (offset < pf->size && ok && !g_pending.cancelled) {
        unsigned long want = (unsigned long)(pf->size - offset);
        if (want > FILE_MAX_CHUNK) {
            want = FILE_MAX_CHUNK;
        }
        unsigned long got = 0;
        int end = 0;
        if (!pull_block(g_pending.session, pf->name, offset, g_pull_chunk, want, &got, &end)) {
            ok = 0;
            break;
        }
        if (got > 0) {
            DWORD written = 0;
            if (!WriteFile(h, g_pull_chunk, got, &written, NULL) || written != got) {
                ok = 0;
                break;
            }
        }
        offset += got;
        *done_bytes += got;
        if (end || offset >= pf->size) {
            break;
        }
        if (got == 0) {
            ok = 0;
            break;
        }
        progress_update(*done_bytes, total_pending_bytes(), pf->name);
    }
    CloseHandle(h);
    if (!ok || g_pending.cancelled) {
        DeleteFileW(full_path);
        return 0;
    }
    return 1;
}

static int write_pending_files(const wchar_t *target_dir)
{
    unsigned long long done_bytes = 0;
    int all_ok = 1;
    for (unsigned long i = 0; i < g_pending.count && !g_pending.cancelled; i++) {
        pending_file *pf = &g_pending.files[i];
        if (pf->done) {
            done_bytes += pf->size;
            continue;
        }
        wchar_t full_path[MAX_NAME_CHARS * 2];
        wsprintfW(full_path, L"%s\\%s", target_dir, pf->name);
        for (wchar_t *p = full_path; *p; p++) {
            if (*p == L'/') {
                *p = L'\\';
            }
        }

        if (pf->is_dir) {
            progress_update(done_bytes, total_pending_bytes(), pf->name);
            if (!ensure_directory(full_path)) {
                all_ok = 0;
                break;
            }
        } else {
            if (!write_file_to_target(target_dir, pf, &done_bytes)) {
                all_ok = 0;
                break;
            }
        }
        pf->done = 1;
    }
    return all_ok && !g_pending.cancelled;
}

/* ---- H2G 消费：文本 / PENDING / CLEAR / REQ 应答 / DATA 派发 / DONE ---- */

/* 宿主文本换行多为裸 \n（macOS/浏览器惯例），XP 程序（记事本等）只认
 * \r\n：落 g_text 前统一转 CRLF。\r\n 原样保留，孤立 \r/\n 都补成 \r\n；
 * 超过 cap 截断（与调用方 chars 钳位同界）。返回写出字符数。 */
static unsigned long text_to_crlf(const unsigned char *src, unsigned long chars,
                                  wchar_t *dst, unsigned long cap)
{
    unsigned long out = 0;
    for (unsigned long i = 0; i < chars && out < cap; i++) {
        wchar_t c = rd_u16(src, i * 2);
        if (c == L'\r' && (i + 1 >= chars || rd_u16(src, (i + 1) * 2) != L'\n')) {
            dst[out++] = L'\r';
            if (out < cap) {
                dst[out++] = L'\n';
            }
        } else if (c == L'\n') {
            dst[out++] = L'\r';
            if (out < cap) {
                dst[out++] = L'\n';
            }
        } else {
            dst[out++] = c;
        }
    }
    return out;
}

/* 主循环与流 Read 都可能进来（流 Read 阻塞期间只有它跑）。 */
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
            unsigned long written =
                text_to_crlf(buf, chars, g_text, SHM_MAILBOX_DATA / 2 - 1);
            g_text[written] = 0;
            g_text_ready = 1;
            log_line("clip-bridge: host text(%lu chars) -> clipboard", written);
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
                log_line("clip-bridge: bad PENDING count=%lu session=%lu", count, session);
                continue;
            }
            if (!pending_append(session, mode, buf, len)) {
                log_line("clip-bridge: pending append failed session=%lu", session);
                continue;
            }
            log_line("clip-bridge: pending partial session=%lu total=%lu mode=%s",
                     session, g_pending.count, mode == FILE_MODE_CUT ? "cut" : "copy");
            if (g_ole_ok) {
                own_clipboard(); /* 空 CF_HDROP 占位 */
                log_line("clip-bridge: empty HDROP placeholder set (paste button active)");
            }
            continue;
        }
        if (sub == FILE_OP_CLEAR) {
            if (g_pending.active) {
                pending_reset();
                if (g_ole_ok) {
                    OleSetClipboard(NULL);
                    g_own_seq = GetClipboardSequenceNumber();
                    g_last_seq = g_own_seq;
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
                    frame_buf *f = &g_tx;
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
            frame_buf *f = &g_tx;
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
                log_line("clip-bridge: stale DATA session=%lu offset=%lu",
                         session, (unsigned long)offset);
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
    frame_buf *f = &g_tx;
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
    /* 先数一遍（≤4096 个），再逐个取尺寸拼帧。 */
    unsigned long count = 0;
    for (const wchar_t *c = list; *c && count < MAX_OFFER_FILES; c += lstrlenW(c) + 1) {
        count++;
    }
    frame_buf *f = &g_tx;
    f->len = 0;
    fb_u32(f, FILE_OP_OFFER);
    fb_u32(f, count);
    fb_u32(f, FILE_MODE_COPY); /* XP 剪贴板的 cut 语义 v1 不区分 */
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
        if (f->len > SHM_MAILBOX_DATA - 2) {
            break; /* 防越界 */
        }
    }
    GlobalUnlock(data);
    CloseClipboard();
    if (g2h_transact(SHM_OP_FILE, f->bytes, f->len)) {
        log_line("clip-bridge: offer sent (%lu files)", rd_u32(f->bytes, 4));
    }
}

/* ---- 桥接管状态机 ---- */

static void send_done(unsigned long result)
{
    if (!g_pending.active || g_pending.done_sent) {
        return;
    }
    frame_buf *f = &g_tx;
    f->len = 0;
    fb_u32(f, FILE_OP_DONE);
    fb_u32(f, g_pending.session);
    fb_u32(f, result);
    g_pending.done_sent = 1;
    g2h_transact(SHM_OP_FILE, f->bytes, f->len);
    log_line("clip-bridge: takeover done session=%lu result=%lu files=%lu",
             g_pending.session, result, g_pending.count);
}

static void run_takeover(void)
{
    if (!g_pending.active || g_pending.in_progress || g_pending.done_sent) {
        return;
    }
    g_pending.in_progress = 1;

    int resolved = resolve_target_path(g_target_path, MAX_NAME_CHARS);
    if (!resolved) {
        resolved = pick_target_folder(g_target_path, MAX_NAME_CHARS);
    }
    if (!resolved) {
        g_pending.in_progress = 0;
        g_pending.cancelled = 1;
        send_done(FILE_RESULT_CANCEL);
        return;
    }

    log_line("clip-bridge: takeover target=%S", g_target_path);
    progress_create();

    int ok = write_pending_files(g_target_path);
    progress_destroy();

    if (g_pending.cancelled) {
        send_done(FILE_RESULT_CANCEL);
    } else if (!ok) {
        send_done(FILE_RESULT_ERROR);
        MessageBoxW(NULL, L"粘贴过程中写入文件失败。", L"复制失败",
                    MB_OK | MB_ICONERROR);
    } else {
        send_done(FILE_RESULT_OK);
    }
    g_pending.in_progress = 0;
}

/* ---- XP 复制检测 + H2G 消费的组合 tick ---- */

/* ivm-shared-folder.c：登录会话内收敛宿主共享文件夹的 net use 映射。 */
void ivm_shared_folder_tick(void);

static void bridge_tick(void)
{
    h2g_process();

    /* 共享文件夹收敛：必须在剪贴板 seq 的提前 return 之前。 */
    ivm_shared_folder_tick();

    /* PENDING 分片收齐判定。 */
    if (g_pending.active && !g_pending.collected && !g_pending.in_progress) {
        DWORD elapsed = GetTickCount() - g_pending.last_pending_ms;
        if (elapsed > PENDING_COLLECT_MS) {
            g_pending.collected = 1;
            log_line("clip-bridge: pending collected session=%lu files=%lu",
                     g_pending.session, g_pending.count);
        }
    }

    /* Explorer 调 GetData(CF_HDROP) 触发接管。 */
    if (g_takeover_probe && g_pending.active && g_pending.collected &&
        !g_pending.in_progress && !g_pending.done_sent) {
        g_takeover_probe = 0;
        run_takeover();
    }

    DWORD seq = GetClipboardSequenceNumber();
    if (seq == g_last_seq) {
        return;
    }
    g_last_seq = seq;

    /* 跳过自己设空 HDROP 导致的序列号变化。 */
    if (g_own_seq && seq == g_own_seq) {
        return;
    }

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
        log_line("clip-bridge: seq change without text/files (own placeholder?), keep");
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
    g_own_seq = GetClipboardSequenceNumber();
    g_last_seq = g_own_seq;
}

/* ---- 主循环 ---- */

void bridge_main(void)
{
    crc32_init();

    const unsigned long ioctl_info =
        ((unsigned long)0x22 << 16) | ((unsigned long)1 << 14) | ((unsigned long)0x801 << 2);
    struct {
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

    /* OLE：成了 → 文件/文本统一走数据对象；败了 → 纯文本裸写回退。 */
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
