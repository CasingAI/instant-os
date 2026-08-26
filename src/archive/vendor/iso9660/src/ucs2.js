// UCS-2 Big Endian encode/decode for Joliet filenames

function encodeUCS2(str, maxBytes) {
  const max = maxBytes != null ? maxBytes : str.length * 2;
  const chars = Math.min(str.length, max >> 1);
  const buf = new Uint8Array(chars * 2);
  for (let i = 0; i < chars; i++) {
    const c = str.charCodeAt(i);
    buf[i * 2] = (c >> 8) & 0xFF;
    buf[i * 2 + 1] = c & 0xFF;
  }
  return buf;
}

function decodeUCS2(buf, offset, length) {
  let str = '';
  for (let i = 0; i < length; i += 2) {
    const c = (buf[offset + i] << 8) | buf[offset + i + 1];
    if (c === 0) break;
    str += String.fromCharCode(c);
  }
  return str;
}

// Pad a UCS-2 encoded string into a fixed-size field (for PVD/SVD string fields)
function writeUCS2Padded(target, offset, str, fieldLen) {
  const encoded = encodeUCS2(str, fieldLen);
  target.set(encoded, offset);
  // Pad remaining bytes with 0x00
  for (let i = encoded.length; i < fieldLen; i++) target[offset + i] = 0;
}

export { encodeUCS2, decodeUCS2, writeUCS2Padded };
