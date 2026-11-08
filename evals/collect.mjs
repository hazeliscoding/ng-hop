#!/usr/bin/env node
// Copies a results folder for upload, leaving out what a checkout wouldn't have and anything but plain files and
// folders: a .git can run commands in whatever runs git on it later, and a link can point out of the folder.
// Usage: node evals/collect.mjs <from> <to>
import { copyFileSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SKIP = new Set(['node_modules', 'dist', '.angular', '.git']);

function copy(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (SKIP.has(name)) continue;
    const source = join(from, name);
    const stat = lstatSync(source);
    if (stat.isDirectory()) copy(source, join(to, name));
    else if (stat.isFile()) copyFileSync(source, join(to, name));
  }
}

const [from, to] = process.argv.slice(2);
if (!from || !to) throw new Error('Usage: node evals/collect.mjs <from> <to>');
copy(from, to);
