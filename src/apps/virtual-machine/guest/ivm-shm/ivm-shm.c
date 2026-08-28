/*
 * ivm-shm.sys —— 共享内存信箱驱动（Windows XP 32 位，ring0）。
 *
 * 职责只有一件：开机早期（boot 起动）分配 64KB 连续物理内存
 * （MmAllocateContiguousMemory，非分页池、天然常驻），把「物理基址 +
 * 调用进程的用户态映射」经 DeviceIoControl(IOCTL_IVM_SHM_INFO) 交出去：
 *
 *   [v86 宿主]  read_memory / write_memory 按物理基址直接读写这块内存
 *               （DMA 通道，todo/vm-remote-control/05 §信箱）
 *   [XP 剪贴板桥] clipboard-bridge.exe 按返回的 user_va 直接读写
 *
 * 64KB 布局：低 32KB = 客→主（G2H）信箱，高 32KB = 主→客（H2G）信箱；
 * 每块信箱头 16 字节（magic 'IVMX' / seq / status / len），数据 UTF-16LE，
 * 布局常量与 Instant-virtual-machine src/ivm-shm.ts 一一对应。
 *
 * 数据面零系统调用，驱动里没有线程、DPC、中断；用户态映射按 FILE_OBJECT
 * 缓存（每个进程第一次 ioctl 建立，之后复用），随系统常驻不回收——驱动
 * 不提供卸载（虚拟机场景重开机即回收，泄漏上限是每次开机几个 VAD）。
 *
 * 构建管线与 boxvideo.sys 相同（Open Watcom + ntoskrnl.lib，产物过
 * normalize-boxvnt-pe.mjs 规范化——wlink 的间接 import 调用与 VSize=0 段
 * 必须修掉，否则 XP 加载即蓝屏，见该脚本头注释）。
 *
 * ABI 注记（wdis 实证，2026-08）：
 * - IoCompleteRequest 头文件声明为 FASTCALL，Watcom 生成 mov ecx/mov edx
 *   + 装饰名 @IofCompleteRequest@8，与 x86 ntoskrnl 导出一致，可直接用。
 * - MmGetPhysicalAddress 返回 8 字节结构体：Watcom 走隐藏指针 ABI，
 *   MSVC 内核是 EAX:EDX——直接按头文件声明调用会把隐藏指针当成第一个
 *   参数传进内核。下面用「重命名屏蔽 + 按标量重声明」规避。
 */

#define MmGetPhysicalAddress IVM_HIDE_HEADER_MmGetPhysicalAddress
#include <ntddk.h>
#undef MmGetPhysicalAddress

/* 同一个 ntoskrnl 导出（_MmGetPhysicalAddress@4），按 8 字节标量声明：
 * 返回值走 EAX:EDX，低 32 位即 x86 非 PAE 的物理地址。 */
NTKERNELAPI unsigned __int64 NTAPI MmGetPhysicalAddress(PVOID BaseAddress);

#define IVM_SHM_TOTAL_SIZE 0x10000 /* 64KB = G2H 0x8000 + H2G 0x8000 */

#define IOCTL_IVM_SHM_INFO \
    CTL_CODE(FILE_DEVICE_UNKNOWN, 0x801, METHOD_BUFFERED, FILE_READ_ACCESS)

typedef struct _IVM_SHM_INFO {
    ULONG phys_addr; /* 物理基址：宿主 v86 read_memory/write_memory 的偏移 */
    ULONG user_va;   /* 本次调用进程的用户态映射基址（可直接读写） */
    ULONG size;      /* 总字节数，恒等于 IVM_SHM_TOTAL_SIZE */
} IVM_SHM_INFO;

static PVOID g_buffer;
static PMDL g_mdl;
static ULONG g_phys_addr;

static NTSTATUS ivm_create_close(PDEVICE_OBJECT device, PIRP irp)
{
    (void)device;
    irp->IoStatus.Status = STATUS_SUCCESS;
    irp->IoStatus.Information = 0;
    IoCompleteRequest(irp, IO_NO_INCREMENT);
    return STATUS_SUCCESS;
}

static NTSTATUS ivm_device_control(PDEVICE_OBJECT device, PIRP irp)
{
    NTSTATUS status;
    PIO_STACK_LOCATION stack;
    IVM_SHM_INFO *out;
    PVOID mapped;
    (void)device;

    stack = IoGetCurrentIrpStackLocation(irp);

    if (stack->Parameters.DeviceIoControl.IoControlCode != IOCTL_IVM_SHM_INFO) {
        status = STATUS_INVALID_DEVICE_REQUEST;
        irp->IoStatus.Information = 0;
        goto done;
    }
    if (stack->Parameters.DeviceIoControl.OutputBufferLength < sizeof(IVM_SHM_INFO)) {
        status = STATUS_BUFFER_TOO_SMALL;
        irp->IoStatus.Information = sizeof(IVM_SHM_INFO);
        goto done;
    }

    /* 用户态映射按 FILE_OBJECT 缓存：同一进程反复查询也只建一次。
     * 映射挂在 MDL 上与句柄无关，进程退出后依然有效（有意为之，见头注释）。 */
    if (stack->FileObject->FsContext == NULL) {
        mapped = MmMapLockedPagesSpecifyCache(
            g_mdl, UserMode, MmCached, NULL, FALSE, NormalPagePriority);
        if (mapped == NULL) {
            status = STATUS_INSUFFICIENT_RESOURCES;
            irp->IoStatus.Information = 0;
            goto done;
        }
        stack->FileObject->FsContext = mapped;
    }

    out = (IVM_SHM_INFO *)irp->AssociatedIrp.SystemBuffer;
    out->phys_addr = g_phys_addr;
    out->user_va = (ULONG)stack->FileObject->FsContext;
    out->size = IVM_SHM_TOTAL_SIZE;
    irp->IoStatus.Information = sizeof(IVM_SHM_INFO);
    status = STATUS_SUCCESS;

done:
    irp->IoStatus.Status = status;
    IoCompleteRequest(irp, IO_NO_INCREMENT);
    return status;
}

NTSTATUS DriverEntry(PDRIVER_OBJECT driver, PUNICODE_STRING registry)
{
    UNICODE_STRING devname;
    UNICODE_STRING symname;
    PDEVICE_OBJECT device;
    PHYSICAL_ADDRESS high;
    NTSTATUS status;
    volatile ULONG *zero;
    ULONG words;
    ULONG i;
    (void)registry;

    RtlInitUnicodeString(&devname, L"\\Device\\IVMSHM");
    RtlInitUnicodeString(&symname, L"\\??\\IVMSHM");

    status = IoCreateDevice(driver, 0, &devname, FILE_DEVICE_UNKNOWN, 0, FALSE, &device);
    if (!NT_SUCCESS(status)) {
        return status;
    }
    status = IoCreateSymbolicLink(&symname, &devname);
    if (!NT_SUCCESS(status)) {
        IoDeleteDevice(device);
        return status;
    }

    high.LowPart = 0xFFFFFFFF;
    high.HighPart = 0; /* x86 非 PAE：物理地址 32 位封顶 */
    g_buffer = MmAllocateContiguousMemory((SIZE_T)IVM_SHM_TOTAL_SIZE, high);
    if (g_buffer == NULL) {
        IoDeleteSymbolicLink(&symname);
        IoDeleteDevice(device);
        return STATUS_INSUFFICIENT_RESOURCES;
    }
    g_phys_addr = (ULONG)MmGetPhysicalAddress(g_buffer);

    /* 连续内存分配不清零：整块写一遍 0，两个信箱从干净的 0 态起步。 */
    zero = (volatile ULONG *)g_buffer;
    words = IVM_SHM_TOTAL_SIZE / 4;
    for (i = 0; i < words; i++) {
        zero[i] = 0;
    }

    g_mdl = IoAllocateMdl(g_buffer, IVM_SHM_TOTAL_SIZE, FALSE, FALSE, NULL);
    if (g_mdl == NULL) {
        IoDeleteSymbolicLink(&symname);
        IoDeleteDevice(device);
        return STATUS_INSUFFICIENT_RESOURCES;
    }
    MmBuildMdlForNonPagedPool(g_mdl);

    driver->MajorFunction[IRP_MJ_CREATE] = ivm_create_close;
    driver->MajorFunction[IRP_MJ_CLOSE] = ivm_create_close;
    driver->MajorFunction[IRP_MJ_DEVICE_CONTROL] = ivm_device_control;
    device->Flags &= ~DO_DEVICE_INITIALIZING;
    /* 不设 DriverUnload：常驻到关机（用户态映射无法安全撤销，见头注释）。 */
    return STATUS_SUCCESS;
}
