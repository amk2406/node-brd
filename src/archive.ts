import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import {
  HEADER_SIZE,
  FLAG_COMPRESS,
  createHeader,
  parseHeader,
  serializeEntry,
  parseIndex,
  ResourceEntry,
} from './format';
import { crc32 } from './crc32';

const deflate = promisify(zlib.deflate);
const inflate = promisify(zlib.inflate);

export interface CreateOptions {
  /** Enable compression for all added resources (default: false) */
  compress?: boolean;
}

export interface AddOptions {
  /** Override compression for this resource */
  compress?: boolean;
  /** Optional metadata (object will be JSON.stringified) */
  metadata?: Record<string, any> | Buffer | string;
}

export interface ResourceInfo {
  name: string;
  size: number;
  compressedSize: number;
  compressed: boolean;
  checksum: number;
  metadata: any | null;
}

export class BrdArchive {
  private filePath: string | null = null;
  private entries: Map<string, ResourceEntry> = new Map();
  private data = new Map<string, Buffer>(); // name -> uncompressed data
  private compressDefault: boolean;
  private dirty = false;

  private constructor(compressDefault = false) {
    this.compressDefault = compressDefault;
  }

  /** Create a brand new empty archive */
  static create(options: CreateOptions = {}): BrdArchive {
    return new BrdArchive(!!options.compress);
  }

  /** Open an existing .brd file */
  static open(filePath: string): BrdArchive {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) {
      throw new Error(`File not found: ${abs}`);
    }

    const buf = fs.readFileSync(abs);
    const header = parseHeader(buf);

    if (header.version !== 1) {
      throw new Error(`Unsupported .brd version: ${header.version}`);
    }

    const entries = parseIndex(buf, header.entryCount, header.indexOffset);
    const archive = new BrdArchive((header.flags & FLAG_COMPRESS) !== 0);
    archive.filePath = abs;

    for (const entry of entries) {
      archive.entries.set(entry.name, entry);

      // Load data (decompress if needed)
      const raw = buf.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
      let data: Buffer;

      if (entry.flags & FLAG_COMPRESS) {
        data = zlib.inflateSync(raw);
      } else {
        data = Buffer.from(raw);
      }

      // Optional integrity check
      if (entry.checksum !== 0) {
        const calculated = crc32(data);
        if (calculated !== entry.checksum) {
          console.warn(`Warning: checksum mismatch for "${entry.name}"`);
        }
      }

      archive.data.set(entry.name, data);
    }

    return archive;
  }

  /** Add a resource (from Buffer, string, or file path) */
  add(name: string, content: Buffer | string | number[], options: AddOptions = {}): this {
    if (!name || typeof name !== 'string') {
      throw new Error('Resource name is required');
    }

    // Normalize path separators
    name = name.replace(/\\/g, '/').replace(/^\/+/, '');

    let data: Buffer;
    if (Buffer.isBuffer(content)) {
      data = content;
    } else if (typeof content === 'string') {
      // If it looks like a file path and exists, read it
      if (fs.existsSync(content) && fs.statSync(content).isFile()) {
        data = fs.readFileSync(content);
      } else {
        data = Buffer.from(content, 'utf8');
      }
    } else if (Array.isArray(content)) {
      data = Buffer.from(content);
    } else {
      throw new Error('Content must be Buffer, string, or number[]');
    }

    let metadata: Buffer | null = null;
    if (options.metadata !== undefined) {
      if (Buffer.isBuffer(options.metadata)) {
        metadata = options.metadata;
      } else if (typeof options.metadata === 'string') {
        metadata = Buffer.from(options.metadata, 'utf8');
      } else {
        metadata = Buffer.from(JSON.stringify(options.metadata), 'utf8');
      }
    }

    const shouldCompress = options.compress !== undefined ? options.compress : this.compressDefault;
    const flags = shouldCompress ? FLAG_COMPRESS : 0;
    const checksum = crc32(data);

    // We store uncompressed in memory; compression happens on save
    this.data.set(name, data);
    this.entries.set(name, {
      name,
      dataOffset: 0, // will be calculated on save
      originalSize: data.length,
      compressedSize: data.length, // updated on save
      flags,
      checksum,
      metadata,
    });

    this.dirty = true;
    return this;
  }

  /** Import (get) a resource as Buffer */
  import(name: string): Buffer {
    name = name.replace(/\\/g, '/').replace(/^\/+/, '');
    const data = this.data.get(name);
    if (!data) {
      throw new Error(`Resource not found: ${name}`);
    }
    return Buffer.from(data); // return a copy
  }

  /** Check if a resource exists */
  has(name: string): boolean {
    name = name.replace(/\\/g, '/').replace(/^\/+/, '');
    return this.data.has(name);
  }

  /** Delete a resource */
  delete(name: string): boolean {
    name = name.replace(/\\/g, '/').replace(/^\/+/, '');
    const existed = this.data.delete(name);
    this.entries.delete(name);
    if (existed) this.dirty = true;
    return existed;
  }

  /** Rename a resource */
  rename(oldName: string, newName: string): this {
    oldName = oldName.replace(/\\/g, '/').replace(/^\/+/, '');
    newName = newName.replace(/\\/g, '/').replace(/^\/+/, '');

    if (!this.data.has(oldName)) {
      throw new Error(`Resource not found: ${oldName}`);
    }
    if (this.data.has(newName)) {
      throw new Error(`Target name already exists: ${newName}`);
    }

    const data = this.data.get(oldName)!;
    const entry = this.entries.get(oldName)!;

    this.data.delete(oldName);
    this.entries.delete(oldName);

    entry.name = newName;
    this.data.set(newName, data);
    this.entries.set(newName, entry);
    this.dirty = true;
    return this;
  }

  /** List all resource names */
  list(): string[] {
    return Array.from(this.entries.keys()).sort();
  }

  /** Get detailed info about all resources */
  listInfo(): ResourceInfo[] {
    return Array.from(this.entries.values())
      .map((e) => ({
        name: e.name,
        size: e.originalSize,
        compressedSize: e.compressedSize,
        compressed: (e.flags & FLAG_COMPRESS) !== 0,
        checksum: e.checksum,
        metadata: e.metadata ? safeJsonParse(e.metadata) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Extract one resource to a file or directory */
  extract(name: string, outputPath: string): void {
    name = name.replace(/\\/g, '/').replace(/^\/+/, '');
    const data = this.import(name);

    let target = path.resolve(outputPath);
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      target = path.join(target, path.basename(name));
    }

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }

  /** Extract all resources to a directory (preserves folder structure) */
  extractAll(outputDir: string): void {
    const base = path.resolve(outputDir);
    fs.mkdirSync(base, { recursive: true });

    for (const name of this.list()) {
      const target = path.join(base, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, this.import(name));
    }
  }

  /** Save the archive to disk */
  save(filePath?: string): void {
    const target = filePath ? path.resolve(filePath) : this.filePath;
    if (!target) {
      throw new Error('No file path specified. Call save("filename.brd")');
    }

    // Build data section first
    const dataBuffers: Buffer[] = [];
    let dataOffset = 0;
    const finalEntries: ResourceEntry[] = [];

    for (const [name, entry] of this.entries) {
      const original = this.data.get(name)!;
      let payload: Buffer;
      let compressedSize: number;
      let flags = entry.flags;

      if (flags & FLAG_COMPRESS) {
        payload = zlib.deflateSync(original);
        compressedSize = payload.length;
      } else {
        payload = original;
        compressedSize = original.length;
      }

      finalEntries.push({
        ...entry,
        name,
        dataOffset, // relative to start of data section for now
        originalSize: original.length,
        compressedSize,
        flags,
      });

      dataBuffers.push(payload);
      dataOffset += payload.length;
    }

    // Build index
    const indexBuffers = finalEntries.map(serializeEntry);
    const indexSize = indexBuffers.reduce((sum, b) => sum + b.length, 0);

    // Calculate absolute offsets
    const indexOffset = HEADER_SIZE;
    const absoluteDataOffset = HEADER_SIZE + indexSize;

    // Fix dataOffset in entries to be absolute
    for (const entry of finalEntries) {
      entry.dataOffset += absoluteDataOffset;
    }

    // Rebuild index with correct absolute offsets
    const finalIndexBuffers = finalEntries.map(serializeEntry);
    const indexBuf = Buffer.concat(finalIndexBuffers);
    const dataBuf = Buffer.concat(dataBuffers);

    const totalSize = HEADER_SIZE + indexBuf.length + dataBuf.length;
    const headerFlags = this.compressDefault ? FLAG_COMPRESS : 0;
    const header = createHeader(
      finalEntries.length,
      indexOffset,
      absoluteDataOffset,
      headerFlags,
      totalSize
    );

    const full = Buffer.concat([header, indexBuf, dataBuf]);
    fs.writeFileSync(target, full);

    this.filePath = target;
    this.dirty = false;

    // Update internal entries with final offsets
    this.entries.clear();
    for (const e of finalEntries) {
      this.entries.set(e.name, e);
    }
  }

  /** Get the path this archive is associated with */
  get path(): string | null {
    return this.filePath;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  get size(): number {
    return this.entries.size;
  }
}

function safeJsonParse(buf: Buffer): any {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return buf.toString('utf8');
  }
}
