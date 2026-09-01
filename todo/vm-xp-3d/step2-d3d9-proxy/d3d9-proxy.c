/* 假 Direct3D 9 库（vm-xp-3d step2）——让 XP 里的程序「以为」有 3D 设备，
 * 把每次绘制调用记录下来，经 ivm-shm 共享内存信箱（op=2）送到浏览器宿主。
 *
 * 部署：改名 d3d9.dll 放在目标 exe 同目录，Windows DLL 搜索顺序保证它
 * 压过 System32 的真库。当前测试台：ivm-3dprobe.exe（B 窗）。
 *
 * 管线约束（与 res-agent/clipboard-bridge 同一套）：
 *   - zig cc -target x86-windows-gnu -nostdlib：无 CRT，memset/memcpy 自带
 *     （非 static，与 string.h 原型一致）；>4KB 局部数组会拉 __alloca，用 static。
 *   - 链接后 patch：PE 版本 5.01（patch-pe-xp-version.mjs）+ 导出名去修饰
 *     （patch-export-kill-at.mjs）。
 *   - DllMain 不做任何事（loader lock），初始化全部推迟到 Direct3DCreate9
 *     首次调用。
 *
 * 与剪贴板桥共存：G2H 单槽、两写者（bridge + 本库），都守「等非 READY 再发布」。
 * 同时发布的理论碰撞窗口在实验期接受（超时自愈），正式仲裁 step 3 再设计。
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string.h>
#include <stdarg.h>
#include <d3d9.h>
#include "d3d9-proxy-stubs.h"

/* ---- 无 CRT 基础 ---- */

void *memset(void *dst, int c, size_t n)
{
    volatile unsigned char *p = (volatile unsigned char *)dst;
    while (n--) {
        *p++ = (unsigned char)c;
    }
    return dst;
}

void *memcpy(void *dst, const void *src, size_t n)
{
    volatile unsigned char *d = (volatile unsigned char *)dst;
    const volatile unsigned char *s = (const volatile unsigned char *)src;
    while (n--) {
        *d++ = *s++;
    }
    return dst;
}

/* ---- 日志：OutputDebugStringA + 同目录 d3d9-proxy.log ---- */

static HMODULE g_hself;
static HANDLE g_log = INVALID_HANDLE_VALUE;
static int g_stub_seen_n;
static char g_stub_seen[64][32];

static void log_write(const char *line)
{
    OutputDebugStringA(line);
    if (g_log != INVALID_HANDLE_VALUE) {
        DWORD written = 0;
        WriteFile(g_log, line, lstrlenA(line), &written, NULL);
    }
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
    log_write(buffer);
}

static void log_open(void)
{
    char path[MAX_PATH];
    UINT n = GetModuleFileNameA(g_hself, path, MAX_PATH);
    while (n > 0 && path[n - 1] != '\\') {
        n--;
    }
    lstrcpyA(path + n, "d3d9-proxy.log");
    g_log = CreateFileA(path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE,
                        NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (g_log == INVALID_HANDLE_VALUE) {
        g_log = INVALID_HANDLE_VALUE;
        log_line("d3d9-proxy: log open failed gle=%lu, ODS only", (unsigned long)GetLastError());
        return;
    }
    log_line("d3d9-proxy: log opened");
}

static void proxy_stub_hit(const char *name)
{
    for (int i = 0; i < g_stub_seen_n; i++) {
        if (lstrcmpA(g_stub_seen[i], name) == 0) {
            return;
        }
    }
    if (g_stub_seen_n < 64) {
        lstrcpynA(g_stub_seen[g_stub_seen_n], name, 32);
        g_stub_seen_n++;
    }
    log_line("d3d9-proxy: stub call (returns 0): %s", name);
}

/* ---- 绘制调用记录与批次 ----
 * 批次 payload：u32 magic 'D3DB' + u32 count + count×24 字节记录。
 * 记录：u32 opcode + 5×u32 参数。Present 时整批发一次（一帧一批）。 */

#define REC_DIRECT3DCREATE9 1u
#define REC_GETADAPTERDISPLAYMODE 2u
#define REC_CREATEDEVICE 3u
#define REC_TESTCOOPERATIVELEVEL 4u
#define REC_BEGINSCENE 5u
#define REC_ENDSCENE 6u
#define REC_CLEAR 7u
#define REC_PRESENT 8u
#define REC_RESET 9u

#define BATCH_MAGIC 0x42334442u /* 'D3DB' 小端 */
#define BATCH_MAX 512u
#define REC_U32 6u /* opcode + 5 参数 */

typedef struct {
    unsigned long op, a0, a1, a2, a3, a4;
} d3d_rec;

static d3d_rec g_batch[BATCH_MAX];
static unsigned long g_batch_n;
static unsigned long g_batches_sent;
static unsigned long g_batches_dropped;

static unsigned long f2u(float f)
{
    union {
        float f;
        unsigned long u;
    } x;
    x.f = f;
    return x.u;
}

static int shm_publish_batch(void);

static void rec(unsigned long op, unsigned long a0, unsigned long a1,
                unsigned long a2, unsigned long a3, unsigned long a4)
{
    if (g_batch_n >= BATCH_MAX) {
        shm_publish_batch();
    }
    g_batch[g_batch_n].op = op;
    g_batch[g_batch_n].a0 = a0;
    g_batch[g_batch_n].a1 = a1;
    g_batch[g_batch_n].a2 = a2;
    g_batch[g_batch_n].a3 = a3;
    g_batch[g_batch_n].a4 = a4;
    g_batch_n++;
}

/* ---- ivm-shm 信箱（与 clipboard-bridge.c 同一套布局/握手） ----
 * 64KB = G2H 32KB（+0）+ H2G 32KB（+0x8000）；16 字节头 magic/seq/status/len。
 * status = 低 16 位握手态 + 高 16 位 op；op=2 是本库新增的 3D 命令批次，
 * 宿主补丁落地前会把这类帧读走并丢弃（readGuestToHostRaw 对未知 op 照样 ACK）。 */

#define SHM_BLOCK_SIZE 0x8000u
#define SHM_MAGIC 0x584D5649u /* 'IVMX' 小端 */
#define SHM_STATUS_EMPTY 0u
#define SHM_STATUS_READY 1u
#define SHM_STATUS_READ 2u
#define SHM_OP_3D 2u
#define SHM_ACK_TIMEOUT_MS 3000u

#define status_state(s) ((s) & 0xFFFFu)
#define status_pack(state, op) (((state) & 0xFFFFu) | ((op) << 16))

static volatile void *g_shm; /* 信箱基址（G2H 在 +0），驱动给的进程内映射 */

static unsigned long mb_read32(volatile void *base, int offset)
{
    return *(volatile unsigned long *)((char *)base + offset);
}

static void mb_write32(volatile void *base, int offset, unsigned long value)
{
    *(volatile unsigned long *)((char *)base + offset) = value;
}

static int shm_open(void)
{
    /* 打开序列与 clipboard-bridge.c 一致：开设备 → IOCTL 拿映射 → 关句柄
     * （映射挂在 FILE_OBJECT 上继续有效）。 */
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
        return 0;
    }
    int ok = DeviceIoControl(dev, ioctl_info, NULL, 0, &info, sizeof(info), &got, NULL);
    CloseHandle(dev);
    if (!ok || got < sizeof(info) || info.size < 2 * SHM_BLOCK_SIZE || info.user_va == 0) {
        return 0;
    }
    g_shm = (void *)(unsigned long)info.user_va;
    if (mb_read32(g_shm, 0) != SHM_MAGIC) {
        mb_write32(g_shm, 0, SHM_MAGIC);
        mb_write32(g_shm, 4, 0);
        mb_write32(g_shm, 8, SHM_STATUS_EMPTY);
        mb_write32(g_shm, 12, 0);
    }
    return 1;
}

/* G2H 事务：等槽位 → 发布（data→len→seq→status，status 最后）→ 等 ACK。
 * 3 秒等不到就复位并放弃本帧：3D 命令宁可丢，不能卡住游戏线程。 */
static int shm_publish(unsigned long op, const unsigned char *data, unsigned long len)
{
    DWORD waited = 0;
    if (g_shm == 0) {
        return 0;
    }
    while (status_state(mb_read32(g_shm, 8)) == SHM_STATUS_READY) {
        if (waited >= SHM_ACK_TIMEOUT_MS) {
            mb_write32(g_shm, 8, SHM_STATUS_EMPTY);
            break;
        }
        Sleep(1);
        waited++;
    }
    volatile unsigned char *dst = (volatile unsigned char *)((char *)g_shm + 16);
    for (unsigned long i = 0; i < len; i++) {
        dst[i] = data[i];
    }
    mb_write32(g_shm, 12, len);
    mb_write32(g_shm, 4, mb_read32(g_shm, 4) + 1);
    mb_write32(g_shm, 8, status_pack(SHM_STATUS_READY, op));

    waited = 0;
    while (status_state(mb_read32(g_shm, 8)) == SHM_STATUS_READY) {
        if (waited >= SHM_ACK_TIMEOUT_MS) {
            mb_write32(g_shm, 8, SHM_STATUS_EMPTY);
            return 0;
        }
        Sleep(1);
        waited++;
    }
    return 1;
}

static unsigned char g_payload[8 + BATCH_MAX * REC_U32 * 4]; /* < 32KB 信箱上限 */

/* 整批发布：'D3DB' 头 + 记录数组。失败只丢帧并计数，调用方无感。 */
static int shm_publish_batch(void)
{
    if (g_batch_n == 0) {
        return 0;
    }
    unsigned long count = g_batch_n;
    g_batch_n = 0;
    unsigned long len = 8 + count * REC_U32 * 4;
    mb_write32(g_payload, 0, BATCH_MAGIC);
    mb_write32(g_payload, 4, count);
    for (unsigned long i = 0; i < count; i++) {
        unsigned char *r = g_payload + 8 + i * 24;
        r[0] = (unsigned char)(g_batch[i].op & 0xFF);
        r[1] = (unsigned char)((g_batch[i].op >> 8) & 0xFF);
        r[2] = (unsigned char)((g_batch[i].op >> 16) & 0xFF);
        r[3] = (unsigned char)((g_batch[i].op >> 24) & 0xFF);
        const unsigned long args[5] = { g_batch[i].a0, g_batch[i].a1,
                                        g_batch[i].a2, g_batch[i].a3, g_batch[i].a4 };
        for (int j = 0; j < 5; j++) {
            r[4 + j * 4] = (unsigned char)(args[j] & 0xFF);
            r[5 + j * 4] = (unsigned char)((args[j] >> 8) & 0xFF);
            r[6 + j * 4] = (unsigned char)((args[j] >> 16) & 0xFF);
            r[7 + j * 4] = (unsigned char)((args[j] >> 24) & 0xFF);
        }
    }
    if (shm_publish(SHM_OP_3D, g_payload, len)) {
        g_batches_sent++;
        return 1;
    }
    g_batches_dropped++;
    return 0;
}

/* ---- 自带 IID（不依赖 libuuid，仓库惯例） ---- */

static const GUID kIID_IUnknown = { 0x00000000, 0x0000, 0x0000,
                                    { 0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46 } };
static const GUID kIID_IDirect3D9 = { 0x81BDCBCA, 0x64D4, 0x426D,
                                      { 0xAE, 0x8D, 0xAD, 0x01, 0x47, 0xF4, 0x27, 0x5C } };
static const GUID kIID_IDirect3DDevice9 = { 0xd0223b96, 0xbf7a, 0x43fd,
                                            { 0x92, 0xbd, 0xa4, 0x3b, 0x0d, 0x82, 0xb9, 0xeb } };

/* ---- 对象实例与虚表 ---- */

static IDirect3D9 g_d3d9;
static IDirect3DDevice9 g_dev;

/* ---- IDirect3D9：17 个方法全部真实现 ---- */

static HRESULT STDMETHODCALLTYPE d3d_QueryInterface(IDirect3D9 *This, REFIID riid, void **ppv)
{
    (void)This;
    if (!ppv) {
        return E_POINTER;
    }
    *ppv = NULL;
    if (memcmp(riid, &kIID_IUnknown, 16) == 0 || memcmp(riid, &kIID_IDirect3D9, 16) == 0) {
        *ppv = &g_d3d9;
        return S_OK;
    }
    return E_NOINTERFACE;
}

static ULONG STDMETHODCALLTYPE d3d_AddRef(IDirect3D9 *This)
{
    (void)This;
    return 2;
}

static ULONG STDMETHODCALLTYPE d3d_Release(IDirect3D9 *This)
{
    (void)This;
    return 1;
}

static HRESULT STDMETHODCALLTYPE d3d_RegisterSoftwareDevice(IDirect3D9 *This, void *init)
{
    (void)This;
    (void)init;
    return D3D_OK;
}

static UINT STDMETHODCALLTYPE d3d_GetAdapterCount(IDirect3D9 *This)
{
    (void)This;
    return 1;
}

static HRESULT STDMETHODCALLTYPE d3d_GetAdapterIdentifier(IDirect3D9 *This, UINT Adapter,
                                                          DWORD Flags,
                                                          D3DADAPTER_IDENTIFIER9 *pid)
{
    (void)This;
    (void)Flags;
    if (Adapter != 0 || !pid) {
        return D3DERR_INVALIDCALL;
    }
    memset(pid, 0, sizeof(*pid));
    lstrcpyA(pid->Driver, "ivm-d3d9-proxy.dll");
    lstrcpyA(pid->Description, "Instant VM Direct3D 9 proxy (step2)");
    lstrcpyA(pid->DeviceName, "\\\\.\\DISPLAY1");
    return D3D_OK;
}

static UINT STDMETHODCALLTYPE d3d_GetAdapterModeCount(IDirect3D9 *This, UINT Adapter,
                                                      D3DFORMAT Format)
{
    (void)This;
    if (Adapter != 0 || Format != D3DFMT_X8R8G8B8) {
        return 0;
    }
    return 1;
}

static HRESULT STDMETHODCALLTYPE d3d_EnumAdapterModes(IDirect3D9 *This, UINT Adapter,
                                                      D3DFORMAT Format, UINT Mode,
                                                      D3DDISPLAYMODE *mode)
{
    (void)This;
    if (Adapter != 0 || Format != D3DFMT_X8R8G8B8 || Mode > 0 || !mode) {
        return D3DERR_INVALIDCALL;
    }
    mode->Width = (UINT)GetSystemMetrics(SM_CXSCREEN);
    mode->Height = (UINT)GetSystemMetrics(SM_CYSCREEN);
    mode->RefreshRate = 60;
    mode->Format = D3DFMT_X8R8G8B8;
    return D3D_OK;
}

static HRESULT STDMETHODCALLTYPE d3d_GetAdapterDisplayMode(IDirect3D9 *This, UINT Adapter,
                                                           D3DDISPLAYMODE *mode)
{
    (void)This;
    if (Adapter != 0 || !mode) {
        return D3DERR_INVALIDCALL;
    }
    mode->Width = (UINT)GetSystemMetrics(SM_CXSCREEN);
    mode->Height = (UINT)GetSystemMetrics(SM_CYSCREEN);
    mode->RefreshRate = 60;
    mode->Format = D3DFMT_X8R8G8B8;
    rec(REC_GETADAPTERDISPLAYMODE, mode->Width, mode->Height, mode->Format, 0, 0);
    return D3D_OK;
}

static HRESULT STDMETHODCALLTYPE d3d_CheckDeviceType(IDirect3D9 *This, UINT iAdapter,
                                                     D3DDEVTYPE DevType, D3DFORMAT DisplayFormat,
                                                     D3DFORMAT BackBufferFormat,
                                                     WINBOOL bWindowed)
{
    (void)This;
    (void)iAdapter;
    (void)DevType;
    (void)DisplayFormat;
    (void)BackBufferFormat;
    (void)bWindowed;
    return D3D_OK;
}

static HRESULT STDMETHODCALLTYPE d3d_CheckDeviceFormat(IDirect3D9 *This, UINT Adapter,
                                                       D3DDEVTYPE DeviceType,
                                                       D3DFORMAT AdapterFormat, DWORD Usage,
                                                       D3DRESOURCETYPE RType,
                                                       D3DFORMAT CheckFormat)
{
    (void)This;
    (void)Adapter;
    (void)DeviceType;
    (void)AdapterFormat;
    (void)Usage;
    (void)RType;
    (void)CheckFormat;
    return D3D_OK;
}

static HRESULT STDMETHODCALLTYPE d3d_CheckDeviceMultiSampleType(
    IDirect3D9 *This, UINT Adapter, D3DDEVTYPE DeviceType, D3DFORMAT SurfaceFormat,
    WINBOOL Windowed, D3DMULTISAMPLE_TYPE MultiSampleType, DWORD *pQualityLevels)
{
    (void)This;
    (void)Adapter;
    (void)DeviceType;
    (void)SurfaceFormat;
    (void)Windowed;
    (void)MultiSampleType;
    if (pQualityLevels) {
        *pQualityLevels = 0;
    }
    return D3D_OK;
}

static HRESULT STDMETHODCALLTYPE d3d_CheckDepthStencilMatch(IDirect3D9 *This, UINT Adapter,
                                                            D3DDEVTYPE DeviceType,
                                                            D3DFORMAT AdapterFormat,
                                                            D3DFORMAT RenderTargetFormat,
                                                            D3DFORMAT DepthStencilFormat)
{
    (void)This;
    (void)Adapter;
    (void)DeviceType;
    (void)AdapterFormat;
    (void)RenderTargetFormat;
    (void)DepthStencilFormat;
    return D3D_OK;
}

static HRESULT STDMETHODCALLTYPE d3d_CheckDeviceFormatConversion(IDirect3D9 *This, UINT Adapter,
                                                                 D3DDEVTYPE DeviceType,
                                                                 D3DFORMAT SourceFormat,
                                                                 D3DFORMAT TargetFormat)
{
    (void)This;
    (void)Adapter;
    (void)DeviceType;
    (void)SourceFormat;
    (void)TargetFormat;
    return D3D_OK;
}

static HRESULT STDMETHODCALLTYPE d3d_GetDeviceCaps(IDirect3D9 *This, UINT Adapter,
                                                   D3DDEVTYPE DeviceType, D3DCAPS9 *caps)
{
    (void)This;
    (void)Adapter;
    (void)DeviceType;
    if (!caps) {
        return D3DERR_INVALIDCALL;
    }
    memset(caps, 0, sizeof(*caps));
    caps->DeviceType = D3DDEVTYPE_HAL;
    caps->AdapterOrdinal = 0;
    caps->MaxTextureWidth = 2048;
    caps->MaxTextureHeight = 2048;
    caps->MaxStreamStride = 256;
    caps->MaxStreams = 1;
    caps->MaxUserClipPlanes = 0;
    return D3D_OK;
}

static HMONITOR STDMETHODCALLTYPE d3d_GetAdapterMonitor(IDirect3D9 *This, UINT Adapter)
{
    (void)This;
    (void)Adapter;
    return NULL;
}

static HRESULT STDMETHODCALLTYPE d3d_CreateDevice(IDirect3D9 *This, UINT Adapter,
                                                  D3DDEVTYPE DeviceType, HWND hFocusWindow,
                                                  DWORD BehaviorFlags,
                                                  D3DPRESENT_PARAMETERS *pPresentationParameters,
                                                  struct IDirect3DDevice9 **ppReturnedDeviceInterface)
{
    (void)This;
    (void)hFocusWindow;
    if (!ppReturnedDeviceInterface || !pPresentationParameters) {
        return D3DERR_INVALIDCALL;
    }
    rec(REC_CREATEDEVICE, Adapter, (unsigned long)DeviceType, BehaviorFlags,
        pPresentationParameters->BackBufferWidth, pPresentationParameters->BackBufferHeight);
    log_line("d3d9-proxy: CreateDevice adapter=%lu type=%lu flags=0x%08lx %lux%lu -> fake OK",
             (unsigned long)Adapter, (unsigned long)DeviceType,
             (unsigned long)BehaviorFlags,
             (unsigned long)pPresentationParameters->BackBufferWidth,
             (unsigned long)pPresentationParameters->BackBufferHeight);
    *ppReturnedDeviceInterface = &g_dev;
    return D3D_OK;
}

static IDirect3D9Vtbl g_d3d9_vtbl = {
    d3d_QueryInterface,
    d3d_AddRef,
    d3d_Release,
    d3d_RegisterSoftwareDevice,
    d3d_GetAdapterCount,
    d3d_GetAdapterIdentifier,
    d3d_GetAdapterModeCount,
    d3d_EnumAdapterModes,
    d3d_GetAdapterDisplayMode,
    d3d_CheckDeviceType,
    d3d_CheckDeviceFormat,
    d3d_CheckDeviceMultiSampleType,
    d3d_CheckDepthStencilMatch,
    d3d_CheckDeviceFormatConversion,
    d3d_GetDeviceCaps,
    d3d_GetAdapterMonitor,
    d3d_CreateDevice,
};

/* ---- IDirect3DDevice9：10 个真实现，其余走生成 stub ---- */

static HRESULT STDMETHODCALLTYPE dev_QueryInterface(IDirect3DDevice9 *This, REFIID riid,
                                                    void **ppv)
{
    (void)This;
    if (!ppv) {
        return E_POINTER;
    }
    *ppv = NULL;
    if (memcmp(riid, &kIID_IUnknown, 16) == 0 || memcmp(riid, &kIID_IDirect3DDevice9, 16) == 0) {
        *ppv = &g_dev;
        return S_OK;
    }
    return E_NOINTERFACE;
}

static ULONG STDMETHODCALLTYPE dev_AddRef(IDirect3DDevice9 *This)
{
    (void)This;
    return 2;
}

static ULONG STDMETHODCALLTYPE dev_Release(IDirect3DDevice9 *This)
{
    (void)This;
    return 1;
}

static HRESULT STDMETHODCALLTYPE dev_TestCooperativeLevel(IDirect3DDevice9 *This)
{
    (void)This;
    return D3D_OK;
}

static HRESULT STDMETHODCALLTYPE dev_BeginScene(IDirect3DDevice9 *This)
{
    (void)This;
    rec(REC_BEGINSCENE, 0, 0, 0, 0, 0);
    return D3D_OK;
}

static HRESULT STDMETHODCALLTYPE dev_EndScene(IDirect3DDevice9 *This)
{
    (void)This;
    rec(REC_ENDSCENE, 0, 0, 0, 0, 0);
    return D3D_OK;
}

static HRESULT STDMETHODCALLTYPE dev_Clear(IDirect3DDevice9 *This, DWORD Count,
                                           const D3DRECT *pRects, DWORD Flags, D3DCOLOR Color,
                                           float Z, DWORD Stencil)
{
    (void)This;
    (void)Count;
    (void)pRects;
    rec(REC_CLEAR, Flags, Color, f2u(Z), Stencil, 0);
    return D3D_OK;
}

static HRESULT STDMETHODCALLTYPE dev_Present(IDirect3DDevice9 *This, const RECT *a,
                                             const RECT *b, HWND c, const RGNDATA *d)
{
    (void)This;
    (void)a;
    (void)b;
    (void)c;
    (void)d;
    rec(REC_PRESENT, 0, 0, 0, 0, 0);
    shm_publish_batch();
    return D3D_OK;
}

static HRESULT STDMETHODCALLTYPE dev_Reset(IDirect3DDevice9 *This,
                                           D3DPRESENT_PARAMETERS *pp)
{
    (void)This;
    rec(REC_RESET, pp ? pp->BackBufferWidth : 0, pp ? pp->BackBufferHeight : 0,
        pp ? pp->BackBufferFormat : 0, 0, 0);
    return D3D_OK;
}

static HRESULT STDMETHODCALLTYPE dev_GetDirect3D(IDirect3DDevice9 *This, IDirect3D9 **ppD3D)
{
    (void)This;
    if (ppD3D) {
        *ppD3D = &g_d3d9;
    }
    return D3D_OK;
}

/* ---- 导出与入口 ---- */

static IDirect3DDevice9Vtbl g_dev_vtbl;

static void proxy_init(void)
{
    log_open();
    log_line("d3d9-proxy: Direct3DCreate9 entry (fake d3d9.dll, vm-xp-3d step2)");
    g_d3d9.lpVtbl = &g_d3d9_vtbl;
    dev_vtbl_init(&g_dev_vtbl);
    g_dev_vtbl.QueryInterface = dev_QueryInterface;
    g_dev_vtbl.AddRef = dev_AddRef;
    g_dev_vtbl.Release = dev_Release;
    g_dev_vtbl.TestCooperativeLevel = dev_TestCooperativeLevel;
    g_dev_vtbl.BeginScene = dev_BeginScene;
    g_dev_vtbl.EndScene = dev_EndScene;
    g_dev_vtbl.Clear = dev_Clear;
    g_dev_vtbl.Present = dev_Present;
    g_dev_vtbl.Reset = dev_Reset;
    g_dev_vtbl.GetDirect3D = dev_GetDirect3D;
    g_dev.lpVtbl = &g_dev_vtbl;
    if (shm_open()) {
        log_line("d3d9-proxy: mailbox ready (op=2 batches on Present)");
    } else {
        log_line("d3d9-proxy: mailbox unavailable gle=%lu, log-file only",
                 (unsigned long)GetLastError());
    }
}

__attribute__((dllexport)) IDirect3D9 *WINAPI Direct3DCreate9(UINT SDKVersion)
{
    static int inited = 0;
    if (!inited) {
        inited = 1;
        proxy_init();
    }
    rec(REC_DIRECT3DCREATE9, SDKVersion, 0, 0, 0, 0);
    return &g_d3d9;
}

int _DllMainCRTStartup(void *hinst, unsigned long reason, void *reserved)
{
    (void)reason;
    (void)reserved;
    g_hself = (HMODULE)hinst;
    return 1;
}
