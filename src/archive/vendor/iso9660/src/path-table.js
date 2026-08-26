// ISO 9660 path table encode/decode

import { encodeUCS2, decodeUCS2 } from './ucs2.js';

// Encode a path table from an array of directory entries
// dirs: [{ name, extentLBA, parentIndex }] — parentIndex is 1-based
// endianness: 'le' or 'be'
function encodePathTable(dirs, endianness) {
  const isLE = endianness === 'le';

  // Compute total size first
  let totalSize = 0;
  for (const dir of dirs) {
    const nameBytes = dir.nameBytes || new Uint8Array(dir.name === '\x00' ? [0] : Array.from(dir.name, c => c.charCodeAt(0)));
    const n = nameBytes.length;
    totalSize += 8 + n + (n % 2); // 8 fixed + name + padding
  }

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  let offset = 0;

  for (const dir of dirs) {
    const nameBytes = dir.nameBytes || new Uint8Array(dir.name === '\x00' ? [0] : Array.from(dir.name, c => c.charCodeAt(0)));
    const n = nameBytes.length;

    buf[offset] = n;     // Directory Identifier Length
    buf[offset + 1] = 0; // Extended Attribute Record Length

    if (isLE) {
      view.setUint32(offset + 2, dir.extentLBA, true);
      view.setUint16(offset + 6, dir.parentIndex, true);
    } else {
      view.setUint32(offset + 2, dir.extentLBA, false);
      view.setUint16(offset + 6, dir.parentIndex, false);
    }

    buf.set(nameBytes, offset + 8);
    offset += 8 + n + (n % 2);
  }

  return buf;
}

// Decode a path table
function decodePathTable(buf, offset, size, endianness) {
  const isLE = endianness === 'le';
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dirs = [];
  let pos = 0;

  while (pos < size) {
    const n = buf[offset + pos];
    if (n === 0) break;
    const extentLBA = isLE
      ? view.getUint32(offset + pos + 2, true)
      : view.getUint32(offset + pos + 2, false);
    const parentIndex = isLE
      ? view.getUint16(offset + pos + 6, true)
      : view.getUint16(offset + pos + 6, false);

    let name;
    if (n === 1 && buf[offset + pos + 8] === 0) {
      name = '\x00'; // root
    } else {
      name = '';
      for (let i = 0; i < n; i++) name += String.fromCharCode(buf[offset + pos + 8 + i]);
    }

    dirs.push({ name, extentLBA, parentIndex });
    pos += 8 + n + (n % 2);
  }

  return dirs;
}

export { encodePathTable, decodePathTable };
