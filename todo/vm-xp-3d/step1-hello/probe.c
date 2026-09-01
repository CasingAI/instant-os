/* vm-xp-3d step1 探针版：双窗口分层验证。
 *
 * A 窗（主窗，永远安全）：常规 Win32 窗口 + XP 原生控件（日志列表、按钮）
 *   + GDI 色条，证明本管线能编出带消息循环/子控件的常规程序。
 * B 窗（点 A 窗按钮才打开）：Direct3D 9 设备实测。d3d9.dll 用 LoadLibrary
 *   动态加载且不进导入表，预期在当前 XP 镜像里失败（显示适配器是只有 2D
 *   的 Bochs BGA），失败码即「客机拦截」一段的基线证据。B 窗出任何问题
 *   都不影响 A 窗继续可用。
 *
 * 将来的假 d3d9.dll 放在本 exe 同目录，Windows DLL 搜索顺序会优先加载它，
 * B 窗即成为 step2 假库的现成测试台。
 */
#include <windows.h>
#include <string.h>
#include <d3d9.h>

/* -nostdlib 没有 CRT，编译器生成的 memset/memcpy 调用要在本文件解析掉；
 * 用与 string.h 原型一致的非 static 定义（static 会撞声明）。 */
void *memset(void *dst, int c, size_t n)
{
    unsigned char *p = (unsigned char *)dst;
    while (n--) *p++ = (unsigned char)c;
    return dst;
}

void *memcpy(void *dst, const void *src, size_t n)
{
    unsigned char *d = (unsigned char *)dst;
    const unsigned char *s = (const unsigned char *)src;
    while (n--) *d++ = *s++;
    return dst;
}

typedef IDirect3D9 *(WINAPI *Direct3DCreate9_t)(UINT);

#define IDC_OPEN_D3D 1001   /* A 窗：打开 B 窗的按钮 */
#define IDC_LIST     1101   /* B 窗：日志列表 */
#define IDC_RERUN    1102   /* B 窗：重跑探针按钮 */

static HINSTANCE g_hinst;
static HWND g_main_list;
static HWND g_d3d_list;
static HWND g_d3d_button;
static IDirect3DDevice9 *g_dev;
static int g_d3d_ok;
static unsigned g_frame;
static char g_buf[256];

static void list_add(HWND list, const char *text)
{
    LRESULT count = SendMessageA(list, LB_GETCOUNT, 0, 0);
    SendMessageA(list, LB_ADDSTRING, 0, (LPARAM)text);
    SendMessageA(list, LB_SETTOPINDEX, (WPARAM)count - 1, 0);
}

static void log_main(const char *text) { list_add(g_main_list, text); }
static void log_d3d(const char *text) { list_add(g_d3d_list, text); }

#define LOG_MAIN(...) (wsprintfA(g_buf, __VA_ARGS__), log_main(g_buf))
#define LOG_D3D(...)  (wsprintfA(g_buf, __VA_ARGS__), log_d3d(g_buf))

static void paint_bars(HDC dc, int bottom, int d3d_ok)
{
    /* GDI 色条 + 一行状态：窗口/GDI 绘制本身没问题，D3D 失败时也有的看。 */
    static const COLORREF pal[4] = {
        RGB(192, 64, 64), RGB(64, 160, 64), RGB(64, 96, 192), RGB(192, 160, 64)
    };
    int i;
    for (i = 0; i < 4; i++) {
        HBRUSH br = CreateSolidBrush(pal[i]);
        RECT r;
        r.left = 8 + i * 60;
        r.top = 12;
        r.right = r.left + 52;
        r.bottom = 48;
        FillRect(dc, &r, br);
        DeleteObject(br);
    }
    SelectObject(dc, GetStockObject(DEFAULT_GUI_FONT));
    SetBkMode(dc, TRANSPARENT);
    if (d3d_ok) {
        TextOutA(dc, 8, bottom - 24, "D3D9 clear animating in client area (see title bar)",
                 (int)lstrlenA("D3D9 clear animating in client area (see title bar)"));
    } else {
        TextOutA(dc, 8, bottom - 24, "D3D9 unavailable - see log above",
                 (int)lstrlenA("D3D9 unavailable - see log above"));
    }
}

/* ---- B 窗：Direct3D 9 设备实测 ---- */

static void d3d_probe(HWND hwnd)
{
    HMODULE mod = LoadLibraryA("d3d9.dll");
    if (!mod) {
        LOG_D3D("LoadLibrary(d3d9.dll) failed, GLE=%ld", (long)GetLastError());
        return;
    }
    LOG_D3D("LoadLibrary(d3d9.dll) OK");

    Direct3DCreate9_t create = (Direct3DCreate9_t)GetProcAddress(mod, "Direct3DCreate9");
    if (!create) {
        LOG_D3D("GetProcAddress(Direct3DCreate9) failed");
        return;
    }
    IDirect3D9 *d3d = create(D3D_SDK_VERSION);
    if (!d3d) {
        LOG_D3D("Direct3DCreate9(%d) returned NULL", D3D_SDK_VERSION);
        return;
    }
    LOG_D3D("Direct3DCreate9 OK");

    D3DDISPLAYMODE dm;
    HRESULT hr = IDirect3D9_GetAdapterDisplayMode(d3d, D3DADAPTER_DEFAULT, &dm);
    if (FAILED(hr)) {
        LOG_D3D("GetAdapterDisplayMode FAILED hr=0x%08X", (unsigned)hr);
        IDirect3D9_Release(d3d);
        return;
    }
    LOG_D3D("Adapter 0: %ux%u fmt=%u", (unsigned)dm.Width, (unsigned)dm.Height, (unsigned)dm.Format);

    RECT rc;
    GetClientRect(hwnd, &rc);
    D3DPRESENT_PARAMETERS pp;
    memset(&pp, 0, sizeof(pp));
    pp.Windowed = TRUE;
    pp.SwapEffect = D3DSWAPEFFECT_DISCARD;
    pp.BackBufferFormat = dm.Format;
    pp.BackBufferWidth = rc.right;
    pp.BackBufferHeight = rc.bottom;
    pp.hDeviceWindow = hwnd;

    IDirect3DDevice9 *dev = NULL;
    hr = IDirect3D9_CreateDevice(d3d, D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, hwnd,
                                 D3DCREATE_SOFTWARE_VERTEXPROCESSING, &pp, &dev);
    if (FAILED(hr)) {
        LOG_D3D("CreateDevice(HAL/SWVP) FAILED hr=0x%08X", (unsigned)hr);
        LOG_D3D("== baseline: this is what the fake d3d9.dll must replace ==");
        IDirect3D9_Release(d3d);
        return;
    }

    g_dev = dev;
    g_d3d_ok = 1;
    LOG_D3D("CreateDevice OK - D3D9 rendering, animated clear running");
    ShowWindow(g_d3d_list, SW_HIDE);
    ShowWindow(g_d3d_button, SW_HIDE);
    SetTimer(hwnd, 1, 400, NULL);
    SetWindowTextA(hwnd, "ivm-3dprobe B - D3D9 device OK (animated clear)");
    InvalidateRect(hwnd, NULL, TRUE);
}

static void d3d_reset(HWND hwnd)
{
    KillTimer(hwnd, 1);
    if (g_dev) {
        IDirect3DDevice9_Release(g_dev);
        g_dev = NULL;
    }
    g_d3d_ok = 0;
    g_frame = 0;
    ShowWindow(g_d3d_list, SW_SHOW);
    ShowWindow(g_d3d_button, SW_SHOW);
    SendMessageA(g_d3d_list, LB_RESETCONTENT, 0, 0);
    SetWindowTextA(hwnd, "ivm-3dprobe B - Direct3D 9 test");
}

static LRESULT CALLBACK d3d_wndproc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    switch (msg) {
    case WM_CREATE: {
        g_d3d_list = CreateWindowA("LISTBOX", NULL,
                                   WS_CHILD | WS_VISIBLE | WS_VSCROLL | WS_BORDER,
                                   8, 60, 488, 200, hwnd, (HMENU)(UINT_PTR)IDC_LIST,
                                   g_hinst, NULL);
        g_d3d_button = CreateWindowA("BUTTON", "Re-run D3D9 probe",
                                     WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                                     8, 272, 160, 28, hwnd, (HMENU)(UINT_PTR)IDC_RERUN,
                                     g_hinst, NULL);
        {
            HFONT font = (HFONT)GetStockObject(DEFAULT_GUI_FONT);
            SendMessageA(g_d3d_list, WM_SETFONT, (WPARAM)font, MAKELPARAM(TRUE, 0));
            SendMessageA(g_d3d_button, WM_SETFONT, (WPARAM)font, MAKELPARAM(TRUE, 0));
        }
        log_d3d("B window: listbox + button OK");
        d3d_probe(hwnd);
        return 0;
    }
    case WM_COMMAND:
        if (LOWORD(wp) == IDC_RERUN) {
            d3d_reset(hwnd);
            log_d3d("B window: listbox + button OK");
            d3d_probe(hwnd);
            InvalidateRect(hwnd, NULL, TRUE);
        }
        return 0;
    case WM_TIMER:
        if (g_dev) {
            D3DCOLOR color = D3DCOLOR_XRGB((unsigned char)(g_frame * 24),
                                           (unsigned char)(g_frame * 16),
                                           (unsigned char)(g_frame * 8));
            IDirect3DDevice9_Clear(g_dev, 0, NULL, D3DCLEAR_TARGET, color, 1.0f, 0);
            IDirect3DDevice9_Present(g_dev, NULL, NULL, NULL, NULL);
            g_frame++;
        }
        return 0;
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC dc = BeginPaint(hwnd, &ps);
        paint_bars(dc, ps.rcPaint.bottom, g_d3d_ok);
        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_DESTROY:
        KillTimer(hwnd, 1);
        if (g_dev) {
            IDirect3DDevice9_Release(g_dev);
            g_dev = NULL;
        }
        g_d3d_ok = 0;
        /* 只关 B 窗不能退出整个进程，A 窗还要用 */
        return 0;
    }
    return DefWindowProcA(hwnd, msg, wp, lp);
}

/* ---- A 窗：常规窗口 + XP 原生控件 ---- */

static LRESULT CALLBACK main_wndproc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    switch (msg) {
    case WM_CREATE: {
        g_main_list = CreateWindowA("LISTBOX", NULL,
                                    WS_CHILD | WS_VISIBLE | WS_VSCROLL | WS_BORDER,
                                    8, 60, 488, 200, hwnd, (HMENU)(UINT_PTR)IDC_LIST,
                                    g_hinst, NULL);
        CreateWindowA("BUTTON", "Open Direct3D 9 test window",
                      WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      8, 272, 220, 28, hwnd, (HMENU)(UINT_PTR)IDC_OPEN_D3D,
                      g_hinst, NULL);
        {
            HFONT font = (HFONT)GetStockObject(DEFAULT_GUI_FONT);
            SendMessageA(g_main_list, WM_SETFONT, (WPARAM)font, MAKELPARAM(TRUE, 0));
        }
        log_main("A window: listbox + button OK");
        log_main("A window: GDI color bars painted");
        return 0;
    }
    case WM_COMMAND:
        if (LOWORD(wp) == IDC_OPEN_D3D) {
            HWND b = CreateWindowA("Ivm3dD3D", "ivm-3dprobe B - Direct3D 9 test",
                                   WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
                                   CW_USEDEFAULT, CW_USEDEFAULT, 520, 390,
                                   hwnd, NULL, g_hinst, NULL);
            if (!b) {
                LOG_MAIN("B window CreateWindow FAILED GLE=%ld", (long)GetLastError());
            } else {
                ShowWindow(b, SW_SHOW);
                log_main("B window opened, D3D probe running there");
            }
        }
        return 0;
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC dc = BeginPaint(hwnd, &ps);
        paint_bars(dc, ps.rcPaint.bottom, 0);
        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcA(hwnd, msg, wp, lp);
}

void ivm_probe_entry(void)
{
    WNDCLASSA wc;
    MSG msg;
    HWND hwnd;

    g_hinst = GetModuleHandleA(NULL);

    memset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = main_wndproc;
    wc.hInstance = g_hinst;
    wc.hCursor = LoadCursorA(NULL, (LPCSTR)IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_BTNFACE + 1);
    wc.lpszClassName = "Ivm3dMain";
    RegisterClassA(&wc);

    memset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = d3d_wndproc;
    wc.hInstance = g_hinst;
    wc.hCursor = LoadCursorA(NULL, (LPCSTR)IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_BTNFACE + 1);
    wc.lpszClassName = "Ivm3dD3D";
    RegisterClassA(&wc);

    hwnd = CreateWindowA("Ivm3dMain", "ivm-3dprobe A - window + controls",
                         WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
                         CW_USEDEFAULT, CW_USEDEFAULT, 520, 390,
                         NULL, NULL, g_hinst, NULL);
    if (!hwnd) {
        MessageBoxA(NULL, "CreateWindow(A) failed", "ivm-3dprobe", MB_ICONERROR);
        ExitProcess(1);
    }
    ShowWindow(hwnd, SW_SHOW);

    while (GetMessageA(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageA(&msg);
    }
    ExitProcess(0);
}
