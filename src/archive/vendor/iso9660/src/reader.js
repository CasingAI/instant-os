// ISO 9660 Reader — public API

import { SECTOR_SIZE, VD_PRIMARY, VD_SUPPLEMENTARY, VD_TERMINATOR } from './constants.js';
import { decodeDirExtent } from './dir-record.js';
import { decodeVolumeDescriptor } from './pvd.js';

class ISOReader {
  constructor(arrayBuffer) {
    this._buf = new Uint8Array(arrayBuffer);
    this._pvd = null;
    this._svd = null;
    this._joliet = false;

    this._parseDescriptors();
  }

  _parseDescriptors() {
    let sector = 16;
    while (sector * SECTOR_SIZE < this._buf.length) {
      const vd = decodeVolumeDescriptor(this._buf, sector);
      if (!vd) break;
      if (vd.type === VD_TERMINATOR) break;
      if (vd.type === VD_PRIMARY) this._pvd = vd;
      if (vd.type === VD_SUPPLEMENTARY && vd.isJoliet) this._svd = vd;
      sector++;
    }
    if (!this._pvd) throw new Error('No Primary Volume Descriptor found');
    this._joliet = !!this._svd;
  }

  get volumeId() { return this._pvd.volumeId; }
  get publisher() { return this._pvd.publisher; }
  get preparer() { return this._pvd.preparer; }
  get application() { return this._pvd.application; }
  get joliet() { return this._joliet; }

  // List all files (and optionally directories)
  // opts.stat: include size, date, isDir
  // opts.joliet: force Joliet tree (true/false), default: auto
  list(opts = {}) {
    const useJoliet = opts.joliet != null ? opts.joliet : this._joliet;
    const vd = useJoliet && this._svd ? this._svd : this._pvd;
    const results = [];

    this._walk(vd.rootExtentLBA, Math.ceil(vd.rootDataLen / SECTOR_SIZE), useJoliet, '', results, opts.stat);
    return results;
  }

  _walk(extentLBA, sectorCount, isJoliet, parentPath, results, stat) {
    const entries = decodeDirExtent(this._buf, extentLBA * SECTOR_SIZE, sectorCount, isJoliet);

    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue;

      const fullPath = parentPath + '/' + entry.name;

      if (entry.isDir) {
        const childSectors = Math.ceil(entry.dataLen / SECTOR_SIZE);
        this._walk(entry.extentLBA, childSectors, isJoliet, fullPath, results, stat);
      } else {
        if (stat) {
          results.push({ path: fullPath, size: entry.dataLen, date: entry.date, isDir: false });
        } else {
          results.push(fullPath);
        }
      }
    }
  }

  // Read a file — returns Uint8Array (zero-copy view into underlying buffer)
  read(path, opts = {}) {
    const useJoliet = opts.joliet != null ? opts.joliet : this._joliet;
    const vd = useJoliet && this._svd ? this._svd : this._pvd;

    const entry = this._findFile(vd.rootExtentLBA, Math.ceil(vd.rootDataLen / SECTOR_SIZE),
      useJoliet, path);
    if (!entry) throw new Error(`File not found: ${path}`);

    return new Uint8Array(this._buf.buffer, this._buf.byteOffset + entry.extentLBA * SECTOR_SIZE, entry.dataLen);
  }

  // Read a file as text
  readText(path, opts = {}) {
    return new TextDecoder().decode(this.read(path, opts));
  }

  // List entries in a specific directory
  readdir(path, opts = {}) {
    const useJoliet = opts.joliet != null ? opts.joliet : this._joliet;
    const vd = useJoliet && this._svd ? this._svd : this._pvd;

    // Find the directory
    const dir = path === '/' || path === ''
      ? { extentLBA: vd.rootExtentLBA, dataLen: vd.rootDataLen }
      : this._findDir(vd.rootExtentLBA, Math.ceil(vd.rootDataLen / SECTOR_SIZE), useJoliet, path);

    if (!dir) throw new Error(`Directory not found: ${path}`);

    const entries = decodeDirExtent(this._buf, dir.extentLBA * SECTOR_SIZE,
      Math.ceil(dir.dataLen / SECTOR_SIZE), useJoliet);

    return entries
      .filter(e => e.name !== '.' && e.name !== '..')
      .map(e => ({ name: e.name, size: e.dataLen, date: e.date, isDir: e.isDir }));
  }

  _findFile(extentLBA, sectorCount, isJoliet, path) {
    // Normalize path
    const parts = path.replace(/^\//, '').split('/').filter(p => p.length > 0);
    return this._findEntry(extentLBA, sectorCount, isJoliet, parts, false);
  }

  _findDir(extentLBA, sectorCount, isJoliet, path) {
    const parts = path.replace(/^\//, '').split('/').filter(p => p.length > 0);
    return this._findEntry(extentLBA, sectorCount, isJoliet, parts, true);
  }

  _findEntry(extentLBA, sectorCount, isJoliet, parts, isDir) {
    if (parts.length === 0) return null;

    const entries = decodeDirExtent(this._buf, extentLBA * SECTOR_SIZE, sectorCount, isJoliet);
    const target = parts[0];

    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue;

      // Case-insensitive match for base tree, exact for Joliet
      const match = isJoliet
        ? entry.name === target
        : entry.name.toUpperCase() === target.toUpperCase();

      if (match) {
        if (parts.length === 1) {
          // Last component — check if it's the right type
          if (isDir && !entry.isDir) continue;
          if (!isDir && entry.isDir) continue;
          return entry;
        }
        // More path components — must be a directory
        if (entry.isDir) {
          return this._findEntry(entry.extentLBA, Math.ceil(entry.dataLen / SECTOR_SIZE),
            isJoliet, parts.slice(1), isDir);
        }
      }
    }

    return null;
  }
}

export { ISOReader };
