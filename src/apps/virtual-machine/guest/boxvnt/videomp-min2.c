/*****************************************************************************
 * videomp-min2.c — boxvnt BSOD 排查探针驱动 #2（调试会话产物，定案后删除）
 *
 * 与 min1 的区别：零导入。不链 videoprt.lib、没有 vidmpdat/boxv、没有资源。
 * DriverEntry 只做一件事：用裸 out 指令把 "[IVM]MIN2-ENTRY=1\r\n" 写到 COM1
 * (0x3F8)，然后返回 STATUS_UNSUCCESSFUL 干净退出（不初始化任何东西）。
 *
 * 它回答的问题是：XP 能否映射并执行我们 Watcom 链接的镜像、并把控制权
 * 交到入口点？——答案完全不受 import/thunk/重定位解析路径的影响。
 * 若 COM1 上出现 MIN2-ENTRY：镜像加载 + 入口执行没问题 → 祸根在导入调用
 * 路径或更深的初始化；若连它都崩：加载器层面就拒了整类镜像。
 *****************************************************************************/

typedef unsigned long   ULONG;

/* 裸端口写：不经过任何导入。parm [dx] [al] → 调用方把端口号装 DX、数据装 AL。 */
extern void vmpOut( unsigned short port, unsigned char val );
#pragma aux vmpOut = "out dx, al" parm [dx] [al];

static const char   msg[] = "[IVM]MIN2-ENTRY=1\r\n";

ULONG DriverEntry( void *Context1, void *Context2 )
{
    const char  *p = msg;

    (void)Context1; (void)Context2;
    vmpOut( 0x3FB, 0x03 );                  /* 8N1，DLAB off */
    while( *p )
        vmpOut( 0x3F8, (unsigned char)*p++ );
    return( 0xC0000001ul );                 /* STATUS_UNSUCCESSFUL：干净失败 */
}
