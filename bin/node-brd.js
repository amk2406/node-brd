#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// Resolve the built module
let brd;
try {
  brd = require('../dist/index.js');
} catch (e) {
  console.error('Error: node-brd is not built yet. Run "npm run build" first.');
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
node-brd — Binary Resources Data (.brd) archive tool

Usage:
  node-brd <command> [options]

Commands:
  create <output.brd> [files...]     Create a new archive from files/folders
  list <archive.brd>                 List resources inside an archive
  info <archive.brd>                 Show detailed information
  extract <archive.brd> <outputDir>  Extract all resources
  extract-one <archive.brd> <name> [output]
                                     Extract a single resource
  add <archive.brd> <name> <file>    Add or replace a resource
  delete <archive.brd> <name>        Delete a resource
  has <archive.brd> <name>           Check if a resource exists

Options:
  --compress                         Enable compression when creating/adding
  -h, --help                         Show this help

Examples:
  node-brd create app.brd icon.png config.json
  node-brd create app.brd ./assets --compress
  node-brd list app.brd
  node-brd extract app.brd ./output
  node-brd extract-one app.brd images/icon.png
  node-brd add app.brd logo.png ./new-logo.png
  node-brd delete app.brd old-file.txt
`);
}

function getFlag(name) {
  const idx = args.indexOf(name);
  if (idx !== -1) {
    args.splice(idx, 1);
    return true;
  }
  return false;
}

async function main() {
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    printHelp();
    process.exit(0);
  }

  const compress = getFlag('--compress');

  try {
    switch (command) {
      case 'create': {
        const output = args[1];
        if (!output) {
          console.error('Error: output file required');
          process.exit(1);
        }
        const files = args.slice(2);
        const archive = brd.create({ compress });

        function addPath(p, prefix = '') {
          const stat = fs.statSync(p);
          if (stat.isDirectory()) {
            const items = fs.readdirSync(p);
            for (const item of items) {
              addPath(path.join(p, item), path.join(prefix, path.basename(p)));
            }
          } else {
            const name = prefix ? path.join(prefix, path.basename(p)).replace(/\\/g, '/') : path.basename(p);
            archive.add(name, p);
            console.log(`  + ${name}`);
          }
        }

        console.log(`Creating ${output}...`);
        for (const f of files) {
          if (!fs.existsSync(f)) {
            console.warn(`  Warning: ${f} not found, skipping`);
            continue;
          }
          addPath(f);
        }
        archive.save(output);
        console.log(`Done. ${archive.size} resource(s) written.`);
        break;
      }

      case 'list': {
        const file = args[1];
        if (!file) {
          console.error('Error: archive file required');
          process.exit(1);
        }
        const archive = brd.open(file);
        const names = archive.list();
        if (names.length === 0) {
          console.log('(empty archive)');
        } else {
          names.forEach((n) => console.log(n));
        }
        break;
      }

      case 'info': {
        const file = args[1];
        if (!file) {
          console.error('Error: archive file required');
          process.exit(1);
        }
        const archive = brd.open(file);
        const infos = archive.listInfo();
        console.log(`Archive: ${file}`);
        console.log(`Resources: ${infos.length}\n`);
        for (const info of infos) {
          const comp = info.compressed ? ` → ${info.compressedSize} bytes compressed` : '';
          console.log(`${info.name}`);
          console.log(`  size: ${info.size} bytes${comp}`);
          console.log(`  checksum: ${info.checksum.toString(16)}`);
          if (info.metadata) {
            console.log(`  metadata: ${JSON.stringify(info.metadata)}`);
          }
          console.log('');
        }
        break;
      }

      case 'extract': {
        const file = args[1];
        const outDir = args[2] || './extracted';
        if (!file) {
          console.error('Error: archive file required');
          process.exit(1);
        }
        const archive = brd.open(file);
        console.log(`Extracting ${archive.size} resource(s) to ${outDir}...`);
        archive.extractAll(outDir);
        console.log('Done.');
        break;
      }

      case 'extract-one': {
        const file = args[1];
        const name = args[2];
        const out = args[3];
        if (!file || !name) {
          console.error('Error: archive and resource name required');
          process.exit(1);
        }
        const archive = brd.open(file);
        const target = out || path.basename(name);
        archive.extract(name, target);
        console.log(`Extracted "${name}" → ${target}`);
        break;
      }

      case 'add': {
        const file = args[1];
        const name = args[2];
        const source = args[3];
        if (!file || !name || !source) {
          console.error('Error: archive, resource name and source file required');
          process.exit(1);
        }
        const archive = brd.open(file);
        archive.add(name, source, { compress });
        archive.save();
        console.log(`Added "${name}" to ${file}`);
        break;
      }

      case 'delete': {
        const file = args[1];
        const name = args[2];
        if (!file || !name) {
          console.error('Error: archive and resource name required');
          process.exit(1);
        }
        const archive = brd.open(file);
        if (archive.delete(name)) {
          archive.save();
          console.log(`Deleted "${name}" from ${file}`);
        } else {
          console.error(`Resource not found: ${name}`);
          process.exit(1);
        }
        break;
      }

      case 'has': {
        const file = args[1];
        const name = args[2];
        if (!file || !name) {
          console.error('Error: archive and resource name required');
          process.exit(1);
        }
        const archive = brd.open(file);
        console.log(archive.has(name) ? 'yes' : 'no');
        process.exit(archive.has(name) ? 0 : 1);
      }

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
