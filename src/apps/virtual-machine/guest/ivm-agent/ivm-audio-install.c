/*
 * ivm-audio-install —— 声卡驱动子命令：把 XP 内置的 Sound Blaster 16 WDM
 * 驱动（ctlsb16.sys）绑到 v86 模拟的 SB16 声卡设备上（Windows XP，32 位）。
 *
 * 四个入口（GUI 子系统不占控制台，成败看退出码 + 日志）：
 *   /audio-install    就地提取驱动文件 + 注册 ctlsb16 服务 + 给未绑定的
 *                     *CTL00xx 声卡实例写 Service/Class；注册表里一个实例
 *                     都没有时**自建**一个根枚举设备（见下）。
 *                     0=成功（新写入或本就已装）1=没找到且建不成实例
 *                     2=驱动文件提取失败 / 服务管理器 / 注册表操作失败
 *   /audio-uninstall  标准回滚：删掉自建的 Enum\Root\*CTL0031 实例 +
 *                     禁用 ctlsb16 服务（BIOS/向导枚举出的实例不碰）。
 *                     0=成功（含本来就没装）2=注册表操作失败
 *   /audio-check      只读体检：驱动文件、ctlsb16 服务、每个 *CTL00xx
 *                     实例的绑定现状。报告进日志 + MessageBox 弹窗。
 *                     0=已装 1=未装 2=驱动文件或服务缺失
 *   ivm_audio_selfheal()  供 agent 常驻身份（服务/登录）每次启动调用：
 *                     已装就静默返回；缺就补，但**绝不自建设备实例**——
 *                     只绑定本就已枚举出来的实例（保守化，见下）。
 *
 * 背景：v86 下 XP 的 PnP 自动安装经常不触发，设备管理器留黄叹号「多媒体
 * 音频控制器」，这就是客机无声的根源（v86 官方文档因此写了手动安装步骤）。
 *
 * 与鼠标自愈（ivm-mouse-install.c）的两点差别：
 *   1. 驱动文件不是 vendor 进 out/ 的——ctlsb16.sys 是 XP 内置（inbox
 *      WDM，INF 为 wdma_ctl.inf），没装过的设备上它还压缩躺在 Driver
 *      Cache 的 cab 或 XP 光盘 I386\CTLSB16.SY_ 里，所以多一步「就地提
 *      取」：Driver Cache 的 cab（sp3/sp2/driver.cab）→ 各 CD-ROM 盘的
 *      I386\CTLSB16.SY_（expand -r）→ C:\Tools\ctlsb16.sys（人工放置兜
 *      底，bat 第 4 步会代放）。全找不到退出码 2，落日志提示。
 *   2. 绑的是设备实例本身的函数驱动（写 Service），不是过滤链。
 *
 * 为什么注册表直改而不走 setupapi/INF 向导：同 vmmouse 的理由——向导弹
 * 「找到新硬件」还要过签名校验；直写 Service/ClassGUID/ConfigFlags 无提
 * 示，inbox 驱动本来就有签名。绑定要等设备重新枚举（下次重启）才生效，
 * 最坏「装好 → 重启生效」，与 vmmouse 的收敛路径一致。
 *
 * 设备识别：硬件 ID 形如 *CTL0031/CTL0041（星号有无随枚举器而定），同时
 * 查设备键名与实例的 HardwareID。只认 CTL00 前缀——同卡的游戏口是
 * CTL7xxx，归 joystick 类，不能绑声卡驱动。
 *
 * 自建设备实例（只有显式 /audio-install 会做）：v86 不模拟 ISA PnP，XP 里
 * 常常连「多媒体音频控制器」实例都没有（v86 官方指引因此是「添加硬件向导
 * → 手动从列表选 SB16 WDM」）——此时自建 Enum\Root\*CTL0031\0000，与向导
 * 产物同构，重启后 PnP 按 HardwareID 匹配 inbox INF 自动装驱动。
 * 血泪教训（2026-08-30）：首版把「自建实例」放进了每次开机的自愈路径，同
 * 一次软重启后 XP 鼠标彻底不动（独占/跟随全死，COM1 串口不受影响）——时
 * 间线高度可疑但机制未完全定罪（同批还撞上 v86 软重启不清绝对鼠标状态的
 * 缺陷）。教训：凡「给系统造新设备」这类有副作用的写操作，只许放在显式
 * 子命令里，自愈只做幂等补写既有状态。/audio-uninstall 即为此准备的回滚。
 *
 * 已知限制：装好驱动只解决「无声」；XP 上 SB16 播放尾段偶发循环是 v86 侧
 * 模拟时序问题（todo/vm-windows-xp-sb16-audio-loop.md），与本驱动无关。
 *
 * 与 res-agent.c / clipboard-bridge.c / ivm-mouse-install.c 合编进
 * ivm-agent.exe；无 CRT（-nostdlib），自带小函数一律 static，避免链接期
 * 撞符号。日志：C:\Tools\audio-install.log（成败汇报必须有日志可查）。
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdarg.h>

#define ENUM_BASE "SYSTEM\\CurrentControlSet\\Enum"
#define MEDIA_CLASS_GUID "{4D36E96C-E325-11CE-BFC1-08002BE10318}"
#define SERVICE_NAME "ctlsb16"
#define DRIVER_SYS "C:\\Windows\\System32\\drivers\\ctlsb16.sys"
#define DRIVERS_DIR "C:\\Windows\\System32\\drivers"
#define STAGED_SYS "C:\\Tools\\ctlsb16.sys"
#define LOG_PATH "C:\\Tools\\audio-install.log"

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

/* 前缀匹配：忽略大小写与前导 '*'（硬件 ID 带不带星号随枚举器而定）。 */
static int id_starts_with(const char *id, const char *prefix)
{
    if (id[0] == '*') {
        id++;
    }
    while (*prefix) {
        if (ivm_lower(*id) != ivm_lower(*prefix)) {
            return 0;
        }
        id++;
        prefix++;
    }
    return 1;
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
 * wvsprintfA 的输出上限是 1024 字符，msg/line 必须装得满这个上限——
 * 2026-08 真机事故：msg 只有 600，%s 带进长转储时直接烧栈，agent 开机
 * 即崩（弹「遇到问题需要关闭」）。 */
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

/* 静默跑一条外部命令（expand.exe）并等它结束（上限 20s）。成败不看退出
 * 码，看产物文件在不在——expand 的 -f/-r 语法在 2000/XP/2003 间有差异。
 * 上限 20s 而非更多：expand 扫大 cab（sp2/sp3 有百 MB 级）在 v86 慢速 CPU
 * 上动辄分钟级，等太久会把每次开机的自愈拖成分钟级；超时弃等后孤儿
 * expand 仍会抢 CPU，所以宁可靠日志里「没出文件」快速落到下一个来源。 */
static void run_command_wait(const char *fmt, ...)
{
    char cmdline[600];
    va_list args;
    va_start(args, fmt);
    wvsprintfA(cmdline, fmt, args);
    va_end(args);
    static const STARTUPINFOA zero_si;
    static const PROCESS_INFORMATION zero_pi;
    STARTUPINFOA si = zero_si;
    PROCESS_INFORMATION pi = zero_pi;
    si.cb = sizeof(si);
    if (!CreateProcessA(NULL, cmdline, NULL, NULL, FALSE, CREATE_NO_WINDOW,
                        NULL, NULL, &si, &pi)) {
        mlog("[extract] CreateProcess failed gle=%lu: %s", GetLastError(),
             cmdline);
        return;
    }
    WaitForSingleObject(pi.hProcess, 20000);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
}

/* 就地提取 ctlsb16.sys：Driver Cache 的 cab → 各 CD-ROM 的 I386\CTLSB16.SY_
 * → C:\Tools 人工放置。返回 1=文件已在位。 */
static int extract_driver_file(void)
{
    static const char *cabs[] = {
        "C:\\WINDOWS\\Driver Cache\\i386\\sp3.cab",
        "C:\\WINDOWS\\Driver Cache\\i386\\sp2.cab",
        "C:\\WINDOWS\\Driver Cache\\i386\\driver.cab",
    };
    for (int i = 0; i < 3; i++) {
        if (!file_exists(cabs[i])) {
            continue;
        }
        mlog("[extract] expanding ctlsb16.sys from %s", cabs[i]);
        run_command_wait("expand \"%s\" -f:ctlsb16.sys " DRIVERS_DIR, cabs[i]);
        if (file_exists(DRIVER_SYS)) {
            return 1;
        }
        mlog("[extract] expand from %s produced no file (not in cab, or "
             "timed out on this slow CPU)",
             cabs[i]);
    }
    for (char drive = 'D'; drive <= 'Z'; drive++) {
        char root[8];
        wsprintfA(root, "%c:\\", drive);
        if (GetDriveTypeA(root) != DRIVE_CDROM) {
            continue;
        }
        char pack[280];
        wsprintfA(pack, "%sI386\\CTLSB16.SY_", root);
        if (!file_exists(pack)) {
            continue;
        }
        mlog("[extract] expanding %s", pack);
        run_command_wait("expand -r \"%s\" " DRIVERS_DIR, pack);
        if (file_exists(DRIVER_SYS)) {
            return 1;
        }
        mlog("[extract] expand from %s produced no file (timed out?)", pack);
    }
    if (file_exists(STAGED_SYS)) {
        mlog("[extract] copying staged %s", STAGED_SYS);
        if (CopyFileA(STAGED_SYS, DRIVER_SYS, FALSE)) {
            return 1;
        }
        mlog("[extract] CopyFile failed gle=%lu", GetLastError());
    }
    mlog("[extract] all sources failed - mount the XP CD-ROM "
         "(I386\\CTLSB16.SY_) and reboot, or put ctlsb16.sys at %s",
         STAGED_SYS);
    return 0;
}

/* ctlsb16 内核服务：inbox WDM 驱动，PnP 按设备实例的 Service 按需加载。 */
static int ensure_ctlsb16_service(void)
{
    SC_HANDLE scm = OpenSCManagerA(NULL, NULL, SC_MANAGER_CREATE_SERVICE);
    if (scm == NULL) {
        mlog("[install] OpenSCManager failed gle=%lu", GetLastError());
        return -1;
    }
    SC_HANDLE svc = OpenServiceA(scm, SERVICE_NAME, SERVICE_QUERY_CONFIG);
    if (svc != NULL) {
        CloseServiceHandle(svc);
        CloseServiceHandle(scm);
        return 0; /* 已注册 */
    }
    svc = CreateServiceA(scm, SERVICE_NAME, "Sound Blaster 16 WDM",
                         SERVICE_ALL_ACCESS, SERVICE_KERNEL_DRIVER,
                         SERVICE_DEMAND_START, SERVICE_ERROR_NORMAL,
                         "\\SystemRoot\\System32\\drivers\\ctlsb16.sys",
                         NULL, NULL, NULL, NULL, NULL);
    if (svc == NULL && GetLastError() == ERROR_SERVICE_EXISTS) {
        /* 服务/登录两个常驻身份可能并发自愈建服务：已存在按成功处理。 */
        svc = OpenServiceA(scm, SERVICE_NAME, SERVICE_QUERY_CONFIG);
    }
    if (svc == NULL) {
        mlog("[install] CreateService " SERVICE_NAME " failed gle=%lu",
             GetLastError());
        CloseServiceHandle(scm);
        return -1;
    }
    CloseServiceHandle(svc);
    CloseServiceHandle(scm);
    return 0;
}

/* 实例的 Service 是否等于给定驱动名（只读）。 */
static int service_equals(HKEY inst_key, const char *svc)
{
    char value[64];
    DWORD size = (DWORD)sizeof(value) - 1;
    DWORD type = 0;
    if (RegQueryValueExA(inst_key, "Service", NULL, &type, (LPBYTE)value,
                         &size) != ERROR_SUCCESS ||
        type != REG_SZ) {
        return 0;
    }
    value[size] = 0;
    return str_equals_ignore_case(value, svc);
}

/* 实例是不是 SB16 声卡功能：设备键名或 HardwareID（multi-sz）里有 CTL00
 * 前缀即算。游戏口 CTL7xxx 由此天然排除。 */
static int instance_is_sb16(HKEY inst_key, const char *dev_id)
{
    if (id_starts_with(dev_id, "CTL00")) {
        return 1;
    }
    char msz[512];
    DWORD size = (DWORD)sizeof(msz) - 2;
    DWORD type = 0;
    if (RegQueryValueExA(inst_key, "HardwareID", NULL, &type, (LPBYTE)msz,
                         &size) != ERROR_SUCCESS ||
        type != REG_MULTI_SZ) {
        return 0;
    }
    msz[size] = 0;
    msz[size + 1] = 0;
    for (const char *p = msz; *p; p += ivm_strlen(p) + 1) {
        if (id_starts_with(p, "CTL00")) {
            return 1;
        }
    }
    return 0;
}

/* 取第一个硬件 ID（multi-sz 首串），诊断报告用。 */
static void first_hwid(HKEY inst_key, char *out, DWORD cap)
{
    char msz[512];
    DWORD size = (DWORD)sizeof(msz) - 2;
    DWORD type = 0;
    out[0] = 0;
    if (RegQueryValueExA(inst_key, "HardwareID", NULL, &type, (LPBYTE)msz,
                         &size) == ERROR_SUCCESS &&
        type == REG_MULTI_SZ) {
        msz[size] = 0;
        msz[size + 1] = 0;
        sz_append(out, cap, msz);
    } else {
        sz_append(out, cap, "(no HardwareID)");
    }
}

/* 把函数驱动绑到设备实例：写 Service/Class/ClassGUID，清 ConfigFlags
 * （褪掉 CONFIGFLAG_FAILEDINSTALL），删掉陈旧的 Driver 值。返回 0=成功。 */
static int bind_instance(HKEY inst_key, const char *inst_path)
{
    static const char kClass[] = "MEDIA";
    DWORD zero = 0;
    int ok = 1;
    ok &= RegSetValueExA(inst_key, "Service", 0, REG_SZ,
                         (const BYTE *)SERVICE_NAME,
                         (DWORD)sizeof(SERVICE_NAME)) == ERROR_SUCCESS;
    ok &= RegSetValueExA(inst_key, "Class", 0, REG_SZ, (const BYTE *)kClass,
                         (DWORD)sizeof(kClass)) == ERROR_SUCCESS;
    ok &= RegSetValueExA(inst_key, "ClassGUID", 0, REG_SZ,
                         (const BYTE *)MEDIA_CLASS_GUID,
                         (DWORD)sizeof(MEDIA_CLASS_GUID)) == ERROR_SUCCESS;
    ok &= RegSetValueExA(inst_key, "ConfigFlags", 0, REG_DWORD,
                         (const BYTE *)&zero, sizeof(zero)) == ERROR_SUCCESS;
    RegDeleteValueA(inst_key, "Driver"); /* 不存在也无所谓 */
    if (!ok) {
        mlog("[install] FAILED binding %s (gle=%lu)", inst_path,
             GetLastError());
        return -1;
    }
    return 0;
}

/* 遍历 Enum 下全部枚举器（SB16 挂在哪个枚举器随 BIOS/HAL 而定，ACPI 与
 * Standard PC 的 Root 都见过，索性全走）。mode：
 *   0 = 安装：给未绑定的候选实例绑 ctlsb16，返回「新绑定+本已绑定」数；
 *   1 = 只查：统计已绑定数，每个候选实例的现状追加进 report（可为 NULL）；
 *   2 = 诊断：不限 CTL00xx，把每个实例的硬件 ID 与 Service 落进 report。
 * candidates 出参（可为 NULL）：候选实例数（mode 2 为全部实例数）。 */
static int walk_enum_all(int mode, char *report, DWORD report_cap,
                         int *candidates)
{
    if (candidates != NULL) {
        *candidates = 0;
    }
    HKEY base;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, ENUM_BASE, 0, KEY_READ, &base) !=
        ERROR_SUCCESS) {
        return 0;
    }
    int hits = 0;
    DWORD enum_index = 0;
    char enum_name[64];
    DWORD enum_len = (DWORD)sizeof(enum_name);
    while (RegEnumKeyExA(base, enum_index++, enum_name, &enum_len, NULL, NULL,
                         NULL, NULL) == ERROR_SUCCESS) {
        enum_len = (DWORD)sizeof(enum_name);
        char enum_path[160];
        wsprintfA(enum_path, "%s\\%s", ENUM_BASE, enum_name);
        HKEY enum_key;
        if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, enum_path, 0, KEY_READ,
                          &enum_key) != ERROR_SUCCESS) {
            continue;
        }
        DWORD dev_index = 0;
        char dev_id[256];
        DWORD dev_len = (DWORD)sizeof(dev_id);
        while (RegEnumKeyExA(enum_key, dev_index++, dev_id, &dev_len, NULL,
                             NULL, NULL, NULL) == ERROR_SUCCESS) {
            dev_len = (DWORD)sizeof(dev_id);
            char dev_path[480];
            wsprintfA(dev_path, "%s\\%s", enum_path, dev_id);
            HKEY dev_key;
            if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, dev_path, 0, KEY_READ,
                              &dev_key) != ERROR_SUCCESS) {
                continue;
            }
            DWORD inst_index = 0;
            char inst_id[256];
            DWORD inst_len = (DWORD)sizeof(inst_id);
            while (RegEnumKeyExA(dev_key, inst_index++, inst_id, &inst_len,
                                 NULL, NULL, NULL, NULL) == ERROR_SUCCESS) {
                inst_len = (DWORD)sizeof(inst_id);
                char inst_path[768];
                wsprintfA(inst_path, "%s\\%s", dev_path, inst_id);
                DWORD access = (mode == 0) ? (KEY_QUERY_VALUE | KEY_SET_VALUE)
                                           : KEY_QUERY_VALUE;
                HKEY inst_key;
                if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, inst_path, 0, access,
                                  &inst_key) != ERROR_SUCCESS) {
                    continue;
                }
                if (mode == 2) {
                    if (candidates != NULL) {
                        (*candidates)++;
                    }
                    char hw[64];
                    first_hwid(inst_key, hw, (DWORD)sizeof(hw));
                    char line[960];
                    wsprintfA(line, "  %s hw=%s svc=", inst_path, hw);
                    if (service_equals(inst_key, SERVICE_NAME)) {
                        sz_append(line, (DWORD)sizeof(line), SERVICE_NAME);
                    } else {
                        sz_append(line, (DWORD)sizeof(line), "(none)");
                    }
                    sz_append(line, (DWORD)sizeof(line), "\r\n");
                    if (report != NULL) {
                        sz_append(report, report_cap, line);
                    }
                    hits++;
                } else if (instance_is_sb16(inst_key, dev_id)) {
                    if (candidates != NULL) {
                        (*candidates)++;
                    }
                    if (mode == 1) {
                        if (service_equals(inst_key, SERVICE_NAME)) {
                            hits++;
                        }
                        char hw[64];
                        first_hwid(inst_key, hw, (DWORD)sizeof(hw));
                        char line[960];
                        wsprintfA(line, "  %s\r\n    hw=%s Service=%s\r\n",
                                  inst_path, hw,
                                  service_equals(inst_key, SERVICE_NAME)
                                      ? SERVICE_NAME
                                      : "(not bound)");
                        if (report != NULL) {
                            sz_append(report, report_cap, line);
                        }
                    } else if (service_equals(inst_key, SERVICE_NAME)) {
                        hits++;
                        mlog("[install] already bound: %s", inst_path);
                    } else if (bind_instance(inst_key, inst_path) == 0) {
                        hits++;
                        mlog("[install] bound %s -> " SERVICE_NAME, inst_path);
                    }
                }
                RegCloseKey(inst_key);
            }
            RegCloseKey(dev_key);
        }
        RegCloseKey(enum_key);
    }
    RegCloseKey(base);
    return hits;
}

/* v86 不模拟 ISA PnP 枚举：XP 里常常连「多媒体音频控制器」实例都没有
 * （v86 官方文档的指引因此是「添加硬件向导 → 添加新设备 → 手动从列表选
 * Sound Blaster 16 WDM」）。没实例就手工造一个根枚举设备实例
 * （Enum\Root\*CTL0031\0000，与向导产物同构），重启后 PnP 拿 HardwareID
 * 匹配 inbox 的 wdma_ctl.inf 自动装驱动。返回 0=成功。 */
static int create_sb16_instance(void)
{
    static const char kPath[] = ENUM_BASE "\\Root\\*CTL0031\\0000";
    static const char kDesc[] = "Sound Blaster 16 or AWE-32 (WDM)";
    static const char kHw[] = "*CTL0031\0CTL0031\0";
    static const char kMatch[] = "*CTL0031";
    static const char kClass[] = "MEDIA";
    DWORD zero = 0;
    DWORD disp = 0;
    HKEY key;
    LONG rc = RegCreateKeyExA(HKEY_LOCAL_MACHINE, kPath, 0, NULL,
                              REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, NULL,
                              &key, &disp);
    if (rc != ERROR_SUCCESS) {
        mlog("[install] create %s failed rc=%ld gle=%lu", kPath, rc,
             GetLastError());
        return -1;
    }
    int ok = 1;
    ok &= RegSetValueExA(key, "DeviceDesc", 0, REG_SZ, (const BYTE *)kDesc,
                         (DWORD)sizeof(kDesc)) == ERROR_SUCCESS;
    ok &= RegSetValueExA(key, "HardwareID", 0, REG_MULTI_SZ, (const BYTE *)kHw,
                         (DWORD)sizeof(kHw)) == ERROR_SUCCESS;
    ok &= RegSetValueExA(key, "MatchingDeviceId", 0, REG_SZ,
                         (const BYTE *)kMatch,
                         (DWORD)sizeof(kMatch)) == ERROR_SUCCESS;
    ok &= RegSetValueExA(key, "Class", 0, REG_SZ, (const BYTE *)kClass,
                         (DWORD)sizeof(kClass)) == ERROR_SUCCESS;
    ok &= RegSetValueExA(key, "ClassGUID", 0, REG_SZ,
                         (const BYTE *)MEDIA_CLASS_GUID,
                         (DWORD)sizeof(MEDIA_CLASS_GUID)) == ERROR_SUCCESS;
    ok &= RegSetValueExA(key, "Service", 0, REG_SZ, (const BYTE *)SERVICE_NAME,
                         (DWORD)sizeof(SERVICE_NAME)) == ERROR_SUCCESS;
    ok &= RegSetValueExA(key, "ConfigFlags", 0, REG_DWORD,
                         (const BYTE *)&zero, sizeof(zero)) == ERROR_SUCCESS;
    RegCloseKey(key);
    if (!ok) {
        mlog("[install] writing %s values failed gle=%lu", kPath,
             GetLastError());
        return -1;
    }
    mlog("[install] created root device instance %s (driver binds on next boot)",
         kPath);
    return 0;
}

static int audio_install(int allow_create)
{
    mlog("[install] === /audio-install begin ===");
    int candidates = 0;
    int bound = walk_enum_all(1, NULL, 0, &candidates);
    /* 早退条件带上驱动文件在位：只创建过实例但提取失败的机器重跑时，
     * 要能走到提取重试，不能被「已绑定」短路。 */
    if (bound > 0 && bound == candidates && file_exists(DRIVER_SYS)) {
        mlog("[install] all %d SB16 instance(s) already bound; nothing to do",
             bound);
        return 0;
    }
    if (candidates == 0) {
        if (!allow_create) {
            /* 自愈身份绝不自建设备（见文件头「血泪教训」）：建实例只发生
             * 在显式 /audio-install，可预期、可回滚。 */
            mlog("[install] no SB16 instance in the registry; explicit "
                 "/audio-install creates one, self-heal never does");
            return 1;
        }
        /* v86 下卡没有被枚举：造实例（见 create_sb16_instance）。 */
        if (create_sb16_instance() != 0) {
            return 2;
        }
        bound = walk_enum_all(1, NULL, 0, &candidates);
        if (candidates == 0) {
            char dump[900];
            dump[0] = 0;
            walk_enum_all(2, dump, (DWORD)sizeof(dump), NULL);
            mlog("[install] instance creation did not stick; instances "
                 "seen:\r\n%s",
                 dump);
            return 1;
        }
    }
    if (!file_exists(DRIVER_SYS) && !extract_driver_file()) {
        mlog("[install] %s missing and every extraction source failed",
             DRIVER_SYS);
        return 2;
    }
    if (ensure_ctlsb16_service() != 0) {
        return 2;
    }
    int hits = walk_enum_all(0, NULL, 0, &candidates);
    if (hits > 0) {
        mlog("[install] ok_instances=%d; sound starts when the device "
             "re-enumerates (reboot)",
             hits);
        return 0;
    }
    if (candidates > 0) {
        mlog("[install] %d candidate instance(s) but none could be bound",
             candidates);
        return 2;
    }
    return 1;
}

int ivm_audio_install(void)
{
    return audio_install(1);
}

int ivm_audio_uninstall(void)
{
    mlog("[uninstall] === /audio-uninstall begin ===");
    /* 只动我们自建的 Root\*CTL0031（RegDeleteKeyA 只删空键，先删子键）；
     * BIOS/向导枚举出来的 ACPI 实例不碰——那些走 /audio-check 诊断。 */
    LONG rc_child = RegDeleteKeyA(HKEY_LOCAL_MACHINE,
                                  ENUM_BASE "\\Root\\*CTL0031\\0000");
    LONG rc_parent = RegDeleteKeyA(HKEY_LOCAL_MACHINE,
                                   ENUM_BASE "\\Root\\*CTL0031");
    if (rc_child == ERROR_SUCCESS || rc_parent == ERROR_SUCCESS) {
        mlog("[uninstall] removed created instance (child rc=%ld parent "
             "rc=%ld); device is gone after the next reboot",
             rc_child, rc_parent);
    } else if (rc_child != ERROR_FILE_NOT_FOUND ||
               rc_parent != ERROR_FILE_NOT_FOUND) {
        mlog("[uninstall] instance delete failed (child rc=%ld parent "
             "rc=%ld) gle=%lu",
             rc_child, rc_parent, GetLastError());
        return 2;
    } else {
        mlog("[uninstall] no created instance present (nothing to remove)");
    }
    /* 服务一并在册禁用：实例删了它本就不会再被加载，禁用是双保险——
     * 真要恢复时 /audio-install 会按需重新配置。 */
    SC_HANDLE scm = OpenSCManagerA(NULL, NULL, SC_MANAGER_CONNECT);
    if (scm == NULL) {
        mlog("[uninstall] OpenSCManager failed gle=%lu", GetLastError());
        return 2;
    }
    SC_HANDLE svc = OpenServiceA(scm, SERVICE_NAME, SERVICE_CHANGE_CONFIG);
    if (svc != NULL) {
        if (ChangeServiceConfigA(svc, SERVICE_NO_CHANGE, SERVICE_DISABLED,
                                 SERVICE_NO_CHANGE, NULL, NULL, NULL, NULL,
                                 NULL, NULL, NULL)) {
            mlog("[uninstall] " SERVICE_NAME " service disabled");
        } else {
            mlog("[uninstall] ChangeServiceConfig failed gle=%lu",
                 GetLastError());
            CloseServiceHandle(svc);
            CloseServiceHandle(scm);
            return 2;
        }
        CloseServiceHandle(svc);
    } else {
        mlog("[uninstall] " SERVICE_NAME " service not present (fine)");
    }
    CloseServiceHandle(scm);
    mlog("[uninstall] done; reboot for the changes to take effect");
    return 0;
}

int ivm_audio_check(void)
{
    char body[900];
    char text[1500];
    int file_ok = file_exists(DRIVER_SYS);
    int svc_ok = 0;
    SC_HANDLE scm = OpenSCManagerA(NULL, NULL, SERVICE_QUERY_STATUS);
    if (scm != NULL) {
        SC_HANDLE svc = OpenServiceA(scm, SERVICE_NAME, SERVICE_QUERY_CONFIG);
        if (svc != NULL) {
            svc_ok = 1;
            CloseServiceHandle(svc);
        }
        CloseServiceHandle(scm);
    }
    int candidates = 0;
    body[0] = 0;
    int bound = walk_enum_all(1, body, (DWORD)sizeof(body), &candidates);    text[0] = 0;
    sz_append(text, (DWORD)sizeof(text),
              file_ok ? "driver file: present\r\n"
                      : "driver file: MISSING (run /audio-install)\r\n");
    sz_append(text, (DWORD)sizeof(text),
              svc_ok ? "ctlsb16 service: registered\r\n"
                     : "ctlsb16 service: MISSING\r\n");
    sz_append(text, (DWORD)sizeof(text),
              bound > 0 ? "driver bound to SB16 device: YES\r\n"
                        : "driver bound to SB16 device: NO\r\n");
    sz_append(text, (DWORD)sizeof(text), "\r\nSB16 audio device instances:\r\n");
    sz_append(text, (DWORD)sizeof(text),
              body[0] != 0 ? body
                           : "  (no *CTL00xx instance found - is the sound "
                             "card enumerated by the BIOS?)\r\n");
    mlog("[check] === /audio-check ===");
    mlog("[check] driver file: %s / service: %s / bound: %s",
         file_ok ? "present" : "MISSING", svc_ok ? "registered" : "MISSING",
         bound > 0 ? "YES" : "NO");
    if (body[0] != 0) {
        mlog("[check] instances:\r\n%s", body);
    }
    MessageBoxA(NULL, text, "ivm-audio check", MB_OK | MB_ICONINFORMATION);
    return (!file_ok || !svc_ok) ? 2 : (bound > 0 ? 0 : 1);
}

void ivm_audio_selfheal(void)
{
    int bound = walk_enum_all(1, NULL, 0, NULL);
    if (bound > 0) {
        return; /* 已装上：静默，别每次开机刷日志 */
    }
    mlog("[self-heal] SB16 audio driver not bound; installing (bind only, "
         "never creates a device)");
    int rc = audio_install(0);
    mlog("[self-heal] install rc=%d (0=ok, sound after next reboot; "
         "1=no SB16 instance, run /audio-install explicitly)",
         rc);
}
