#!/usr/bin/env node
// Puts back the line endings and final newline each changed file had at HEAD, as the repo itself decides them:
// .gitattributes and the endings it commits, not this machine's core.autocrlf, which a dev container's git on the
// same files doesn't have. Migrations and package managers write LF into repos that commit CRLF, on any OS, and can drop
// a final newline, and then every line shows as changed and buries the real change. New, deleted and binary files,
// links, and files whose HEAD version mixes endings are left alone. Only line breaks change, never content.
// Usage: eol.mjs [--project .]
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const USAGE = 'Usage: eol.mjs [--project <dir>]';
const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });

// The one line ending a file uses, or null when it has none or mixes them.
function lineEnding(bytes) {
  const text = bytes.toString('latin1');
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  return crlf && !lf ? '\r\n' : lf && !crlf ? '\n' : null;
}

// What the file should be: its own lines, with HEAD's line ending and final newline. null when nothing can be decided.
function restore(before, now) {
  if (before.includes(0) || now.includes(0)) return null;
  const eol = lineEnding(before);
  if (!eol) return before.includes(10) ? 'mixed' : null;
  // latin1 keeps every byte as it is, and UTF-8 never uses the bytes for \r and \n inside a character.
  let text = now.toString('latin1').replace(/\r\n/g, '\n');
  if (before.at(-1) === 10 && !text.endsWith('\n')) text += '\n';
  if (before.at(-1) !== 10) text = text.replace(/\n$/, '');
  return Buffer.from(eol === '\n' ? text : text.replace(/\n/g, '\r\n'), 'latin1');
}

function main() {
  let values;
  try { ({ values } = parseArgs({ options: { project: { type: 'string' }, help: { type: 'boolean' } } })); } catch (err) { throw new Error(`${err.message.split('.')[0]}.\n${USAGE}`); }
  if (values.help) { console.log(USAGE); return; }
  let root;
  try { root = git(['rev-parse', '--show-toplevel'], resolve(values.project || '.')).toString().trim(); git(['rev-parse', '--verify', '-q', 'HEAD'], root); } catch { throw new Error('eol.mjs needs a git repository with at least one commit.'); }
  const realRoot = realpathSync(root);
  const restored = [];
  for (const file of git(['diff', '--name-only', '-z', 'HEAD'], root).toString().split('\0').filter(Boolean)) {
    const path = join(root, file);
    try {
      // A link, or a file reached through a linked folder, would be written wherever it points.
      if (!existsSync(path) || lstatSync(path).isSymbolicLink()) continue;
      const inside = relative(realRoot, realpathSync(path));
      if (inside.startsWith('..') || isAbsolute(inside)) continue;
      let before;
      // The repo's own form, with .gitattributes applied but not this machine's core.autocrlf.
      try { before = git(['-c', 'core.autocrlf=false', 'cat-file', '--filters', `HEAD:${file}`], root); } catch { continue; } // new since HEAD
      const now = readFileSync(path);
      const fixed = restore(before, now);
      if (fixed === 'mixed') console.log(`left as it is, because its HEAD version mixes line endings: ${file}`);
      else if (fixed && !fixed.equals(now)) { writeFileSync(path, fixed); restored.push(file); }
    } catch (err) {
      console.log(`left as it is, because it couldn't be read or written (${err.code || err.message.split('\n')[0]}): ${file}`);
    }
  }
  for (const file of restored) console.log(`restored: ${file}`);
  console.log(restored.length ? `Restored ${restored.length} file(s). Compare \`git diff --stat\` again.` : 'Nothing to restore.');
}

try { main(); } catch (err) { console.error(err.message); process.exitCode = 1; }
