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
 * Internal video miniport interfaces.
 */

/* Video Port versions that affect miniport behavior. */

#define VP_VER_NT31     0x030100
#define VP_VER_NT4      0x040000        /* Also NT 3.51 */
#define VP_VER_W2K      0x050000
#define VP_VER_XP       0x050100

/* Instant VM changes: host IO ports publishing the dynamic mode target.
 * The host (Instant-virtual-machine runtime) registers read handlers on
 * these ports only while the resolution auto-align switch is on; an
 * unregistered read returns 0xFFFF, so the magic port doubles as presence
 * detection. Values: 0xE001 = width, 0xE002 = height, 0xE003 = magic.
 * All reads are 16-bit; contract details in guest/boxvnt/ARCHITECTURE.md. */
#define VMP_PORT_MODE_W     0xE001
#define VMP_PORT_MODE_H     0xE002
#define VMP_PORT_MODE_MAGIC 0xE003
#define VMP_MODE_MAGIC      0x5AB0

/* Instant VM changes: accepted dynamic target window; equals the dispi
 * limits (boxv.c VBE_DISPI_MAX_*) and the host-side clamp in
 * resolution-channel.ts, so all three layers reject the same targets. */
#define VMP_MODE_MIN_W      640
#define VMP_MODE_MAX_W      2560
#define VMP_MODE_MIN_H      480
#define VMP_MODE_MAX_H      1600

/* Video mode description structure */
typedef struct {
    USHORT              HorzRes;                /* Horizontal resolution */
    USHORT              VertRes;                /* Vertical resolution */
    UCHAR               Bpp;                    /* Bits per pixel */
    BOOLEAN             bValid;                 /* Valid mode flag */
} VIDEOMP_MODE, *PVIDEOMP_MODE;

/* The device extension - private miniport data */
typedef struct {
    PVOID               IoPorts;                /* I/O ports mapping */
    PVOID               FrameAddress;           /* Framebuffer mapping */
    PHYSICAL_ADDRESS    PhysicalFrameAddress;   /* Physical FB address */
    ULONG               FramebufLen;            /* Framebuffer length */
    ULONG               CurrentModeNumber;      /* Current mode index */
    ULONG               NumValidModes;          /* Number of valid modes */
    ULONG               NumMonitors;            /* Number of attached monitors */
    PUCHAR              IOAddrVGA;              /* VGA I/O ports mapping */
    ULONG               ulSlot;                 /* PCI slot the adapter is in. */
    ULONG               PortVersion;            /* Video Port version */
    /* Instant VM changes: dynamic mode slots. Refreshed from the host IO
     * ports before every mode list query; mode indices ulAllModes and
     * ulAllModes+1 address the two slots. Only the slot named by
     * DynamicModeSlot is reported; on every target change the mode moves
     * to the other slot. VirtualBox's XPDM miniport alternates the pending
     * mode between two tail slots because "windows will ignore actual mode
     * change call" when the index stays the same (VBoxMPVidModes.cpp);
     * NumDynamicModes is 0 or 1. */
    VIDEOMP_MODE        DynamicModes[2];
    ULONG               NumDynamicModes;
    ULONG               DynamicModeSlot;
    /* Instant VM changes: last dynamic target ever accepted, kept even
     * after the live slot is torn down (RESET_DEVICE or host switch-off).
     * A tail-slot mode index that win32k still holds from an older
     * enumeration then resolves to these dimensions instead of failing
     * with ERROR_INVALID_PARAMETER - "the mode it names is already on the
     * wire" semantics. Both tail indices are accepted for as long as any
     * dynamic state exists. */
    USHORT              LastDynW;
    USHORT              LastDynH;
    UCHAR               LastDynBpp;
    UCHAR               HaveLastDyn;
} HW_DEV_EXT, *PHW_DEV_EXT;

/* Variables defined in vidmpdat.c */
extern VIDEOMP_MODE         VideoModes[];
extern ULONG                ulAllModes;
extern VIDEO_ACCESS_RANGE   LegacyRanges[];
extern ULONG                ulNumLegacyRanges;
extern ULONG                PortVersion;
