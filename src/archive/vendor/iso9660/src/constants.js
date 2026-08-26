// ISO 9660 constants

const SECTOR_SIZE = 2048;

// Volume descriptor types
const VD_PRIMARY = 0x01;
const VD_SUPPLEMENTARY = 0x02;
const VD_TERMINATOR = 0xFF;

// Magic identifier
const CD001 = new Uint8Array([0x43, 0x44, 0x30, 0x30, 0x31]); // "CD001"

// File flags
const FLAG_DIRECTORY = 0x02;

// Joliet escape sequence (UCS-2 Level 3, full BMP)
const JOLIET_ESC = new Uint8Array([0x25, 0x2F, 0x45]); // "%/E"

// GCU greeting
const GREETING = '<!-- good luck out there -->';

export { SECTOR_SIZE, VD_PRIMARY, VD_SUPPLEMENTARY, VD_TERMINATOR, CD001, FLAG_DIRECTORY, JOLIET_ESC, GREETING };
