/*
 * clip-dav-hdrop —— dav_clipboard_paste 一期真机探针的剪贴板助手。
 *
 * 它与 vmfile-spike 同管线（zig cc -nostdlib、入口 clipdav_entry、PE 补
 * 5.01），但方向相反：vmfile-spike 验证「虚拟文件描述符」这条被放弃的
 * 路，本程序验证「真实网络路径」那条要落地的路——
 *
 *   用法：clip-dav-hdrop.exe <路径> [更多路径...] [/cut]
 *                                    [/wait:<秒>] [/manifest:<清单文件>]
 *
 * 把命令行给出的【真实存在】的路径（盘符或 UNC，绝不许 http://）挂上
 * OLE 剪贴板的 CF_HDROP + Preferred DropEffect（默认复制，/cut 改剪切），
 * 然后只做三件事：保持剪贴板所有权、记录每一次被取数、到点退出。
 * 它【只返回路径】：绝不自己写盘、绝不弹「正在复制」——真正的复制引擎
 * 应当是 XP 资源管理器自己（这就是二期要验证的前提）。
 *
 * v9 新增 /manifest:<清单文件>：服务「宿主文件APP复制 → XP 系统对话框
 * 粘贴」桥接。清单是 UTF-16LE 文本（BOM 可有可无）：第一行是模式
 * （copy/cut，其他值按 copy，且优先于命令行 /cut），其余每行一个绝对
 * 路径；相对行以清单所在目录拼成绝对路径。路径很多（几百行）也吃得下：
 * 清单按实际文件尺寸读入，路径数组动态分配。该模式 /wait 缺省放宽为
 * 24 小时——复制在宿主侧发生，粘贴可能很久之后才发生；显式 /wait 仍
 * 优先。
 *
 * 判定方法（与 C:\Tools\clip-dav-probe.log、宿主控制台 WebDAV 行对时间）：
 *   QUERY（QueryGetData）成串出现、没有 FETCH → 只是右键菜单在探格式，
 *     属「探询」；粘贴按钮亮起靠它。
 *   FETCH（GetData）CF_HDROP 之后 Explorer 自己发起 DAV 目录查询/读取
 *     （宿主控制台出现 PROPFIND/GET 行）、目标出现文件、进度窗是系统自带
 *     → 前提成立，二期照此落地。
 *   FETCH 之后什么都没发生 / 粘贴灰 / 报错 → 该路径形态不被资源管理器
 *     当文件源，换下一种（盘符 / UNC）。
 *
 * 每次取数记相对时间、格式名、tymed、返回码、字节数，全部追加到
 * C:\Tools\clip-dav-hdrop.log；同时轮询剪贴板序号与所有权（被别的进程
 * 抢走会记一笔——常买就是现有剪贴板桥接管了，探针结果作废重跑）。
 * 4 分钟自动退出（/manifest 模式缺省 24 小时）；退出前 OleFlushClipboard
 * 把路径定格到系统剪贴板，助手退场后再贴一次的表现也是一个数据点。
 *
 * 运行前（探针批处理会提醒）：不要从宿主文件 APP 复制任何东西，否则
 * 现有剪贴板桥会把剪贴板抢成空占位，本程序 OleSetClipboard 直接失败。
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <ole2.h>
#include <shellapi.h>
#include <shlobj.h> /* DROPFILES（zig 头把它放在 shlobj.h，同 vmfile-spike） */
#include <stdarg.h>

/* 无 CRT（-nostdlib）：自带 mem*（IsEqualGUID 宏与结构填充会用到）。 */
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

/* ---- 日志：C:\Tools\clip-dav-hdrop.log 追加 + OutputDebugString ----
 * 前缀本地时间，事件行另带 [秒.毫秒] 相对时间，与探针 bat / 宿主控制台
 * 按时刻对齐。实机没有调试器，落盘是唯一看得见的通道。 */

#define LOG_PATH "C:\\Tools\\clip-dav-hdrop.log"

static DWORD g_start_tick;

static unsigned long elapsed_ms(void)
{
    return (unsigned long)(GetTickCount() - g_start_tick);
}

static void log_line(const char *fmt, ...)
{
    char buffer[512];
    SYSTEMTIME st;
    int used;
    va_list args;

    GetLocalTime(&st);
    wsprintfA(buffer, "%04u-%02u-%02u %02u:%02u:%02u.%03u ",
              st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond,
              st.wMilliseconds);
    used = lstrlenA(buffer);
    va_start(args, fmt);
    wvsprintfA(buffer + used, fmt, args);
    va_end(args);
    for (char *p = buffer; *p; p++) {
        if (*p == '\n' || *p == '\r') {
            *p = ' ';
        }
    }
    lstrcatA(buffer, "\r\n");
    OutputDebugStringA(buffer);
    HANDLE h = CreateFileA(LOG_PATH, GENERIC_WRITE,
                           FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_ALWAYS,
                           FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) {
        return;
    }
    SetFilePointer(h, 0, NULL, FILE_END);
    DWORD written = 0;
    WriteFile(h, buffer, (DWORD)lstrlenA(buffer), &written, NULL);
    CloseHandle(h);
}

/* 事件行统一带 [秒.毫秒] 相对时间。 */
#define LOG_EVENT(fmt, ...) \
    log_line("[%06lu.%03lu] " fmt, elapsed_ms() / 1000u, elapsed_ms() % 1000u, __VA_ARGS__)

/* ---- 剪贴板格式名：标准 ID 查表，注册格式读名字 ---- */

static void cf_name(unsigned int cf, char *dst /* >=96 */)
{
    static const char *const standard[] = {
        NULL, "CF_TEXT", "CF_BITMAP", "CF_METAFILEPICT", "CF_SYLK", "CF_DIF",
        "CF_TIFF", "CF_OEMTEXT", "CF_DIB", "CF_PALETTE", "CF_PENDATA",
        "CF_RIFF", "CF_WAVE", "CF_UNICODETEXT", "CF_ENHMETAFILE", "CF_HDROP",
        "CF_LOCALE", "CF_DIBV5",
    };
    wsprintfA(dst, "cf=0x%04X", cf);
    if (cf < (sizeof(standard) / sizeof(standard[0])) && standard[cf] != NULL) {
        lstrcpynA(dst + lstrlenA(dst), standard[cf], 32);
        return;
    }
    if (cf >= 0xC000) {
        char name[64];
        if (GetClipboardFormatNameA((UINT)cf, name, (int)sizeof(name))) {
            lstrcatA(dst, " ");
            lstrcatA(dst, name);
        }
    }
}

/* ---- IID 自带定义（避免链 libuuid），同 vmfile-spike ---- */

static const IID PROBE_IID_IUnknown = {0x00000000u, 0x0000u, 0x0000u, {0xC0u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x46u}};
static const IID PROBE_IID_IEnumFORMATETC = {0x00000103u, 0x0000u, 0x0000u, {0xC0u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x46u}};
static const IID PROBE_IID_IDataObject = {0x0000010Eu, 0x0000u, 0x0000u, {0xC0u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x46u}};

static int iid_equals(REFIID a, const IID *b)
{
    return memcmp(a, b, sizeof(IID)) == 0;
}

/* ---- 数据：两块 HGLOBAL（HDROP 多串路径 + Preferred DropEffect），
 * GetData 时逐份克隆给调用方，自己那份留着重用。 ---- */

static HGLOBAL g_hdrop;
static HGLOBAL g_effect;
static UINT g_cf_effect;

static HGLOBAL dup_global(HGLOBAL src)
{
    SIZE_T size = GlobalSize(src);
    HGLOBAL dst = GlobalAlloc(GMEM_MOVEABLE, size);
    void *s;
    void *d;
    if (dst == NULL) {
        return NULL;
    }
    s = GlobalLock(src);
    d = GlobalLock(dst);
    if (s != NULL && d != NULL) {
        memcpy(d, s, size);
    }
    if (s != NULL) {
        GlobalUnlock(src);
    }
    if (d != NULL) {
        GlobalUnlock(dst);
    }
    return dst;
}

/* ---- IEnumFORMATETC：GET 方向枚举 CF_HDROP + DropEffect ---- */

#define PROBE_FORMAT_COUNT 2u

typedef struct {
    IEnumFORMATETCVtbl *lpVtbl;
    ULONG refs;
    ULONG pos;
} ProbeEnum;

static ProbeEnum *enum_create_at(ULONG pos);

static FORMATETC g_formats[PROBE_FORMAT_COUNT];

static HRESULT STDMETHODCALLTYPE enum_QueryInterface(IEnumFORMATETC *This, REFIID riid, void **ppvObject)
{
    if (ppvObject == NULL) {
        return E_POINTER;
    }
    *ppvObject = NULL;
    if (iid_equals(riid, &PROBE_IID_IUnknown) || iid_equals(riid, &PROBE_IID_IEnumFORMATETC)) {
        *ppvObject = This;
        This->lpVtbl->AddRef(This);
        return S_OK;
    }
    return E_NOINTERFACE;
}

static ULONG STDMETHODCALLTYPE enum_AddRef(IEnumFORMATETC *This)
{
    ProbeEnum *e = (ProbeEnum *)This;
    return ++e->refs;
}

static ULONG STDMETHODCALLTYPE enum_Release(IEnumFORMATETC *This)
{
    ProbeEnum *e = (ProbeEnum *)This;
    ULONG refs = --e->refs;
    if (refs == 0) {
        HeapFree(GetProcessHeap(), 0, e);
    }
    return refs;
}

static HRESULT STDMETHODCALLTYPE enum_Next(IEnumFORMATETC *This, ULONG celt, FORMATETC *rgelt, ULONG *pceltFetched)
{
    ProbeEnum *e = (ProbeEnum *)This;
    ULONG fetched = 0;
    if (pceltFetched != NULL) {
        *pceltFetched = 0;
    }
    if (celt > 0 && rgelt == NULL) {
        return E_POINTER;
    }
    while (fetched < celt && e->pos < PROBE_FORMAT_COUNT) {
        rgelt[fetched] = g_formats[e->pos];
        fetched++;
        e->pos++;
    }
    if (pceltFetched != NULL) {
        *pceltFetched = fetched;
    }
    return (fetched == celt) ? S_OK : S_FALSE;
}

static HRESULT STDMETHODCALLTYPE enum_Skip(IEnumFORMATETC *This, ULONG celt)
{
    ProbeEnum *e = (ProbeEnum *)This;
    e->pos += celt;
    if (e->pos > PROBE_FORMAT_COUNT) {
        e->pos = PROBE_FORMAT_COUNT;
        return S_FALSE;
    }
    return S_OK;
}

static HRESULT STDMETHODCALLTYPE enum_Reset(IEnumFORMATETC *This)
{
    ProbeEnum *e = (ProbeEnum *)This;
    e->pos = 0;
    return S_OK;
}

static HRESULT STDMETHODCALLTYPE enum_Clone(IEnumFORMATETC *This, IEnumFORMATETC **ppenum)
{
    ProbeEnum *e = (ProbeEnum *)This;
    if (ppenum == NULL) {
        return E_POINTER;
    }
    *ppenum = (IEnumFORMATETC *)enum_create_at(e->pos);
    return (*ppenum != NULL) ? S_OK : E_OUTOFMEMORY;
}

static IEnumFORMATETCVtbl g_enumVtbl = {
    enum_QueryInterface,
    enum_AddRef,
    enum_Release,
    enum_Next,
    enum_Skip,
    enum_Reset,
    enum_Clone,
};

static ProbeEnum *enum_create_at(ULONG pos)
{
    ProbeEnum *e = (ProbeEnum *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*e));
    if (e == NULL) {
        return NULL;
    }
    e->lpVtbl = &g_enumVtbl;
    e->refs = 1;
    e->pos = pos;
    return e;
}

/* ---- IDataObject：只出路径，绝不写盘 ---- */

static unsigned long g_stat_get;
static unsigned long g_stat_query;
static unsigned long g_stat_enum;

typedef struct {
    IDataObjectVtbl *lpVtbl;
    ULONG refs;
} ProbeData;

static HRESULT STDMETHODCALLTYPE data_QueryInterface(IDataObject *This, REFIID riid, void **ppvObject)
{
    if (ppvObject == NULL) {
        return E_POINTER;
    }
    *ppvObject = NULL;
    if (iid_equals(riid, &PROBE_IID_IUnknown) || iid_equals(riid, &PROBE_IID_IDataObject)) {
        *ppvObject = This;
        This->lpVtbl->AddRef(This);
        return S_OK;
    }
    return E_NOINTERFACE;
}

static ULONG STDMETHODCALLTYPE data_AddRef(IDataObject *This)
{
    ProbeData *d = (ProbeData *)This;
    return ++d->refs;
}

static ULONG STDMETHODCALLTYPE data_Release(IDataObject *This)
{
    ProbeData *d = (ProbeData *)This;
    ULONG refs = --d->refs;
    if (refs == 0) {
        log_line("data object destroyed");
        HeapFree(GetProcessHeap(), 0, d);
    }
    return refs;
}

static HRESULT offer_hglobal(FORMATETC *fmt, HGLOBAL src, STGMEDIUM *medium)
{
    HGLOBAL copy;
    if (!(fmt->tymed & TYMED_HGLOBAL)) {
        return DV_E_TYMED;
    }
    copy = dup_global(src);
    if (copy == NULL) {
        return STG_E_MEDIUMFULL;
    }
    medium->tymed = TYMED_HGLOBAL;
    medium->hGlobal = copy;
    medium->pUnkForRelease = NULL;
    return S_OK;
}

static HRESULT STDMETHODCALLTYPE data_GetData(IDataObject *This, FORMATETC *pformatetcIn, STGMEDIUM *pmedium)
{
    char name[96];
    HRESULT hr;
    (void)This;
    if (pformatetcIn == NULL || pmedium == NULL) {
        return E_POINTER;
    }
    g_stat_get++;
    cf_name(pformatetcIn->cfFormat, name);
    if (pformatetcIn->dwAspect != DVASPECT_CONTENT) {
        LOG_EVENT("FETCH %s aspect=0x%08X -> DV_E_DVASPECT",
                  name, (unsigned int)pformatetcIn->dwAspect);
        return DV_E_DVASPECT;
    }
    if (pformatetcIn->cfFormat == CF_HDROP) {
        hr = offer_hglobal(pformatetcIn, g_hdrop, pmedium);
    } else if (pformatetcIn->cfFormat == (CLIPFORMAT)g_cf_effect) {
        hr = offer_hglobal(pformatetcIn, g_effect, pmedium);
    } else {
        hr = DV_E_FORMATETC;
    }
    LOG_EVENT("FETCH %s tymed=0x%08X lindex=%ld -> 0x%08lX bytes=%lu",
              name, (unsigned int)pformatetcIn->tymed, (long)pformatetcIn->lindex,
              (unsigned long)hr,
              SUCCEEDED(hr) ? (unsigned long)GlobalSize(pmedium->hGlobal) : 0ul);
    return hr;
}

static HRESULT STDMETHODCALLTYPE data_GetDataHere(IDataObject *This, FORMATETC *pformatetc, STGMEDIUM *pmedium)
{
    (void)This;
    (void)pformatetc;
    (void)pmedium;
    return E_NOTIMPL;
}

static HRESULT STDMETHODCALLTYPE data_QueryGetData(IDataObject *This, FORMATETC *pformatetc)
{
    char name[96];
    HRESULT hr;
    (void)This;
    if (pformatetc == NULL) {
        return E_POINTER;
    }
    g_stat_query++;
    cf_name(pformatetc->cfFormat, name);
    if (pformatetc->dwAspect != DVASPECT_CONTENT) {
        hr = DV_E_DVASPECT;
    } else if (pformatetc->cfFormat == CF_HDROP ||
               pformatetc->cfFormat == (CLIPFORMAT)g_cf_effect) {
        hr = S_OK;
    } else {
        hr = DV_E_FORMATETC;
    }
    /* 只问不取 = 典型探询（组右键菜单/亮粘贴按钮）；真粘贴走 FETCH。 */
    LOG_EVENT("QUERY %s aspect=0x%08X -> 0x%08lX (probe-ish: query only)",
              name, (unsigned int)pformatetc->dwAspect, (unsigned long)hr);
    return hr;
}

static HRESULT STDMETHODCALLTYPE data_GetCanonicalFormatEtc(IDataObject *This, FORMATETC *pformatectIn, FORMATETC *pformatetcOut)
{
    (void)This;
    if (pformatetcOut == NULL) {
        return E_POINTER;
    }
    *pformatetcOut = *pformatectIn;
    pformatetcOut->ptd = NULL;
    return DATA_S_SAMEFORMATETC;
}

static HRESULT STDMETHODCALLTYPE data_SetData(IDataObject *This, FORMATETC *pformatetc, STGMEDIUM *pmedium, BOOL fRelease)
{
    char name[96];
    (void)This;
    (void)pmedium;
    (void)fRelease;
    if (pformatetc != NULL) {
        cf_name(pformatetc->cfFormat, name);
        LOG_EVENT("SetData %s (not offered, refusing)", name);
    }
    return E_NOTIMPL;
}

static HRESULT STDMETHODCALLTYPE data_EnumFormatEtc(IDataObject *This, DWORD dwDirection, IEnumFORMATETC **ppenumFormatEtc)
{
    (void)This;
    if (ppenumFormatEtc == NULL) {
        return E_POINTER;
    }
    *ppenumFormatEtc = NULL;
    if (dwDirection != DATADIR_GET) {
        return E_NOTIMPL;
    }
    g_stat_enum++;
    log_line("[%06lu.%03lu] ENUM dir=GET",
             elapsed_ms() / 1000u, elapsed_ms() % 1000u);
    *ppenumFormatEtc = (IEnumFORMATETC *)enum_create_at(0);
    return (*ppenumFormatEtc != NULL) ? S_OK : E_OUTOFMEMORY;
}

static HRESULT STDMETHODCALLTYPE data_DAdvise(IDataObject *This, FORMATETC *pformatetc, DWORD advf, IAdviseSink *pAdvSink, DWORD *pdwConnection)
{
    (void)This;
    (void)pformatetc;
    (void)advf;
    (void)pAdvSink;
    (void)pdwConnection;
    return OLE_E_ADVISENOTSUPPORTED;
}

static HRESULT STDMETHODCALLTYPE data_DUnadvise(IDataObject *This, DWORD dwConnection)
{
    (void)This;
    (void)dwConnection;
    return OLE_E_ADVISENOTSUPPORTED;
}

static HRESULT STDMETHODCALLTYPE data_EnumDAdvise(IDataObject *This, IEnumSTATDATA **ppenumAdvise)
{
    (void)This;
    if (ppenumAdvise != NULL) {
        *ppenumAdvise = NULL;
    }
    return OLE_E_ADVISENOTSUPPORTED;
}

static IDataObjectVtbl g_dataVtbl = {
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

static ProbeData *data_create(void)
{
    ProbeData *d = (ProbeData *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*d));
    if (d == NULL) {
        return NULL;
    }
    d->lpVtbl = &g_dataVtbl;
    d->refs = 1;
    return d;
}

/* ---- HDROP/DropEffect 内存 ---- */

static HGLOBAL build_hdrop(wchar_t **paths, int count)
{
    int total_wchars = 1; /* 结尾双 NUL 的第二枚 */
    HGLOBAL h;
    DROPFILES *df;
    wchar_t *w;
    for (int i = 0; i < count; i++) {
        total_wchars += lstrlenW(paths[i]) + 1;
    }
    h = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT,
                    sizeof(DROPFILES) + (SIZE_T)total_wchars * sizeof(wchar_t));
    if (h == NULL) {
        return NULL;
    }
    df = (DROPFILES *)GlobalLock(h);
    if (df == NULL) {
        GlobalFree(h);
        return NULL;
    }
    df->pFiles = sizeof(DROPFILES);
    df->pt.x = 0;
    df->pt.y = 0;
    df->fNC = 0;
    df->fWide = TRUE;
    w = (wchar_t *)((char *)df + sizeof(DROPFILES));
    for (int i = 0; i < count; i++) {
        int n = lstrlenW(paths[i]) + 1;
        memcpy(w, paths[i], (SIZE_T)n * sizeof(wchar_t));
        w += n;
    }
    *w = 0;
    GlobalUnlock(h);
    return h;
}

static HGLOBAL build_effect(DWORD value)
{
    HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, sizeof(DWORD));
    DWORD *p;
    if (h == NULL) {
        return NULL;
    }
    p = (DWORD *)GlobalLock(h);
    if (p == NULL) {
        GlobalFree(h);
        return NULL;
    }
    *p = value;
    GlobalUnlock(h);
    return h;
}

/* ---- 入口 ---- */

#define TIMER_EXIT 1
#define TIMER_POLL 2
#define PROBE_SECONDS 240u /* 命令行模式的缺省存活时长（4 分钟） */
#define MANIFEST_SECONDS 86400u /* /manifest 模式缺省存活 24 小时：粘贴可能发生在很久之后 */
#define MAX_PATHS 16 /* 命令行直给路径的上限；/manifest 走动态数组，几百行也行 */

static ProbeData *g_data;

static DWORD g_last_seq;
static int g_last_owned = 1;

static void poll_clipboard(void)
{
    DWORD seq = GetClipboardSequenceNumber();
    if (seq != g_last_seq) {
        LOG_EVENT("clipboard sequence %lu -> %lu", g_last_seq, seq);
        g_last_seq = seq;
    }
    int owned = OleIsCurrentClipboard((IDataObject *)g_data) == S_OK;
    if (owned != g_last_owned) {
        g_last_owned = owned;
        LOG_EVENT("clipboard ownership: %s",
                  owned ? "ours again" : "LOST - someone else took the clipboard");
    }
}

/* ASCII 大小写无关比较（只认 /cut /copy 开关）。 */
static int argi_equals(const wchar_t *s, const wchar_t *lit)
{
    while (*lit) {
        wchar_t a = *s;
        wchar_t b = *lit;
        if (a >= L'A' && a <= L'Z') {
            a += L'a' - L'A';
        }
        if (a != b) {
            return 0;
        }
        s++;
        lit++;
    }
    return *s == 0;
}

/*
 * `/wait:<秒>`：覆盖默认存活时长。手工粘贴测试要留出足够时间（几分钟到半小时），
 * 默认 4 分钟会在用户出手前就 OleFlushClipboard 收工。范围钳到 10..86400。
 */
static int parse_wait_arg(const wchar_t *s, unsigned *out)
{
    const wchar_t *p = s;
    unsigned value = 0;
    if (*p == L'/' || *p == L'-') {
        p++;
    } else {
        return 0;
    }
    {
        static const wchar_t prefix[] = L"wait:";
        int i;
        for (i = 0; prefix[i] != 0; i++) {
            wchar_t a = p[i];
            if (a >= L'A' && a <= L'Z') {
                a += L'a' - L'A';
            }
            if (a != prefix[i]) {
                return 0;
            }
        }
        p += i;
    }
    if (*p == 0) {
        return 0;
    }
    while (*p) {
        if (*p < L'0' || *p > L'9') {
            return 0;
        }
        value = value * 10u + (unsigned)(*p - L'0');
        if (value > 86400u) {
            value = 86400u;
        }
        p++;
    }
    if (value < 10u) {
        value = 10u;
    }
    *out = value;
    return 1;
}

/*
 * `/manifest:<文件路径>`：返回冒号后的清单文件路径部分，不匹配返回 NULL。
 * 与 /wait 同款大小写无关前缀匹配，冒号后内容原样保留（是路径，不改大小写）。
 */
static const wchar_t *parse_manifest_arg(const wchar_t *s)
{
    const wchar_t *p = s;
    if (*p == L'/' || *p == L'-') {
        p++;
    } else {
        return NULL;
    }
    {
        static const wchar_t prefix[] = L"manifest:";
        int i;
        for (i = 0; prefix[i] != 0; i++) {
            wchar_t a = p[i];
            if (a >= L'A' && a <= L'Z') {
                a += L'a' - L'A';
            }
            if (a != prefix[i]) {
                return NULL;
            }
        }
        p += i;
    }
    if (*p == 0) {
        return NULL;
    }
    return p;
}

/* ---- v9 /manifest：清单读入与解析（宿主文件APP复制 → XP 对话框粘贴） ---- */

/* 绝对路径判定：X: 盘符或 \\ UNC 开头；其余按相对，用 manifest 目录拼。 */
static int path_is_absolute(const wchar_t *p)
{
    if (p[0] == L'\\' && p[1] == L'\\') {
        return 1;
    }
    if (p[0] != 0 && p[1] == L':') {
        return 1;
    }
    return 0;
}

/* 动态路径数组：命令行直给的（最多 16 个）+ 清单里的几百行都进这里。 */
typedef struct {
    wchar_t **items;
    int count;
    int cap;
} PathList;

static int pathlist_push(PathList *pl, wchar_t *path)
{
    if (pl->count >= pl->cap) {
        int ncap = pl->cap > 0 ? pl->cap * 2 : 64;
        wchar_t **na = (wchar_t **)HeapReAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY,
                                               pl->items,
                                               (SIZE_T)ncap * sizeof(wchar_t *));
        if (na == NULL) {
            return 0;
        }
        pl->items = na;
        pl->cap = ncap;
    }
    pl->items[pl->count++] = path;
    return 1;
}

/*
 * 按实际尺寸读入 manifest 全文（无 CRT，只能 CreateFileW/ReadFile）。
 * UTF-16LE，BOM(FF FE) 可有可无（解析阶段跳过）。返回 NUL 结尾的
 * HeapAlloc 缓冲区，失败返回 NULL。16 MB 上限纯属防呆——几百行路径
 * 也就几十 KB。
 */
static wchar_t *read_manifest_file(const wchar_t *path)
{
    HANDLE h;
    DWORD size;
    DWORD got = 0;
    wchar_t *buf;

    h = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                    NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) {
        log_line("manifest CreateFileW failed err=%lu", GetLastError());
        return NULL;
    }
    size = GetFileSize(h, NULL);
    if (size == INVALID_FILE_SIZE) {
        log_line("manifest GetFileSize failed err=%lu", GetLastError());
        CloseHandle(h);
        return NULL;
    }
    if (size > 16u * 1024u * 1024u) {
        log_line("manifest too large: %lu bytes", size);
        CloseHandle(h);
        return NULL;
    }
    /* 尾部多给 4 字节：奇数尺寸按 wchar 对齐的兜底 + 强制 NUL 结尾。 */
    buf = (wchar_t *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY,
                               (SIZE_T)size + 2 * sizeof(wchar_t));
    if (buf == NULL) {
        log_line("manifest alloc failed (%lu bytes)", size);
        CloseHandle(h);
        return NULL;
    }
    if (size != 0 && (!ReadFile(h, buf, size, &got, NULL) || got != size)) {
        log_line("manifest ReadFile failed err=%lu got=%lu want=%lu",
                 GetLastError(), got, size);
        HeapFree(GetProcessHeap(), 0, buf);
        CloseHandle(h);
        return NULL;
    }
    CloseHandle(h);
    buf[size / 2] = 0; /* 强制 NUL 结尾；奇数尺寸的半个 wchar 就地丢弃 */
    return buf;
}

/*
 * 解析清单文本：按 '\n' 分行、去行尾 '\r'，空行跳过。第一行是模式
 * （"cut" → 剪切，其他值一律 copy，且优先于命令行 /cut），其余每行一个
 * 路径；相对行以 manifest 所在目录为基准简单拼接（目录 + '\' + 行内容）。
 * 路径串尽量原地复用（行内 NUL 截断），相对行才另配缓冲。返回解析出的
 * 条数，分配失败返回 0。
 */
static int manifest_parse(const wchar_t *manifest_path, wchar_t *text, PathList *pl,
                          int *out_cut)
{
    int dir_len = 0; /* manifest 所在目录长度（最后一个分隔符之前） */
    int have_mode = 0;
    int cut = 0;
    const wchar_t *q;
    wchar_t *p;

    for (q = manifest_path; *q; q++) {
        if (*q == L'\\' || *q == L'/') {
            dir_len = (int)(q - manifest_path);
        }
    }

    p = text;
    if (*p == 0xFEFF) {
        p++; /* UTF-16LE BOM（可选） */
    }
    while (*p != 0) {
        wchar_t *line = p;
        while (*p != 0 && *p != L'\n') {
            p++;
        }
        if (p > line && p[-1] == L'\r') {
            p[-1] = 0; /* 去行尾 \r */
        }
        if (*p != 0) {
            *p++ = 0; /* 吃掉 \n，line 成独立串 */
        }
        if (*line == 0) {
            continue; /* 空行 */
        }
        if (!have_mode) {
            have_mode = 1;
            cut = argi_equals(line, L"cut") ? 1 : 0; /* 其他值一律按 copy */
            continue;
        }
        if (path_is_absolute(line)) {
            if (!pathlist_push(pl, line)) {
                return 0;
            }
            continue;
        }
        /* 相对行：manifest 目录 + '\' + 行内容（清单只给文件名时退化为 .\）。 */
        {
            SIZE_T line_wchars = lstrlenW(line);
            SIZE_T base_len = dir_len > 0 ? (SIZE_T)dir_len : 1;
            wchar_t *joined = (wchar_t *)HeapAlloc(
                GetProcessHeap(), 0, (base_len + 1 + line_wchars + 1) * sizeof(wchar_t));
            if (joined == NULL) {
                log_line("manifest path alloc failed (%u wchars)",
                         (unsigned)(base_len + 1 + line_wchars + 1));
                return 0;
            }
            if (dir_len > 0) {
                memcpy(joined, manifest_path, (SIZE_T)dir_len * sizeof(wchar_t));
            } else {
                joined[0] = L'.';
            }
            joined[base_len] = L'\\';
            memcpy(joined + base_len + 1, line, (line_wchars + 1) * sizeof(wchar_t));
            if (!pathlist_push(pl, joined)) {
                return 0;
            }
        }
    }
    *out_cut = cut;
    return pl->count;
}

void clipdav_entry(void)
{
    int argcW = 0;
    LPWSTR *argv = CommandLineToArgvW(GetCommandLineW(), &argcW);
    wchar_t *stack_paths[MAX_PATHS];
    wchar_t **paths = stack_paths; /* /manifest 模式换成动态数组 */
    int count = 0;
    int cut = 0;
    int wait_explicit = 0;
    const wchar_t *manifest_file = NULL;
    unsigned probe_seconds = PROBE_SECONDS;
    HRESULT hr;
    MSG msg;

    g_start_tick = GetTickCount();

    if (argv == NULL || argcW < 2) {
        log_line("==== clip-dav-hdrop: no path given ====");
        MessageBoxA(NULL,
                    "usage: clip-dav-hdrop.exe <path> [more paths] [/cut]\r\n"
                    "       [/wait:<seconds>] [/manifest:<file>]\r\n\r\n"
                    "Puts real paths on the clipboard as CF_HDROP and logs every\r\n"
                    "fetch to " LOG_PATH ". /manifest reads a UTF-16LE list file\r\n"
                    "(first line: copy/cut, then one absolute path per line) and\r\n"
                    "defaults to /wait:86400 in that mode. Auto-exits after 4\r\n"
                    "minutes otherwise; /wait:<seconds> holds the clipboard longer.",
                    "clip-dav-hdrop", MB_OK | MB_ICONINFORMATION);
        ExitProcess(2);
    }
    for (int i = 1; i < argcW; i++) {
        const wchar_t *mf = parse_manifest_arg(argv[i]);
        if (argi_equals(argv[i], L"/cut") || argi_equals(argv[i], L"-cut")) {
            cut = 1;
        } else if (argi_equals(argv[i], L"/copy") || argi_equals(argv[i], L"-copy")) {
            /* 默认就是 copy，显式写也无妨 */
        } else if (parse_wait_arg(argv[i], &probe_seconds)) {
            wait_explicit = 1; /* 显式 /wait 优先于 manifest 模式的 24 小时缺省 */
        } else if (mf != NULL) {
            manifest_file = mf;
        } else if (count < MAX_PATHS) {
            stack_paths[count++] = argv[i];
        }
    }
    if (manifest_file != NULL) {
        /* v9：/manifest 模式。清单路径与命令行直给的路径进同一个数组、
         * 走同一套 CF_HDROP + DropEffect 逻辑；模式以清单第一行为准
         * （优先于 /cut），/wait 缺省放宽到 24 小时。 */
        PathList pl;
        wchar_t *text = read_manifest_file(manifest_file);
        if (text == NULL) {
            log_line("manifest unusable, giving up");
            MessageBoxA(NULL, "cannot read manifest file", "clip-dav-hdrop /manifest",
                        MB_OK | MB_ICONERROR);
            ExitProcess(2);
        }
        pl.items = NULL;
        pl.count = 0;
        pl.cap = 0;
        for (int i = 0; i < count; i++) {
            pathlist_push(&pl, stack_paths[i]); /* 命令行直给的也在列 */
        }
        count = manifest_parse(manifest_file, text, &pl, &cut);
        paths = pl.items;
        if (count == 0) {
            log_line("manifest parsed to 0 path(s), giving up");
            MessageBoxA(NULL, "manifest has no path lines", "clip-dav-hdrop /manifest",
                        MB_OK | MB_ICONERROR);
            ExitProcess(2);
        }
        if (!wait_explicit) {
            probe_seconds = MANIFEST_SECONDS;
        }
        log_line("manifest=%S entries=%d mode=%s wait=%us (explicit=%d)",
                 manifest_file, count, cut ? "cut" : "copy", probe_seconds,
                 wait_explicit);
    }
    if (count == 0) {
        log_line("==== clip-dav-hdrop: only flags, no path ====");
        MessageBoxA(NULL, "no path given (only /cut or /copy)", "clip-dav-hdrop",
                    MB_OK | MB_ICONERROR);
        ExitProcess(2);
    }

    hr = OleInitialize(NULL);
    if (FAILED(hr)) {
        char detail[64];
        wsprintfA(detail, "hr=0x%08lX", (unsigned long)hr);
        log_line("OleInitialize failed %s", detail);
        MessageBoxA(NULL, "OleInitialize failed", detail, MB_OK | MB_ICONERROR);
        ExitProcess(1);
    }

    log_line("==== clip-dav-hdrop build=%s ====", CLIP_DAV_BUILD);
    g_cf_effect = RegisterClipboardFormatA("Preferred DropEffect");
    if (g_cf_effect == 0) {
        log_line("RegisterClipboardFormat(Preferred DropEffect) failed");
        MessageBoxA(NULL, "RegisterClipboardFormat failed", "Preferred DropEffect",
                    MB_OK | MB_ICONERROR);
        ExitProcess(1);
    }
    for (int i = 0; i < count; i++) {
        log_line("path[%d]=%S", i, paths[i]);
    }
    log_line("mode=%s wait=%us", cut ? "cut (DROPEFFECT_MOVE)" : "copy (DROPEFFECT_COPY)",
             probe_seconds);

    g_hdrop = build_hdrop(paths, count);
    g_effect = build_effect(cut ? 2u /* DROPEFFECT_MOVE */ : 1u /* DROPEFFECT_COPY */);
    if (g_hdrop == NULL || g_effect == NULL) {
        log_line("out of memory building HDROP/DropEffect");
        MessageBoxA(NULL, "out of memory", "HDROP", MB_OK | MB_ICONERROR);
        ExitProcess(1);
    }

    g_formats[0].cfFormat = CF_HDROP;
    g_formats[0].ptd = NULL;
    g_formats[0].dwAspect = DVASPECT_CONTENT;
    g_formats[0].lindex = -1;
    g_formats[0].tymed = TYMED_HGLOBAL;
    g_formats[1] = g_formats[0];
    g_formats[1].cfFormat = (CLIPFORMAT)g_cf_effect;

    g_data = data_create();
    if (g_data == NULL) {
        log_line("out of memory creating data object");
        MessageBoxA(NULL, "out of memory", "data object", MB_OK | MB_ICONERROR);
        ExitProcess(1);
    }
    hr = OleSetClipboard((IDataObject *)g_data);
    log_line("OleSetClipboard hr=0x%08lX (CLIPBRD_E_CANT_OPEN 0x800401D0 = bridge owns it: rerun without touching host Files app)",
             (unsigned long)hr);
    ((IDataObject *)g_data)->lpVtbl->Release((IDataObject *)g_data);
    if (FAILED(hr)) {
        MessageBoxA(NULL, "OleSetClipboard failed",
                    "clipboard is owned by someone else (clipboard bridge?)",
                    MB_OK | MB_ICONERROR);
        ExitProcess(1);
    }
    g_last_seq = GetClipboardSequenceNumber();
    LOG_EVENT("armed: %d path(s) on clipboard as CF_HDROP, effect=%s, seq=%lu",
              count, cut ? "cut" : "copy", g_last_seq);

    SetTimer(NULL, TIMER_EXIT, probe_seconds * 1000u, NULL);
    SetTimer(NULL, TIMER_POLL, 2000u, NULL);
    while (GetMessageA(&msg, (HWND)NULL, 0, 0) > 0) {
        if (msg.message == WM_TIMER && msg.hwnd == NULL) {
            if (msg.wParam == TIMER_POLL) {
                poll_clipboard();
                continue;
            }
            if (msg.wParam == TIMER_EXIT) {
                KillTimer(NULL, TIMER_EXIT);
                KillTimer(NULL, TIMER_POLL);
                break;
            }
        }
        TranslateMessage(&msg);
        DispatchMessageA(&msg);
    }
    LOG_EVENT("exit (timer): fetch=%lu query=%lu enum=%lu",
              g_stat_get, g_stat_query, g_stat_enum);
    hr = OleFlushClipboard();
    log_line("OleFlushClipboard hr=0x%08lX (S_OK = paths stay on the plain clipboard after this process exits - try pasting once more)",
             (unsigned long)hr);
    log_line("==== clip-dav-hdrop done ====");
    OleUninitialize();
    ExitProcess(0);
}
