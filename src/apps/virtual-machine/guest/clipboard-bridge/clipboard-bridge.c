/*
 * clipboard-bridge —— XP 侧剪贴板桥（Windows XP，32 位，用户态）。
 *
 * 把系统剪贴板（CF_UNICODETEXT）与 ivm-shm.sys 的共享内存信箱接起来：
 *   [G2H] 用户在 XP 里复制 → GetClipboardSequenceNumber 变化 → 读剪贴板
 *         → 写入低 32KB 信箱（seq+1, status=1）→ v86 宿主 200ms 轮询读走
 *         → 回 status=2 确认（3 秒无人收就复位信箱，防止卡住后续复制）
 *   [H2G] v86 宿主写高 32KB 信箱（status=1）→ 本桥 150ms 轮询发现 →
 *         EmptyClipboard + SetClipboardData → 回 status=2
 * 防回环：桥自己 Set 的内容记为 lastSelfText，序列号再变时内容相同就不回发。
 *
 * 信箱布局与 ivm-shm.sys / Instant-virtual-machine src/ivm-shm.ts 一一对应：
 *   块内 +0 magic 'IVMX' / +4 seq / +8 status(0空 1就绪 2已读) / +12 len / +16 data
 *   data 是 UTF-16LE 裸字节（XP 原生编码，双向零转换）。
 *
 * 构建：scripts/build-clipboard-bridge.sh（zig cc 交叉编译，同 res-agent：
 * -nostdlib 自带 memset/memcpy，入口指到 bridge_entry，PE 版本补 5.01）。
 * 日志走 OutputDebugStringA（GUI 子系统无控制台）。
 * 安装：install-agent-v2.bat 写 HKCU Run 自启（剪贴板在交互会话里，服务摸不到）。
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdarg.h>
#include <stddef.h>

#define BRIDGE_POLL_MS 150     /* 两个方向的轮询周期 */
#define G2H_ACK_TIMEOUT_MS 3000 /* 宿主不确认就复位 G2H 信箱 */

#define SHM_BLOCK_SIZE 0x8000  /* 单个信箱 32KB；G2H 在 +0，H2G 在 +0x8000 */
#define SHM_MAILBOX_DATA (SHM_BLOCK_SIZE - 16)
#define SHM_MAX_TEXT_BYTES SHM_MAILBOX_DATA /* 32752 字节 = 16376 个 UTF-16 码元 */

#define SHM_MAGIC 0x584D5649u /* 'IVMX' 小端 */
#define SHM_STATUS_EMPTY 0u
#define SHM_STATUS_READY 1u
#define SHM_STATUS_READ 2u

typedef struct {
    unsigned long phys_addr;
    unsigned long user_va;
    unsigned long size;
} shm_info_t;

/* 无 CRT（-nostdlib）：自带 memset/memcpy，volatile 防循环惯用语识别。 */
void *memset(void *dst, int value, size_t count)
{
    volatile unsigned char *d = (volatile unsigned char *)dst;
    while (count--) {
        *d++ = (unsigned char)value;
    }
    return dst;
}

void *memcpy(void *dst, const void *src, size_t count)
{
    volatile unsigned char *d = (volatile unsigned char *)dst;
    const unsigned char *s = (const unsigned char *)src;
    while (count--) {
        *d++ = *s++;
    }
    return dst;
}

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

/* 信箱头的字段读写：全部按 volatile 32 位访问，写侧先数据后头（status 最后发布）。 */
static unsigned long mb_read32(volatile void *base, int offset)
{
    return *(volatile unsigned long *)((char *)base + offset);
}

static void mb_write32(volatile void *base, int offset, unsigned long value)
{
    *(volatile unsigned long *)((char *)base + offset) = value;
}

static void *g_shm; /* 驱动给的 64KB 用户态映射 */

static volatile void *g2h(void)
{
    return g_shm;
}

static volatile void *h2g(void)
{
    return (volatile void *)((char *)g_shm + SHM_BLOCK_SIZE);
}

static int shm_open(void)
{
    /* CTL_CODE(FILE_DEVICE_UNKNOWN=0x22, 0x801, METHOD_BUFFERED, FILE_READ_ACCESS=1)，
     * 展开式与 guest/ivm-shm/ivm-shm.c 一致。 */
    const unsigned long ioctl_info =
        ((unsigned long)0x22 << 16) | ((unsigned long)1 << 14) | ((unsigned long)0x801 << 2);
    static const shm_info_t zero_info;
    shm_info_t info = zero_info;
    DWORD got = 0;

    HANDLE dev = CreateFileA("\\\\.\\IVMSHM", 0, FILE_SHARE_READ | FILE_SHARE_WRITE,
                             NULL, OPEN_EXISTING, 0, NULL);
    if (dev == INVALID_HANDLE_VALUE) {
        log_line("clip-bridge: open ivm-shm failed (%lu)", GetLastError());
        return 0;
    }
    int ok = DeviceIoControl(dev, ioctl_info, NULL, 0, &info, sizeof(info), &got, NULL);
    CloseHandle(dev);
    if (!ok || got < sizeof(info) || info.size < 2 * SHM_BLOCK_SIZE || info.user_va == 0) {
        log_line("clip-bridge: ivm-shm info invalid (ok=%d got=%lu size=%lu)", ok, got, info.size);
        return 0;
    }
    g_shm = (void *)info.user_va;

    /* 驱动只负责清零；两个信箱的 magic/状态由首个使用方盖章。 */
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
    return 1;
}

/* 上一次由本桥写入剪贴板的内容（防回环）；超出容量的部分截断比较。 */
static wchar_t g_self_text[SHM_MAX_TEXT_BYTES / 2];
static DWORD g_self_text_wchars;

/* 把 H2G 信箱里的文本设进系统剪贴板；成功才回 status=2（失败留待下轮重试）。 */
static void apply_host_text(void)
{
    unsigned long len = mb_read32(h2g(), 12);
    if (len > SHM_MAX_TEXT_BYTES) {
        len = SHM_MAX_TEXT_BYTES;
    }
    if (len < 2) {
        mb_write32(h2g(), 8, SHM_STATUS_READ); /* 空文本无从设置，直接确认掉 */
        return;
    }

    HGLOBAL mem = GlobalAlloc(GMEM_MOVEABLE, len);
    if (mem == NULL) {
        return;
    }
    void *dst = GlobalLock(mem);
    if (dst == NULL) {
        GlobalFree(mem);
        return;
    }
    memcpy(dst, (char *)h2g() + 16, len);
    GlobalUnlock(mem);

    if (!OpenClipboard(NULL)) {
        GlobalFree(mem); /* 剪贴板被占：留 status=1，下轮重试 */
        return;
    }
    int ok = EmptyClipboard() && SetClipboardData(CF_UNICODETEXT, mem) != NULL;
    CloseClipboard();
    if (!ok) {
        GlobalFree(mem);
        return;
    }

    /* 记下自己写的内容：下一轮序列号变化时内容相同就不回发（防回环）。 */
    g_self_text_wchars = len / 2 < sizeof(g_self_text) / sizeof(g_self_text[0])
                             ? len / 2
                             : sizeof(g_self_text) / sizeof(g_self_text[0]);
    memcpy(g_self_text, (char *)h2g() + 16, g_self_text_wchars * 2);
    mb_write32(h2g(), 8, SHM_STATUS_READ);
}

/* 读系统剪贴板文本；返回字节数（UTF-16LE，含结尾 NUL），0 = 无/失败。 */
static DWORD read_clipboard_text(wchar_t *out, DWORD max_wchars)
{
    if (!OpenClipboard(NULL)) {
        return 0;
    }
    HANDLE data = GetClipboardData(CF_UNICODETEXT);
    if (data == NULL) {
        CloseClipboard();
        return 0;
    }
    wchar_t *text = (wchar_t *)GlobalLock(data);
    DWORD wchars = 0;
    if (text != NULL) {
        DWORD cap = GlobalSize(data) / 2;
        if (cap > max_wchars - 1) {
            cap = max_wchars - 1;
        }
        while (wchars < cap && text[wchars] != 0) {
            wchars++;
        }
        memcpy(out, text, wchars * 2);
        out[wchars] = 0;
        GlobalUnlock(data);
    }
    CloseClipboard();
    return wchars * 2 + 2;
}

/* 剪贴板内容有变且不是自己写的 → 发 G2H。 */
static wchar_t g_read_text[SHM_MAX_TEXT_BYTES / 2];

static void publish_clipboard_if_changed(void)
{
    DWORD bytes = read_clipboard_text(g_read_text, sizeof(g_read_text) / sizeof(g_read_text[0]));
    if (bytes == 0) {
        return; /* 非 CF_UNICODETEXT（图片/文件等）：本轮不碰信箱 */
    }
    DWORD wchars = bytes / 2 - 1;
    if (wchars == g_self_text_wchars &&
        (wchars == 0 || memcmp(g_read_text, g_self_text, wchars * 2) == 0)) {
        return; /* 自己刚设回去的内容：回环，跳过 */
    }
    memcpy((char *)g2h() + 16, g_read_text, bytes);
    mb_write32(g2h(), 12, bytes);
    mb_write32(g2h(), 4, mb_read32(g2h(), 4) + 1);
    mb_write32(g2h(), 8, SHM_STATUS_READY);
}

void bridge_entry(void)
{
    CreateMutexA(NULL, TRUE, "InstantVmClipboardBridge");
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        ExitProcess(0); /* 已有实例：安静退出（后台工具，不弹窗） */
    }
    if (!shm_open()) {
        ExitProcess(1); /* 驱动不在：装好 ivm-shm.sys 再起（安装脚本负责顺序） */
    }

    DWORD last_seq = GetClipboardSequenceNumber();
    int awaiting_ack = 0;
    DWORD posted_at = 0;

    for (;;) {
        /* H2G：宿主发来的文本 → 系统剪贴板。 */
        if (mb_read32(h2g(), 0) == SHM_MAGIC && mb_read32(h2g(), 8) == SHM_STATUS_READY) {
            apply_host_text();
        }

        /* G2H：确认 / 超时复位，然后看剪贴板有没有新内容。 */
        if (awaiting_ack) {
            if (mb_read32(g2h(), 8) == SHM_STATUS_READ) {
                awaiting_ack = 0;
            } else if (GetTickCount() - posted_at > G2H_ACK_TIMEOUT_MS) {
                mb_write32(g2h(), 8, SHM_STATUS_EMPTY);
                awaiting_ack = 0;
            }
        } else if (mb_read32(g2h(), 8) == SHM_STATUS_EMPTY) {
            DWORD seq_now = GetClipboardSequenceNumber();
            if (seq_now != last_seq) {
                last_seq = seq_now;
                publish_clipboard_if_changed();
                if (mb_read32(g2h(), 8) == SHM_STATUS_READY) {
                    awaiting_ack = 1;
                    posted_at = GetTickCount();
                }
            }
        }

        Sleep(BRIDGE_POLL_MS);
    }
}
