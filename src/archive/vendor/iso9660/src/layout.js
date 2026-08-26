// ISO 9660 two-pass layout engine
// Pass 1: compute sector assignments for all metadata and file extents
// Pass 2: write bytes (handled by writer.js)

import { SECTOR_SIZE } from './constants.js';
import { dirRecordLength, encodeBaseIdentifier, encodeJolietIdentifier } from './dir-record.js';

// Build a directory tree from flat file paths
// Returns root node: { name, children: Map<name, node>, files: [{ name, data }], parent }
function buildTree(fileList) {
  const root = { name: '', children: new Map(), files: [], parent: null };

  for (const { path, data } of fileList) {
    const parts = path.split('/').filter(p => p.length > 0);
    if (parts.length === 0) throw new Error('Empty path');

    let node = root;
    // Create intermediate directories
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];
      if (!node.children.has(dirName)) {
        const child = { name: dirName, children: new Map(), files: [], parent: node };
        node.children.set(dirName, child);
      }
      node = node.children.get(dirName);
    }

    const fileName = parts[parts.length - 1];
    // Check for duplicate
    if (node.files.some(f => f.name === fileName)) {
      throw new Error(`Duplicate path: ${path}`);
    }
    node.files.push({ name: fileName, data });
  }

  return root;
}

// Flatten directory tree into depth-first order (for path table and sector assignment)
// Returns array of { node, depth, index (1-based), parentIndex (1-based) }
function flattenTree(root) {
  const result = [];
  const queue = [{ node: root, depth: 0, parentIndex: 1 }];

  // BFS to get breadth-first order (required for path tables)
  while (queue.length > 0) {
    const { node, depth, parentIndex } = queue.shift();
    const index = result.length + 1; // 1-based
    result.push({ node, depth, index, parentIndex });

    for (const child of node.children.values()) {
      if (depth + 1 > 8) throw new Error('Directory depth exceeds 8 levels');
      queue.push({ node: child, depth: depth + 1, parentIndex: index });
    }
  }

  return result;
}

// Compute how many sectors a directory extent needs
function computeDirExtentSize(node, isJoliet) {
  // Start with dot and dotdot entries (34 bytes each — identifier is 1 byte)
  let size = 34 + 34;
  let sectorPos = size; // position within current sector

  // Directory entries
  for (const child of node.children.values()) {
    const ident = isJoliet
      ? encodeJolietIdentifier(child.name, true)
      : encodeBaseIdentifier(child.name, true);
    const recLen = dirRecordLength(ident.length);
    // Check if record fits in current sector
    if (sectorPos + recLen > SECTOR_SIZE) {
      // Skip to next sector
      size += (SECTOR_SIZE - sectorPos);
      sectorPos = 0;
    }
    size += recLen;
    sectorPos += recLen;
  }

  // File entries
  for (const file of node.files) {
    const ident = isJoliet
      ? encodeJolietIdentifier(file.name, false)
      : encodeBaseIdentifier(file.name, false);
    const recLen = dirRecordLength(ident.length);
    if (sectorPos + recLen > SECTOR_SIZE) {
      size += (SECTOR_SIZE - sectorPos);
      sectorPos = 0;
    }
    size += recLen;
    sectorPos += recLen;
  }

  // Round up to sector boundary
  return Math.ceil(size / SECTOR_SIZE) * SECTOR_SIZE;
}

// Compute path table size
function computePathTableSize(dirs, isJoliet) {
  let size = 0;
  for (const { node, index } of dirs) {
    let nameLen;
    if (index === 1) {
      nameLen = 1; // root: single zero byte
    } else if (isJoliet) {
      nameLen = encodeJolietIdentifier(node.name, true).length;
      // Path table uses directory name without ;1, so re-encode as dir name
      const name = node.name.substring(0, 64);
      nameLen = name.length * 2; // UCS-2
    } else {
      const name = node.name.toUpperCase().replace(/[^A-Z0-9_.\-]/g, '_').substring(0, 31);
      nameLen = name.length;
    }
    size += 8 + nameLen + (nameLen % 2);
  }
  return size;
}

// Main layout computation
// Returns a layout descriptor with all sector assignments
function computeLayout(fileList, opts = {}) {
  const joliet = opts.joliet !== false;

  // Validate file sizes
  for (const { path, data } of fileList) {
    if (data.byteLength > 0xFFFFFFFF) {
      throw new Error(`File exceeds 4 GiB: ${path}`);
    }
  }

  const root = buildTree(fileList);
  const dirs = flattenTree(root);

  // Sector counter
  let sector = 0;

  // System area: sectors 0-15
  const systemAreaStart = 0;
  sector = 16;

  // PVD: sector 16
  const pvdSector = sector++;

  // SVD (Joliet): sector 17 (if enabled)
  const svdSector = joliet ? sector++ : -1;

  // Terminator
  const terminatorSector = sector++;

  // Path tables (base LE, base BE, joliet LE, joliet BE)
  const basePathTableSize = computePathTableSize(dirs, false);
  const basePathTableSectors = Math.ceil(basePathTableSize / SECTOR_SIZE);

  const basePathTableLE = sector;
  sector += basePathTableSectors;
  const basePathTableBE = sector;
  sector += basePathTableSectors;

  let jolietPathTableLE = -1, jolietPathTableBE = -1, jolietPathTableSize = 0;
  if (joliet) {
    jolietPathTableSize = computePathTableSize(dirs, true);
    const jolietPathTableSectors = Math.ceil(jolietPathTableSize / SECTOR_SIZE);
    jolietPathTableLE = sector;
    sector += jolietPathTableSectors;
    jolietPathTableBE = sector;
    sector += jolietPathTableSectors;
  }

  // Directory extents (base tree)
  const baseDirExtents = [];
  for (const dir of dirs) {
    const extentSize = computeDirExtentSize(dir.node, false);
    baseDirExtents.push({ sector, size: extentSize, sectors: extentSize / SECTOR_SIZE });
    sector += extentSize / SECTOR_SIZE;
  }

  // Directory extents (Joliet tree)
  const jolietDirExtents = [];
  if (joliet) {
    for (const dir of dirs) {
      const extentSize = computeDirExtentSize(dir.node, true);
      jolietDirExtents.push({ sector, size: extentSize, sectors: extentSize / SECTOR_SIZE });
      sector += extentSize / SECTOR_SIZE;
    }
  }

  // File data extents — collect all unique files, assign sectors
  const allFiles = [];
  function collectFiles(node) {
    for (const file of node.files) {
      const sectors = Math.ceil(file.data.byteLength / SECTOR_SIZE) || 1; // at least 1 sector even for empty
      // Actually, empty files can have 0 sectors and LBA 0
      const fileSectors = file.data.byteLength > 0 ? Math.ceil(file.data.byteLength / SECTOR_SIZE) : 0;
      allFiles.push({ file, sector: 0, sectors: fileSectors });
    }
    for (const child of node.children.values()) collectFiles(child);
  }
  collectFiles(root);

  // Assign sectors to files
  for (const entry of allFiles) {
    if (entry.sectors > 0) {
      entry.sector = sector;
      sector += entry.sectors;
    }
    // Store LBA on the file object for later reference
    entry.file._lba = entry.sector;
    entry.file._size = entry.file.data.byteLength;
  }

  const totalSectors = sector;

  return {
    root, dirs,
    totalSectors,
    pvdSector, svdSector, terminatorSector,
    basePathTableLE, basePathTableBE, basePathTableSize,
    jolietPathTableLE, jolietPathTableBE, jolietPathTableSize,
    baseDirExtents, jolietDirExtents,
    allFiles,
    joliet,
  };
}

export { computeLayout, buildTree, flattenTree };
