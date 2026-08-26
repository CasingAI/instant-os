// ISO 9660 Primary/Supplementary Volume Descriptor encode/decode

import { SECTOR_SIZE, VD_PRIMARY, VD_SUPPLEMENTARY, VD_TERMINATOR, CD001, JOLIET_ESC } from './constants.js';
import { writeBoth16, writeBoth32, readBoth16, readBoth32 } from './both.js';
import { writeUCS2Padded, decodeUCS2 } from './ucs2.js';
import { encodeDecimalDate, decodeDecimalDate, zeroDecimalDate } from './dates.js';

// Write an ASCII string padded with spaces into a buffer
function writeAsciiPadded(buf, offset, str, len) {
  for (let i = 0; i < len; i++) {
    buf[offset + i] = i < str.length ? str.charCodeAt(i) : 0x20; // space-pad
  }
}

// Read an ASCII string from buffer, trim trailing spaces
function readAsciiPadded(buf, offset, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(buf[offset + i]);
  return s.trimEnd();
}

// Encode a Primary Volume Descriptor (2048 bytes)
function encodePVD(opts) {
  const buf = new Uint8Array(SECTOR_SIZE);
  const view = new DataView(buf.buffer);

  buf[0] = VD_PRIMARY;
  buf.set(CD001, 1);
  buf[6] = 0x01; // version

  writeAsciiPadded(buf, 8, opts.systemId || '', 32);
  writeAsciiPadded(buf, 40, opts.volumeId || '', 32);
  writeBoth32(view, 80, opts.volumeSpaceSize);
  writeBoth16(view, 120, 1); // volume set size
  writeBoth16(view, 124, 1); // volume sequence number
  writeBoth16(view, 128, SECTOR_SIZE); // logical block size
  writeBoth32(view, 132, opts.pathTableSize);
  view.setUint32(140, opts.pathTableLBA_LE, true);
  view.setUint32(144, 0, true); // optional path table LE
  view.setUint32(148, opts.pathTableLBA_BE, false);
  view.setUint32(152, 0, false); // optional path table BE

  // Root directory record (34 bytes at offset 156)
  if (opts.rootRecord) buf.set(opts.rootRecord, 156);

  writeAsciiPadded(buf, 190, '', 128);  // volume set identifier
  writeAsciiPadded(buf, 318, opts.publisher || '', 128);
  writeAsciiPadded(buf, 446, opts.preparer || '', 128);
  writeAsciiPadded(buf, 574, opts.application || '', 128);
  writeAsciiPadded(buf, 702, '', 37);   // copyright file
  writeAsciiPadded(buf, 739, '', 37);   // abstract file
  writeAsciiPadded(buf, 776, '', 37);   // bibliographic file

  const now = opts.date || new Date();
  buf.set(encodeDecimalDate(now), 813);          // creation
  buf.set(encodeDecimalDate(now), 830);          // modification
  buf.set(zeroDecimalDate(), 847);               // expiration
  buf.set(zeroDecimalDate(), 864);               // effective

  buf[881] = 0x01; // file structure version

  return buf;
}

// Encode a Supplementary Volume Descriptor (Joliet)
function encodeSVD(opts) {
  const buf = new Uint8Array(SECTOR_SIZE);
  const view = new DataView(buf.buffer);

  buf[0] = VD_SUPPLEMENTARY;
  buf.set(CD001, 1);
  buf[6] = 0x01;

  // UCS-2 encoded string fields for Joliet
  writeUCS2Padded(buf, 8, opts.systemId || '', 32);
  writeUCS2Padded(buf, 40, opts.volumeId || '', 32);
  writeBoth32(view, 80, opts.volumeSpaceSize);

  // Escape sequences at bytes 88-119 (32 bytes)
  buf.set(JOLIET_ESC, 88);

  writeBoth16(view, 120, 1);
  writeBoth16(view, 124, 1);
  writeBoth16(view, 128, SECTOR_SIZE);
  writeBoth32(view, 132, opts.pathTableSize);
  view.setUint32(140, opts.pathTableLBA_LE, true);
  view.setUint32(144, 0, true);
  view.setUint32(148, opts.pathTableLBA_BE, false);
  view.setUint32(152, 0, false);

  if (opts.rootRecord) buf.set(opts.rootRecord, 156);

  writeUCS2Padded(buf, 190, '', 128);
  writeUCS2Padded(buf, 318, opts.publisher || '', 128);
  writeUCS2Padded(buf, 446, opts.preparer || '', 128);
  writeUCS2Padded(buf, 574, opts.application || '', 128);
  writeUCS2Padded(buf, 702, '', 37);
  writeUCS2Padded(buf, 739, '', 37);
  writeUCS2Padded(buf, 776, '', 37);

  const now = opts.date || new Date();
  buf.set(encodeDecimalDate(now), 813);
  buf.set(encodeDecimalDate(now), 830);
  buf.set(zeroDecimalDate(), 847);
  buf.set(zeroDecimalDate(), 864);

  buf[881] = 0x01;

  return buf;
}

// Encode a Volume Descriptor Set Terminator
function encodeTerminator() {
  const buf = new Uint8Array(SECTOR_SIZE);
  buf[0] = VD_TERMINATOR;
  buf.set(CD001, 1);
  buf[6] = 0x01;
  return buf;
}

// Decode a volume descriptor from buffer at a sector offset
function decodeVolumeDescriptor(buf, sectorOffset) {
  const off = sectorOffset * SECTOR_SIZE;
  const type = buf[off];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Check magic
  for (let i = 0; i < 5; i++) {
    if (buf[off + 1 + i] !== CD001[i]) return null;
  }

  if (type === VD_TERMINATOR) return { type };

  const isJoliet = type === VD_SUPPLEMENTARY &&
    buf[off + 88] === 0x25 && buf[off + 89] === 0x2F &&
    (buf[off + 90] === 0x40 || buf[off + 90] === 0x43 || buf[off + 90] === 0x45);

  const readStr = isJoliet
    ? (o, len) => decodeUCS2(buf, off + o, len)
    : (o, len) => readAsciiPadded(buf, off + o, len);

  return {
    type,
    isJoliet,
    volumeId: readStr(40, 32),
    volumeSpaceSize: readBoth32(view, off + 80),
    pathTableSize: readBoth32(view, off + 132),
    pathTableLBA_LE: view.getUint32(off + 140, true),
    pathTableLBA_BE: view.getUint32(off + 148, false),
    publisher: readStr(318, 128),
    preparer: readStr(446, 128),
    application: readStr(574, 128),
    creationDate: decodeDecimalDate(buf, off + 813),
    rootExtentLBA: readBoth32(view, off + 156 + 2),
    rootDataLen: readBoth32(view, off + 156 + 10),
  };
}

export { encodePVD, encodeSVD, encodeTerminator, decodeVolumeDescriptor, writeAsciiPadded, readAsciiPadded };
