/*
 * ivm-aero-snap —— XP 客机窗口吸附：Win7 Aero Snap 的行为平移（XP 32 位）。
 *
 * 行为（Win7 平价）：
 *   - 拖标题栏到屏幕左/右边缘 → 贴半屏（工作区一半宽 × 全高）；
 *   - 拖到屏幕顶边 → 最大化（真 SW_MAXIMIZE）；
 *   - 拖动已吸附的窗口 → 恢复吸附前尺寸跟随光标（吸附链：同一次拖拽里
 *     再吸附仍记更早的原矩形；放下后链条结束，与 Win7 一致）；
 *   - Win+左/右/上/下 → 前台窗半屏 / 最大化 / 还原→最小化；
 *   - 边缘触发距离宿主可配（OP_SNAP_EDGE 帧实时下发，默认 12px）。
 *
 * 原理（AltSnap 在 XP 上的实证路线，代码全部原创）：WH_MOUSE_LL 低级鼠标
 * 钩子（免 DLL 注入，NT4 SP3+ 即有）看所有进程的标题栏拖拽；窗口判定用
 * GetAncestor(GA_ROOT) + 跨进程 WM_NCHITTEST（SendMessageTimeoutA 带
 * SMTO_ABORTIFHUNG——目标进程挂死也绝不拖累钩子线程，否则全系统鼠标事件
 * 跟着卡）；目标矩形按 MonitorFromPoint(MONITOR_DEFAULTTONEAREST) 的
 * rcWork 算（避任务栏），触发带按 rcMonitor 边缘 g_edge_base px（默认 12、
 * 宿主可配；角落让位于左右半屏，与 Win7 一致）；恢复矩形存 16 项静态表，
 * 不用 SetProp（无跨进程写、
 * 卸载不留痕）。预览窗单窗方案：WS_EX_LAYERED 整体半透明（AltSnap 的
 * TransWinOpacity 路线；它的默认「4 薄窗拼空心框」是为视觉保真，不必抄）。
 *
 * 与原生模态拖拽循环的相处（本模块最容易翻车的三处）：
 *   1. 普通窗口松手吸附：win32k 的 move-size 模态循环在按钮释放时退出，
 *      但退出时序与本线程无保证——吸附动作 post 到本线程消息泵延迟 50ms
 *      落位，躲开原生循环收尾可能做的最后一次摆位；
 *   2. 吸附过的普通窗口拖离：原生循环只会原样拖动窗口，与「恢复原尺寸
 *      跟随光标」打架——超过阈值后 keybd_event 发 ESC 取消原生循环
 *      （win32k 把窗口放回拖前矩形 = 吸附矩形，恰好无损），改由本模块
 *      接管拖拽（LL move 里 SetWindowPos，4px 步进节流）；
 *   3. 最大化的窗口拖离：XP 原生行为就是「拖标题栏取消最大化跟随光标」，
 *      恢复矩形恰是吸附前矩形，放手让原生走，不做接管。
 *
 * XP 特有坑：最大化窗口矩形向四周越界 ~8px（Win7 才修）。凡需要「最大化
 * 前的矩形」一律取 GetWindowPlacement 的 rcNormalPosition（工作区坐标系，
 * 换算见 placement_rect），绝不从 GetWindowRect 反推。
 *
 * 归属：登录会话常驻身份（剪贴板桥同款会话互斥）顺带启动；服务身份不跑
 * （交互增强一律跟桥走，见 res-agent.c 的 owns_bridge 判定）。入口
 * ivm_aero_snap_start() 起独立线程——LL 钩子所在线程必须泵消息。
 *
 * 合成输入无需防护：宿主 CLICK 命令走 mouse_event，LL 钩子看得见，但它
 * 是无拖拽单击，状态机天然忽略。
 *
 * 构建：与 res-agent.c / clipboard-bridge.c 等合编进 ivm-agent.exe（zig cc
 * -nostdlib）。memset/memcpy/strlen 用 res-agent.c 的全局符号；日志走
 * OutputDebugStringA；字符串一律 ASCII。
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdarg.h>

#define SNAP_CLASS "IVMSnapPreview" /* 构建防呆 marker，勿改字符串 */

/* 光标贴近屏幕边缘的触发距离（px）：宿主经 OP_SNAP_EDGE 帧可配（v5），
 * 默认值与宿主 VM_SNAP_EDGE_PX_DEFAULT 保持同步；协议字节侧 clamp 2..64。 */
#define SNAP_EDGE_BASE_DEFAULT 12
#define SNAP_EDGE_BASE_MIN 2
#define SNAP_EDGE_BASE_MAX 64
#define RESTORE_THRESHOLD_PX 6    /* 吸附窗拖离：超过才取消原生循环接管拖拽 */
#define OWN_DRAG_STEP_PX 4        /* 接管拖拽的摆位节流步长 */
#define RESTORE_APPLY_DELAY_MS 50 /* 原生循环退出等待（见文件头第 1 条） */
#define NCHITTEST_TIMEOUT_MS 64   /* 跨进程 NCHITTEST 的最久等待 */
#define PREVIEW_BORDER_PX 4       /* 预览白框线宽（2px 在 96DPI 下偏细） */
#define SNAP_TABLE_SIZE 16

#define WM_APP_SNAP (WM_APP + 0x11)        /* 线程内消息：吸附落位（延迟由泵处理） */
#define WM_APP_SNAP_ENABLE (WM_APP + 0x12) /* 线程内消息：宿主开关（挂/卸钩子） */
#define WM_APP_SNAP_EDGE (WM_APP + 0x13)   /* 线程内消息：宿主触发距离（px） */

#define HOTKEY_LEFT 1
#define HOTKEY_RIGHT 2
#define HOTKEY_UP 3
#define HOTKEY_DOWN 4

/* 构建时间戳由构建脚本 -DVM_AGENT_BUILD= 注入（YYYYMMDD-HHMMSS）。 */
#ifndef VM_AGENT_BUILD
#define VM_AGENT_BUILD "unknown"
#endif

/* 仅状态迁移打点（DebugView 可见），拖拽热路径不写日志。 */
static void snap_log(const char *fmt, ...)
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

/* 吸附意图种类 */
#define SNAP_LEFT 0
#define SNAP_RIGHT 1
#define SNAP_MAX 2
#define SNAP_NONE (-1)

static int snap_abs(int v)
{
    return v < 0 ? -v : v;
}

static int rect_near(const RECT *a, const RECT *b, int tol)
{
    return snap_abs(a->left - b->left) <= tol && snap_abs(a->top - b->top) <= tol &&
           snap_abs(a->right - b->right) <= tol && snap_abs(a->bottom - b->bottom) <= tol;
}

/*
 * 吸附表：HWND → 吸附前矩形（orig）+ 吸附目标（target）。只为本模块自己
 * 吸过的窗口服务；表项有效性在下次按下时复核：还贴在目标上 = 仍吸附；
 * 恰好回到原矩形 = 刚被拖离还原；都不是 = 用户自己动过，丢弃。
 */
typedef struct {
    HWND hwnd;
    int kind;
    RECT orig;
    RECT target;
} snap_slot_t;

static snap_slot_t g_table[SNAP_TABLE_SIZE];
static unsigned g_table_gen;

static snap_slot_t *table_find(HWND hwnd)
{
    for (int i = 0; i < SNAP_TABLE_SIZE; i++) {
        if (g_table[i].hwnd == hwnd) {
            return &g_table[i];
        }
    }
    return NULL;
}

static void table_put(HWND hwnd, int kind, const RECT *orig, const RECT *target)
{
    snap_slot_t *slot = table_find(hwnd);
    if (slot == NULL) {
        for (int i = 0; i < SNAP_TABLE_SIZE && slot == NULL; i++) {
            if (g_table[i].hwnd == NULL) {
                slot = &g_table[i];
            }
        }
        if (slot == NULL) { /* 表满：轮转覆写最旧的一格 */
            slot = &g_table[g_table_gen++ % SNAP_TABLE_SIZE];
        }
    }
    slot->hwnd = hwnd;
    slot->kind = kind;
    slot->orig = *orig;
    slot->target = *target;
}

static void table_del(HWND hwnd)
{
    snap_slot_t *slot = table_find(hwnd);
    if (slot != NULL) {
        slot->hwnd = NULL;
    }
}

/* 表项复核：仍吸附（贴目标上，最大化项认 IsZoomed）或恰回原矩形。 */
static int table_still_valid(const snap_slot_t *slot, HWND hwnd)
{
    RECT cur;
    if (!GetWindowRect(hwnd, &cur)) {
        return 0;
    }
    if (slot->kind == SNAP_MAX && IsZoomed(hwnd)) {
        return 1;
    }
    if (rect_near(&cur, &slot->target, 2)) {
        return 1;
    }
    return rect_near(&cur, &slot->orig, 2);
}

/* 最大化前的矩形：rcNormalPosition 是工作区坐标系（原点 = 主屏工作区左
 * 上角），VM 单屏场景偏移取 SPI_GETWORKAREA；XP 最大化 8px 越界坑的解。 */
static void placement_rect(HWND hwnd, RECT *out)
{
    static RECT primary_wa;
    WINDOWPLACEMENT wp;
    memset(&wp, 0, sizeof(wp));
    wp.length = sizeof(wp);
    if (primary_wa.right == 0 && primary_wa.bottom == 0) {
        SystemParametersInfoA(SPI_GETWORKAREA, 0, &primary_wa, 0);
    }
    if (!GetWindowPlacement(hwnd, &wp)) {
        GetWindowRect(hwnd, out); /* 兜底：拿到什么用什么 */
        return;
    }
    out->left = wp.rcNormalPosition.left + primary_wa.left;
    out->top = wp.rcNormalPosition.top + primary_wa.top;
    out->right = wp.rcNormalPosition.right + primary_wa.left;
    out->bottom = wp.rcNormalPosition.bottom + primary_wa.top;
}

/* 本进程的窗口（预览窗、单实例告示牌等）一律不吸。 */
static int own_process_window(HWND hwnd)
{
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    return pid == GetCurrentProcessId();
}

/* 拖拽候选的基础门槛（种类相关的 THICKFRAME/MAXIMIZEBOX 在落位时再查）。 */
static int drag_eligible(HWND hwnd)
{
    LONG style = GetWindowLongA(hwnd, GWL_STYLE);
    LONG ex = GetWindowLongA(hwnd, GWL_EXSTYLE);
    if ((style & WS_CAPTION) != WS_CAPTION) {
        return 0;
    }
    if (ex & WS_EX_TOOLWINDOW) {
        return 0;
    }
    if (IsIconic(hwnd) || !IsWindowVisible(hwnd)) {
        return 0;
    }
    return !own_process_window(hwnd);
}

/* 种类相关门槛：侧吸要可改大小，顶吸要可最大化。 */
static int snap_eligible(HWND hwnd, int kind)
{
    LONG style = GetWindowLongA(hwnd, GWL_STYLE);
    if (kind == SNAP_MAX) {
        return (style & WS_MAXIMIZEBOX) != 0;
    }
    return (style & WS_THICKFRAME) != 0;
}

static void monitor_work(const POINT *pt, RECT *mon, RECT *wa)
{
    HMONITOR hm = MonitorFromPoint(*pt, MONITOR_DEFAULTTONEAREST);
    MONITORINFO mi;
    memset(&mi, 0, sizeof(mi));
    mi.cbSize = sizeof(mi);
    if (hm != NULL && GetMonitorInfoA(hm, &mi)) {
        *mon = mi.rcMonitor;
        *wa = mi.rcWork;
        return;
    }
    SystemParametersInfoA(SPI_GETWORKAREA, 0, wa, 0);
    *mon = *wa; /* 兜底：无监视器信息时用主屏工作区充当屏幕矩形 */
}

/* 触发距离（宿主 OP_SNAP_EDGE 下发）：泵线程写、钩子线程读，单 int 对齐
 * 读写 x86 天然原子，无需锁；越界值在泵线程 clamp。 */
static int g_edge_base = SNAP_EDGE_BASE_DEFAULT;

/* 角落让位于左右半屏（Win7 行为）：先判左右，再判顶。 */
static int edge_kind(const POINT *pt, const RECT *mon)
{
    if (pt->x <= mon->left + g_edge_base) {
        return SNAP_LEFT;
    }
    if (pt->x >= mon->right - 1 - g_edge_base) {
        return SNAP_RIGHT;
    }
    if (pt->y <= mon->top + g_edge_base) {
        return SNAP_MAX;
    }
    return SNAP_NONE;
}

static void compute_target(int kind, const RECT *wa, RECT *out)
{
    int width = (wa->right - wa->left) / 2;
    if (kind == SNAP_LEFT) {
        out->left = wa->left;
        out->top = wa->top;
        out->right = wa->left + width;
        out->bottom = wa->bottom;
    } else if (kind == SNAP_RIGHT) {
        out->left = wa->right - width;
        out->top = wa->top;
        out->right = wa->right;
        out->bottom = wa->bottom;
    } else {
        *out = *wa; /* 顶吸预览给整块工作区，落位走 SW_MAXIMIZE */
    }
}

/*
 * 预览窗：XP 时代主流样式——白色实线边框、内部 100% 透明（region 抠洞，
 * 洞里直接透出桌面），不做半透明整块填充。WS_EX_TRANSPARENT 使它对
 * WindowFromPoint / 鼠标输入完全透明；TOPMOST + NOACTIVATE 保证不抢焦点。
 */
static HWND g_preview;

static LRESULT CALLBACK preview_proc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    return DefWindowProcA(hwnd, msg, wp, lp);
}

static int preview_create(void)
{
    WNDCLASSA wc;
    memset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = preview_proc;
    wc.hInstance = GetModuleHandleA(NULL);
    wc.hbrBackground = CreateSolidBrush(RGB(255, 255, 255));
    wc.lpszClassName = SNAP_CLASS;
    if (!RegisterClassA(&wc)) {
        snap_log("snap: RegisterClass failed gle=%lu", GetLastError());
        return 0;
    }
    g_preview = CreateWindowExA(WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_NOACTIVATE |
                                    WS_EX_TOOLWINDOW,
                                SNAP_CLASS, "", WS_POPUP, 0, 0, 0, 0,
                                NULL, NULL, wc.hInstance, NULL);
    if (g_preview == NULL) {
        snap_log("snap: CreateWindowEx failed gle=%lu", GetLastError());
        return 0;
    }
    return 1;
}

static void preview_show(const RECT *target)
{
    int w = target->right - target->left;
    int h = target->bottom - target->top;
    /* 预览只在进/出触发区时摆位，region 重建频率极低；SetWindowRgn 成功
     * 后 region 所有权归系统，只有失败才需要自己删。 */
    HRGN outer = CreateRectRgn(0, 0, w, h);
    HRGN inner = CreateRectRgn(PREVIEW_BORDER_PX, PREVIEW_BORDER_PX,
                               w - PREVIEW_BORDER_PX, h - PREVIEW_BORDER_PX);
    HRGN frame = CreateRectRgn(0, 0, 0, 0);
    int placed = outer != NULL && inner != NULL && frame != NULL &&
                 CombineRgn(frame, outer, inner, RGN_DIFF) != ERROR &&
                 SetWindowRgn(g_preview, frame, FALSE) != 0;
    if (!placed && frame != NULL) {
        DeleteObject(frame);
    }
    if (outer != NULL) {
        DeleteObject(outer);
    }
    if (inner != NULL) {
        DeleteObject(inner);
    }
    SetWindowPos(g_preview, HWND_TOPMOST, target->left, target->top, w, h,
                 SWP_NOACTIVATE | SWP_SHOWWINDOW);
}

static void preview_hide(void)
{
    if (g_preview != NULL) {
        ShowWindow(g_preview, SW_HIDE);
    }
}

/*
 * 拖拽状态（钩子与消息泵同线程，无锁）。
 * orig_now = 本次拖拽开始前的矩形；曾吸附的窗口取链上更早的原矩形
 * （chain_orig）——落位时写进吸附表，吸附链就这么保住。
 */
static struct {
    int active;
    int owning;   /* 已 ESC 取消原生循环，改由本模块驱动拖拽 */
    int restored; /* 已做过「拖离还原」（含最大化交原生的情况） */
    int was_snapped;
    HWND hwnd;
    RECT chain_orig;
    RECT orig_now;
    int grab_dx;
    int grab_dy;
    int last_x;
    int last_y;
} g_drag;

static int g_pending = SNAP_NONE;
static RECT g_pending_mon;

/* 开关状态（泵线程私有写；宿主经 OP_SNAP 帧置 0/1，默认开）。 */
static HHOOK g_hook;
static int g_enabled = 1;
static DWORD g_snap_tid;

/* 落位参数暂存：on_up 在 drag_reset 之前抄走，泵里延迟消费。 */
static struct {
    int kind;
    HWND hwnd;
    RECT orig;
} g_apply;

static void drag_reset(void)
{
    memset(&g_drag, 0, sizeof(g_drag));
    g_pending = SNAP_NONE;
    preview_hide();
}

/* 接管拖拽：ESC 取消原生循环（win32k 恢复拖前矩形 = 吸附矩形），窗口改
 * 回原尺寸，光标按抓取点横向比例留在标题栏上。 */
static void take_over_drag(POINT pt)
{
    keybd_event(VK_ESCAPE, 0, 0, 0);
    keybd_event(VK_ESCAPE, 0, KEYEVENTF_KEYUP, 0);

    HWND hwnd = g_drag.hwnd;
    RECT cur;
    if (!GetWindowRect(hwnd, &cur)) {
        drag_reset();
        return;
    }
    RECT *orig = &g_drag.chain_orig;
    int width = orig->right - orig->left;
    int height = orig->bottom - orig->top;
    int span = cur.right - cur.left;
    int left;
    if (span > 0) { /* 抓取点在原宽度里的位置等比搬过来 */
        left = pt.x - (pt.x - cur.left) * width / span;
    } else {
        left = pt.x;
    }
    /* 光标至少留在窗口内 16px，别让窗口整个滑到光标一边去 */
    if (left > pt.x - 16) {
        left = pt.x - 16;
    }
    if (left < pt.x - width + 16) {
        left = pt.x - width + 16;
    }
    int top = pt.y - GetSystemMetrics(SM_CYCAPTION) - GetSystemMetrics(SM_CYSIZEFRAME);
    g_drag.grab_dx = pt.x - left;
    g_drag.grab_dy = pt.y - top;
    SetWindowPos(hwnd, NULL, left, top, width, height, SWP_NOZORDER | SWP_NOACTIVATE);
    g_drag.owning = 1;
    g_drag.restored = 1;
    g_drag.last_x = pt.x;
    g_drag.last_y = pt.y;
    snap_log("snap: takeover hwnd=%p orig=%dx%d", hwnd, width, height);
}

/* 落位。拖拽路径由泵延迟 RESTORE_APPLY_DELAY_MS 调用（躲原生循环收尾）；
 * 热键路径无原生循环，直接调。orig 由调用方给——状态机已复位，不能现取。 */
static void apply_snap(int kind, HWND hwnd, const RECT *orig)
{
    if (!IsWindow(hwnd) || IsIconic(hwnd) || !drag_eligible(hwnd) || !snap_eligible(hwnd, kind)) {
        return;
    }
    POINT pt;
    GetCursorPos(&pt);
    RECT mon, wa, target;
    monitor_work(&pt, &mon, &wa);
    compute_target(kind, &wa, &target);

    if (kind == SNAP_MAX) {
        if (IsZoomed(hwnd)) {
            return; /* 已经最大化，无事可做 */
        }
        ShowWindow(hwnd, SW_MAXIMIZE);
    } else {
        if (IsZoomed(hwnd)) {
            ShowWindow(hwnd, SW_RESTORE); /* 最大化窗直接侧吸：先还原 */
        }
        SetWindowPos(hwnd, NULL, target.left, target.top,
                     target.right - target.left, target.bottom - target.top,
                     SWP_NOZORDER | SWP_NOACTIVATE);
    }
    table_put(hwnd, kind, orig, &target);
    snap_log("snap: applied kind=%d hwnd=%p", kind, hwnd);
}

/* Win+左/右/上：对前台窗执行吸附意图（原矩形现场捕获）。 */
static void hotkey_snap(int kind)
{
    HWND hwnd = GetForegroundWindow();
    if (hwnd == NULL || !drag_eligible(hwnd) || !snap_eligible(hwnd, kind)) {
        return;
    }
    RECT orig;
    snap_slot_t *slot = table_find(hwnd);
    if (slot != NULL && slot->kind != SNAP_MAX && table_still_valid(slot, hwnd)) {
        orig = slot->orig; /* 已吸附窗再上热键：吸附链延续（Win7 同款） */
    } else if (IsZoomed(hwnd)) {
        placement_rect(hwnd, &orig);
    } else {
        GetWindowRect(hwnd, &orig);
    }
    apply_snap(kind, hwnd, &orig);
}

/* Win+下：最大化→还原；吸附→还原原矩形；否则→最小化（Win7 平价）。 */
static void hotkey_down(void)
{
    HWND hwnd = GetForegroundWindow();
    if (hwnd == NULL || !drag_eligible(hwnd)) {
        return;
    }
    if (IsZoomed(hwnd)) {
        ShowWindow(hwnd, SW_RESTORE);
        return;
    }
    snap_slot_t *slot = table_find(hwnd);
    if (slot != NULL && slot->kind != SNAP_MAX && table_still_valid(slot, hwnd)) {
        SetWindowPos(hwnd, NULL, slot->orig.left, slot->orig.top,
                     slot->orig.right - slot->orig.left,
                     slot->orig.bottom - slot->orig.top,
                     SWP_NOZORDER | SWP_NOACTIVATE);
        table_del(hwnd);
        return;
    }
    ShowWindow(hwnd, SW_MINIMIZE);
}

/* —— LL 鼠标钩子 —— */

static void on_down(POINT pt)
{
    HWND hwnd = WindowFromPoint(pt);
    if (hwnd != NULL) {
        hwnd = GetAncestor(hwnd, GA_ROOT);
    }
    if (hwnd == NULL) {
        drag_reset();
        return;
    }
    if (!drag_eligible(hwnd)) {
        snap_log("snap: down skip hwnd=%p (not eligible)", hwnd);
        drag_reset();
        return;
    }
    /* 跨进程 NCHITTEST 必须带超时：目标进程挂死时绝不能把钩子线程一起挂住 */
    DWORD_PTR hit = 0;
    if (!SendMessageTimeoutA(hwnd, WM_NCHITTEST, 0, MAKELPARAM((SHORT)pt.x, (SHORT)pt.y),
                             SMTO_ABORTIFHUNG, NCHITTEST_TIMEOUT_MS, &hit)) {
        snap_log("snap: down hwnd=%p nchittest failed gle=%lu", hwnd, GetLastError());
        drag_reset();
        return;
    }
    if (hit != HTCAPTION) {
        snap_log("snap: down hwnd=%p hit=%lu (not caption)", hwnd, hit);
        drag_reset();
        return;
    }

    memset(&g_drag, 0, sizeof(g_drag));
    g_drag.active = 1;
    g_drag.hwnd = hwnd;
    g_drag.last_x = pt.x;
    g_drag.last_y = pt.y;
    snap_slot_t *slot = table_find(hwnd);
    g_drag.was_snapped = slot != NULL && table_still_valid(slot, hwnd);
    if (g_drag.was_snapped) {
        g_drag.chain_orig = slot->orig;
        g_drag.orig_now = slot->orig; /* 链条：再吸附仍记这个矩形 */
        if (IsZoomed(hwnd)) {
            g_drag.restored = 1; /* 最大化交 XP 原生：拖标题栏自动取消最大化 */
        }
    } else {
        table_del(hwnd); /* 失效残表顺手清 */
        if (IsZoomed(hwnd)) {
            placement_rect(hwnd, &g_drag.orig_now);
        } else {
            GetWindowRect(hwnd, &g_drag.orig_now);
        }
    }
}

static void on_move(POINT pt)
{
    if (!g_drag.active) {
        return;
    }
    /* 物理按钮已抬起（拖拽被系统打断/事件丢失）：回收状态 */
    if (!(GetAsyncKeyState(VK_LBUTTON) & 0x8000)) {
        drag_reset();
        return;
    }

    /* 吸附窗拖离：超阈值后取消原生循环、接管拖拽（最大化窗除外） */
    if (g_drag.was_snapped && !g_drag.restored && !g_drag.owning &&
        (snap_abs(pt.x - g_drag.last_x) > RESTORE_THRESHOLD_PX ||
         snap_abs(pt.y - g_drag.last_y) > RESTORE_THRESHOLD_PX)) {
        take_over_drag(pt);
    }

    if (g_drag.owning &&
        (snap_abs(pt.x - g_drag.last_x) >= OWN_DRAG_STEP_PX ||
         snap_abs(pt.y - g_drag.last_y) >= OWN_DRAG_STEP_PX)) {
        SetWindowPos(g_drag.hwnd, NULL, pt.x - g_drag.grab_dx, pt.y - g_drag.grab_dy,
                     0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
        g_drag.last_x = pt.x;
        g_drag.last_y = pt.y;
    }

    /* 边缘区判定 → 预览（接管与原生拖拽共用） */
    RECT mon, wa;
    monitor_work(&pt, &mon, &wa);
    int kind = edge_kind(&pt, &mon);
    int changed = kind != g_pending || (kind != SNAP_NONE && !rect_near(&mon, &g_pending_mon, 0));
    if (changed) {
        g_pending = kind;
        g_pending_mon = mon;
        if (kind == SNAP_NONE || !snap_eligible(g_drag.hwnd, kind)) {
            preview_hide();
        } else {
            RECT target;
            compute_target(kind, &wa, &target);
            preview_show(&target);
        }
    }
}

static void on_up(void)
{
    if (!g_drag.active) {
        return;
    }
    int kind = g_pending;
    HWND hwnd = g_drag.hwnd;
    int owning = g_drag.owning;
    int was_snapped = g_drag.was_snapped;
    RECT chain = g_drag.chain_orig;
    RECT orig_now = g_drag.orig_now;
    drag_reset();

    if (kind == SNAP_NONE) {
        if (owning) {
            /* 拖离还原后随手放下：链条到此为止（Win7 同款：此后重新吸附
             * 以放下位置为新原矩形）。非接管路径（含合成单击、最大化窗
             * 的原生拖离）表项留给下次按下时复核，不在此清。 */
            table_del(hwnd);
        }
        return;
    }
    if (owning && was_snapped) {
        orig_now = chain; /* 接管拖拽里的再吸附：链上原矩形优先 */
    }
    g_apply.kind = kind;
    g_apply.hwnd = hwnd;
    g_apply.orig = orig_now;
    PostThreadMessageA(GetCurrentThreadId(), WM_APP_SNAP, 0, 0);
}

static LRESULT CALLBACK mouse_hook(int code, WPARAM wp, LPARAM lp)
{
    if (code == HC_ACTION) {
        const MSLLHOOKSTRUCT *e = (const MSLLHOOKSTRUCT *)lp;
        switch (wp) {
        case WM_LBUTTONDOWN:
            on_down(e->pt);
            break;
        case WM_MOUSEMOVE:
            on_move(e->pt);
            break;
        case WM_LBUTTONUP:
            on_up();
            break;
        default:
            break;
        }
    }
    return CallNextHookEx(NULL, code, wp, lp);
}

/* —— 常驻线程：预览窗 + 热键 + LL 钩子 + 消息泵 —— */

static DWORD WINAPI snap_thread_main(void *arg)
{
    (void)arg;
    g_snap_tid = GetCurrentThreadId();
    snap_log("snap: thread start built=" VM_AGENT_BUILD);
    if (!preview_create()) {
        snap_log("snap: module disabled (preview failed)");
        return 1;
    }
    snap_log("snap: preview ok");
    /* 热键失败不致命：鼠标拖拽路径照常（宿主截获 Win 键时仅键盘路径失效） */
    if (!RegisterHotKey(NULL, HOTKEY_LEFT, MOD_WIN, VK_LEFT) ||
        !RegisterHotKey(NULL, HOTKEY_RIGHT, MOD_WIN, VK_RIGHT) ||
        !RegisterHotKey(NULL, HOTKEY_UP, MOD_WIN, VK_UP) ||
        !RegisterHotKey(NULL, HOTKEY_DOWN, MOD_WIN, VK_DOWN)) {
        snap_log("snap: RegisterHotKey failed (%lu), mouse-only mode",
                 GetLastError());
    }
    /* XP 对 LL 钩子同样要求真实模块句柄：传 NULL 报 1428
     * （ERROR_HOOK_NEEDS_HMODULE，2026-08-30 真机日志实证）；Win7+ 才
     * 容忍 NULL。钩子函数就在本 exe 里，给自身句柄（AltSnap 同款）。 */
    g_hook = SetWindowsHookExA(WH_MOUSE_LL, mouse_hook, GetModuleHandleA(NULL), 0);
    if (g_hook == NULL) {
        snap_log("snap: SetWindowsHookEx failed (%lu), module disabled",
                 GetLastError());
        return 1;
    }
    snap_log("snap: hook ok, aero-snap active");

    MSG msg;
    while (GetMessageA(&msg, NULL, 0, 0) > 0) {
        if (msg.message == WM_APP_SNAP_ENABLE) {
            /* LL 钩子必须由安装线程挂/卸：开关只 post 过来，这里执行。
             * 关闭顺手复位拖拽状态并藏预览，避免留下孤儿视觉。 */
            int on = (int)msg.wParam;
            if (on != g_enabled) {
                g_enabled = on;
                if (!on) {
                    drag_reset();
                }
                if (!on && g_hook != NULL) {
                    UnhookWindowsHookEx(g_hook);
                    g_hook = NULL;
                } else if (on && g_hook == NULL) {
                    g_hook = SetWindowsHookExA(WH_MOUSE_LL, mouse_hook,
                                               GetModuleHandleA(NULL), 0);
                }
                snap_log("snap: enabled=%d hook=%s", g_enabled,
                         g_hook != NULL ? "on" : "off");
            }
            continue;
        }
        if (msg.message == WM_APP_SNAP_EDGE) {
            /* 触发距离 clamp 后落全局：无论开关状态都更新，开着时下一次
             * mousemove 即用新值。 */
            int px = (int)msg.wParam;
            if (px < SNAP_EDGE_BASE_MIN) {
                px = SNAP_EDGE_BASE_MIN;
            }
            if (px > SNAP_EDGE_BASE_MAX) {
                px = SNAP_EDGE_BASE_MAX;
            }
            g_edge_base = px;
            snap_log("snap: edge=%d", px);
            continue;
        }
        if (msg.message == WM_APP_SNAP) {
            Sleep(RESTORE_APPLY_DELAY_MS); /* 等原生 move-size 循环退场 */
            apply_snap(g_apply.kind, g_apply.hwnd, &g_apply.orig);
            continue;
        }
        if (msg.message == WM_HOTKEY) {
            if (!g_enabled) {
                continue;
            }
            snap_log("snap: hotkey recv id=%d", (int)msg.wParam);
            if ((int)msg.wParam == HOTKEY_DOWN) {
                hotkey_down();
            } else {
                hotkey_snap((int)msg.wParam);
            }
            continue;
        }
        TranslateMessage(&msg);
        DispatchMessageA(&msg);
    }
    if (g_hook != NULL) {
        UnhookWindowsHookEx(g_hook);
    }
    return 0;
}

void ivm_aero_snap_start(void)
{
    HANDLE thread = CreateThread(NULL, 0, snap_thread_main, NULL, 0, NULL);
    if (thread == NULL) {
        snap_log("snap: thread create failed (%lu)", GetLastError());
        return;
    }
    CloseHandle(thread); /* 线程常驻，句柄即弃 */
}

/* 宿主「窗口吸附」开关（OP_SNAP 帧）：LL 钩子必须在安装线程挂/卸，
 * 所以只 post 消息，泵线程执行；fire-and-forget，无回执。 */
void ivm_aero_snap_set_enabled(unsigned char on)
{
    if (g_snap_tid != 0) {
        PostThreadMessageA(g_snap_tid, WM_APP_SNAP_ENABLE, on ? 1 : 0, 0);
    }
}

/* 宿主「吸附触发距离」（OP_SNAP_EDGE 帧）：与开关同款 post 给泵线程
 * （clamp 在那边做）；fire-and-forget，无回执。 */
void ivm_aero_snap_set_edge(unsigned char px)
{
    if (g_snap_tid != 0) {
        PostThreadMessageA(g_snap_tid, WM_APP_SNAP_EDGE, px, 0);
    }
}

/* OP_SNAP 帧的解析（len=2，payload[1]=0/1）。放本模块是为了 res-agent.c
 * 的行数预算；len 不对静默丢弃。 */
void ivm_aero_snap_command(unsigned char len, const unsigned char *payload)
{
    if (len == 2) {
        ivm_aero_snap_set_enabled(payload[1]);
    }
}
