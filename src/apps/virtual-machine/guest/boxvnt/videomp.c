/*****************************************************************************

Copyright (c) 2012  Michal Necasek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

*****************************************************************************/

/*
 * Windows NT Video Miniport for the VirtualBox/bochs/qemu SVGA adapter.
 * This miniport programs the hardware directly and does not use or require
 * the video BIOS or VBE.
 *
 * NB: This is not a "VGA compatible" miniport and standard VGA modes are
 * handled by the default VGA miniport.
 *
 * ---------------------------------------------------------------------------
 * Instant VM changes: architecture in one screen.
 *
 * Call chain, top to bottom:
 *
 *   win32k (GDI) --IOCTL--> video port driver --VRP--> HwVidStartIO (here)
 *     --BOXV_ext_mode_set--> dispi registers 0x1CE/0x1CF --> v86 vga.js
 *     --> host canvas resize.
 *
 * The mode list win32k sees has three layers:
 *   1. VideoModes[] static table (vidmpdat.c): 19 classic resolutions x 5
 *      depths + a dense 8px-step 32bpp ladder (821 entries total) - any
 *      8-aligned target snaps to <=4px even with zero host support.
 *   2. The dynamic mode (this file, vmpRefreshDynamicMode): the host
 *      publishes an exact WxH on IO ports 0xE001/0xE002/0xE003 (16-bit
 *      reads each; 0xE003 carries magic 0x5AB0 as presence detection).
 *      Listed at tail index ulAllModes+DynamicModeSlot, alternating slots
 *      on target change (VirtualBox XPDM trick - win32k ignores a mode
 *      change when the index stays the same).
 *   3. LastDyn*: the last accepted dynamic target, so a stale tail index
 *      cached by win32k still resolves ("already on the wire") instead of
 *      failing after RESET_DEVICE or host switch-off.
 *
 * Every entry point and every error exit logs an [IVM]<tag>=<hex> line to
 * COM1 (vmplog.c, import-free). On a bugcheck the last line before silence
 * marks the crash site; the tag registry and the triage playbook live in
 * guest/boxvnt/ARCHITECTURE.md.
 * ---------------------------------------------------------------------------
 */

#include <miniport.h>
#include <ntddvdeo.h>
#include <video.h>
#include <stddef.h>

#include "videomp.h"
#include "boxv.h"
#include "vmplog.h"

/* Accommodate incomplete DDK headers shipped with Open Watcom 1.9. */
#ifndef SIZE_OF_NT4_VIDEO_HW_INITIALIZATION_DATA

#define SIZE_OF_NT4_VIDEO_HW_INITIALIZATION_DATA    FIELD_OFFSET( VIDEO_HW_INITIALIZATION_DATA, HwStartDma )
#define SIZE_OF_W2K_VIDEO_HW_INITIALIZATION_DATA    FIELD_OFFSET( VIDEO_HW_INITIALIZATION_DATA, Reserved )
#define SIZE_OF_WXP_VIDEO_HW_INITIALIZATION_DATA    (SIZE_OF_W2K_VIDEO_HW_INITIALIZATION_DATA + sizeof( ULONG ))

#include <winerror.h>   /* This should really be dderror.h... */

#else

#include <dderror.h>

#endif

/* Number of PCI access ranges. */
#define NUM_PCI_RANGES      3

/* RGB color channel constants. */
typedef enum {
    CHANNEL_RED,
    CHANNEL_GREEN,
    CHANNEL_BLUE
} COLOR_CHANNEL;

/* Instant VM changes: dimension validation reason codes. Logged as-is on
 * reject (VSVB from IOCTL_VIDEO_SET_CURRENT_MODE, VDMJ-1 from the dynamic
 * refresh; see ARCHITECTURE.md for the meaning table). */
#define VMP_DIM_OK        0   /* dimensions accepted */
#define VMP_DIM_BAD_BPP   1   /* bpp not in {8,15,16,24,32} */
#define VMP_DIM_W_RANGE   2   /* width outside 640..2560 */
#define VMP_DIM_H_RANGE   3   /* height outside 480..1600 */
#define VMP_DIM_W_ALIGN   4   /* width not divisible by 8 (dispi contract) */
#define VMP_DIM_VRAM      5   /* pitch*height exceeds video memory */

#if defined( ALLOC_PRAGMA )
#pragma alloc_text( PAGE, DriverEntry )
#pragma alloc_text( PAGE, HwVidFindAdapter )
#pragma alloc_text( PAGE, HwVidInitialize )
#pragma alloc_text( PAGE, HwVidStartIO )
#endif
/* NB: boxvideo.lnk links every CODE/DATA segment nonpageable, so the
 * pragmas above are decorative - nothing in this driver can be paged out,
 * which is also why running at DISPATCH_LEVEL is safe. */


/* Calculate pitch based on scanline length and bit depth. */
static ULONG vmpPitchByBpp( ULONG Length, UCHAR Bpp )
{
    ULONG   ulPitch = 0;

    switch( Bpp ) {
    case 4:
        ulPitch = (Length + 1) / 2;
        break;
    case 8:
        ulPitch = Length;
        break;
    case 15:
    case 16:
        ulPitch = Length * 2;
        break;
    case 24:
        ulPitch = Length * 3;
        break;
    case 32:
        ulPitch = Length * 4;
        break;
    }
    return( ulPitch );
}


/* Instant VM changes: one validation truth for every path that turns W/H/Bpp
 * into hardware programming - the static table at FindAdapter time, the
 * dynamic mode at refresh time, and the re-check inside SET_CURRENT_MODE.
 * Returns a VMP_DIM_* reason code (0 = accepted). */
static unsigned vmpCheckDims( ULONG W, ULONG H, UCHAR Bpp, ULONG FramebufLen )
{
    ULONG   ulModeMem;

    switch( Bpp ) {
    case 8:
    case 15:
    case 16:
    case 24:
    case 32:
        break;
    default:
        return( VMP_DIM_BAD_BPP );
    }
    if( W < VMP_MODE_MIN_W || W > VMP_MODE_MAX_W )
        return( VMP_DIM_W_RANGE );
    if( H < VMP_MODE_MIN_H || H > VMP_MODE_MAX_H )
        return( VMP_DIM_H_RANGE );
    /* Horizontal resolution must be divisible by 8 (dispi grid contract). */
    if( W % 8 )
        return( VMP_DIM_W_ALIGN );
    ulModeMem = vmpPitchByBpp( W, Bpp ) * H;
    if( ulModeMem > FramebufLen )
        return( VMP_DIM_VRAM );
    return( VMP_DIM_OK );
}

/* Validate a given mode and set the appropriate flag. Note that the
 * validation criteria are somewhat arbitrary.
 */
static void vmpValidateMode( PVIDEOMP_MODE Mode, ULONG FramebufLen )
{
    Mode->bValid = (vmpCheckDims( Mode->HorzRes, Mode->VertRes,
                                  Mode->Bpp, FramebufLen ) == VMP_DIM_OK);
}

/* Instant VM changes: remember the last accepted dynamic target so stale
 * tail-slot indices stay resolvable after the live slot is torn down. */
static void vmpSetLastDyn( PHW_DEV_EXT pExt, USHORT W, USHORT H, UCHAR Bpp )
{
    pExt->LastDynW    = W;
    pExt->LastDynH    = H;
    pExt->LastDynBpp  = Bpp;
    pExt->HaveLastDyn = 1;
}

/* Instant VM changes: read a 16-bit host-published IO port. On x86 the HAL
 * accepts unmapped port addresses (IOAddrVGA is NULL), so the port number
 * can be used directly, same as the boxv_io.h accessors. */
static unsigned vmpInHostPort16( PHW_DEV_EXT pExt, unsigned port )
{
    return( VideoPortReadPortUshort( (PUSHORT)(pExt->IOAddrVGA + port) ) );
}

/* Instant VM changes: refresh the dynamic mode slot from the host ports.
 * Called before both mode-list queries (see the IOCTL handlers for why
 * refreshing inside QUERY_AVAIL_MODES too is safe). The slot never mutates
 * elsewhere, so a QUERY_NUM_AVAIL_MODES/QUERY_AVAIL_MODES pair always stays
 * consistent.
 * No host (or switch off) reads 0xFFFF, fails the magic, and leaves the
 * miniport with zero dynamic modes - byte-for-byte upstream behavior.
 * The pending mode alternates between the two tail slots on every target
 * change, mirroring VirtualBox's XPDM miniport: a mode that reappears at
 * the same index makes Windows ignore the mode change call
 * ("We need to alternate mode index entry for a pending mode change, else
 * windows will ignore actual mode change call", VBoxMPVidModes.cpp). */
static void vmpRefreshDynamicMode( PHW_DEV_EXT pExt )
{
    USHORT              w, h;
    const VIDEOMP_MODE  *pCur;
    unsigned            reason;

    if( vmpInHostPort16( pExt, VMP_PORT_MODE_MAGIC ) != VMP_MODE_MAGIC ) {
        /* 0xFFFF = the runtime is not publishing (absent or switch off).
         * Silent while nothing is live (the normal no-driver-support boot),
         * logged once when a live dynamic mode disappears. */
        if( pExt->NumDynamicModes ) {
            pExt->NumDynamicModes = 0;
            VmpLog( "VDMJ", 0 );
        }
        return;
    }

    w = (USHORT)vmpInHostPort16( pExt, VMP_PORT_MODE_W );
    h = (USHORT)vmpInHostPort16( pExt, VMP_PORT_MODE_H );
    VmpLog( "VDMT", ((ULONG)w << 16) | h );

    reason = vmpCheckDims( w, h, 32, pExt->FramebufLen );
    if( reason != VMP_DIM_OK ) {
        pExt->NumDynamicModes = 0;
        VmpLog( "VDMJ", reason );
        return;
    }

    /* Same target again: keep the slot (and its mode index) untouched. */
    if( pExt->NumDynamicModes ) {
        pCur = &pExt->DynamicModes[pExt->DynamicModeSlot];
        if( pCur->HorzRes == w && pCur->VertRes == h )
            return;
    }

    /* New target: publish it in the other slot so its mode index differs
     * from the previously applied one. */
    pExt->DynamicModeSlot ^= 1;
    pExt->DynamicModes[pExt->DynamicModeSlot].HorzRes = w;
    pExt->DynamicModes[pExt->DynamicModeSlot].VertRes = h;
    pExt->DynamicModes[pExt->DynamicModeSlot].Bpp = 32;
    pExt->DynamicModes[pExt->DynamicModeSlot].bValid = TRUE;
    pExt->NumDynamicModes = 1;
    vmpSetLastDyn( pExt, w, h, 32 );
    VmpLog( "VDMA", (pExt->DynamicModeSlot << 16) | pExt->NumDynamicModes );
}

/* Instant VM changes: resolve a mode index (static table or a dynamic tail
 * slot) to its dimensions. Also fixes an upstream off-by-one that let
 * modeNumber == ulAllModes index one past the end of VideoModes[].
 * Both tail indices resolve while any dynamic state exists: win32k caches
 * the mode list per-PDEV, so after a target change flips the slot it may
 * still SET the stale index - that must apply the current target rather
 * than fail (resolution changes would silently stick otherwise). With the
 * live slot torn down (RESET_DEVICE / host off), the last accepted target
 * answers instead - "the mode it names is already on the wire". */
static BOOLEAN vmpGetModeDims( PHW_DEV_EXT pExt, ULONG modeNumber,
                               PUSHORT pHRes, PUSHORT pVRes, PUCHAR pBpp )
{
    const VIDEOMP_MODE  *pDyn;

    if( modeNumber < ulAllModes ) {
        *pHRes = VideoModes[modeNumber].HorzRes;
        *pVRes = VideoModes[modeNumber].VertRes;
        *pBpp = VideoModes[modeNumber].Bpp;
        return( VideoModes[modeNumber].bValid );
    }
    if( (modeNumber == ulAllModes || modeNumber == ulAllModes + 1) ) {
        if( pExt->NumDynamicModes ) {
            pDyn = &pExt->DynamicModes[pExt->DynamicModeSlot];
            *pHRes = pDyn->HorzRes;
            *pVRes = pDyn->VertRes;
            *pBpp = pDyn->Bpp;
            return( TRUE );
        }
        if( pExt->HaveLastDyn ) {
            *pHRes = pExt->LastDynW;
            *pVRes = pExt->LastDynH;
            *pBpp = pExt->LastDynBpp;
            return( TRUE );
        }
    }
    return( FALSE );
}

/* Determine whether the supported adapter is present. Note that this
 * function is not allowed to change the state of the adapter!
 */
VP_STATUS HwVidFindAdapter( PVOID HwDevExt, PVOID HwContext, PWSTR ArgumentString,
                            PVIDEO_PORT_CONFIG_INFO ConfigInfo, PUCHAR Again )
{
    PHW_DEV_EXT             pExt = HwDevExt;
    PVOID                   *pVirtAddr;
    ULONG                   i;
    INT                     chip_id;
    VP_STATUS               status;
    ULONG                   cbVramSize;
    PWSTR                   pwszDesc;
    ULONG                   cbDesc;
#ifdef USE_GETACCESSRANGES
    VIDEO_ACCESS_RANGE      pciAccessRanges[NUM_PCI_RANGES];
    USHORT                  usVendorId = BOXV_PCI_VEN;
    USHORT                  usDeviceId = BOXV_PCI_DEV;
    ULONG                   ulSlot = 0;
#endif

    //@todo: The framebuffer address should not be hardcoded for non-PCI access
#define NUM_ACCESS_RANGES   2
    VIDEO_ACCESS_RANGE accessRanges[NUM_ACCESS_RANGES] = {
        /* StartLo     StartHi     Len       IO Vis Shr */
        { 0x000001CE, 0x00000000, 0x00000002, 1, 1, 0 },    /* I/O ports */
        { 0xE0000000, 0x00000000, 0x00400000, 0, 1, 0 }     /* Framebuffer */
    };

    VideoDebugPrint( (1, "videomp: HwVidFindAdapter\n") );
    VmpLog( "VFA0", 0 );                    /* debug: FindAdapter entered */

    /* Fail if the passed structure is smaller than the NT 3.1 version. */
    if( ConfigInfo->Length < offsetof( VIDEO_PORT_CONFIG_INFO, DmaChannel ) ) {
        VmpLog( "VFAc", ConfigInfo->Length );
        return( ERROR_INVALID_PARAMETER );
    }

    /* Sadly, VideoPortGetAccessRanges was not present in NT 3.1. There is no
     * reasonably simple way to dynamically import port driver routines on
     * newer versions, so we'll just do without.
     */
#ifdef USE_GETACCESSRANGES
    /* If PCI is supported, query the bus for resource mappings. */
    if( ConfigInfo->AdapterInterfaceType == PCIBus ) {
        /* Ask for bus specific access ranges. */
        VideoPortZeroMemory( pciAccessRanges, sizeof( pciAccessRanges ) );
        status = VideoPortGetAccessRanges( HwDevExt, 0, NULL,
                                           NUM_PCI_RANGES, pciAccessRanges,
                                           &usVendorId, &usDeviceId, &ulSlot );
        if( status == NO_ERROR ) {
            VideoDebugPrint( (1, "videomp: Found adapter in PCI slot %d\n", ulSlot) );
            pExt->ulSlot = ulSlot;
            /* The framebuffer is in the first slot of the PCI ranges. Copy
             * the data into the access ranges we're going to request.
             */
            accessRanges[1].RangeStart  = pciAccessRanges[0].RangeStart;
            accessRanges[1].RangeLength = pciAccessRanges[0].RangeLength;
        } else {
            /* On NT versions without PCI support, we won't even attempt this.
             * So if we tried to query the PCI device and failed to find it,
             * it really isn't there and we have to give up.
             */
            VideoDebugPrint( (1, "videomp: PCI adapter not found\n") );
            VmpLog( "VFAn", status );
            return( ERROR_DEV_NOT_EXIST );
        }
    }
#endif

    /* Some versions of vga.sys trap accesses to ports 0x1CE-0x1CF used on
     * old ATI cards. On Windows 2000 and later we can report legacy
     * resources to resolve this conflict. On NT 4 and older, we use a hack
     * and claim other, non-conflicting ports.
     */
    if( PortVersion < VP_VER_W2K )
        accessRanges[0].RangeStart = RtlConvertUlongToLargeInteger( 0x1CC );

    /* Check for a conflict in case someone else claimed our resources. */
    status = VideoPortVerifyAccessRanges( HwDevExt, NUM_ACCESS_RANGES, accessRanges );
    if( status != NO_ERROR ) {
        VmpLog( "VFAr", status );           /* debug: range claim failed */
        return( status );
    }
    VmpLog( "VFA1", status );               /* debug: ranges verified */

    /* Indicate no emulator support. */
    ConfigInfo->NumEmulatorAccessEntries     = 0;
    ConfigInfo->EmulatorAccessEntries        = NULL;
    ConfigInfo->EmulatorAccessEntriesContext = 0;

    ConfigInfo->HardwareStateSize = 0;

    ConfigInfo->VdmPhysicalVideoMemoryAddress.LowPart  = 0;
    ConfigInfo->VdmPhysicalVideoMemoryAddress.HighPart = 0;
    ConfigInfo->VdmPhysicalVideoMemoryLength           = 0;

    /* Describe the framebuffer. We claimed the range already. */
    pExt->PhysicalFrameAddress = accessRanges[1].RangeStart;


    /*
     * Map all memory and I/O ranges into system virtual address space.
     * NB: The virtual addresses in the HwDevExt must match the number
     * and type of AccessRange entries.
     */
    pVirtAddr = &pExt->IoPorts;

    /* Attempt to claim and map the memory and I/O address ranges. */
    for( i = 0; i < NUM_ACCESS_RANGES; ++i, ++pVirtAddr ) {
        *pVirtAddr = VideoPortGetDeviceBase( pExt,
                                             accessRanges[i].RangeStart,
                                             accessRanges[i].RangeLength,
                                             accessRanges[i].RangeInIoSpace );
        if( *pVirtAddr == NULL ) {
            VmpLog( "VFAm", i );            /* debug: map failed, range # */
            return( ERROR_INVALID_PARAMETER );
        }
    }
    VmpLog( "VFA2", NUM_ACCESS_RANGES );    /* debug: ranges mapped */

    /* Verify that supported hardware is present. */
    chip_id = BOXV_detect( pExt, &pExt->FramebufLen );
    VmpLog( "VFA3", (ULONG)chip_id );       /* debug: dispi chip id */
    VmpLog( "VFA4", pExt->FramebufLen );    /* debug: reported vram bytes */
    if( !chip_id ) {
        /* If supported hardware was not found, free allocated resources. */
        pVirtAddr = &pExt->IoPorts;
        for( i = 0; i < NUM_ACCESS_RANGES; ++i, ++pVirtAddr )
            VideoPortFreeDeviceBase( pExt, *pVirtAddr );

        VmpLog( "VFAd", 0 );                /* debug: adapter not detected */
        return( ERROR_DEV_NOT_EXIST );
    }
    if( !pExt->FramebufLen ) {
        /* Instant VM changes: a detected adapter reporting zero VRAM would
         * turn every mode invalid; fail loudly instead of limping. */
        VmpLog( "VFAl", 0 );
        return( ERROR_DEV_NOT_EXIST );
    }
    if( pExt->FramebufLen > 0x00400000 ) {
        /* Instant VM changes: informational only - we map by physical
         * address beyond the 4MB range we claimed (upstream quirk, kept
         * deliberately; see ARCHITECTURE.md "known edges"). */
        VmpLog( "VFAf", pExt->FramebufLen );
    }

    /* We need to access VGA and other I/O ports. Fortunately the HAL doesn't
     * care at all how the I/O ports are or aren't mapped on x86 platforms.
     */
    pExt->IOAddrVGA = NULL;

    /* Only support one attached monitor. */
    pExt->NumMonitors = 1;

    /* Set up mode information. */
    pExt->CurrentModeNumber = 0;
    pExt->NumValidModes     = 0;
    pExt->NumDynamicModes   = 0;    /* Instant VM changes */
    pExt->DynamicModeSlot   = 1;    /* Instant VM changes: first target lands in slot 0 */
    pExt->HaveLastDyn       = 0;    /* Instant VM changes */

    for( i = 0; i < ulAllModes; ++i ) {
        vmpValidateMode( &VideoModes[i], pExt->FramebufLen );
        if( VideoModes[i].bValid )
            ++pExt->NumValidModes;
    }
    VmpLog( "VFA5", pExt->NumValidModes );  /* debug: static modes valid */

    /* Only one adapter supported, no need to call us again. */
    *Again = 0;

    /* Report the hardware names via registry. */

#define TEMP_CHIP_NAME  L"bochs Mk II"
    pwszDesc = TEMP_CHIP_NAME;
    cbDesc   = sizeof( TEMP_CHIP_NAME );

    VideoPortSetRegistryParameters( pExt, L"HardwareInformation.ChipType",
                                    pwszDesc, cbDesc );

#define TEMP_DAC_NAME  L"Integrated DAC"
    pwszDesc = TEMP_DAC_NAME;
    cbDesc   = sizeof( TEMP_DAC_NAME );

    VideoPortSetRegistryParameters( pExt, L"HardwareInformation.DacType",
                                    pwszDesc, cbDesc );

#define TEMP_ADAPTER_NAME  L"VirtualBox/bochs"
    pwszDesc = TEMP_ADAPTER_NAME;
    cbDesc   = sizeof( TEMP_ADAPTER_NAME );

    VideoPortSetRegistryParameters( pExt, L"HardwareInformation.AdapterString",
                                    pwszDesc, cbDesc );

    cbVramSize = pExt->FramebufLen;
    VideoPortSetRegistryParameters( pExt, L"HardwareInformation.MemorySize",
                                    &cbVramSize, sizeof( ULONG ) );
    VmpLog( "VFA6", 0xF9F9F9F9ul );         /* debug: FindAdapter ok */
    /* All is well. */
    return( NO_ERROR );
}


/* Perform one-time device initialization. Once this function has been
 * entered, the miniport may change adapter state.
 */
BOOLEAN HwVidInitialize( PVOID HwDevExt )
{
    VideoDebugPrint( (1, "videomp: HwVidInitialize\n") );
    VmpLog( "VINI", 1 );                    /* debug: HwInitialize */
    return( TRUE );
}


/* Determine pixel mask given color depth and color channel. */
static ULONG vmpMaskByBpp( UCHAR Bpp, COLOR_CHANNEL Channel )
{
    ULONG   ulMask;

    switch( Bpp ) {
    case 24:
    case 32:
        ulMask = 0x00FF0000 >> (Channel * 8);
        break;
    case 15:
        ulMask = 0x00007C00 >> (Channel * 5);
        break;
    case 16:
        switch( Channel ) {
        case CHANNEL_RED:
            ulMask = 0x0000F800;
            break;
        case CHANNEL_GREEN:
            ulMask = 0x000007E0;
            break;
        case CHANNEL_BLUE:
            ulMask = 0x0000001F;
            break;
        }
        break;
    case 4:
    case 8:
    default:
        ulMask = 0;     /* Palettized modes don't have a mask. */
    }

    return( ulMask );
}

/* Fill out NT specific video mode information struct based on resolution
 * and color depth.
 */
static void vmpFillModeInfo( PVIDEO_MODE_INFORMATION ModeInfo, USHORT HRes, USHORT VRes, UCHAR Bpp)
{
    /* First the basic mode information. */
    ModeInfo->Length          = sizeof( VIDEO_MODE_INFORMATION );
    ModeInfo->ModeIndex       = 0;      /* Filled in later. */
    ModeInfo->VisScreenWidth  = HRes;   /* Horizontal resolution in pixels. */
    ModeInfo->VisScreenHeight = VRes;   /* Vertical resolution in pixels. */

    /* Assume no rounding is necessary. */
    ModeInfo->ScreenStride    = vmpPitchByBpp( HRes, Bpp );

    ModeInfo->NumberOfPlanes  = 1;      /* Always one plane - packed pixel only. */
    ModeInfo->BitsPerPlane    = Bpp;    /* Number of bits per pixel. */
    ModeInfo->Frequency       = 60;     /* Irrelevant; just make something up. */

    /* Screen size is made up, but should correspond to aspect ratio. */
    ModeInfo->XMillimeter     = 320;
    ModeInfo->YMillimeter     = ModeInfo->XMillimeter * VRes / HRes;

    /* The DAC always works with 8 bits per channel. */
    ModeInfo->NumberRedBits   = 8;      /* Red pixels in DAC. */
    ModeInfo->NumberGreenBits = 8;      /* Green pixels in DAC. */
    ModeInfo->NumberBlueBits  = 8;      /* Blue pixels in DAC. */

    /* Pixel mask depends on color depth. */
    ModeInfo->RedMask         = vmpMaskByBpp( Bpp, CHANNEL_RED );
    ModeInfo->GreenMask       = vmpMaskByBpp( Bpp, CHANNEL_GREEN );
    ModeInfo->BlueMask        = vmpMaskByBpp( Bpp, CHANNEL_BLUE );

    /* Mode attributes are only different for 8bpp modes. */
    ModeInfo->AttributeFlags      = VIDEO_MODE_GRAPHICS | VIDEO_MODE_COLOR;
    if( Bpp <= 8 )
        ModeInfo->AttributeFlags |= VIDEO_MODE_PALETTE_DRIVEN | VIDEO_MODE_MANAGED_PALETTE;

    /* Strictly speaking, the following don't need to be filled out. */
    ModeInfo->VideoMemoryBitmapWidth       = 0;
    ModeInfo->VideoMemoryBitmapHeight      = 0;
    ModeInfo->DriverSpecificAttributeFlags = 0;
}

/* Main I/O request handler routine. */
BOOLEAN HwVidStartIO( PVOID HwDevExt, PVIDEO_REQUEST_PACKET ReqPkt )
{
    PHW_DEV_EXT                         pExt = HwDevExt;
    VP_STATUS                           status = NO_ERROR;
    PVIDEO_MODE_INFORMATION             modeInfo;
    PVIDEO_MEMORY                       vidMem;
    PVIDEO_SHARE_MEMORY                 pShrMem;
    PVOID                               virtualAddress;
    ULONG                               inIoSpace;
    ULONG                               modeNumber;
    ULONG                               ulLen;
    ULONG                               i;
    USHORT                              usHRes, usVRes; /* Instant VM changes */
    UCHAR                               ucBpp;          /* Instant VM changes */
    int                                 rc;             /* Instant VM changes */
    unsigned                            reason;         /* Instant VM changes */

    VideoDebugPrint( (2, "videomp: HwVidStartIO: ") );
    VmpLog( "VSTI", ReqPkt->IoControlCode );        /* debug: StartIO entry */

    /* Instant VM changes: device-extension self-check. If memory corruption
     * ever lands here, fail safe to "no dynamic modes" instead of indexing
     * garbage slots - logged loudly so the corruption is visible. */
    if( pExt->NumDynamicModes > 1 || pExt->DynamicModeSlot > 1 ) {
        VmpLog( "VEXT", (pExt->NumDynamicModes << 16) | pExt->DynamicModeSlot );
        pExt->NumDynamicModes = 0;
        pExt->DynamicModeSlot = 1;
    }

    /* Process the VRP. Required requests are handled first. */
    switch( ReqPkt->IoControlCode ) {
    case IOCTL_VIDEO_QUERY_NUM_AVAIL_MODES:
    {
        PVIDEO_NUM_MODES        numModes;

        VideoDebugPrint( (2, "QUERY_NUM_AVAIL_MODES\n") );
        vmpRefreshDynamicMode( pExt );   /* Instant VM changes */
        if( ReqPkt->OutputBufferLength < sizeof( VIDEO_NUM_MODES ) ) {
            VmpLog( "VMBF", ReqPkt->OutputBufferLength );
            status = ERROR_INSUFFICIENT_BUFFER;
        } else {
            ReqPkt->StatusBlock->Information = sizeof( VIDEO_NUM_MODES );
            numModes = (PVIDEO_NUM_MODES)ReqPkt->OutputBuffer;
            numModes->ModeInformationLength = sizeof( VIDEO_MODE_INFORMATION );
            numModes->NumModes = pExt->NumValidModes + pExt->NumDynamicModes;
            VmpLog( "VNUM", numModes->NumModes );   /* debug: mode count */
        }
        break;
    }

    case IOCTL_VIDEO_QUERY_AVAIL_MODES:
        VideoDebugPrint( (2, "QUERY_AVAIL_MODES\n") );
        /* Instant VM changes: refresh here too. win32k always sends
         * QUERY_NUM first, so this is a same-target no-op in practice;
         * if the host did change the target in between, refreshing keeps
         * the list consistent with what a subsequent SET will resolve,
         * and the length check below guards the buffer either way. */
        vmpRefreshDynamicMode( pExt );
        ulLen = (pExt->NumValidModes + pExt->NumDynamicModes)
                    * sizeof( VIDEO_MODE_INFORMATION );   /* Instant VM changes */
        if( ReqPkt->OutputBufferLength < ulLen ) {
            VmpLog( "VMBF", ReqPkt->OutputBufferLength );
            status = ERROR_INSUFFICIENT_BUFFER;
        } else {
            ReqPkt->StatusBlock->Information = ulLen;
            modeInfo = ReqPkt->OutputBuffer;
            for( i = 0; i < ulAllModes; ++i ) {
                if( VideoModes[i].bValid ) {
                    vmpFillModeInfo( modeInfo, VideoModes[i].HorzRes,
                                     VideoModes[i].VertRes, VideoModes[i].Bpp );
                    modeInfo->ModeIndex = i; //VideoModes[i].modeInformation.ModeIndex;

                    modeInfo++;
                }
            }
            /* Instant VM changes: append the dynamic mode (if any) at the
             * slot it currently occupies - see vmpRefreshDynamicMode. */
            if( pExt->NumDynamicModes ) {
                vmpFillModeInfo( modeInfo,
                                 pExt->DynamicModes[pExt->DynamicModeSlot].HorzRes,
                                 pExt->DynamicModes[pExt->DynamicModeSlot].VertRes,
                                 pExt->DynamicModes[pExt->DynamicModeSlot].Bpp );
                modeInfo->ModeIndex = ulAllModes + pExt->DynamicModeSlot;
            }
            VmpLog( "VLST", ulLen );        /* debug: list bytes */
        }
        break;

    case IOCTL_VIDEO_QUERY_CURRENT_MODE:
        VideoDebugPrint( (2, "QUERY_CURRENT_MODE\n") );
        if( ReqPkt->OutputBufferLength < sizeof( VIDEO_MODE_INFORMATION ) ) {
            VmpLog( "VMBF", ReqPkt->OutputBufferLength );
            status = ERROR_INSUFFICIENT_BUFFER;
        } else if( !vmpGetModeDims( pExt, pExt->CurrentModeNumber,
                                    &usHRes, &usVRes, &ucBpp ) ) {  /* Instant VM changes */
            VmpLog( "VQCF", pExt->CurrentModeNumber );
            status = ERROR_INVALID_PARAMETER;
        } else {
            ReqPkt->StatusBlock->Information = sizeof( VIDEO_MODE_INFORMATION );
            modeInfo  = ReqPkt->OutputBuffer;
            vmpFillModeInfo( modeInfo, usHRes, usVRes, ucBpp );
            modeInfo->ModeIndex = pExt->CurrentModeNumber;
            VmpLog( "VQCM", ((ULONG)usHRes << 16) | usVRes );   /* debug: current dims */
        }

        break;

    case IOCTL_VIDEO_SET_CURRENT_MODE:
        VideoDebugPrint( (2, "SET_CURRENT_MODE\n") );

        /* Instant VM changes: bound the input before dereferencing it -
         * win32k always sends sizeof(VIDEO_MODE), but a short buffer must
         * fail cleanly, not read past the allocation. */
        if( ReqPkt->InputBufferLength < sizeof( VIDEO_MODE ) ) {
            VmpLog( "VIBF", ReqPkt->InputBufferLength );
            status = ERROR_INSUFFICIENT_BUFFER;
            break;
        }

        /* Ensure the mode is valid. */
        modeNumber = ((PVIDEO_MODE)(ReqPkt->InputBuffer))->RequestedMode;
        VmpLog( "VSET", modeNumber );       /* debug: requested mode index */

        /* Instant VM changes: one resolver for static and dynamic modes
         * (also fixes the upstream `modeNumber > ulAllModes` off-by-one). */
        if( !vmpGetModeDims( pExt, modeNumber, &usHRes, &usVRes, &ucBpp ) ) {
            VmpLog( "VMDR", modeNumber );   /* debug: unresolvable index */
            status = ERROR_INVALID_PARAMETER;
            break;
        }
        VmpLog( "VMD0", ((ULONG)usHRes << 16) | usVRes );   /* debug: resolved dims */

        /* Instant VM changes: re-validate against the hardware contract
         * right before programming - static entries were checked at
         * FindAdapter, dynamic entries at refresh, but defense in depth
         * here is what keeps a corrupted entry from reaching dispi. */
        reason = vmpCheckDims( usHRes, usVRes, ucBpp, pExt->FramebufLen );
        if( reason != VMP_DIM_OK ) {
            VmpLog( "VSVB", reason );       /* debug: dims rejected, reason */
            status = ERROR_INVALID_PARAMETER;
            break;
        }

        rc = BOXV_ext_mode_set( pExt, usHRes, usVRes, ucBpp, usHRes, usVRes );
        VmpLog( "VSMS", (ULONG)rc );        /* debug: ext_mode_set result */
        if( rc ) {
            /* Fails only on parameter checks before touching hardware. */
            status = ERROR_INVALID_PARAMETER;
            break;
        }

        pExt->CurrentModeNumber = modeNumber;
        /* Instant VM changes: a dynamic target that actually got applied
         * becomes the stale-index fallback (same data vmpSetLastDyn kept
         * at refresh; refreshed here in case the slot moved in between). */
        if( modeNumber >= ulAllModes )
            vmpSetLastDyn( pExt, usHRes, usVRes, ucBpp );
        break;

    case IOCTL_VIDEO_RESET_DEVICE:
        VideoDebugPrint( (2, "RESET_DEVICE\n") );
        pExt->NumDynamicModes = 0;  /* Instant VM changes: back to pure static */
        VmpLog( "VRST", pExt->NumDynamicModes );    /* debug: reset; LastDyn kept */
	/* Not calling the following routine avoids some visual glitches. */
        /* BOXV_ext_disable( pExt ); */
        break;

    case IOCTL_VIDEO_MAP_VIDEO_MEMORY:
    {
        PVIDEO_MEMORY_INFORMATION           memInfo;

        VideoDebugPrint( (2, "MAP_VIDEO_MEMORY\n") );
        if( (ReqPkt->OutputBufferLength < sizeof( VIDEO_MEMORY_INFORMATION )) ||
            (ReqPkt->InputBufferLength < sizeof( VIDEO_MEMORY )) ) {

            VmpLog( "VMBF", ReqPkt->OutputBufferLength );
            status = ERROR_INSUFFICIENT_BUFFER;
            break;
        }

        ReqPkt->StatusBlock->Information =  sizeof( VIDEO_MEMORY_INFORMATION );

        vidMem    = (PVIDEO_MEMORY)ReqPkt->InputBuffer;
        memInfo   = ReqPkt->OutputBuffer;
        inIoSpace = FALSE;

        memInfo->VideoRamBase   = vidMem->RequestedVirtualAddress;
        memInfo->VideoRamLength = pExt->FramebufLen;

        status = VideoPortMapMemory( pExt, pExt->PhysicalFrameAddress,
                                     &memInfo->VideoRamLength, &inIoSpace,
                                     &memInfo->VideoRamBase );

        /* The framebuffer covers the entire video memory. */
        memInfo->FrameBufferBase   = memInfo->VideoRamBase;
        memInfo->FrameBufferLength = memInfo->VideoRamLength;
        VmpLog( "VMAP", status == NO_ERROR ? memInfo->VideoRamLength
                                           : (ULONG)status );   /* debug: mapped len / error */
        break;
    }

    case IOCTL_VIDEO_UNMAP_VIDEO_MEMORY:
        VideoDebugPrint( (2, "UNMAP_VIDEO_MEMORY\n") );
        if( ReqPkt->InputBufferLength < sizeof( VIDEO_MEMORY ) ) {
            VmpLog( "VIBF", ReqPkt->InputBufferLength );
            status = ERROR_INSUFFICIENT_BUFFER;
        } else {
            vidMem  = (PVIDEO_MEMORY)ReqPkt->InputBuffer;
            status = VideoPortUnmapMemory( pExt,
                                           vidMem->RequestedVirtualAddress,
                                           0 );
            VmpLog( "VUMA", (ULONG)status );
        }
        break;

    /* The following request is required for palettized modes. */
    case IOCTL_VIDEO_SET_COLOR_REGISTERS:
    {
        PVIDEO_CLUT     clutBuffer;

        VideoDebugPrint( (2, "SET_COLOR_REGISTERS\n") );
        clutBuffer = ReqPkt->InputBuffer;

        if( ReqPkt->InputBufferLength < sizeof( VIDEO_CLUT ) - sizeof( ULONG ) ||
            ReqPkt->InputBufferLength < sizeof( VIDEO_CLUT ) +
                    (sizeof( ULONG ) * (clutBuffer->NumEntries - 1)) ) {

            VmpLog( "VIBF", ReqPkt->InputBufferLength );
            status = ERROR_INSUFFICIENT_BUFFER;
            break;
        }

        /* Instant VM changes: bound NumEntries/FirstEntry before they reach
         * BOXV_dac_set - the buffer-length math above can wrap for huge
         * counts, and the DAC loop would then read far past the CLUT. */
        if( clutBuffer->NumEntries > 256 ||
            clutBuffer->FirstEntry > 256 ||
            clutBuffer->FirstEntry + clutBuffer->NumEntries > 256 ) {
            VmpLog( "VCLF", clutBuffer->NumEntries );   /* debug: CLUT rejected */
            status = ERROR_INVALID_PARAMETER;
            break;
        }

        /* Instant VM changes: resolve the current mode through the dynamic-
         * aware helper (dynamic modes are 32bpp, so they never load a CLUT). */
        if( vmpGetModeDims( pExt, pExt->CurrentModeNumber, &usHRes, &usVRes, &ucBpp )
            && ucBpp == 8 ) {
            BOXV_dac_set( pExt, clutBuffer->FirstEntry, clutBuffer->NumEntries,
                          clutBuffer->LookupTable );
        }
        VmpLog( "VCLT", clutBuffer->NumEntries );   /* debug: CLUT entries */
        break;
    }

    /* The following requests are optional. */
    case IOCTL_VIDEO_QUERY_POINTER_CAPABILITIES:
    {
        PVIDEO_POINTER_CAPABILITIES     ptrCaps = ReqPkt->OutputBuffer;

        VideoDebugPrint( (2, "QUERY_POINTER_CAPABILITIES\n") );
        if( ReqPkt->OutputBufferLength < sizeof( VIDEO_POINTER_CAPABILITIES ) ) {
            ReqPkt->StatusBlock->Information = 0;
            VmpLog( "VMBF", ReqPkt->OutputBufferLength );
            status = ERROR_INSUFFICIENT_BUFFER;
            /* Instant VM changes: upstream fell through and wrote the
             * struct anyway, overrunning a short buffer - stop here. */
            break;
        }

        ptrCaps->Flags = 0;     /* Indicate no pointer support. */
        ptrCaps->MaxWidth = ptrCaps->MaxHeight = 0;
        /* Documentation and sample code disagree on whether no display
         * memory for cursor is indicated by 0 or -1.
         */
        ptrCaps->HWPtrBitmapStart = ptrCaps->HWPtrBitmapEnd = ~0;

        ReqPkt->StatusBlock->Information = sizeof( VIDEO_POINTER_CAPABILITIES );
        VmpLog( "VPTR", 0 );                /* debug: no pointer support */
        break;
    }

    /* The share/unshare IOCTLs are new for NT 3.51. */
    case IOCTL_VIDEO_SHARE_VIDEO_MEMORY:
    {
        PVIDEO_SHARE_MEMORY_INFORMATION     pShrMemInfo;
        PHYSICAL_ADDRESS                    shareAddress;
        ULONG                               sharedViewSize;

        VideoDebugPrint( (2, "SHARE_VIDEO_MEMORY\n") );
        if( (ReqPkt->OutputBufferLength < sizeof( VIDEO_SHARE_MEMORY_INFORMATION )) ||
            (ReqPkt->InputBufferLength < sizeof( VIDEO_MEMORY )) ) {

            VmpLog( "VMBF", ReqPkt->OutputBufferLength );
            status = ERROR_INSUFFICIENT_BUFFER;
            break;
        }

        pShrMem = ReqPkt->InputBuffer;

        if( (pShrMem->ViewOffset > pExt->FramebufLen) ||
            ((pShrMem->ViewOffset + pShrMem->ViewSize) > pExt->FramebufLen) ) {

            VmpLog( "VSHF", pShrMem->ViewSize );    /* debug: view out of VRAM */
            status = ERROR_INVALID_PARAMETER;
            break;
        }

        ReqPkt->StatusBlock->Information = sizeof( VIDEO_SHARE_MEMORY_INFORMATION );

        /* The input buffer is also the output buffer; remember the input. */
        virtualAddress = pShrMem->ProcessHandle;
        sharedViewSize = pShrMem->ViewSize;

        inIoSpace = FALSE;

        /* NB: ViewOffset is not being taken into account. */
        shareAddress.QuadPart = pExt->PhysicalFrameAddress.QuadPart;

        status = VideoPortMapMemory( pExt, shareAddress,
                                     &sharedViewSize, &inIoSpace,
                                     &virtualAddress );

        pShrMemInfo = ReqPkt->OutputBuffer;
        pShrMemInfo->SharedViewOffset = pShrMem->ViewOffset;
        pShrMemInfo->VirtualAddress   = virtualAddress;
        pShrMemInfo->SharedViewSize   = sharedViewSize;
        VmpLog( "VSHR", sharedViewSize );   /* debug: shared view bytes */
        break;
    }

    case IOCTL_VIDEO_UNSHARE_VIDEO_MEMORY:
        VideoDebugPrint( (2, "UNSHARE_VIDEO_MEMORY\n") );
        if( ReqPkt->InputBufferLength < sizeof( VIDEO_SHARE_MEMORY ) ) {
            VmpLog( "VIBF", ReqPkt->InputBufferLength );
            status = ERROR_INSUFFICIENT_BUFFER;
            break;
        }

        pShrMem = ReqPkt->InputBuffer;
        status = VideoPortUnmapMemory( pExt, pShrMem->RequestedVirtualAddress,
                                       pShrMem->ProcessHandle );
        VmpLog( "VUSR", (ULONG)status );
        break;


    /* The child state IOCTLs are new for NT 5.0 (Windows 2000). */
    case IOCTL_VIDEO_GET_CHILD_STATE:
    {
        PULONG      pChildIndex;
        PULONG      pChildState;

        VideoDebugPrint( (2, "GET_CHILD_STATE\n") );
        if( ReqPkt->InputBufferLength < sizeof( ULONG ) ||
            ReqPkt->OutputBufferLength < sizeof( ULONG ) ) {
            VmpLog( "VMBF", ReqPkt->InputBufferLength );
            status = ERROR_INSUFFICIENT_BUFFER;
            break;
        }

        pChildIndex = ReqPkt->InputBuffer;
        pChildState = ReqPkt->OutputBuffer;

        /* Always say the child is active. */
        *pChildState = VIDEO_CHILD_ACTIVE;
        VmpLog( "VCHD", *pChildState );     /* debug: child active */
        break;
    }

    /* Any other request is invalid and fails. */
    default:
        VideoDebugPrint( (1, "Unhandled IoControlCode %08x!\n", ReqPkt->IoControlCode) );
        VmpLog( "VINV", ReqPkt->IoControlCode );    /* debug: unhandled ioctl */
        status = ERROR_INVALID_FUNCTION;
        break;
    }

    VmpLog( "VSTO", status );               /* debug: StartIO exit status */
    ReqPkt->StatusBlock->Status = status;
    return( TRUE );
}

/* Validate support for a requested power state. */
VP_STATUS HwGetPowerState( PVOID HwDevExt, ULONG HwId,
                           PVIDEO_POWER_MANAGEMENT VideoPowerControl )
{
    VideoDebugPrint( (1, "videomp: HwGetPowerState\n") );
    VmpLog( "VPWG", HwId );
    return( NO_ERROR );
}

/* Set the device power state. */
VP_STATUS HwSetPowerState( PVOID HwDevExt, ULONG HwId,
                           PVIDEO_POWER_MANAGEMENT VideoPowerControl )
{
    VideoDebugPrint( (1, "videomp: HwSetPowerState\n") );
    VmpLog( "VPWS", HwId );
    return( NO_ERROR );
}

/* Return child device descriptors. In this case just a single monitor. */
VP_STATUS HwGetChildDesc( PVOID HwDevExt, PVIDEO_CHILD_ENUM_INFO ChildEnumInfo,
                          PVIDEO_CHILD_TYPE VideoChildType, PUCHAR pChildDescriptor,
                          PULONG UId, PULONG pUnused )
{
    PHW_DEV_EXT     pExt = HwDevExt;

    VideoDebugPrint( (1, "videomp: HwGetChildDesc\n") );
    VmpLog( "VCH0", ChildEnumInfo->ChildIndex );    /* debug: child enum */

    if( ChildEnumInfo->ChildIndex > 0 ) {
        if( (int)ChildEnumInfo->ChildIndex <= pExt->NumMonitors ) {
            *VideoChildType = Monitor;
            *UId = ChildEnumInfo->ChildIndex;
            return( VIDEO_ENUM_MORE_DEVICES );
        }
    }

    return( ERROR_NO_MORE_DEVICES );
}

/* Reset the adapter into a VGA-compatible state. */
BOOLEAN HwVidResetHw( PVOID HwDevExt, ULONG Columns, ULONG Rows )
{
    PHW_DEV_EXT     pExt = HwDevExt;

    VideoDebugPrint( (1, "videomp: HwVidResetHw\n") );
    VmpLog( "VRHW", 0xAAAAAAAAul );         /* debug: ResetHw (crash triage:
                                                also runs on bugcheck path) */

    BOXV_ext_disable( pExt );
    /* Indicate that we didn't actually set the requested text mode. */
    return( FALSE );
}

/* Standard NT driver initialization entry point. */
ULONG DriverEntry( PVOID Context1, PVOID Context2 )
{
    VIDEO_HW_INITIALIZATION_DATA    hwInitData;
    ULONG                           status;

    VideoDebugPrint( (1, "videomp: DriverEntry\n") );
    VmpLog( "VLD1", 0xDEDEDEDEul );         /* debug: DriverEntry entered -
                                                image loaded and running */
    VmpLog( "VLD2", 0 );                    /* debug: right before first import call */

#ifdef VMP_BOOT_PROBE_ONLY
    /* debug: bisect build - proves image load + DriverEntry execution only.
     * Returning failure fails the device start gracefully (no mode takeover). */
    VmpLog( "VPRB", 1 );
    return( 0xC0000001ul );
#endif

    /* Prepare the initialization structure. */
    VideoPortZeroMemory( &hwInitData, sizeof( VIDEO_HW_INITIALIZATION_DATA ) );
    VmpLog( "VLD3", 1 );                    /* debug: first import call survived */
    hwInitData.HwInitDataSize = sizeof( VIDEO_HW_INITIALIZATION_DATA );

    /* Set up driver callbacks. */
    hwInitData.HwFindAdapter = HwVidFindAdapter;
    hwInitData.HwInitialize  = HwVidInitialize;
    hwInitData.HwStartIO     = HwVidStartIO;
    /* There's no interrupt or timer callback. */
    hwInitData.HwInterrupt   = NULL;
    hwInitData.HwTimer       = NULL;
    hwInitData.HwResetHw     = HwVidResetHw;

    /* Power and child device management callbacks were added in NT 5.0. */
    hwInitData.HwGetPowerState           = HwGetPowerState;
    hwInitData.HwSetPowerState           = HwSetPowerState;
    hwInitData.HwGetVideoChildDescriptor = HwGetChildDesc;

    /* Report legacy resources. */
    hwInitData.HwLegacyResourceList  = LegacyRanges;
    hwInitData.HwLegacyResourceCount = ulNumLegacyRanges;

    /* Report the device extension size. */
    hwInitData.HwDeviceExtensionSize = sizeof( HW_DEV_EXT );

    /* Refer to the CurrentControlSet\Services\xxx\Device0 registry key. */
    hwInitData.StartingDeviceNumber = 0;

    /* Later NT versions support PCI; recent versions ignore this entirely */
    hwInitData.AdapterInterfaceType = PCIBus;

    /* The PsGetVersion function was not available in NT 3.x. We therefore
     * implement a poor man's version detection by successively reducing the
     * HwInitDataSize until the video miniport (we hope) accepts it.
     */
    do {
        /* First try with NT 5.1 (Windows XP) structure size. */
        VideoDebugPrint( (1, "videomp: Trying DDI 5.1 HwInitDataSize\n") );
        hwInitData.HwInitDataSize = SIZE_OF_WXP_VIDEO_HW_INITIALIZATION_DATA;
        PortVersion = VP_VER_XP;
        VmpLog( "VLD4", PortVersion );      /* debug: VideoPortInitialize attempt */
        status = VideoPortInitialize( Context1, Context2, &hwInitData, NULL );
        if( status != STATUS_REVISION_MISMATCH ) {
            /* If status is anything other than a version mismatch, don't
             * try calling VideoPortInitialize again. The call may have
             * succeeded, or it failed for some reason whe can't easily fix.
             */
            break;
        }

        /* Try the NT 5.0 (Windows 2000) structure size. */
        VideoDebugPrint( (1, "videomp: Trying DDI 5.0 HwInitDataSize\n") );
        hwInitData.HwInitDataSize = SIZE_OF_W2K_VIDEO_HW_INITIALIZATION_DATA;
        PortVersion = VP_VER_W2K;
        VmpLog( "VLD4", PortVersion );
        status = VideoPortInitialize( Context1, Context2, &hwInitData, NULL );
        if( status != STATUS_REVISION_MISMATCH ) {
            break;
        }

        /* Try the NT 4.0 (and also NT 3.51) structure size. */
        VideoDebugPrint( (1, "videomp: Trying DDI 4.0 HwInitDataSize\n") );
        hwInitData.HwInitDataSize = SIZE_OF_NT4_VIDEO_HW_INITIALIZATION_DATA;
        PortVersion = VP_VER_NT4;
        VmpLog( "VLD4", PortVersion );
        status = VideoPortInitialize( Context1, Context2, &hwInitData, NULL );
        if( status != STATUS_REVISION_MISMATCH ) {
            break;
        }

        /* Try the original NT 3.1/3.5 HwInitDataSize. No PCI support. */
        VideoDebugPrint( (1, "videomp: Trying DDI 3.1 HwInitDataSize\n") );
        hwInitData.HwInitDataSize = offsetof( VIDEO_HW_INITIALIZATION_DATA, HwResetHw );
        hwInitData.AdapterInterfaceType = Isa;
        PortVersion = VP_VER_NT31;
        VmpLog( "VLD4", PortVersion );
        status = VideoPortInitialize( Context1, Context2, &hwInitData, NULL );
    } while( 0 );
    VideoDebugPrint( (1, "videomp: VideoPortInitialize rc=%08x\n", status ) );
    VmpLog( "VLDR", status );               /* debug: DriverEntry return */
    return( status );
}
