// ISO 9660 date/time encoding and decoding

// 7-byte recording date (used in directory records)
// [years-since-1900, month, day, hour, minute, second, GMT-offset-in-15min]
function encodeRecordingDate(date) {
  const buf = new Uint8Array(7);
  buf[0] = date.getFullYear() - 1900;
  buf[1] = date.getMonth() + 1;
  buf[2] = date.getDate();
  buf[3] = date.getHours();
  buf[4] = date.getMinutes();
  buf[5] = date.getSeconds();
  buf[6] = -(date.getTimezoneOffset() / 15) & 0xFF; // signed byte
  return buf;
}

function decodeRecordingDate(buf, offset) {
  const year = buf[offset] + 1900;
  const month = buf[offset + 1] - 1;
  const day = buf[offset + 2];
  const hour = buf[offset + 3];
  const min = buf[offset + 4];
  const sec = buf[offset + 5];
  // GMT offset in 15-min increments, signed
  const gmtOff = (buf[offset + 6] << 24) >> 24; // sign-extend
  const d = new Date(Date.UTC(year, month, day, hour, min, sec));
  d.setMinutes(d.getMinutes() - gmtOff * 15);
  return d;
}

// 17-byte decimal date (used in PVD/SVD)
// ASCII: "YYYYMMDDHHMMSScc" + 1 byte GMT offset
function encodeDecimalDate(date) {
  const buf = new Uint8Array(17);
  const s = date.getFullYear().toString().padStart(4, '0')
    + (date.getMonth() + 1).toString().padStart(2, '0')
    + date.getDate().toString().padStart(2, '0')
    + date.getHours().toString().padStart(2, '0')
    + date.getMinutes().toString().padStart(2, '0')
    + date.getSeconds().toString().padStart(2, '0')
    + '00'; // centiseconds
  for (let i = 0; i < 16; i++) buf[i] = s.charCodeAt(i);
  buf[16] = -(date.getTimezoneOffset() / 15) & 0xFF;
  return buf;
}

function decodeDecimalDate(buf, offset) {
  let s = '';
  for (let i = 0; i < 16; i++) s += String.fromCharCode(buf[offset + i]);
  if (s.trim() === '' || s[0] === '0' && s[1] === '0' && s[2] === '0' && s[3] === '0') return null;
  const year = parseInt(s.substring(0, 4));
  const month = parseInt(s.substring(4, 6)) - 1;
  const day = parseInt(s.substring(6, 8));
  const hour = parseInt(s.substring(8, 10));
  const min = parseInt(s.substring(10, 12));
  const sec = parseInt(s.substring(12, 14));
  const gmtOff = (buf[offset + 16] << 24) >> 24;
  const d = new Date(Date.UTC(year, month, day, hour, min, sec));
  d.setMinutes(d.getMinutes() - gmtOff * 15);
  return d;
}

// Zero-filled 17-byte date (for unused date fields)
function zeroDecimalDate() {
  return new Uint8Array(17);
}

export { encodeRecordingDate, decodeRecordingDate, encodeDecimalDate, decodeDecimalDate, zeroDecimalDate };
