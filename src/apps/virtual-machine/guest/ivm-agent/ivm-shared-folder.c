/* ivm-shared-folder.c —— 共享文件夹（WebDAV 网络驱动器映射）收敛执行。
 *
 * 配置流：宿主设置开关 → EXEC（SYSTEM 身份）写
 *   HKLM\SOFTWARE\InstantVM\SharedFolder 下的 Seq/Enabled/Url/Drive
 *   （见 instant-app virtual-machine-app.tsx pushSharedFolderGuestConfig）。
 * 本模块在登录会话实例的 bridge_tick 里轮询 Seq，变化后在【用户会话】内
 * 幂等收敛 net use 映射。映射是每登录会话的资源：EXEC 直发会落进 session 0
 * （SYSTEM 的映射用户看不见），所以必须在登录实例里做，且用轮询 + 收敛
 * 而不是直发命令——顺带获得启动自愈（配置持久在注册表，重开虚拟机即生效）。
 *
 * 幂等规则：HKCU\Network\<drive> 的 RemotePath 是 persistent 映射的注册表
 * 留痕，已等于 Url 就什么都不做；否则 net use <drive> /delete /y（忽略失败）
 * 后 net use <drive> <url> /persistent:yes。Enabled=0 时只删不挂。
 * 日志：C:\Tools\shared-folder.log（尽力而为，绝不阻塞）。
 */

#include <windows.h>

/* 与 instant-app virtual-machine-app.tsx pushSharedFolderGuestConfig 对齐 */
#define SF_REG_KEY  "SOFTWARE\\InstantVM\\SharedFolder"
#define SF_LOG_PATH "C:\\Tools\\shared-folder.log"
#define SF_WAIT_MS  10000
#define SF_URL_MAX  400

static size_t sf_strlen(const char *s)
{
    size_t n = 0;
    while (s[n]) {
        n++;
    }
    return n;
}

static void sflog(const char *line)
{
    char stamped[1200];
    SYSTEMTIME st;
    GetLocalTime(&st);
    wsprintfA(stamped, "[%04u-%02u-%02u %02u:%02u:%02u] %s\r\n", st.wYear, st.wMonth,
              st.wDay, st.wHour, st.wMinute, st.wSecond, line);
    OutputDebugStringA(stamped);
    CreateDirectoryA("C:\\Tools", NULL);
    HANDLE log = CreateFileA(SF_LOG_PATH, FILE_APPEND_DATA, FILE_SHARE_READ, NULL,
                             OPEN_ALWAYS, 0, NULL);
    if (log != INVALID_HANDLE_VALUE) {
        DWORD written = 0;
        WriteFile(log, stamped, (DWORD)sf_strlen(stamped), &written, NULL);
        CloseHandle(log);
    }
}

static int sf_reg_read_string(HKEY root, const char *path, const char *name,
                              char *out, DWORD cap)
{
    HKEY key;
    if (RegOpenKeyExA(root, path, 0, KEY_READ, &key) != ERROR_SUCCESS) {
        return 0;
    }
    DWORD type = 0;
    LONG rc = RegQueryValueExA(key, name, NULL, &type, (LPBYTE)out, &cap);
    RegCloseKey(key);
    return rc == ERROR_SUCCESS && type == REG_SZ && cap > 0 && out[0] != 0;
}

static int sf_reg_read_dword(HKEY root, const char *path, const char *name, DWORD *out)
{
    HKEY key;
    if (RegOpenKeyExA(root, path, 0, KEY_READ, &key) != ERROR_SUCCESS) {
        return 0;
    }
    DWORD type = 0;
    DWORD value = 0;
    DWORD size = sizeof(value);
    LONG rc = RegQueryValueExA(key, name, NULL, &type, (LPBYTE)&value, &size);
    RegCloseKey(key);
    if (rc != ERROR_SUCCESS || type != REG_DWORD || size != sizeof(value)) {
        return 0;
    }
    *out = value;
    return 1;
}

/* net.exe 子命令执行；返回退出码，0xFFFFFFFF = 启动失败。 */
static DWORD sf_run_net(const char *args)
{
    char cmdline[600];
    wsprintfA(cmdline, "net %s", args);
    static const STARTUPINFOA zero_si;
    static const PROCESS_INFORMATION zero_pi;
    STARTUPINFOA si = zero_si;
    PROCESS_INFORMATION pi = zero_pi;
    si.cb = sizeof(si);
    if (!CreateProcessA(NULL, cmdline, NULL, NULL, FALSE, CREATE_NO_WINDOW,
                        NULL, NULL, &si, &pi)) {
        return 0xFFFFFFFF;
    }
    if (WaitForSingleObject(pi.hProcess, SF_WAIT_MS) != WAIT_OBJECT_0) {
        TerminateProcess(pi.hProcess, 1);
    }
    DWORD exit_code = 1;
    GetExitCodeProcess(pi.hProcess, &exit_code);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return exit_code;
}

static void sf_apply(int enabled, const char *url, const char *drive)
{
    char sub[32];
    wsprintfA(sub, "Network\\%s", drive);
    char current[SF_URL_MAX];
    DWORD current_len = (DWORD)sizeof(current);
    int have = 0;
    HKEY key;
    if (RegOpenKeyExA(HKEY_CURRENT_USER, sub, 0, KEY_READ, &key) == ERROR_SUCCESS) {
        DWORD type = 0;
        if (RegQueryValueExA(key, "RemotePath", NULL, &type, (LPBYTE)current,
                             &current_len) == ERROR_SUCCESS &&
            type == REG_SZ) {
            have = 1;
        }
        RegCloseKey(key);
    }
    if (enabled && have && lstrcmpA(current, url) == 0) {
        return; /* 已是期望状态：幂等出口 */
    }
    char action[128];
    if (have) {
        wsprintfA(action, "use %s /delete /y", drive);
        sf_run_net(action);
    }
    if (enabled) {
        char add[520];
        wsprintfA(add, "use %s %s /persistent:yes", drive, url);
        DWORD rc = sf_run_net(add);
        wsprintfA(action, "map %s -> %s rc=%lu", drive, url, rc);
        sflog(action);
    } else if (have) {
        sflog("share disabled, mapping removed");
    }
}

/* 清理仍指向本共享的残留映射（盘符换过/旧配置遗留）：HKCU\Network 的子键
 * 就是 persistent 映射的盘符（不带冒号），RemotePath 等于 Url 的都属于本
 * 共享，除 keep_drive（当前盘符，不带冒号；NULL = 全清）外一律删除。
 * 先枚举后删除，避免边枚举边改键。 */
static void sf_cleanup_stale(const char *url, const char *keep_drive)
{
    char names[32][8];
    int count = 0;
    int i;
    HKEY key;
    if (RegOpenKeyExA(HKEY_CURRENT_USER, "Network", 0, KEY_READ, &key) != ERROR_SUCCESS) {
        return;
    }
    while (count < 32) {
        char name[8];
        DWORD name_len = (DWORD)sizeof(name);
        if (RegEnumKeyExA(key, (DWORD)count, name, &name_len, NULL, NULL, NULL, NULL)
            != ERROR_SUCCESS) {
            break;
        }
        lstrcpynA(names[count], name, (int)sizeof(names[count]));
        count++;
    }
    RegCloseKey(key);
    for (i = 0; i < count; i++) {
        char sub[32];
        char path[SF_URL_MAX];
        DWORD path_len = (DWORD)sizeof(path);
        char action[96];
        if (keep_drive && lstrcmpiA(names[i], keep_drive) == 0) {
            continue;
        }
        wsprintfA(sub, "Network\\%s", names[i]);
        if (!sf_reg_read_string(HKEY_CURRENT_USER, sub, "RemotePath", path, path_len)) {
            continue;
        }
        if (lstrcmpA(path, url) != 0) {
            continue;
        }
        wsprintfA(action, "use %s: /delete /y", names[i]);
        sf_run_net(action);
        sflog(action);
    }
}

/* 由 clipboard-bridge 的 bridge_tick 每周期调用（约 150ms 空闲 / 4ms 活跃）。
 * 注册表读很轻；Seq 没变时一次 RegOpen+RegQuery 即返回。 */
void ivm_shared_folder_tick(void)
{
    static DWORD last_seq;
    static int have_seq;

    DWORD seq = 0;
    if (!sf_reg_read_dword(HKEY_LOCAL_MACHINE, SF_REG_KEY, "Seq", &seq)) {
        return; /* 没有配置（旧宿主/从未启用过）：零动作 */
    }
    if (have_seq && seq == last_seq) {
        return;
    }
    last_seq = seq;
    have_seq = 1;

    DWORD enabled = 0;
    sf_reg_read_dword(HKEY_LOCAL_MACHINE, SF_REG_KEY, "Enabled", &enabled);
    char url[SF_URL_MAX] = "http://instant-vm-files.local/";
    sf_reg_read_string(HKEY_LOCAL_MACHINE, SF_REG_KEY, "Url", url, (DWORD)sizeof(url));
    char drive[8] = "Z:";
    sf_reg_read_string(HKEY_LOCAL_MACHINE, SF_REG_KEY, "Drive", drive, (DWORD)sizeof(drive));
    if (drive[0] < 'A' || drive[0] > 'Z' || drive[1] != ':') {
        sflog("invalid Drive value, skip");
        return;
    }
    sf_apply(enabled != 0, url, drive);
    /* keep 当前盘符（去掉冒号）；停用时全清本共享的所有盘符 */
    if (enabled) {
        char keep[2];
        keep[0] = drive[0];
        keep[1] = 0;
        sf_cleanup_stale(url, keep);
    } else {
        sf_cleanup_stale(url, NULL);
    }
}
