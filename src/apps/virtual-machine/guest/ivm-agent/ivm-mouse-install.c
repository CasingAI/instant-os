/*
 * ivm-mouse-install —— /mouse-install 子命令：把 VMware vmmouse 挂上 PS/2
 * 鼠标设备（Windows XP，32 位）。
 *
 * 由 install-agent-v2.bat 以 `ivm-agent.exe /mouse-install` 调用（GUI 子系统
 * 不占控制台，成败看退出码）：
 *   0 = 成功（过滤驱动已挂上，或本就装好）
 *   1 = 没找到 PS/2 鼠标设备（Enum 下无 PNP0F03/PNP0F13 实例）
 *   2 = 服务管理器 / 注册表操作失败
 *
 * 做两件事：
 *   1. vmmouse 内核服务不存在就创建（type= kernel start= demand
 *      error= ignore group= Pointer Port，ImagePath 指向 drivers\vmmouse.sys，
 *      驱动文件由安装脚本先拷到位）；
 *   2. 遍历 Enum\ACPI 与 Enum\Root 下的 PNP0F03/PNP0F13 设备实例，把
 *      "vmmouse" 追加进实例键的 UpperFilters（REG_MULTI_SZ，已在则跳过）。
 *
 * 为什么走注册表直改而不是 rundll32 装 INF：INF 向导会弹「找到新硬件」、
 * 还要过驱动签名校验；注册表直改无提示，重启后 PnP 按上层过滤驱动加载
 * vmmouse，驱动起来向 VMware backdoor（io 端口 0x5658）要绝对坐标，
 * v86 侧的绝对坐标通路随即打通（指针 auto 模式自动切「跟随」）。
 *
 * 与 res-agent.c / clipboard-bridge.c 合编进 ivm-agent.exe；无 CRT
 * （-nostdlib），自带的 strlen 等小函数一律 static，避免链接期撞符号。
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

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
    } else if (rc == ERROR_FILE_NOT_FOUND || rc == ERROR_MORE_DATA) {
        existing[0] = 0; /* 没有现值：从头写 */
    } else {
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

/* 遍历一个枚举器（ACPI / Root）下的 PNP0F03/PNP0F13 设备实例并打补丁。
 * 返回成功写入的实例数。 */
static int walk_enumerator(const char *enumerator_path)
{
    HKEY enum_key;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, enumerator_path, 0, KEY_READ,
                      &enum_key) != ERROR_SUCCESS) {
        return 0;
    }
    int patched = 0;
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
            HKEY inst_key;
            if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, inst_path, 0,
                              KEY_QUERY_VALUE | KEY_SET_VALUE,
                              &inst_key) == ERROR_SUCCESS) {
                int result = append_filter_value(inst_key);
                if (result > 0) {
                    patched++;
                }
                RegCloseKey(inst_key);
            }
        }
        RegCloseKey(dev_key);
    }
    RegCloseKey(enum_key);
    return patched;
}

/* vmmouse 内核服务：过滤驱动按需启动，随 PS/2 鼠标设备一起被 PnP 加载。 */
static int ensure_vmmouse_service(void)
{
    SC_HANDLE scm = OpenSCManagerA(NULL, NULL, SC_MANAGER_CREATE_SERVICE);
    if (scm == NULL) {
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
    if (svc == NULL) {
        CloseServiceHandle(scm);
        return -1;
    }
    CloseServiceHandle(svc);
    CloseServiceHandle(scm);
    return 0;
}

int ivm_mouse_install(void)
{
    if (ensure_vmmouse_service() != 0) {
        return 2;
    }
    int patched = walk_enumerator("SYSTEM\\CurrentControlSet\\Enum\\ACPI") +
                  walk_enumerator("SYSTEM\\CurrentControlSet\\Enum\\Root");
    return patched > 0 ? 0 : 1;
}
