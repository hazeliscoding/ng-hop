#!/usr/bin/env node
// Puts back the line endings and final newline each changed file had at HEAD, in the form git checks it out, so
// .gitattributes and core.autocrlf are followed. Migrations and package managers write LF into repos that commit CRLF,
// on any OS, and can drop a final newline, and then every line shows as changed and buries the real change. New files,
// binary files and files whose HEAD version mixes endings are left alone. Only line breaks change, never content.
// Usage: eol.mjs [--project .]
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { project: { type: 'string' } } });
const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
const root = git(['rev-parse', '--show-toplevel'], resolve(values.project || '.')).toString().trim();

// The one line ending a file uses, or null when it has none or mixes them.
function lineEnding(bytes) {
  const text = bytes.toString('latin1');
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  return crlf && !lf ? '\r\n' : lf && !crlf ? '\n' : null;
}

const restored = [];
for (const file of git(['diff', '--name-only', '-z', 'HEAD'], root).toString().split('\0').filter(Boolean)) {
  const path = join(root, file);
  // A link would be read and written through to wherever it points.
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()) continue;
  let before;
  try { before = git(['cat-file', '--filters', `HEAD:${file}`], root); } catch { continue; } // new since HEAD
  const now = readFileSync(path);
  if (before.includes(0) || now.includes(0)) continue;
  const eol = lineEnding(before);
  if (!eol) {
    if (before.includes(10)) console.log(`left as it is, because its HEAD version mixes line endings: ${file}`);
    continue;
  }
  // latin1 keeps every byte as it is, and UTF-8 never uses the bytes for \r and \n inside a character.
  let text = now.toString('latin1').replace(/\r\n/g, '\n');
  if (before.at(-1) === 10 && !text.endsWith('\n')) text += '\n';
  if (before.at(-1) !== 10) text = text.replace(/\n$/, '');
  const fixed = Buffer.from(eol === '\n' ? text : text.replace(/\n/g, '\r\n'), 'latin1');
  if (!fixed.equals(now)) { writeFileSync(path, fixed); restored.push(file); }
}
for (const file of restored) console.log(`restored: ${file}`);
console.log(restored.length ? `Restored ${restored.length} file(s). Compare \`git diff --stat\` again.` : 'Nothing to restore.');
