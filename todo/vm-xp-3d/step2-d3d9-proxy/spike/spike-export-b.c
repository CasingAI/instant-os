/* S0 spike B：dllexport + stdcall 直接导出，看 lld-link 给的导出名。
 * 若是 "Direct3DCreate9@4"（带 @n 修饰），就需要链接后 patch 导出表；
 * 若恰好是 "Direct3DCreate9"（lld mingw 模式剥修饰），就零额外机制。 */
#include <windows.h>

__attribute__((dllexport, stdcall)) void *Direct3DCreate9(unsigned int version)
{
    (void)version;
    return (void *)0;
}

int _DllMainCRTStartup(void *hinst, unsigned long reason, void *reserved)
{
    (void)hinst;
    (void)reason;
    (void)reserved;
    return 1;
}
