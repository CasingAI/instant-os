/* S0 spike：验证 32 位 stdcall 函数能否以无修饰名 Direct3DCreate9 导出。
 *
 * XP 加载器/GetProcAddress 按名字 Direct3DCreate9（无下划线、无 @4）查找，
 * 而 i386 stdcall 符号天生是 _ivm_d3d9_create@4。本文件试 drectve 通道：
 * clang 把 #pragma comment(linker, "/EXPORT:...") 写进 .drectve 段，
 * lld-link 链接时处理为重命名导出。若不支持，退回链接后 patch 导出表。
 * 结果查证：llvm-objdump -p spike-a.dll 看 Export 表的 Name 列。
 */
#include <windows.h>

__attribute__((stdcall)) void *ivm_d3d9_create(unsigned int version)
{
    (void)version;
    return (void *)0;
}

#pragma comment(linker, "/EXPORT:Direct3DCreate9=_ivm_d3d9_create@4")

/* -nostdlib -shared 下 lld-link 的缺省 DLL 入口；cdecl 非 static，
 * 符号正好是 _DllMainCRTStartup。loader lock 内不许做任何事。 */
int _DllMainCRTStartup(void *hinst, unsigned long reason, void *reserved)
{
    (void)hinst;
    (void)reason;
    (void)reserved;
    return 1;
}
