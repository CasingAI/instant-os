/* vm-xp-3d 阶梯第 0 级前置：编译工具链验证（todo/vm-xp-3d/02 第 3 节）。
 * 什么都不做，只弹一块告示牌，证明「Mac 上 zig 交叉编译的 32 位 GUI exe
 * 能被 XP 加载运行」。文案纯 ASCII，XP 默认代码页可直接显示。
 */
#include <windows.h>

void ivm_hello_entry(void)
{
    MessageBoxA(NULL,
                "Step 1 OK.\n\n"
                "This popup proves the build pipeline works in XP.\n"
                "zig cc -nostdlib / PE 5.01 / imports: kernel32 + user32 only.",
                "vm-xp-3d step1-hello",
                MB_OK | MB_ICONINFORMATION);
    ExitProcess(0);
}
