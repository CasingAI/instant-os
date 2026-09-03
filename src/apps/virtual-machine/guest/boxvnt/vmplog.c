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
 * Instant VM changes: see vmplog.h for the design notes.
 *
 * Deliberately import-free: every access goes through `#pragma aux` inline
 * OUT/IN so the module links with no fixups, no IAT entries, and no reliance
 * on import resolution - logging keeps working when the crash is inside the
 * import path itself (the failure that took five rounds to pin down).
 */

#include "vmplog.h"

#if VMP_LOG_SERIAL

/* COM1 (v86 serial0). LSR read doubles as a no-op on machines without a
 * registered UART: unregistered reads return 0xFF, whose THRE bit (0x20)
 * is set, so the wait loop exits immediately instead of spinning. */
#define VMP_COM1_DATA   0x3F8   /* TX/RX (DLAB=0) */
#define VMP_COM1_LCR    0x3FB   /* line control */
#define VMP_COM1_LSR    0x3FD   /* line status */

#define VMP_LSR_THRE    0x20    /* transmit holding register empty */

/* 8N1, DLAB off. v86's UART is a byte pipe (no real framing), but keeping
 * the register in the canonical state costs two OUTs per line and makes
 * the stream readable by real hardware tools too. Baud divisor is never
 * touched - res-agent owns the line speed via its own Comm config. */

/* Prototypes must precede the #pragma aux definitions (OW infers int from
 * an undeclared function and then rejects the [al] return register). The
 * pragma templates ARE the function bodies - there is no C code for them. */
static unsigned char    vmplog_inb( unsigned short port );
static void             vmplog_outb( unsigned short port, unsigned char val );

#pragma aux vmplog_outb = "out dx, al" parm [dx] [al];
#pragma aux vmplog_inb  = "in al, dx"  parm [dx] value [al];

static void vmplog_tx( unsigned char byte )
{
    unsigned    spin;

    /* Bound the wait so a wedged LSR can never hang the driver; 64k polls
     * is orders of magnitude past any real UART's drain time. */
    for( spin = 0; spin < 65535; ++spin ) {
        if( vmplog_inb( VMP_COM1_LSR ) & VMP_LSR_THRE )
            break;
    }
    vmplog_outb( VMP_COM1_DATA, byte );
}

void VmpLog( const char *tag, unsigned long value )
{
    static const char   hex[] = "0123456789abcdef";
    static const char   head[] = "[IVM]";
    const char          *p;
    int                 i;

    vmplog_outb( VMP_COM1_LCR, 0x03 );      /* re-assert 8N1, DLAB off */

    for( p = head; *p; ++p )
        vmplog_tx( (unsigned char)*p );
    for( p = tag; *p; ++p )
        vmplog_tx( (unsigned char)*p );
    vmplog_tx( '=' );
    for( i = 28; i >= 0; i -= 4 )
        vmplog_tx( (unsigned char)hex[(value >> i) & 0xF] );
    vmplog_tx( '\r' );
    vmplog_tx( '\n' );
}

#endif /* VMP_LOG_SERIAL */
