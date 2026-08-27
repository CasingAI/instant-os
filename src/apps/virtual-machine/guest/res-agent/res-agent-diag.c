/*
 * res-agent-diag —— 定位 res-agent 在真 XP 上启动崩溃的分步诊断版。
 *
 * 双击运行后按顺序弹 5 个消息框；停在哪个框没弹出来，病灶就在那一步：
 *   1 进程已进入          —— PE 加载、重定位、导入表解析全过
 *   2 kernel32 可调用      —— Sleep(1) 正常返回
 *   3 栈与局部变量正常     —— 自写十进制格式化（不依赖 CRT）
 *   4 显示模式枚举正常     —— EnumDisplaySettingsA 枚举到的档位数、最大宽高
 *   5 端口读取完成         —— 真正执行 INL 0xE000，显示打包值十六进制
 *
 * 第 5 步兼作 todo/vm-resolution-auto-align 01 号文档「第 3 级原生工具」的
 * 权限层实测：若 4 有值而 5 前崩溃，即 ring3 IN 在该环境不可达，§8.3 的最终结论就有了。
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stddef.h>

/* 与 res-agent.c 相同的无 CRT 洁癖：自写 memset/memcpy，防编译器回退成库调用 */
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

static void show(const char *title, const char *msg)
{
    MessageBoxA(NULL, msg, title, MB_OK | MB_ICONINFORMATION);
}

static void append_hex16(char **p, unsigned short v)
{
    static const char digits[] = "0123456789ABCDEF";
    *(*p)++ = digits[(v >> 12) & 0xF];
    *(*p)++ = digits[(v >> 8) & 0xF];
    *(*p)++ = digits[(v >> 4) & 0xF];
    *(*p)++ = digits[v & 0xF];
}

static void append_dec(char **p, unsigned long v)
{
    char tmp[12];
    int n = 0;
    do {
        tmp[n++] = (char)('0' + (v % 10));
        v /= 10;
    } while (v != 0);
    while (n > 0) {
        *(*p)++ = tmp[--n];
    }
}

static unsigned long read_packed_resolution(void)
{
#if defined(__i386__)
    unsigned long value;
    __asm__ __volatile__("inl %1, %0" : "=a"(value) : "Nd"((unsigned short)0xE000));
    return value;
#else
    return 0;
#endif
}

static const DEVMODEA g_zero_mode;

void res_diag_entry(void)
{
    char buffer[160];
    char *p;

    /* 弹框文案全用 ASCII：EXE 里是裸字节，XP 的 MessageBoxA 按系统 ANSI
     * 代码页（zh-CN 是 GBK）解码，UTF-8 中文会变乱码。 */
    show("diag 1/5 process entry",
         "Entered res_diag_entry successfully.\n\n"
         "PE load, imports and relocations all OK.\n"
         "(If this box never shows up, the fault is at load time.)");

    Sleep(1);
    show("diag 2/5 kernel32", "Sleep(1) returned normally - kernel32 imports usable.");

    p = buffer;
    append_dec(&p, 123456UL);
    *p++ = ' ';
    append_dec(&p, 654321UL);
    *p = '\0';
    show("diag 3/5 stack check", buffer);

    /* 显示模式表盘点：条数、最大宽高、当前位深（00 §8.6 的驱动天花板一眼可见） */
    {
        DEVMODEA mode = g_zero_mode;
        DEVMODEA current = g_zero_mode;
        DWORD count = 0;
        DWORD max_w = 0;
        DWORD max_h = 0;
        mode.dmSize = sizeof(mode);
        current.dmSize = sizeof(current);
        while (EnumDisplaySettingsA(NULL, count, &mode)) {
            if (mode.dmPelsWidth > max_w) {
                max_w = mode.dmPelsWidth;
                max_h = mode.dmPelsHeight;
            }
            mode = g_zero_mode;
            mode.dmSize = sizeof(mode);
            count++;
        }
        p = buffer;
        append_dec(&p, count);
        memcpy(p, " modes, max ", 13);
        p += 12;
        append_dec(&p, max_w);
        *p++ = 'x';
        append_dec(&p, max_h);
        memcpy(p, ", bpp ", 7);
        p += 6;
        append_dec(&p,
                   EnumDisplaySettingsA(NULL, ENUM_CURRENT_SETTINGS, &current)
                       ? current.dmBitsPerPel
                       : 0);
        *p = '\0';
        show("diag 4/5 display modes", buffer);
    }

    /* 关键一步：ring3 IN 指令读 0xE000 */
    {
        unsigned long packed = read_packed_resolution();
        p = buffer;
        memcpy(p, "port 0xE000 = 0x", 17);
        p += 16;
        append_hex16(&p, (unsigned short)(packed >> 16));
        append_hex16(&p, (unsigned short)(packed & 0xFFFF));
        memcpy(p, "\n(w<<16)|h packed", 18);
        p += 17;
        *p = '\0';
        show("diag 5/5 port read", buffer);
    }

    ExitProcess(0);
}
