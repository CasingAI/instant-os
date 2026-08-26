// Both-endian (LE + BE) encoding for ISO 9660 multi-byte integers

function writeBoth16(view, offset, value) {
  view.setUint16(offset, value, true);      // LE
  view.setUint16(offset + 2, value, false); // BE
}

function writeBoth32(view, offset, value) {
  view.setUint32(offset, value, true);      // LE
  view.setUint32(offset + 4, value, false); // BE
}

function readBoth16(view, offset) {
  return view.getUint16(offset, true); // read LE half
}

function readBoth32(view, offset) {
  return view.getUint32(offset, true); // read LE half
}

export { writeBoth16, writeBoth32, readBoth16, readBoth32 };
