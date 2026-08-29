/*
 * vmfile-spike —— M1 风险门验证程序：XP Explorer 是否接受「虚拟文件」粘贴。
 * 见 todo/vm-remote-control 文件传输计划（宿主→XP 流式导入的剪贴板路径）。
 *
 * 它不依赖 ivm-shm 驱动、不碰信箱。启动后把一个 1MB 的「虚拟文件」挂上
 * OLE 剪贴板：FileGroupDescriptorW/A 给出文件名与大小，FileContents 用
 * 无 CRT 手写的 IStream 延迟供给——剪贴板里没有数据，也不放 CF_HDROP，
 * Explorer 只能走虚拟文件路径。内容是确定性模式（偏移 k 的字节 =
 * (k*7+13)&0xFF），同时落一份到 C:\Tools\vmfile-spike.bin 供 fc /b 比对。
 * 主案实现里 IStream.Read 的内容生成器将换成「信箱向宿主拉一块」，
 * 这里先纯函数生成，把 COM/Explorer 兼容性单独验证干净。
 *
 * 判定（DebugView 配合）：
 *   通过 → Explorer 里 Ctrl+V 出现 vm-spike-file.txt（1048576 字节），
 *          日志可见 GetData(FileContents)→IStream 与逐块 Read，
 *          fc /b 与样本一致 → FileContents 路线成立。
 *   拒绝 → 粘贴菜单灰/报错，日志里 Explorer 只 QueryGetData(CF_HDROP)
 *          等标准格式 → 走降级链（延迟渲染 CF_HDROP → 预暂存）。
 *
 * COM 三个 vtable（IDataObject/IEnumFORMATETC/IStream）全部按 mingw
 * 头文件的 C 绑定手写；IStream 每次 Read 只服务一次请求，Explorer 的
 * 进度对话框因此能推进、取消能生效——这也是主案把信箱往返塞进 Read
 * 的前提（一次 Read = 一轮信箱往返，STA 线程在两次 Read 之间泵消息）。
 * IID 自带定义避免依赖 libuuid；导表只多 ole32 一个。
 *
 * 运行：先 taskkill clipboard-bridge（它会在收到宿主文本时抢回剪贴板
 * 所有权，干扰验证），再运行本程序；结束 taskkill vmfile-spike.exe。
 * 构建：scripts/build-vmfile-spike.sh（与 clipboard-bridge 同管线，
 * 入口 spike_entry，PE 版本补 5.01）。
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <ole2.h>
#include <shlobj.h>
#include <stdarg.h>
#include <stddef.h>

/* 无 CRT（-nostdlib）：自带 mem*，IsEqualGUID 宏与结构填充会用到。 */
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
    lstrcatA(buffer, "\r\n");
    OutputDebugStringA(buffer);
}

static void fatal_box(const char *what, const char *detail)
{
    char text[256];
    lstrcpyA(text, what);
    lstrcatA(text, "\r\n");
    lstrcatA(text, detail);
    log_line("vmfile-spike: %s (%s)", what, detail);
    MessageBoxA(NULL, text, "vmfile-spike", MB_OK | MB_ICONERROR);
}

/* ---- 虚拟文件定义 ---- */

#define VIRT_FILE_SIZE 1048576u /* 1MB，粘贴结果与样本逐字节可比 */
static const char VIRT_NAME_A[] = "vm-spike-file.txt";
static const wchar_t VIRT_NAME_W[] = L"vm-spike-file.txt";
static const char SAMPLE_PATH[] = "C:\\Tools\\vmfile-spike.bin";

/* 内容生成器：偏移 k 的字节 = (k*7+13)&0xFF。主案里此处换成信箱拉块。 */
static void fill_pattern(unsigned char *dst, unsigned long long offset, unsigned long count)
{
    unsigned long i;
    for (i = 0; i < count; i++) {
        unsigned long long k = offset + i;
        dst[i] = (unsigned char)((k * 7ull + 13ull) & 0xFFu);
    }
}

/* 开机备样本：没有就生成，供粘贴后 fc /b 逐字节比对。失败不致命
 * （虚拟文件照常供给），只是比对手段没了，日志里说明。 */
static void ensure_sample_file(void)
{
    /* 静态缓冲：函数内 4KB 局部数组会把（被内联后的）入口栈帧顶过 4096
     * 页阈值，clang 生成 __alloca 调用而 -nostdlib 没有运行时符号。 */
    static unsigned char chunk[4096];
    HANDLE f = CreateFileA(SAMPLE_PATH, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
    unsigned long long offset = 0;
    if (f == INVALID_HANDLE_VALUE) {
        log_line("vmfile-spike: sample create failed gle=%lu (比对需手工)", GetLastError());
        return;
    }
    while (offset < VIRT_FILE_SIZE) {
        unsigned long n = VIRT_FILE_SIZE - offset;
        DWORD written = 0;
        if (n > sizeof(chunk)) {
            n = sizeof(chunk);
        }
        fill_pattern(chunk, offset, n);
        if (!WriteFile(f, chunk, n, &written, NULL) || written != n) {
            log_line("vmfile-spike: sample write failed gle=%lu", GetLastError());
            CloseHandle(f);
            return;
        }
        offset += n;
    }
    CloseHandle(f);
    log_line("vmfile-spike: sample ready at %s", SAMPLE_PATH);
}

/* ---- IID 自带定义（避免链 libuuid） ---- */

static const IID SPIKE_IID_IUnknown = {0x00000000u, 0x0000u, 0x0000u, {0xC0u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x46u}};
static const IID SPIKE_IID_IStream = {0x0000000Cu, 0x0000u, 0x0000u, {0xC0u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x46u}};
static const IID SPIKE_IID_IEnumFORMATETC = {0x00000103u, 0x0000u, 0x0000u, {0xC0u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x46u}};
static const IID SPIKE_IID_IDataObject = {0x0000010Eu, 0x0000u, 0x0000u, {0xC0u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x00u, 0x46u}};

static int iid_equals(REFIID a, const IID *b)
{
    return memcmp(a, b, sizeof(IID)) == 0;
}

/* ---- IStream：FileContents 的延迟数据源 ---- */

typedef struct {
    IStreamVtbl *lpVtbl;
    ULONG refs;
    unsigned long long offset;
} SpikeStream;

static HRESULT STDMETHODCALLTYPE stream_QueryInterface(IStream *This, REFIID riid, void **ppvObject)
{
    if (ppvObject == NULL) {
        return E_POINTER;
    }
    *ppvObject = NULL;
    if (iid_equals(riid, &SPIKE_IID_IUnknown) || iid_equals(riid, &SPIKE_IID_IStream)) {
        *ppvObject = This;
        This->lpVtbl->AddRef(This);
        return S_OK;
    }
    return E_NOINTERFACE;
}

static ULONG STDMETHODCALLTYPE stream_AddRef(IStream *This)
{
    SpikeStream *s = (SpikeStream *)This;
    return ++s->refs;
}

static ULONG STDMETHODCALLTYPE stream_Release(IStream *This)
{
    SpikeStream *s = (SpikeStream *)This;
    ULONG refs = --s->refs;
    if (refs == 0) {
        log_line("vmfile-spike: stream destroyed");
        HeapFree(GetProcessHeap(), 0, s);
    }
    return refs;
}

static HRESULT STDMETHODCALLTYPE stream_Read(IStream *This, void *pv, ULONG cb, ULONG *pcbRead)
{
    SpikeStream *s = (SpikeStream *)This;
    ULONG n = 0;
    if (pcbRead != NULL) {
        *pcbRead = 0;
    }
    if (pv == NULL) {
        return STG_E_INVALIDPOINTER;
    }
    if (s->offset < VIRT_FILE_SIZE && cb > 0) {
        unsigned long long remain = VIRT_FILE_SIZE - s->offset;
        n = (remain < (unsigned long long)cb) ? (ULONG)remain : cb;
        fill_pattern((unsigned char *)pv, s->offset, n);
        s->offset += n;
        if (pcbRead != NULL) {
            *pcbRead = n;
        }
    }
    /* wvsprintfA 无 %llu：64 位值拆两个 32 位打 */
    log_line("vmfile-spike: Read cb=%lu ret=%lu next hi=0x%08X lo=0x%08X",
             cb, n, (unsigned long)(s->offset >> 32), (unsigned long)s->offset);
    return (n == cb) ? S_OK : S_FALSE;
}

static HRESULT STDMETHODCALLTYPE stream_Write(IStream *This, const void *pv, ULONG cb, ULONG *pcbWritten)
{
    (void)This;
    (void)pv;
    (void)cb;
    (void)pcbWritten;
    return STG_E_ACCESSDENIED; /* 只读流 */
}

static HRESULT STDMETHODCALLTYPE stream_Seek(IStream *This, LARGE_INTEGER dlibMove, DWORD dwOrigin, ULARGE_INTEGER *plibNewPosition)
{
    SpikeStream *s = (SpikeStream *)This;
    long long move = (long long)dlibMove.QuadPart;
    long long target;
    if (dwOrigin == STREAM_SEEK_SET) {
        target = move;
    } else if (dwOrigin == STREAM_SEEK_CUR) {
        target = (long long)s->offset + move;
    } else if (dwOrigin == STREAM_SEEK_END) {
        target = (long long)VIRT_FILE_SIZE + move;
    } else {
        return STG_E_INVALIDFUNCTION;
    }
    if (target < 0) {
        return STG_E_INVALIDFUNCTION;
    }
    if ((unsigned long long)target > VIRT_FILE_SIZE) {
        target = (long long)VIRT_FILE_SIZE;
    }
    s->offset = (unsigned long long)target;
    if (plibNewPosition != NULL) {
        plibNewPosition->QuadPart = (ULONGLONG)target;
    }
    log_line("vmfile-spike: Seek origin=%lu hi=0x%08X lo=0x%08X",
             dwOrigin, (unsigned long)(((ULONGLONG)target) >> 32), (unsigned long)target);
    return S_OK;
}

static HRESULT STDMETHODCALLTYPE stream_SetSize(IStream *This, ULARGE_INTEGER libNewSize)
{
    (void)This;
    (void)libNewSize;
    return STG_E_INVALIDFUNCTION;
}

static HRESULT STDMETHODCALLTYPE stream_CopyTo(IStream *This, IStream *pstm, ULARGE_INTEGER cb, ULARGE_INTEGER *pcbRead, ULARGE_INTEGER *pcbWritten)
{
    (void)This;
    (void)pstm;
    (void)cb;
    (void)pcbRead;
    (void)pcbWritten;
    return E_NOTIMPL;
}

static HRESULT STDMETHODCALLTYPE stream_Commit(IStream *This, DWORD grfCommitFlags)
{
    (void)This;
    (void)grfCommitFlags;
    return STG_E_INVALIDFUNCTION;
}

static HRESULT STDMETHODCALLTYPE stream_Revert(IStream *This)
{
    (void)This;
    return STG_E_INVALIDFUNCTION;
}

static HRESULT STDMETHODCALLTYPE stream_LockRegion(IStream *This, ULARGE_INTEGER libOffset, ULARGE_INTEGER cb, DWORD dwLockType)
{
    (void)This;
    (void)libOffset;
    (void)cb;
    (void)dwLockType;
    return STG_E_INVALIDFUNCTION;
}

static HRESULT STDMETHODCALLTYPE stream_UnlockRegion(IStream *This, ULARGE_INTEGER libOffset, ULARGE_INTEGER cb, DWORD dwLockType)
{
    (void)This;
    (void)libOffset;
    (void)cb;
    (void)dwLockType;
    return STG_E_INVALIDFUNCTION;
}

static HRESULT STDMETHODCALLTYPE stream_Stat(IStream *This, STATSTG *pstatstg, DWORD grfStatFlag)
{
    SpikeStream *s = (SpikeStream *)This;
    if (pstatstg == NULL) {
        return STG_E_INVALIDPOINTER;
    }
    memset(pstatstg, 0, sizeof(*pstatstg));
    pstatstg->type = STGTY_STREAM;
    pstatstg->cbSize.QuadPart = (ULONGLONG)VIRT_FILE_SIZE;
    pstatstg->grfMode = STGM_READ;
    if ((grfStatFlag & STATFLAG_NONAME) == 0) {
        /* 调用方会用 CoTaskMemFree 释放名字，必须分配不能给静态串 */
        wchar_t *name = (wchar_t *)CoTaskMemAlloc(sizeof(VIRT_NAME_W));
        if (name == NULL) {
            return E_OUTOFMEMORY;
        }
        memcpy(name, VIRT_NAME_W, sizeof(VIRT_NAME_W));
        pstatstg->pwcsName = name;
    }
    log_line("vmfile-spike: Stat flag=%lu offset hi=0x%08X lo=0x%08X",
             grfStatFlag, (unsigned long)(s->offset >> 32), (unsigned long)s->offset);
    return S_OK;
}

static HRESULT STDMETHODCALLTYPE stream_Clone(IStream *This, IStream **ppstm)
{
    (void)This;
    (void)ppstm;
    return E_NOTIMPL;
}

static IStreamVtbl g_streamVtbl = {
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

static SpikeStream *stream_create(void)
{
    SpikeStream *s = (SpikeStream *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*s));
    if (s == NULL) {
        return NULL;
    }
    s->lpVtbl = &g_streamVtbl;
    s->refs = 1;
    s->offset = 0;
    return s;
}

/* ---- IEnumFORMATETC：GET 方向枚举我们暴露的格式 ---- */

#define SPIKE_FORMAT_COUNT 3u

typedef struct {
    IEnumFORMATETCVtbl *lpVtbl;
    ULONG refs;
    ULONG pos;
} SpikeEnum;

static SpikeEnum *enum_create_at(ULONG pos);

static FORMATETC g_formats[SPIKE_FORMAT_COUNT];
static CLIPFORMAT g_cfFileDescA;
static CLIPFORMAT g_cfFileDescW;
static CLIPFORMAT g_cfFileContents;

static HRESULT STDMETHODCALLTYPE enum_QueryInterface(IEnumFORMATETC *This, REFIID riid, void **ppvObject)
{
    if (ppvObject == NULL) {
        return E_POINTER;
    }
    *ppvObject = NULL;
    if (iid_equals(riid, &SPIKE_IID_IUnknown) || iid_equals(riid, &SPIKE_IID_IEnumFORMATETC)) {
        *ppvObject = This;
        This->lpVtbl->AddRef(This);
        return S_OK;
    }
    return E_NOINTERFACE;
}

static ULONG STDMETHODCALLTYPE enum_AddRef(IEnumFORMATETC *This)
{
    SpikeEnum *e = (SpikeEnum *)This;
    return ++e->refs;
}

static ULONG STDMETHODCALLTYPE enum_Release(IEnumFORMATETC *This)
{
    SpikeEnum *e = (SpikeEnum *)This;
    ULONG refs = --e->refs;
    if (refs == 0) {
        HeapFree(GetProcessHeap(), 0, e);
    }
    return refs;
}

static HRESULT STDMETHODCALLTYPE enum_Next(IEnumFORMATETC *This, ULONG celt, FORMATETC *rgelt, ULONG *pceltFetched)
{
    SpikeEnum *e = (SpikeEnum *)This;
    ULONG fetched = 0;
    if (pceltFetched != NULL) {
        *pceltFetched = 0;
    }
    if (celt > 0 && rgelt == NULL) {
        return E_POINTER;
    }
    while (fetched < celt && e->pos < SPIKE_FORMAT_COUNT) {
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
    SpikeEnum *e = (SpikeEnum *)This;
    e->pos += celt;
    if (e->pos > SPIKE_FORMAT_COUNT) {
        e->pos = SPIKE_FORMAT_COUNT;
        return S_FALSE;
    }
    return S_OK;
}

static HRESULT STDMETHODCALLTYPE enum_Reset(IEnumFORMATETC *This)
{
    SpikeEnum *e = (SpikeEnum *)This;
    e->pos = 0;
    return S_OK;
}

static HRESULT STDMETHODCALLTYPE enum_Clone(IEnumFORMATETC *This, IEnumFORMATETC **ppenum)
{
    SpikeEnum *e = (SpikeEnum *)This;
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

static SpikeEnum *enum_create_at(ULONG pos)
{
    SpikeEnum *e = (SpikeEnum *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*e));
    if (e == NULL) {
        return NULL;
    }
    e->lpVtbl = &g_enumVtbl;
    e->refs = 1;
    e->pos = pos;
    return e;
}

/* ---- IDataObject：FileGroupDescriptorW/A + FileContents ---- */

typedef struct {
    IDataObjectVtbl *lpVtbl;
    ULONG refs;
} SpikeData;

static HRESULT STDMETHODCALLTYPE data_QueryInterface(IDataObject *This, REFIID riid, void **ppvObject)
{
    if (ppvObject == NULL) {
        return E_POINTER;
    }
    *ppvObject = NULL;
    if (iid_equals(riid, &SPIKE_IID_IUnknown) || iid_equals(riid, &SPIKE_IID_IDataObject)) {
        *ppvObject = This;
        This->lpVtbl->AddRef(This);
        return S_OK;
    }
    return E_NOINTERFACE;
}

static ULONG STDMETHODCALLTYPE data_AddRef(IDataObject *This)
{
    SpikeData *d = (SpikeData *)This;
    return ++d->refs;
}

static ULONG STDMETHODCALLTYPE data_Release(IDataObject *This)
{
    SpikeData *d = (SpikeData *)This;
    ULONG refs = --d->refs;
    if (refs == 0) {
        log_line("vmfile-spike: data object destroyed");
        HeapFree(GetProcessHeap(), 0, d);
    }
    return refs;
}

static int format_matches(FORMATETC *fmt, CLIPFORMAT cf)
{
    return fmt->cfFormat == cf && fmt->dwAspect == DVASPECT_CONTENT;
}

/* 描述符（FileGroupDescriptorW/A）渲染成 HGLOBAL：只有元数据，无内容。 */
static HRESULT render_descriptor_wide(HGLOBAL *out)
{
    HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, sizeof(FILEGROUPDESCRIPTORW));
    FILEGROUPDESCRIPTORW *fgd;
    if (h == NULL) {
        return STG_E_MEDIUMFULL;
    }
    fgd = (FILEGROUPDESCRIPTORW *)GlobalLock(h);
    if (fgd == NULL) {
        GlobalFree(h);
        return E_OUTOFMEMORY;
    }
    fgd->cItems = 1;
    fgd->fgd[0].dwFlags = FD_FILESIZE | FD_ATTRIBUTES | FD_PROGRESSUI;
    fgd->fgd[0].dwFileAttributes = FILE_ATTRIBUTE_NORMAL;
    fgd->fgd[0].nFileSizeHigh = 0;
    fgd->fgd[0].nFileSizeLow = VIRT_FILE_SIZE;
    lstrcpynW(fgd->fgd[0].cFileName, VIRT_NAME_W, 260);
    GlobalUnlock(h);
    *out = h;
    return S_OK;
}

static HRESULT render_descriptor_ansi(HGLOBAL *out)
{
    HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, sizeof(FILEGROUPDESCRIPTORA));
    FILEGROUPDESCRIPTORA *fgd;
    if (h == NULL) {
        return STG_E_MEDIUMFULL;
    }
    fgd = (FILEGROUPDESCRIPTORA *)GlobalLock(h);
    if (fgd == NULL) {
        GlobalFree(h);
        return E_OUTOFMEMORY;
    }
    fgd->cItems = 1;
    fgd->fgd[0].dwFlags = FD_FILESIZE | FD_ATTRIBUTES | FD_PROGRESSUI;
    fgd->fgd[0].dwFileAttributes = FILE_ATTRIBUTE_NORMAL;
    fgd->fgd[0].nFileSizeHigh = 0;
    fgd->fgd[0].nFileSizeLow = VIRT_FILE_SIZE;
    lstrcpynA(fgd->fgd[0].cFileName, VIRT_NAME_A, 260);
    GlobalUnlock(h);
    *out = h;
    return S_OK;
}

static HRESULT STDMETHODCALLTYPE data_GetData(IDataObject *This, FORMATETC *pformatetcIn, STGMEDIUM *pmedium)
{
    HGLOBAL h;
    HRESULT hr;
    (void)This;
    if (pformatetcIn == NULL || pmedium == NULL) {
        return E_POINTER;
    }
    log_line("vmfile-spike: GetData cf=0x%04X tymed=0x%08X lindex=%ld aspect=0x%08X",
             (unsigned int)pformatetcIn->cfFormat, (unsigned int)pformatetcIn->tymed,
             (long)pformatetcIn->lindex, (unsigned int)pformatetcIn->dwAspect);
    if (pformatetcIn->dwAspect != DVASPECT_CONTENT) {
        return DV_E_DVASPECT;
    }

    if (format_matches(pformatetcIn, g_cfFileDescW)) {
        if (!(pformatetcIn->tymed & TYMED_HGLOBAL)) {
            return DV_E_TYMED;
        }
        hr = render_descriptor_wide(&h);
        if (FAILED(hr)) {
            return hr;
        }
        pmedium->tymed = TYMED_HGLOBAL;
        pmedium->hGlobal = h;
        pmedium->pUnkForRelease = NULL;
        return S_OK;
    }
    if (format_matches(pformatetcIn, g_cfFileDescA)) {
        if (!(pformatetcIn->tymed & TYMED_HGLOBAL)) {
            return DV_E_TYMED;
        }
        hr = render_descriptor_ansi(&h);
        if (FAILED(hr)) {
            return hr;
        }
        pmedium->tymed = TYMED_HGLOBAL;
        pmedium->hGlobal = h;
        pmedium->pUnkForRelease = NULL;
        return S_OK;
    }
    if (format_matches(pformatetcIn, g_cfFileContents)) {
        if (pformatetcIn->lindex != -1 && pformatetcIn->lindex != 0) {
            return DV_E_LINDEX;
        }
        if (pformatetcIn->tymed & TYMED_ISTREAM) {
            SpikeStream *s = stream_create();
            if (s == NULL) {
                return E_OUTOFMEMORY;
            }
            pmedium->tymed = TYMED_ISTREAM;
            pmedium->pstm = (IStream *)s;
            pmedium->pUnkForRelease = NULL;
            log_line("vmfile-spike: FileContents -> IStream");
            return S_OK;
        }
        if (pformatetcIn->tymed & TYMED_HGLOBAL) {
            unsigned char *bytes;
            h = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, VIRT_FILE_SIZE);
            if (h == NULL) {
                return STG_E_MEDIUMFULL;
            }
            bytes = (unsigned char *)GlobalLock(h);
            if (bytes == NULL) {
                GlobalFree(h);
                return E_OUTOFMEMORY;
            }
            fill_pattern(bytes, 0, VIRT_FILE_SIZE);
            GlobalUnlock(h);
            pmedium->tymed = TYMED_HGLOBAL;
            pmedium->hGlobal = h;
            pmedium->pUnkForRelease = NULL;
            log_line("vmfile-spike: FileContents -> HGLOBAL(1MB)");
            return S_OK;
        }
        return DV_E_TYMED;
    }
    return DV_E_FORMATETC;
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
    (void)This;
    if (pformatetc == NULL) {
        return E_POINTER;
    }
    log_line("vmfile-spike: QueryGetData cf=0x%04X", (unsigned int)pformatetc->cfFormat);
    if (pformatetc->dwAspect != DVASPECT_CONTENT) {
        return DV_E_DVASPECT;
    }
    if (format_matches(pformatetc, g_cfFileDescW) || format_matches(pformatetc, g_cfFileDescA) ||
        format_matches(pformatetc, g_cfFileContents)) {
        return S_OK;
    }
    return DV_E_FORMATETC;
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
    (void)This;
    (void)pformatetc;
    (void)pmedium;
    (void)fRelease;
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

static SpikeData *data_create(void)
{
    SpikeData *d = (SpikeData *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*d));
    if (d == NULL) {
        return NULL;
    }
    d->lpVtbl = &g_dataVtbl;
    d->refs = 1;
    return d;
}

/* ---- 入口：STA + OleSetClipboard + 消息泵 ---- */

void spike_entry(void)
{
    HRESULT hr;
    SpikeData *obj;
    MSG msg;

    hr = OleInitialize(NULL);
    if (FAILED(hr)) {
        char detail[64];
        wsprintfA(detail, "hr=0x%08lX", (unsigned long)hr);
        fatal_box("OleInitialize failed", detail);
        ExitProcess(1);
    }

    g_cfFileDescA = RegisterClipboardFormatA("FileGroupDescriptor");
    g_cfFileDescW = RegisterClipboardFormatA("FileGroupDescriptorW");
    g_cfFileContents = RegisterClipboardFormatA("FileContents");
    if (g_cfFileDescA == 0 || g_cfFileDescW == 0 || g_cfFileContents == 0) {
        fatal_box("RegisterClipboardFormat failed", "FileGroupDescriptor/FileContents");
        ExitProcess(1);
    }
    log_line("vmfile-spike: formats descA=0x%04X descW=0x%04X contents=0x%04X",
             (unsigned int)g_cfFileDescA, (unsigned int)g_cfFileDescW, (unsigned int)g_cfFileContents);

    g_formats[0].cfFormat = g_cfFileDescW;
    g_formats[0].ptd = NULL;
    g_formats[0].dwAspect = DVASPECT_CONTENT;
    g_formats[0].lindex = -1;
    g_formats[0].tymed = TYMED_HGLOBAL;
    g_formats[1] = g_formats[0];
    g_formats[1].cfFormat = g_cfFileDescA;
    g_formats[2] = g_formats[0];
    g_formats[2].cfFormat = g_cfFileContents;
    g_formats[2].tymed = TYMED_HGLOBAL | TYMED_ISTREAM;

    ensure_sample_file();

    obj = data_create();
    if (obj == NULL) {
        fatal_box("out of memory", "data object");
        ExitProcess(1);
    }
    hr = OleSetClipboard((IDataObject *)obj);
    log_line("vmfile-spike: OleSetClipboard hr=0x%08lX", (unsigned long)hr);
    ((IDataObject *)obj)->lpVtbl->Release((IDataObject *)obj);
    if (FAILED(hr)) {
        fatal_box("OleSetClipboard failed", "cannot own clipboard");
        ExitProcess(1);
    }

    log_line("vmfile-spike: ready — virtual file %s (1048576 bytes) on clipboard, paste into Explorer now", VIRT_NAME_A);

    while (GetMessageA(&msg, (HWND)NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageA(&msg);
    }
    OleUninitialize();
    ExitProcess(0);
}
