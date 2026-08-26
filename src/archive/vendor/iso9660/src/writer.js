// ISO 9660 Writer — public API

import { SECTOR_SIZE, GREETING } from './constants.js';
import { encodePVD, encodeSVD, encodeTerminator } from './pvd.js';
import { encodePathTable } from './path-table.js';
import {
  encodeDotRecord, encodeDotDotRecord, encodeDirRecord,
  encodeBaseIdentifier, encodeJolietIdentifier,
} from './dir-record.js';
import { encodeUCS2 } from './ucs2.js';
import { computeLayout } from './layout.js';

class ISOWriter {
  constructor(opts = {}) {
    this._opts = {
      volumeId: opts.volumeId || 'UNTITLED',
      publisher: opts.publisher || '',
      preparer: opts.preparer || '',
      application: opts.application || '',
      joliet: opts.joliet !== false,
      greeting: opts.greeting !== false,
    };
    this._files = [];
  }

  // Add a file to the image
  // path: string with "/" separators (e.g., "data/file.txt")
  // data: Uint8Array or ArrayBuffer
  add(path, data) {
    if (data instanceof ArrayBuffer) data = new Uint8Array(data);
    if (!(data instanceof Uint8Array)) throw new Error('data must be Uint8Array or ArrayBuffer');
    this._files.push({ path, data });
  }

  _build() {
    const layout = computeLayout(this._files, { joliet: this._opts.joliet });
    const buf = new Uint8Array(layout.totalSectors * SECTOR_SIZE);
    const date = new Date();

    // System area (sectors 0-15) — zeros + optional greeting
    if (this._opts.greeting) {
      const greetBytes = new TextEncoder().encode(GREETING);
      const greetOffset = 16 * SECTOR_SIZE - greetBytes.length;
      buf.set(greetBytes, greetOffset);
    }

    // Build root directory record for PVD (34 bytes)
    function makeRootDirRecord(extentLBA, dataLen) {
      const rec = new Uint8Array(34);
      encodeDotRecord(rec, 0, extentLBA, dataLen, date);
      return rec;
    }

    // Write PVD
    const baseRootRec = makeRootDirRecord(
      layout.baseDirExtents[0].sector,
      layout.baseDirExtents[0].size,
    );
    const pvd = encodePVD({
      volumeId: this._opts.volumeId,
      publisher: this._opts.publisher,
      preparer: this._opts.preparer,
      application: this._opts.application,
      volumeSpaceSize: layout.totalSectors,
      pathTableSize: layout.basePathTableSize,
      pathTableLBA_LE: layout.basePathTableLE,
      pathTableLBA_BE: layout.basePathTableBE,
      rootRecord: baseRootRec,
      date,
    });
    buf.set(pvd, layout.pvdSector * SECTOR_SIZE);

    // Write SVD (Joliet)
    if (layout.joliet) {
      const jolietRootRec = makeRootDirRecord(
        layout.jolietDirExtents[0].sector,
        layout.jolietDirExtents[0].size,
      );
      const svd = encodeSVD({
        volumeId: this._opts.volumeId,
        publisher: this._opts.publisher,
        preparer: this._opts.preparer,
        application: this._opts.application,
        volumeSpaceSize: layout.totalSectors,
        pathTableSize: layout.jolietPathTableSize,
        pathTableLBA_LE: layout.jolietPathTableLE,
        pathTableLBA_BE: layout.jolietPathTableBE,
        rootRecord: jolietRootRec,
        date,
      });
      buf.set(svd, layout.svdSector * SECTOR_SIZE);
    }

    // Write terminator
    buf.set(encodeTerminator(), layout.terminatorSector * SECTOR_SIZE);

    // Write path tables
    this._writePathTables(buf, layout, false); // base
    if (layout.joliet) this._writePathTables(buf, layout, true); // joliet

    // Write directory extents
    this._writeDirExtents(buf, layout, false, date);
    if (layout.joliet) this._writeDirExtents(buf, layout, true, date);

    // Write file data
    for (const entry of layout.allFiles) {
      if (entry.file.data.byteLength > 0) {
        buf.set(entry.file.data, entry.sector * SECTOR_SIZE);
      }
    }

    return buf;
  }

  _writePathTables(buf, layout, isJoliet) {
    const dirs = layout.dirs;
    const extents = isJoliet ? layout.jolietDirExtents : layout.baseDirExtents;
    const leLBA = isJoliet ? layout.jolietPathTableLE : layout.basePathTableLE;
    const beLBA = isJoliet ? layout.jolietPathTableBE : layout.basePathTableBE;

    const entries = dirs.map((dir, i) => {
      let nameBytes;
      if (dir.index === 1) {
        nameBytes = new Uint8Array([0]); // root
      } else if (isJoliet) {
        const name = dir.node.name.substring(0, 64);
        nameBytes = encodeUCS2(name);
      } else {
        const name = dir.node.name.toUpperCase().replace(/[^A-Z0-9_.\-]/g, '_').substring(0, 31);
        nameBytes = new Uint8Array(Array.from(name, c => c.charCodeAt(0)));
      }
      return {
        nameBytes,
        extentLBA: extents[i].sector,
        parentIndex: dir.parentIndex,
      };
    });

    const leTable = encodePathTable(entries, 'le');
    const beTable = encodePathTable(entries, 'be');
    buf.set(leTable, leLBA * SECTOR_SIZE);
    buf.set(beTable, beLBA * SECTOR_SIZE);
  }

  _writeDirExtents(buf, layout, isJoliet, date) {
    const dirs = layout.dirs;
    const extents = isJoliet ? layout.jolietDirExtents : layout.baseDirExtents;

    for (let di = 0; di < dirs.length; di++) {
      const { node } = dirs[di];
      const extent = extents[di];
      const extentOff = extent.sector * SECTOR_SIZE;

      // Parent extent info
      const parentIdx = dirs[di].parentIndex - 1; // 0-based for array lookup
      const parentExtent = extents[parentIdx];

      let pos = 0;

      // Dot entry (self)
      pos += encodeDotRecord(buf, extentOff + pos, extent.sector, extent.size, date);

      // Dotdot entry (parent)
      pos += encodeDotDotRecord(buf, extentOff + pos, parentExtent.sector, parentExtent.size, date);

      // Directory children
      for (const child of node.children.values()) {
        const childDirIdx = dirs.findIndex(d => d.node === child);
        const childExtent = extents[childDirIdx];

        const ident = isJoliet
          ? encodeJolietIdentifier(child.name, true)
          : encodeBaseIdentifier(child.name, true);

        const recLen = 33 + ident.length + ((33 + ident.length) % 2 === 1 ? 1 : 0);

        // Sector boundary check
        const sectorPos = pos % SECTOR_SIZE;
        if (sectorPos + recLen > SECTOR_SIZE) {
          pos += SECTOR_SIZE - sectorPos; // skip to next sector
        }

        pos += encodeDirRecord(buf, extentOff + pos, {
          extentLBA: childExtent.sector,
          dataLen: childExtent.size,
          date,
          isDir: true,
          identifier: ident,
        });
      }

      // File entries
      for (const file of node.files) {
        const ident = isJoliet
          ? encodeJolietIdentifier(file.name, false)
          : encodeBaseIdentifier(file.name, false);

        const recLen = 33 + ident.length + ((33 + ident.length) % 2 === 1 ? 1 : 0);

        const sectorPos = pos % SECTOR_SIZE;
        if (sectorPos + recLen > SECTOR_SIZE) {
          pos += SECTOR_SIZE - sectorPos;
        }

        pos += encodeDirRecord(buf, extentOff + pos, {
          extentLBA: file._lba,
          dataLen: file._size,
          date,
          isDir: false,
          identifier: ident,
        });
      }
    }
  }

  toUint8Array() {
    return this._build();
  }

  toBlob() {
    return new Blob([this._build()], { type: 'application/octet-stream' });
  }

  download(filename) {
    const blob = this.toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'image.iso';
    a.click();
    URL.revokeObjectURL(url);
  }
}

export { ISOWriter };
