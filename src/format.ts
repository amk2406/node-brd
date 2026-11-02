/**
 * node-brd binary format definitions and low-level helpers
 *
 * Structure:
 *   [ Header 32 bytes ]
 *   [ Index entries   ]
 *   [ Data section    ]
 */

export const MAGIC = Buffer.from('BRD1');
export const VERSION = 1;
export const HEADER_SIZE = 32;

export const FLAG_COMPRESS = 1 << 0;

export interface ResourceEntry {
  name: string;
  dataOffset: number;
  originalSize: number;
  compressedSize: number;
  flags: number;
  checksum: number;
  metadata: Buffer | null;
}

export interface ArchiveHeader {
  magic: string;
  version: number;
  flags: number;
  entryCount: number;
  indexOffset: number;
  dataOffset: number;
  totalSize: number;
}

export function createHeader(
  entryCount: number,
  indexOffset: number,
  dataOffset: number,
  flags: number = 0,
  totalSize: number = 0
): Buffer {
  const buf = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(buf, 0);
  buf.writeUInt16LE(VERSION, 4);
  buf.writeUInt16LE(flags, 6);
  buf.writeUInt32LE(entryCount, 8);
  buf.writeUInt32LE(indexOffset, 12);
  buf.writeUInt32LE(dataOffset, 16);
  buf.writeUInt32LE(totalSize, 20);
  // bytes 24-31 reserved (zeroed)
  return buf;
}

export function parseHeader(buf: Buffer): ArchiveHeader {
  if (buf.length < HEADER_SIZE) {
    throw new Error('Invalid .brd file: header too short');
  }
  const magic = buf.subarray(0, 4).toString('ascii');
  if (magic !== 'BRD1') {
    throw new Error(`Invalid .brd file: bad magic "${magic}" (expected BRD1)`);
  }
  return {
    magic,
    version: buf.readUInt16LE(4),
    flags: buf.readUInt16LE(6),
    entryCount: buf.readUInt32LE(8),
    indexOffset: buf.readUInt32LE(12),
    dataOffset: buf.readUInt32LE(16),
    totalSize: buf.readUInt32LE(20),
  };
}

/**
 * Serialize one index entry
 */
export function serializeEntry(entry: ResourceEntry): Buffer {
  const nameBuf = Buffer.from(entry.name, 'utf8');
  const meta = entry.metadata || Buffer.alloc(0);

  // nameLength(2) + name + dataOffset(4) + originalSize(4) + compressedSize(4)
  // + flags(2) + checksum(4) + metaLength(2) + metadata
  const size = 2 + nameBuf.length + 4 + 4 + 4 + 2 + 4 + 2 + meta.length;
  const buf = Buffer.alloc(size);
  let offset = 0;

  buf.writeUInt16LE(nameBuf.length, offset);
  offset += 2;
  nameBuf.copy(buf, offset);
  offset += nameBuf.length;

  buf.writeUInt32LE(entry.dataOffset, offset);
  offset += 4;
  buf.writeUInt32LE(entry.originalSize, offset);
  offset += 4;
  buf.writeUInt32LE(entry.compressedSize, offset);
  offset += 4;
  buf.writeUInt16LE(entry.flags, offset);
  offset += 2;
  buf.writeUInt32LE(entry.checksum, offset);
  offset += 4;
  buf.writeUInt16LE(meta.length, offset);
  offset += 2;
  if (meta.length > 0) {
    meta.copy(buf, offset);
  }

  return buf;
}

/**
 * Parse index entries starting at the given buffer offset
 */
export function parseIndex(buf: Buffer, entryCount: number, startOffset: number): ResourceEntry[] {
  const entries: ResourceEntry[] = [];
  let offset = startOffset;

  for (let i = 0; i < entryCount; i++) {
    if (offset + 2 > buf.length) {
      throw new Error('Corrupted index: unexpected end of file');
    }
    const nameLen = buf.readUInt16LE(offset);
    offset += 2;

    if (offset + nameLen + 4 + 4 + 4 + 2 + 4 + 2 > buf.length) {
      throw new Error('Corrupted index: entry truncated');
    }

    const name = buf.subarray(offset, offset + nameLen).toString('utf8');
    offset += nameLen;

    const dataOffset = buf.readUInt32LE(offset);
    offset += 4;
    const originalSize = buf.readUInt32LE(offset);
    offset += 4;
    const compressedSize = buf.readUInt32LE(offset);
    offset += 4;
    const flags = buf.readUInt16LE(offset);
    offset += 2;
    const checksum = buf.readUInt32LE(offset);
    offset += 4;
    const metaLen = buf.readUInt16LE(offset);
    offset += 2;

    let metadata: Buffer | null = null;
    if (metaLen > 0) {
      if (offset + metaLen > buf.length) {
        throw new Error('Corrupted index: metadata truncated');
      }
      metadata = Buffer.from(buf.subarray(offset, offset + metaLen));
      offset += metaLen;
    }

    entries.push({
      name,
      dataOffset,
      originalSize,
      compressedSize,
      flags,
      checksum,
      metadata,
    });
  }

  return entries;
}
