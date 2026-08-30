/*
 * ivm-mouse-install —— 鼠标驱动子命令：把 VMware vmmouse 挂上 PS/2
 * 鼠标设备（Windows XP，32 位）。
 *
 * 三个入口（GUI 子系统不占控制台，成败看退出码 + 日志）：
 *   /mouse-install  注册 vmmouse 服务 + 把 "vmmouse" 追加进 PS/2 鼠标设备
 *                   实例的 UpperFilters（安装脚本调用）。
 *                   0=成功（新写入或本就已挂）1=没找到 PS/2 鼠标设备实例
 *                   2=驱动文件缺失 / 服务管理器 / 注册表操作失败
 *   /mouse-check    只读体检：驱动文件、vmmouse 服务、每个 PS/2 鼠标实例的
 *                   过滤链现状。报告进日志 + MessageBox 弹窗。
 *                   0=已挂 1=未挂 2=驱动文件或服务缺失
 *   ivm_mouse_selfheal()  供 agent 常驻身份（服务/登录）每次启动调用：
 *                   过滤链和服务**两者**齐了才静默返回，缺啥补啥（幂等）。
 *                   只补注册表——过滤器要等设备重新枚举（下次重启）才真
 *                   正挂载，所以「装好 → 重启 1 补注册 → 重启 2 生效」是
 *                   最坏收敛路径。
 *
 * 血泪教训（2026-08-30）：bat 重装时 sc delete vmmouse 后立刻 /mouse-install
 * 撞 1072（marked-for-delete）竞态，服务创建失败、UpperFilters 却还挂着
 * vmmouse——开机 PnP 找不到过滤器服务，PS/2 鼠标设备整个启动失败，光标
 * 全模式冻死（键盘无此过滤器所以幸免）。自愈因此必须同时查服务与过滤链；
 * bat 的等服务消失循环也必须把 vmmouse 算进去。另外此镜像的 reg.exe 每次
 * 查询都退 1（疑似精简版阉割），成败汇报只认 advapi32/退出码，别信 reg.exe。
 *
 * 做两件事（/mouse-install）：
 *   1. vmmouse 内核服务不存在就创建（type= kernel start= demand
 *      error= ignore group= Pointer Port，ImagePath 指向 drivers\vmmouse.sys；
 *      文件由安装脚本先拷到位，缺失直接失败——注册了也白注册）；
 *   2. 遍历 Enum\ACPI 与 Enum\Root 下的 PNP0F03/PNP0F13 设备实例，把
 *      "vmmouse" 追加进实例键的 UpperFilters（REG_MULTI_SZ，已在则跳过）。
 *
 * 全程追加写 C:\Tools\mouse-install.log。血泪教训（2026-08）：产物曾用
 * 旧构建，exe 不认 /mouse-install 还以 0 退出，bat 误报「注册成功」，重启
 * 两次毫无痕迹——没有日志的成败汇报都不可信，日志是最后的排查抓手。
 *
 * 为什么走注册表直改而不是 rundll32 装 INF：INF 向导会弹「找到新硬件」、
 * 还要过驱动签名校验；注册表直改无提示，重启后 PnP 按上层过滤驱动加载
 * vmmouse，驱动起来向 VMware backdoor（io 端口 0x5658）要绝对坐标，
 * v86 侧的绝对坐标通路随即打通（指针 auto 模式自动切「跟随」）。
 * 注意：装好后设备管理器主体仍显示 Microsoft PS/2 驱动——vmmouse 是
 * 上层过滤器，不替换 msmouse 函数驱动，别拿它当失败判据。
 *
 * 与 res-agent.c / clipboard-bridge.c 合编进 ivm-agent.exe；无 CRT
 * （-nostdlib），自带的 strlen 等小函数一律 static，避免链接期撞符号。
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdarg.h>

#define ENUM_BASE "SYSTEM\\CurrentControlSet\\Enum"
#define DRIVER_SYS "C:\\Windows\\System32\\drivers\\vmmouse.sys"
#define LOG_PATH "C:\\Tools\\mouse-install.log"

static size_t ivm_strlen(const char *s)
{
    const char *p = s;
    while (*p) {
        p++;
    }
    return (size_t)(p - s);
}

static char ivm_lower(char c)
{
    return (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c;
}

/* 设备 ID 匹配：忽略大小写与前导 '*'（Enum 键名有无星号随枚举器而定）。 */
static int dev_id_match(const char *key_name, const char *pnp_id)
{
    if (key_name[0] == '*') {
        key_name++;
    }
    if (pnp_id[0] == '*') {
        pnp_id++;
    }
    while (*key_name && *pnp_id) {
        if (ivm_lower(*key_name) != ivm_lower(*pnp_id)) {
            return 0;
        }
        key_name++;
        pnp_id++;
    }
    return *key_name == 0 && *pnp_id == 0;
}

static int str_equals_ignore_case(const char *s, const char *lit)
{
    while (*s && *lit) {
        if (ivm_lower(*s) != ivm_lower(*lit)) {
            return 0;
        }
        s++;
        lit++;
    }
    return *s == 0 && *lit == 0;
}

static int multi_sz_contains(const char *msz, const char *needle)
{
    const char *p = msz;
    while (*p) {
        if (str_equals_ignore_case(p, needle)) {
            return 1;
        }
        p += ivm_strlen(p) + 1;
    }
    return 0;
}

/* 无 CRT 的安全拼接：把 src 追加到 dst 尾部，超 cap 截断（保证结尾 \0）。 */
static void sz_append(char *dst, DWORD cap, const char *src)
{
    DWORD used = (DWORD)ivm_strlen(dst);
    while (*src != 0 && used + 1 < cap) {
        dst[used++] = *src++;
    }
    dst[used] = 0;
}

static int file_exists(const char *path)
{
    return GetFileAttributesA(path) != INVALID_FILE_ATTRIBUTES;
}

/* 追加一行日志：带本地时间戳，OutputDebugStringA + 文件双写。文件写不进
 * （目录建不出等）只走调试通道——日志尽力而为，绝不反过来卡安装。
 * wvsprintfA 输出上限 1024 字符，msg/line 必须装得满这个上限——%s 带进
 * 长报告时小缓冲直接烧栈（audio 模块 2026-08 在真机上崩过，见同目录
 * ivm-audio-install.c，教训通用）。 */
static void mlog(const char *fmt, ...)
{
    char line[1200];
    char msg[1100];
    SYSTEMTIME st;
    va_list args;
    GetLocalTime(&st);
    va_start(args, fmt);
    wvsprintfA(msg, fmt, args);
    va_end(args);
    wsprintfA(line, "[%04u-%02u-%02u %02u:%02u:%02u] ", st.wYear, st.wMonth,
              st.wDay, st.wHour, st.wMinute, st.wSecond);
    lstrcatA(line, msg);
    OutputDebugStringA(line);
    CreateDirectoryA("C:\\Tools", NULL); /* 自愈可能先于安装脚本跑 */
    HANDLE log = CreateFileA(LOG_PATH, FILE_APPEND_DATA, FILE_SHARE_READ, NULL,
                             OPEN_ALWAYS, 0, NULL);
    if (log != INVALID_HANDLE_VALUE) {
        DWORD written = 0;
        WriteFile(log, line, (DWORD)ivm_strlen(line), &written, NULL);
        CloseHandle(log);
    }
}

/* 把 "vmmouse" 追加进 UpperFilters。返回 1=写了，0=本来就有，-1=失败。 */
static int append_filter_value(HKEY instance_key)
{
    static const char kFilter[] = "vmmouse";
    char existing[512];
    char out[532];
    DWORD size = (DWORD)sizeof(existing) - 2;
    DWORD type = 0;
    LONG rc = RegQueryValueExA(instance_key, "UpperFilters", NULL, &type,
                               (LPBYTE)existing, &size);
    if (rc == ERROR_SUCCESS) {
        if (type != REG_MULTI_SZ) {
            return -1;
        }
        existing[size] = 0;
        existing[size + 1] = 0;
        if (multi_sz_contains(existing, kFilter)) {
            return 0; /* 已装，幂等退出 */
        }
    } else if (rc == ERROR_FILE_NOT_FOUND) {
        existing[0] = 0; /* 没有现值：从头写 */
    } else {
        /* 含 ERROR_MORE_DATA：现值比缓冲大，宁可不写也不能整条覆盖。 */
        return -1;
    }

    DWORD used = 0;
    const char *p = existing;
    while (*p) {
        DWORD len = (DWORD)ivm_strlen(p) + 1;
        if (used + len + sizeof(kFilter) + 1 > (DWORD)sizeof(out)) {
            return -1;
        }
        for (DWORD i = 0; i < len; i++) {
            out[used + i] = p[i];
        }
        used += len;
        p += len;
    }
    for (DWORD i = 0; i < sizeof(kFilter); i++) {
        out[used + i] = kFilter[i]; /* 含结尾 \0 */
    }
    used += (DWORD)sizeof(kFilter);
    out[used] = 0; /* multi-sz 以双 \0 收尾 */
    used++;
    return RegSetValueExA(instance_key, "UpperFilters", 0, REG_MULTI_SZ,
                          (const BYTE *)out, used) == ERROR_SUCCESS
               ? 1
               : -1;
}

/* 实例的 UpperFilters 是否已含 vmmouse（只读）。 */
static int instance_has_vmmouse(HKEY instance_key)
{
    char existing[512];
    DWORD size = (DWORD)sizeof(existing) - 2;
    DWORD type = 0;
    LONG rc = RegQueryValueExA(instance_key, "UpperFilters", NULL, &type,
                               (LPBYTE)existing, &size);
    if (rc != ERROR_SUCCESS || type != REG_MULTI_SZ) {
        return 0;
    }
    existing[size] = 0;
    existing[size + 1] = 0;
    return multi_sz_contains(existing, "vmmouse");
}

/* 把一个实例的过滤链现状追加进 report（/mouse-check 报告正文，可为 NULL）。 */
static void report_filters(char *report, DWORD cap, const char *inst_path,
                           HKEY instance_key)
{
    char filters[512];
    char line[768];
    DWORD size = (DWORD)sizeof(filters) - 2;
    DWORD type = 0;
    LONG rc = RegQueryValueExA(instance_key, "UpperFilters", NULL, &type,
                               (LPBYTE)filters, &size);
    wsprintfA(line, "  %s UpperFilters=", inst_path);
    if (rc == ERROR_SUCCESS && type == REG_MULTI_SZ) {
        filters[size] = 0;
        filters[size + 1] = 0;
        int first = 1;
        for (const char *p = filters; *p; p += ivm_strlen(p) + 1) {
            if (!first) {
                sz_append(line, (DWORD)sizeof(line), "|");
            }
            first = 0;
            sz_append(line, (DWORD)sizeof(line), p);
        }
    } else {
        sz_append(line, (DWORD)sizeof(line), "(none)");
    }
    sz_append(line, (DWORD)sizeof(line), "\r\n");
    if (report != NULL) {
        sz_append(report, cap, line);
    }
}

/* 遍历一个枚举器（ACPI / Root）下的 PNP0F03/PNP0F13 设备实例。
 * query_only=0：把 vmmouse 追加进 UpperFilters，返回写入+已挂的实例数；
 * query_only=1：只读，返回已含 vmmouse 的实例数，并把每个实例的过滤链
 * 现状追加进 report（可为 NULL）。 */
static int walk_enumerator(const char *enumerator_path, int query_only,
                           char *report, DWORD report_cap)
{
    HKEY enum_key;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, enumerator_path, 0, KEY_READ,
                      &enum_key) != ERROR_SUCCESS) {
        return 0;
    }
    int hits = 0;
    DWORD index = 0;
    char dev_id[256];
    DWORD dev_id_len = (DWORD)sizeof(dev_id);
    while (RegEnumKeyExA(enum_key, index++, dev_id, &dev_id_len, NULL, NULL,
                         NULL, NULL) == ERROR_SUCCESS) {
        dev_id_len = (DWORD)sizeof(dev_id);
        if (!dev_id_match(dev_id, "PNP0F03") && !dev_id_match(dev_id, "PNP0F13")) {
            continue;
        }
        char dev_path[512];
        wsprintfA(dev_path, "%s\\%s", enumerator_path, dev_id);
        HKEY dev_key;
        if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, dev_path, 0, KEY_READ,
                          &dev_key) != ERROR_SUCCESS) {
            continue;
        }
        DWORD inst_index = 0;
        char inst_id[256];
        DWORD inst_id_len = (DWORD)sizeof(inst_id);
        while (RegEnumKeyExA(dev_key, inst_index++, inst_id, &inst_id_len, NULL,
                             NULL, NULL, NULL) == ERROR_SUCCESS) {
            inst_id_len = (DWORD)sizeof(inst_id);
            char inst_path[640];
            wsprintfA(inst_path, "%s\\%s", dev_path, inst_id);
            DWORD access = query_only ? KEY_QUERY_VALUE
                                      : (KEY_QUERY_VALUE | KEY_SET_VALUE);
            HKEY inst_key;
            if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, inst_path, 0, access,
                              &inst_key) != ERROR_SUCCESS) {
                continue;
            }
            if (query_only) {
                if (instance_has_vmmouse(inst_key)) {
                    hits++;
                }
                report_filters(report, report_cap, inst_path, inst_key);
            } else {
                int result = append_filter_value(inst_key);
                if (result > 0) {
                    hits++;
                    mlog("[install] patched %s += vmmouse", inst_path);
                } else if (result == 0) {
                    hits++;
                    mlog("[install] already attached: %s", inst_path);
                } else {
                    mlog("[install] FAILED %s UpperFilters gle=%lu", inst_path,
                         GetLastError());
                }
            }
            RegCloseKey(inst_key);
        }
        RegCloseKey(dev_key);
    }
    RegCloseKey(enum_key);
    return hits;
}

/* vmmouse 内核服务：过滤驱动按需启动，随 PS/2 鼠标设备一起被 PnP 加载。 */
static int ensure_vmmouse_service(void)
{
    SC_HANDLE scm = OpenSCManagerA(NULL, NULL, SC_MANAGER_CREATE_SERVICE);
    if (scm == NULL) {
        mlog("[install] OpenSCManager failed gle=%lu", GetLastError());
        return -1;
    }
    SC_HANDLE svc = OpenServiceA(scm, "vmmouse", SERVICE_QUERY_CONFIG);
    if (svc != NULL) {
        CloseServiceHandle(svc);
        CloseServiceHandle(scm);
        return 0; /* 已注册 */
    }
    svc = CreateServiceA(scm, "vmmouse", "VMware Pointing Device",
                         SERVICE_ALL_ACCESS, SERVICE_KERNEL_DRIVER,
                         SERVICE_DEMAND_START, SERVICE_ERROR_IGNORE,
                         "\\SystemRoot\\System32\\drivers\\vmmouse.sys",
                         "Pointer Port", NULL, NULL, NULL, NULL);
    if (svc == NULL && GetLastError() == ERROR_SERVICE_EXISTS) {
        /* 服务/登录两个常驻身份可能并发自愈建服务：已存在按成功处理。 */
        svc = OpenServiceA(scm, "vmmouse", SERVICE_QUERY_CONFIG);
    }
    if (svc == NULL) {
        mlog("[install] CreateService vmmouse failed gle=%lu", GetLastError());
        CloseServiceHandle(scm);
        return -1;
    }
    CloseServiceHandle(svc);
    CloseServiceHandle(scm);
    return 0;
}

int ivm_mouse_install(void)
{
    mlog("[install] === /mouse-install begin ===");
    if (!file_exists(DRIVER_SYS)) {
        mlog("[install] %s missing; run install-agent-v2.bat first", DRIVER_SYS);
        return 2;
    }
    if (ensure_vmmouse_service() != 0) {
        return 2;
    }
    int ok = walk_enumerator(ENUM_BASE "\\ACPI", 0, NULL, 0) +
             walk_enumerator(ENUM_BASE "\\Root", 0, NULL, 0);
    mlog("[install] ok_instances=%d; the filter attaches on the next reboot", ok);
    return ok > 0 ? 0 : 1;
}

int ivm_mouse_check(void)
{
    char body[1024];
    char text[1400];
    int file_ok = file_exists(DRIVER_SYS);
    int svc_ok = 0;
    SC_HANDLE scm = OpenSCManagerA(NULL, NULL, SERVICE_QUERY_STATUS);
    if (scm != NULL) {
        SC_HANDLE svc = OpenServiceA(scm, "vmmouse", SERVICE_QUERY_CONFIG);
        if (svc != NULL) {
            svc_ok = 1;
            CloseServiceHandle(svc);
        }
        CloseServiceHandle(scm);
    }
    body[0] = 0;
    int attached = walk_enumerator(ENUM_BASE "\\ACPI", 1, body,
                                   (DWORD)sizeof(body)) +
                   walk_enumerator(ENUM_BASE "\\Root", 1, body,
                                   (DWORD)sizeof(body));
    text[0] = 0;
    sz_append(text, (DWORD)sizeof(text),
              file_ok ? "driver file: present\r\n" : "driver file: MISSING\r\n");
    sz_append(text, (DWORD)sizeof(text),
              svc_ok ? "vmmouse service: registered\r\n"
                     : "vmmouse service: MISSING\r\n");
    sz_append(text, (DWORD)sizeof(text),
              attached > 0 ? "filter attached to PS/2 mouse: YES\r\n"
                           : "filter attached to PS/2 mouse: NO\r\n");
    sz_append(text, (DWORD)sizeof(text), "\r\nPS/2 mouse device instances:\r\n");
    sz_append(text, (DWORD)sizeof(text),
              body[0] != 0 ? body
                           : "  (none found under Enum\\ACPI / Enum\\Root)\r\n");
    mlog("[check] === /mouse-check ===");
    mlog("[check] driver file: %s / service: %s / attached: %s",
         file_ok ? "present" : "MISSING",
         svc_ok ? "registered" : "MISSING",
         attached > 0 ? "YES" : "NO");
    if (body[0] != 0) {
        mlog("[check] instances:\r\n%s", body);
    }
    MessageBoxA(NULL, text, "ivm-mouse check", MB_OK | MB_ICONINFORMATION);
    return (!file_ok || !svc_ok) ? 2 : (attached > 0 ? 0 : 1);
}

/* vmmouse 服务是否还在（只读）。血泪教训（2026-08-30）：bat 重装时
 * `sc delete vmmouse` 撞 1072 竞态导致服务没了、UpperFilters 却还挂着
 * ——开机 PnP 加载过滤器找不到服务，PS/2 鼠标设备整个启动失败，光标全
 * 死（键盘无过滤器所以正常）。自愈必须两者都查，不能只看过滤链。 */
static int vmmouse_service_present(void)
{
    SC_HANDLE scm = OpenSCManagerA(NULL, NULL, SC_MANAGER_CONNECT);
    SC_HANDLE svc;
    int ok = 0;
    if (scm == NULL) {
        return 0;
    }
    svc = OpenServiceA(scm, "vmmouse", SERVICE_QUERY_CONFIG);
    if (svc != NULL) {
        ok = 1;
        CloseServiceHandle(svc);
    }
    CloseServiceHandle(scm);
    return ok;
}

void ivm_mouse_selfheal(void)
{
    int attached = walk_enumerator(ENUM_BASE "\\ACPI", 1, NULL, 0) +
                   walk_enumerator(ENUM_BASE "\\Root", 1, NULL, 0);
    if (attached > 0 && vmmouse_service_present()) {
        return; /* 已挂上：静默，别每次开机刷日志 */
    }
    mlog("[self-heal] vmmouse incomplete (attached=%d service=%d); installing",
         attached, vmmouse_service_present());
    int rc = ivm_mouse_install();
    mlog("[self-heal] install rc=%d (0=ok; takes effect after next reboot)", rc);
}
