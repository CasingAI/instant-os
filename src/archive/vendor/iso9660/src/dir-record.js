// ISO 9660 directory record encode/decode

import { SECTOR_SIZE, FLAG_DIRECTORY } from './constants.js';
import { writeBoth16, writeBoth32, readBoth16, readBoth32 } from './both.js';
import { encodeUCS2, decodeUCS2 } from './ucs2.js';
import { encodeRecordingDate, decodeRecordingDate } from './dates.js';

// Compute the length of a directory record given the identifier
function dirRecordLength(identLen) {
  // Fixed fields: 33 bytes + identifier + padding if even-length identifier
  const base = 33 + identLen;
  return base + (base % 2 === 1 ? 1 : 0); // pad to even total
}

// Encode a directory record into a buffer at the given offset
// Returns the number of bytes written
function encodeDirRecord(buf, offset, opts) {
  const { extentLBA, dataLen, date, isDir, identifier } = opts;
  // identifier: Uint8Array (already encoded — ASCII or UCS-2)
  const identLen = identifier.length;
  const recLen = dirRecordLength(identLen);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  buf[offset] = recLen;                              // Record length
  buf[offset + 1] = 0;                               // Extended attribute record length
  writeBoth32(view, offset + 2, extentLBA);           // Extent location
  writeBoth32(view, offset + 10, dataLen);            // Data length
  const dateBytes = encodeRecordingDate(date || new Date());
  buf.set(dateBytes, offset + 18);                    // Recording date
  buf[offset + 25] = isDir ? FLAG_DIRECTORY : 0;      // File flags
  buf[offset + 26] = 0;                               // File unit size
  buf[offset + 27] = 0;                               // Interleave gap size
  writeBoth16(view, offset + 28, 1);                  // Volume sequence number
  buf[offset + 32] = identLen;                        // File identifier length
  buf.set(identifier, offset + 33);                   // File identifier

  return recLen;
}

// Encode the dot (self) entry
function encodeDotRecord(buf, offset, extentLBA, dataLen, date) {
  return encodeDirRecord(buf, offset, {
    extentLBA, dataLen, date, isDir: true,
    identifier: new Uint8Array([0x00]),
  });
}

// Encode the dotdot (parent) entry
function encodeDotDotRecord(buf, offset, parentLBA, parentDataLen, date) {
  return encodeDirRecord(buf, offset, {
    extentLBA: parentLBA, dataLen: parentDataLen, date, isDir: true,
    identifier: new Uint8Array([0x01]),
  });
}

// Encode a filename for the base (ISO 9660 Level 2) tree
// Uppercase, max 31 chars, invalid chars replaced with _, ;1 suffix for files
function encodeBaseIdentifier(name, isDir) {
  let base = name.toUpperCase().replace(/[^A-Z0-9_.\-]/g, '_');
  if (isDir) {
    base = base.substring(0, 31);
  } else {
    base = base.substring(0, 29) + ';1'; // leave room for ;1
    if (base.length > 31) base = base.substring(0, 31);
  }
  const buf = new Uint8Array(base.length);
  for (let i = 0; i < base.length; i++) buf[i] = base.charCodeAt(i);
  return buf;
}

// Encode a filename for the Joliet tree (UCS-2 BE, max 64 chars)
function encodeJolietIdentifier(name, isDir) {
  let s = isDir ? name.substring(0, 64) : name.substring(0, 62) + ';1';
  if (s.length > 64) s = s.substring(0, 64);
  return encodeUCS2(s);
}

// Decode a single directory record from buffer
function decodeDirRecord(buf, offset, isJoliet) {
  const recLen = buf[offset];
  if (recLen === 0) return null;

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const extentLBA = readBoth32(view, offset + 2);
  const dataLen = readBoth32(view, offset + 10);
  const date = decodeRecordingDate(buf, offset + 18);
  const flags = buf[offset + 25];
  const isDir = (flags & FLAG_DIRECTORY) !== 0;
  const identLen = buf[offset + 32];

  let name;
  if (identLen === 1 && buf[offset + 33] === 0x00) {
    name = '.';
  } else if (identLen === 1 && buf[offset + 33] === 0x01) {
    name = '..';
  } else if (isJoliet) {
    name = decodeUCS2(buf, offset + 33, identLen);
  } else {
    name = '';
    for (let i = 0; i < identLen; i++) name += String.fromCharCode(buf[offset + 33 + i]);
  }

  // Strip ;1 version suffix
  if (name.endsWith(';1')) name = name.substring(0, name.length - 2);

  return { name, extentLBA, dataLen, date, isDir, recordLen: recLen };
}

// Decode all directory records in a directory extent (may span multiple sectors)
function decodeDirExtent(buf, extentOffset, sectorCount, isJoliet) {
  const entries = [];
  const totalLen = sectorCount * SECTOR_SIZE;
  let pos = 0;

  while (pos < totalLen) {
    // Check if we're at a zero byte — skip to next sector boundary
    if (buf[extentOffset + pos] === 0) {
      const nextSector = (Math.floor(pos / SECTOR_SIZE) + 1) * SECTOR_SIZE;
      if (nextSector >= totalLen) break;
      pos = nextSector;
      continue;
    }

    const rec = decodeDirRecord(buf, extentOffset + pos, isJoliet);
    if (!rec) break;
    entries.push(rec);
    pos += rec.recordLen;
  }

  return entries;
}

export {
  dirRecordLength, encodeDirRecord, encodeDotRecord, encodeDotDotRecord,
  encodeBaseIdentifier, encodeJolietIdentifier,
  decodeDirRecord, decodeDirExtent,
};
