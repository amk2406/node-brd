# brd-node

**Binary Resources Data (`.brd`) archives for Node.js**

`brd-node` is a zero-dependency module for creating, reading, extracting, updating and managing `.brd` files — a compact binary container format designed for packing application resources (images, configs, JSON, binary assets, etc.) into a single file.

---

## Features

- Create new `.brd` archives
- Add files or buffers (with optional per-file compression)
- Import / extract single or all resources
- Delete and rename resources
- List resources + detailed info (size, checksum, metadata)
- Folder-style paths (`images/icon.png`)
- Optional zlib compression
- CRC32 integrity checksums
- Full TypeScript support
- Built-in CLI (`node-brd` / `brd`)
- Zero runtime dependencies (only Node.js built-ins)

---

## Installation

```bash
npm install brd-node
```

For global CLI usage:

```bash
npm install -g brd-node
```

---

## Quick Start

```js
const brd = require('brd-node');

// 1. Create a new archive
const archive = brd.create({ compress: true });

// 2. Add resources
archive.add('images/icon.png', './assets/icon.png');
archive.add('config.json', JSON.stringify({ theme: 'dark' }), {
  metadata: { type: 'config', version: 1 }
});
archive.add('data/binary.bin', Buffer.from([0x01, 0x02, 0x03]));

// 3. Save
archive.save('app.brd');

// 4. Later: open and import
const opened = brd.open('app.brd');
const icon = opened.import('images/icon.png'); // → Buffer
console.log(opened.list());
```

Short-hand import:

```js
const icon = brd.import('app.brd', 'images/icon.png');
```

---

## API Reference

### `brd.create([options])`

Create a new empty archive.

**Options:**
- `compress` (boolean) – Enable compression by default for all added resources. Default: `false`.

Returns: `BrdArchive` instance.

---

### `brd.open(filePath)`

Open an existing `.brd` file.

Returns: `BrdArchive` instance.

---

### `brd.import(archivePath, resourceName)`

Short-hand to open an archive and extract one resource as a `Buffer`.

---

### Class: `BrdArchive`

#### `archive.add(name, content, [options])`

Add or replace a resource.

- `name` – Resource path (e.g. `images/logo.png`)
- `content` – File path (string), `Buffer`, or string
- `options.compress` – Override default compression
- `options.metadata` – Optional object / Buffer / string stored with the entry

#### `archive.import(name)`

Return the resource content as a `Buffer`.

#### `archive.has(name)`

Check whether a resource exists.

#### `archive.delete(name)`

Remove a resource. Returns `true` if it existed.

#### `archive.rename(oldName, newName)`

Rename a resource.

#### `archive.list()`

Return sorted array of resource names.

#### `archive.listInfo()`

Returns detailed info array:

```ts
{
  name: string;
  size: number;
  compressedSize: number;
  compressed: boolean;
  checksum: number;
  metadata: any | null;
}
```

#### `archive.extract(name, outputPath)`

Extract one resource to a file or into a directory.

#### `archive.extractAll(outputDir)`

Extract every resource, preserving folder structure.

#### `archive.save([filePath])`

Write the archive to disk. If no path is given, overwrites the original file.

#### Properties

- `archive.path` – Current file path (or `null`)
- `archive.size` – Number of resources
- `archive.isDirty` – Whether there are unsaved changes

---

## CLI Usage

After installing globally (or using `npx`):

```bash
# Create archive from files
node-brd create app.brd icon.png config.json

# Create from a folder (recursive) with compression
node-brd create app.brd ./assets --compress

# List contents
node-brd list app.brd

# Detailed info
node-brd info app.brd

# Extract everything
node-brd extract app.brd ./output

# Extract one file
node-brd extract-one app.brd images/icon.png ./icon.png

# Add / replace a resource
node-brd add app.brd logo.png ./new-logo.png --compress

# Delete a resource
node-brd delete app.brd old.txt

# Check existence
node-brd has app.brd images/icon.png
```

You can also use the short command `brd` instead of `node-brd` or `brd-node`.

---

## .brd File Format (Version 1)

```
┌──────────────────────────────┐
│  Header (32 bytes)           │
├──────────────────────────────┤
│  Index (variable)            │
├──────────────────────────────┤
│  Data section (variable)     │
└──────────────────────────────┘
```

### Header

| Offset | Size | Description                    |
|--------|------|--------------------------------|
| 0      | 4    | Magic `"BRD1"`                 |
| 4      | 2    | Version (1)                    |
| 6      | 2    | Flags (bit 0 = compression)    |
| 8      | 4    | Number of entries              |
| 12     | 4    | Index offset                   |
| 16     | 4    | Data section offset            |
| 20     | 4    | Total file size                |
| 24     | 8    | Reserved                       |

### Index Entry

For each resource:

- `uint16` name length
- `utf8` name
- `uint32` data offset
- `uint32` original size
- `uint32` compressed size
- `uint16` flags
- `uint32` CRC32 checksum
- `uint16` metadata length
- `bytes` metadata (optional)

### Data Section

Concatenated resource payloads (raw or zlib-compressed).

---

## TypeScript

```ts
import brd, { BrdArchive, CreateOptions, ResourceInfo } from 'brd-node';

const archive: BrdArchive = brd.create({ compress: true });
archive.add('config.json', '{"ok":true}');
archive.save('app.brd');

const info: ResourceInfo[] = archive.listInfo();
```

---

## License

MIT
