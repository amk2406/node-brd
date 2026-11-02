/**
 * node-brd
 * Advanced Binary Resources Data (.brd) archive module for Node.js
 */

import { BrdArchive, CreateOptions, AddOptions, ResourceInfo } from './archive';

export { BrdArchive, CreateOptions, AddOptions, ResourceInfo };
export * from './format';

/**
 * Create a new empty .brd archive
 */
export function create(options?: CreateOptions): BrdArchive {
  return BrdArchive.create(options);
}

/**
 * Open an existing .brd file
 */
export function open(filePath: string): BrdArchive {
  return BrdArchive.open(filePath);
}

/**
 * Short-hand: import (extract) a single resource from an .brd file
 *
 * @example
 * const icon = brd.import('app.brd', 'images/icon.png');
 */
export function importResource(archivePath: string, resourceName: string): Buffer {
  const archive = BrdArchive.open(archivePath);
  return archive.import(resourceName);
}

// Default export for convenience
const brd = {
  create,
  open,
  import: importResource,
  BrdArchive,
};

export default brd;
