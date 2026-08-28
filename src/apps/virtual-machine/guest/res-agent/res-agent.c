/*
 * res-agent —— 分辨率自动对齐客机代理（Windows XP，32 位，串口版）。
 *
 * 数据流（通道载体第二版，见 todo/vm-resolution-auto-align/00-overview.md §8.3）：
 *   [宿主运行时] resolution-serial.ts 每秒向 COM1 广播一帧：
 *     A5 | 04 | val_b0 val_b1 val_b2 val_b3 | 校验和
 *     其中 val = (w<<16)|h 的 32 位打包值，小端；校验和 = 前 6 字节累加 & FF
 *   [本代理] 打开 \\.\COM1，流式解帧；校验通过且值有变化时枚举显示模式，
 *     按就近吸附选档（find_matching_mode），ChangeDisplaySettingsExA 切换。
 *
 * v2 协议扩展（todo/vm-remote-control/00-overview.md §6，全部在
 * `#region vm-agent v2` 内）：len≠4 的帧按 payload[0] 分发——
 *   PING(0x01)/SHUTDOWN(0x02)/REBOOT(0x03)/EXEC(0x10)/CLICK(0x20)/DBLCLICK(0x21)，
 *   回执走 ring3 WriteFile 的 `[IVM]xxx=...\r\n` 行，与 ring0 驱动的裸 OUT
 *   字节流交错无害（宿主 tap 按行收）。v1 的 7 字节分辨率帧行为完全不变。
 *
 * 血泪教训（v5 定案）：COM1 必须显式 SetCommState 成 8N1。XP 对这个虚拟
 * 串口的初始配置是 7 数据位，驱动按 7-bit 接收会把每个字节的最高位剥掉
 * （魔数 0xA5 变成 0x25），帧永远无法解析——「只弹首字节框、有效帧永不
 * 出现」的全部调试轮次都是它。DCB 往返（读原样写回）无效，必须显式声明。
 *
 * 为什么不用旧的 IN 0xE000 读端口方案：ring3 特权指令在真 XP 上必然 #GP
 * （res-agent-diag.exe 实测前 4 步全过、死于 IN），而 GP 检查封在 vendored
 * wasm 内部，JS 层无豁免口。串口是 ring3 合法设备 IO，零特权零驱动。
 *
 * 构建：Makefile / scripts/build-res-agent.sh（zig cc 交叉编译，只编不跑）。
 * 日志：GUI 子系统无控制台，走 OutputDebugStringA（DebugView 可见）。
 * 字符串一律 ASCII——EXE 里是裸字节，MessageBoxA/调试器按系统 ANSI 页解码。
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winsvc.h>
#include <stdarg.h>
#include <stddef.h>

#define RES_BROADCAST_REOPEN_MS 500 /* COM1 打不开时的重试周期 */
#define RES_READ_TIMEOUT_MS 100     /* 单次 ReadFile 的最久等待 */
#define RESOLUTION_MAX_WIDTH 2560   /* v86 vga.js MAX_XRES */
#define RESOLUTION_MAX_HEIGHT 1600  /* v86 vga.js MAX_YRES */

#define FRAME_MAGIC 0xA5
#define FRAME_PAYLOAD_LEN 4

/*
 * 无 CRT 链接（-nostdlib）：导入表只剩 kernel32/user32/advapi32，XP 裸机可加载。
 * 编译器会把大结构清零/拷贝降级成 memset/memcpy 调用，这里自带实现；
 * 用 volatile 写循环，防止 LLVM 循环惯用语识别再把它们变回库调用。
 */
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

static void log_line(const char *fmt, ...)
{
    char buffer[256];
    va_list args;
    va_start(args, fmt);
    /* wvsprintfA 在 user32，避免依赖 CRT 的 printf 家族（导入表更干净）。 */
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

/*
 * 帧解析状态机。校验和从魔数字节开始累加，所以收到魔数时就要记住；
 * 返回 1 表示拿到完整且校验通过的帧，此时 fp->len / fp->payload 有效，
 * 调用方处理完必须 frame_reset（payload 与解析状态都在 fp 里）。
 */
#define RX_WAIT_MAGIC 0
#define RX_WAIT_LEN 1
#define RX_PAYLOAD 2
#define RX_CHECKSUM 3
#define RX_DONE 4 /* 完整帧已交付、等待调用方 reset；期间喂进的字节全忽略 */

#define MAX_FRAME_PAYLOAD 200 /* EXEC cmdline 上限（len 是单字节，留余量） */

typedef struct {
    unsigned char phase;
    unsigned char len;
    unsigned char payload[MAX_FRAME_PAYLOAD];
    unsigned char payload_idx;
    unsigned short sum;
} frame_parser_t;

static const frame_parser_t g_zero_parser;

static void frame_reset(frame_parser_t *fp)
{
    *fp = g_zero_parser;
}

static int frame_feed(frame_parser_t *fp, unsigned char byte)
{
    switch (fp->phase) {
    case RX_WAIT_MAGIC:
        if (byte == FRAME_MAGIC) {
            fp->sum = byte;
            fp->phase = RX_WAIT_LEN;
        }
        return 0;
    case RX_WAIT_LEN:
        /* v1 只认 len=4（分辨率）；v2 放开到 1..MAX_FRAME_PAYLOAD。 */
        if (byte >= 1 && byte <= MAX_FRAME_PAYLOAD) {
            fp->sum += byte;
            fp->len = byte;
            fp->payload_idx = 0;
            fp->phase = RX_PAYLOAD;
        } else if (byte != FRAME_MAGIC) {
            frame_reset(fp);
        }
        return 0;
    case RX_PAYLOAD:
        fp->sum += byte;
        fp->payload[fp->payload_idx++] = byte;
        if (fp->payload_idx >= fp->len) {
            fp->phase = RX_CHECKSUM;
        }
        return 0;
    case RX_CHECKSUM: { /* 此时 sum 已累完 len+2 个前导字节，恰等于宿主校验和 */
        int ok = (unsigned char)fp->sum == byte;
        if (!ok) {
            /* 校验失败必须立刻复位：调用方只在返回 1 时 reset，
             * 残留状态会吞掉后续所有字节。 */
            frame_reset(fp);
            return 0;
        }
        fp->phase = RX_DONE; /* 交付：payload 保持有效，等调用方处理完 reset */
        return 1;
    }
    default: /* RX_DONE：交付后的残余字节丢弃，等调用方 reset */
        return 0;
    }
}

/* #region vm-agent v2 —— 远程操控命令（PING/EXEC/CLICK/DBLCLICK/SHUTDOWN/REBOOT） */

static void handle_packed_value(unsigned long packed);

#define OP_PING 0x01
#define OP_SHUTDOWN 0x02
#define OP_REBOOT 0x03
#define OP_EXEC 0x10
#define OP_CLICK 0x20
#define OP_DBLCLICK 0x21

/* 当前 COM1 句柄：命令回执（[IVM]…\r\n）从这里写回宿主。 */
static HANDLE g_port;

static void reply_line(const char *fmt, ...)
{
    if (g_port == NULL) {
        return;
    }
    char body[144];
    char line[176];
    va_list args;
    va_start(args, fmt);
    wvsprintfA(body, fmt, args);
    va_end(args);
    lstrcpyA(line, "[IVM]");
    lstrcatA(line, body);
    lstrcatA(line, "\r\n");
    DWORD written = 0;
    WriteFile(g_port, line, lstrlenA(line), &written, NULL);
}

/* ExitWindowsEx 要求 SE_SHUTDOWN_NAME 特权（服务令牌里默认禁用）。 */
static void enable_shutdown_privilege(void)
{
    HANDLE token;
    TOKEN_PRIVILEGES tp;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &token)) {
        return;
    }
    tp.PrivilegeCount = 1;
    tp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
    if (!LookupPrivilegeValueA(NULL, "SeShutdownPrivilege", &tp.Privileges[0].Luid)) {
        CloseHandle(token);
        return;
    }
    AdjustTokenPrivileges(token, FALSE, &tp, 0, NULL, NULL);
    CloseHandle(token);
}

static void power_off(UINT flags)
{
    enable_shutdown_privilege();
    if (!ExitWindowsEx(flags, 0)) {
        log_line("res-agent: ExitWindowsEx failed (%lu)", GetLastError());
    }
}

static void handle_exec(unsigned char len, const unsigned char *payload)
{
    /* payload: 0x10 | cmdline（含结尾 NUL）。CreateProcessA 的命令行参数
     * 是 IN/OUT，必须放进可写缓冲。CREATE_NO_WINDOW 只抑制控制台闪窗，
     * GUI 程序照常显示。 */
    static char cmdline[MAX_FRAME_PAYLOAD + 1];
    int n = len - 1;
    if (n <= 0) {
        reply_line("EXEC=0");
        return;
    }
    for (int i = 0; i < n; i++) {
        cmdline[i] = (char)payload[1 + i];
    }
    cmdline[n] = 0;

    static const STARTUPINFOA zero_si;
    static const PROCESS_INFORMATION zero_pi;
    STARTUPINFOA si = zero_si;
    PROCESS_INFORMATION pi = zero_pi;
    si.cb = sizeof(si);
    if (CreateProcessA(NULL, cmdline, NULL, NULL, FALSE, CREATE_NO_WINDOW,
                       NULL, NULL, &si, &pi)) {
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        reply_line("EXEC=1");
    } else {
        reply_line("EXEC=0 err=%lu", GetLastError());
    }
}

static void handle_click(unsigned char opcode, const unsigned char *p)
{
    DWORD x = (DWORD)p[0] | ((DWORD)p[1] << 8);
    DWORD y = (DWORD)p[2] | ((DWORD)p[3] << 8);
    if (!SetCursorPos((int)x, (int)y)) {
        reply_line("CLICK=0 err=%lu", GetLastError());
        return;
    }
    int rounds = (opcode == OP_DBLCLICK) ? 2 : 1;
    for (int i = 0; i < rounds; i++) {
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        if (rounds == 2) {
            Sleep(60);
        }
    }
    reply_line("%s=1", (opcode == OP_DBLCLICK) ? "DBLCLK" : "CLICK");
}

static void handle_frame(unsigned char len, const unsigned char *payload)
{
    if (len == FRAME_PAYLOAD_LEN) {
        /* v1 分辨率帧：与旧版行为逐字节一致。 */
        unsigned long packed =
            (unsigned long)payload[0] |
            ((unsigned long)payload[1] << 8) |
            ((unsigned long)payload[2] << 16) |
            ((unsigned long)payload[3] << 24);
        handle_packed_value(packed);
        return;
    }
    switch (payload[0]) {
    case OP_PING:
        reply_line("PONG=%lu", GetTickCount());
        break;
    case OP_SHUTDOWN:
        reply_line("SDWN=1");
        power_off(EWX_SHUTDOWN | EWX_POWEROFF | EWX_FORCE);
        break;
    case OP_REBOOT:
        reply_line("RBOOT=1");
        power_off(EWX_REBOOT | EWX_FORCE);
        break;
    case OP_EXEC:
        handle_exec(len, payload);
        break;
    case OP_CLICK:
    case OP_DBLCLICK:
        if (len == 5) {
            handle_click(payload[0], payload + 1);
        } else {
            log_line("res-agent: click frame len=%u ignored", len);
        }
        break;
    default:
        log_line("res-agent: unknown opcode 0x%02X", payload[0]);
        break;
    }
}

/* #endregion */

/*
 * 在驱动枚举的模式表里为任意目标 (tw,th) 选档。XP 驱动的模式表是固定档位，
 * 宿主发来的目标却是任意像素值，精确匹配几乎必然落空，所以按就近吸附：
 *   1. 精确匹配（有就直接用）；
 *   2. 两维都 ≥ 目标的档位中面积最小者（guest 画面由宿主 CSS 缩小，最清晰）；
 *   3. 兜底：面积最大的档位。
 * 同档位内位深优先当前值、刷新率优先更高值。找不到任何档位才返回 0。
 * 无 CRT 链接：结构清零用全局常量拷贝，避免编译器生成 memset 调用。
 */
static const DEVMODEA g_zero_mode;

static int better_mode(const DEVMODEA *a, const DEVMODEA *b, DWORD cur_bpp)
{
    return (a->dmBitsPerPel == cur_bpp && b->dmBitsPerPel != cur_bpp) ||
           (a->dmBitsPerPel == b->dmBitsPerPel &&
            a->dmDisplayFrequency > b->dmDisplayFrequency);
}

static int find_matching_mode(DWORD tw, DWORD th, DEVMODEA *out_mode)
{
    DEVMODEA current = g_zero_mode;
    current.dmSize = sizeof(current);
    DWORD current_bpp = 32;
    if (EnumDisplaySettingsA(NULL, ENUM_CURRENT_SETTINGS, &current)) {
        current_bpp = current.dmBitsPerPel > 0 ? current.dmBitsPerPel : 32;
    }

    DEVMODEA exact = g_zero_mode;
    int have_exact = 0;
    DEVMODEA cover = g_zero_mode;
    DWORD cover_delta = 0;
    int have_cover = 0;
    DEVMODEA largest = g_zero_mode;
    DWORD largest_area = 0;

    DWORD i = 0;
    DEVMODEA mode = g_zero_mode;
    mode.dmSize = sizeof(mode);
    while (EnumDisplaySettingsA(NULL, i, &mode)) {
        DWORD area = mode.dmPelsWidth * mode.dmPelsHeight;
        if (mode.dmPelsWidth == tw && mode.dmPelsHeight == th) {
            if (!have_exact || better_mode(&mode, &exact, current_bpp)) {
                exact = mode;
                have_exact = 1;
            }
        } else if (mode.dmPelsWidth >= tw && mode.dmPelsHeight >= th) {
            DWORD delta = area - tw * th;
            if (!have_cover || delta < cover_delta ||
                (delta == cover_delta && better_mode(&mode, &cover, current_bpp))) {
                cover = mode;
                cover_delta = delta;
                have_cover = 1;
            }
        }
        if (area >= largest_area) {
            largest = mode;
            largest_area = area;
        }
        mode = g_zero_mode;
        mode.dmSize = sizeof(mode);
        i++;
    }

    const DEVMODEA *picked =
        have_exact ? &exact : (have_cover ? &cover : (largest_area ? &largest : NULL));
    if (picked == NULL) {
        return 0;
    }
    *out_mode = *picked;
    out_mode->dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_BITSPERPEL | DM_DISPLAYFREQUENCY;
    return 1;
}

static void apply_resolution(DWORD width, DWORD height)
{
    DEVMODEA mode;
    if (!find_matching_mode(width, height, &mode)) {
        log_line("res-agent: no mode for %lux%lu, keeping current", width, height);
        return;
    }

    /* 吸附结果与当前档位相同就不重切：拖动产生的连续目标常落在同一档，
     * 重放同模式只会闪屏（00 §10）。 */
    DEVMODEA current = g_zero_mode;
    current.dmSize = sizeof(current);
    int cur_ok = EnumDisplaySettingsA(NULL, ENUM_CURRENT_SETTINGS, &current);
    if (cur_ok &&
        current.dmPelsWidth == mode.dmPelsWidth &&
        current.dmPelsHeight == mode.dmPelsHeight &&
        current.dmBitsPerPel == mode.dmBitsPerPel) {
        log_line("res-agent: target %lux%lu already at mode %lux%lu",
                 width, height, mode.dmPelsWidth, mode.dmPelsHeight);
        return;
    }

    LONG result = ChangeDisplaySettingsExA(NULL, &mode, NULL, CDS_UPDATEREGISTRY, NULL);
    LONG retry = -99; /* DISP_CHANGE 码域是 1..-7，-99 即「未降级重试」 */
    if (result != DISP_CHANGE_SUCCESSFUL) {
        /* 全字段档位被驱动拒时，降级为只带宽高重试一次。 */
        mode.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT;
        retry = ChangeDisplaySettingsExA(NULL, &mode, NULL, CDS_UPDATEREGISTRY, NULL);
        mode.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_BITSPERPEL | DM_DISPLAYFREQUENCY;
    }

    if (result == DISP_CHANGE_SUCCESSFUL || retry == DISP_CHANGE_SUCCESSFUL) {
        log_line("res-agent: switched to %lux%lu @ %lu bpp %luHz (fallback=%d)",
                 mode.dmPelsWidth, mode.dmPelsHeight,
                 mode.dmBitsPerPel, mode.dmDisplayFrequency,
                 result != DISP_CHANGE_SUCCESSFUL);
    } else {
        log_line("res-agent: ChangeDisplaySettingsEx failed (%ld, retry %ld) for %lux%lu",
                 result, retry, mode.dmPelsWidth, mode.dmPelsHeight);
    }
}

static unsigned long last_applied = 0;

/* 收到完整帧后的统一入口（v1）：拆包、溢出守卫、去重，再决定是否应用。 */
static void handle_packed_value(unsigned long packed)
{
    if (packed == 0 || packed == last_applied) {
        return;
    }
    DWORD width = (packed >> 16) & 0xFFFF;
    DWORD height = packed & 0xFFFF;
    /* 溢出守卫：宿主 clamp 失效时这里天然拒绝（00 §8.4）。 */
    if (width > 0 && height > 0 &&
        width <= RESOLUTION_MAX_WIDTH && height <= RESOLUTION_MAX_HEIGHT) {
        last_applied = packed;
        apply_resolution(width, height);
    } else {
        log_line("res-agent: out-of-range target %lux%lu ignored", width, height);
    }
}

/*
 * 主循环（交互/服务共用）：打开/重开 COM1；读块喂状态机，
 * 直到设备出错才重开。v2 后 COM1 是 GENERIC_READ|GENERIC_WRITE。
 */
static void agent_loop(void)
{
    static frame_parser_t parser;
    frame_reset(&parser);
    log_line("res-agent: started, listening on COM1");

    for (;;) {
        HANDLE port = CreateFileA("\\\\.\\COM1", GENERIC_READ | GENERIC_WRITE, 0, NULL,
                                  OPEN_EXISTING, 0, NULL);
        if (port == INVALID_HANDLE_VALUE) {
            DWORD gle = GetLastError();
            log_line("res-agent: COM1 open failed (%lu)", gle);
            Sleep(RES_BROADCAST_REOPEN_MS);
            continue;
        }
        g_port = port;

        /* 必须显式 8N1（见文件头）：驱动初始是 7 位，DCB 往返无效。 */
        DCB dcb;
        memset(&dcb, 0, sizeof(dcb));
        dcb.DCBlength = sizeof(dcb);
        if (!BuildCommDCBA("9600,n,8,1", &dcb)) {
            dcb.BaudRate = 9600;
            dcb.fBinary = 1;
            dcb.fParity = 0;
            dcb.ByteSize = 8;
            dcb.Parity = NOPARITY;
            dcb.StopBits = ONESTOPBIT;
        }
        if (!SetCommState(port, &dcb)) {
            log_line("res-agent: SetCommState(8N1) failed (%lu), reopening",
                     GetLastError());
            CloseHandle(port);
            g_port = NULL;
            frame_reset(&parser);
            Sleep(RES_BROADCAST_REOPEN_MS);
            continue;
        }

        /* 超时必须显式声明：默认 0,0,0 = 无限阻塞，会卡死读循环。 */
        COMMTIMEOUTS timeouts;
        memset(&timeouts, 0, sizeof(timeouts));
        /* interval=0 且 constant>0：最多等 100ms，有字节立即返回，绝不阻塞。 */
        timeouts.ReadIntervalTimeout = 0;
        timeouts.ReadTotalTimeoutMultiplier = 0;
        timeouts.ReadTotalTimeoutConstant = RES_READ_TIMEOUT_MS;
        if (!SetCommTimeouts(port, &timeouts)) {
            log_line("res-agent: SetCommTimeouts failed (%lu)", GetLastError());
        }

        unsigned char chunk[64];
        for (;;) {
            DWORD got = 0;
            if (!ReadFile(port, chunk, sizeof(chunk), &got, NULL)) {
                log_line("res-agent: COM1 read failed (%lu), reopening", GetLastError());
                break;
            }
            for (DWORD k = 0; k < got; k++) {
                if (frame_feed(&parser, chunk[k])) {
                    handle_frame(parser.len, parser.payload);
                    frame_reset(&parser);
                }
            }
            Sleep(10);
        }
        CloseHandle(port);
        g_port = NULL;
        frame_reset(&parser);
    }
}

/* #region vm-agent v2 —— XP 服务化（开机即起免登录，todo/vm-remote-control §7 预防层） */

static int agent_single_instance(void)
{
    CreateMutexA(NULL, TRUE, "InstantVmResAgent");
    return GetLastError() != ERROR_ALREADY_EXISTS;
}

static SERVICE_STATUS_HANDLE g_svc_status;

static void svc_set_state(DWORD state)
{
    static const SERVICE_STATUS zero_status;
    SERVICE_STATUS st = zero_status;
    st.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
    st.dwCurrentState = state;
    st.dwControlsAccepted = (state == SERVICE_RUNNING) ? SERVICE_ACCEPT_STOP : 0;
    if (g_svc_status != NULL) {
        SetServiceStatus(g_svc_status, &st);
    }
}

static void WINAPI svc_handler(DWORD control)
{
    if (control == SERVICE_CONTROL_STOP) {
        svc_set_state(SERVICE_STOPPED);
        ExitProcess(0);
    }
}

static void WINAPI svc_main(DWORD argc, char **argv)
{
    (void)argc;
    (void)argv;
    if (!agent_single_instance()) {
        return; /* 已有实例：直接报告停止，SCM 不会反复拉起（start= auto 只开机起一次） */
    }
    g_svc_status = RegisterServiceCtrlHandlerA("InstantVmResAgent", svc_handler);
    if (g_svc_status == NULL) {
        return;
    }
    svc_set_state(SERVICE_RUNNING);
    agent_loop();
    svc_set_state(SERVICE_STOPPED);
}

/* #endregion */

/*
 * 进程入口（链接器 -e 直接指到这，无 CRT 启动对象）。
 * SCM 启动 → 走服务调度器（阻塞到服务停止）；否则交互运行（双击/HKCU Run）。
 */
void res_agent_entry(void)
{
    /* #region vm-agent v2 —— 服务调度器优先：SCM 启动时交互弹框永远出不来 */
    static SERVICE_TABLE_ENTRYA svc_table[2];
    svc_table[0].lpServiceName = "InstantVmResAgent";
    svc_table[0].lpServiceProc = svc_main;
    svc_table[1].lpServiceName = NULL;
    svc_table[1].lpServiceProc = NULL;
    if (StartServiceCtrlDispatcherA(svc_table)) {
        return; /* 服务路径：svc_main 已跑完主循环 */
    }
    /* #endregion */

    /* 交互路径：单实例失败弹框退出（保留 v1 产品行为）。 */
    if (!agent_single_instance()) {
        MessageBoxA(NULL, "res-agent is already running.",
                    "res-agent", MB_OK | MB_ICONINFORMATION);
        ExitProcess(0);
    }
    agent_loop();
}
