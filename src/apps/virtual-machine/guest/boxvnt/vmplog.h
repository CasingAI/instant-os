/*****************************************************************************

Copyright (c) 2026  Instant VM (boxvnt derivative, MIT licensed)

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
 * Instant VM changes: COM1 serial logging for BSOD triage ("black box").
 *
 * The miniport runs before any user-mode agent exists and dies with the
 * machine on a bugcheck, so the only channel that survives a crash is the
 * raw UART. VmpLog() writes one machine-parseable line per event:
 *
 *     [IVM]<tag>=<8 hex digits>\r\n
 *
 * through bare `out dx,al` instructions - no imports, so logging works
 * even when the crash is inside import/thunk resolution, and even before
 * DriverEntry's first import call. The host runtime taps the v86
 * serial0-output stream; the last [IVM] line before silence marks the
 * crash site. Full tag registry and triage playbook:
 * guest/boxvnt/ARCHITECTURE.md.
 *
 * Coexistence with res-agent: both use COM1. res-agent replies with
 * 4-char tags (PONG/EXEC/...) via Win32 WriteFile; this module's tags
 * always start with 'V', so the host-side parser can route by tag and
 * neither side parses the other's lines. res-agent reads RX only, this
 * module writes TX only - the directions never collide.
 *
 * Line rate: StartIO emits VSTI (entry) + branch details + VSTO (exit),
 * ~3 lines per IOCTL; mode queries happen at PDEV (re)initialization
 * only, so the stream stays in the hundreds of lines per boot.
 */

#ifndef VMPLOG_H_INCLUDED
#define VMPLOG_H_INCLUDED

/* Master switch. 1 = log to COM1 (default for every build shipped to a
 * test VM). 0 = compile to no-ops, byte-for-byte silent. */
#ifndef VMP_LOG_SERIAL
#define VMP_LOG_SERIAL 1
#endif

#if VMP_LOG_SERIAL

/* Emit "[IVM]<tag>=<value>" to COM1 (0x3F8, 8N1). `tag` is a 4-character
 * literal from the registry in ARCHITECTURE.md; tags are host-routed, so
 * keep them distinct from res-agent's (never reuse a res-agent tag). */
void VmpLog( const char *tag, unsigned long value );

#else

#define VmpLog( tag, value ) ( (void)0 )

#endif

#endif /* VMPLOG_H_INCLUDED */
