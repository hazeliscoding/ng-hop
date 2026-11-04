#!/usr/bin/env node
// Prints the steps from Angular's official Update Guide for one major-to-major move. It reads the guide's own data
// file live, so a new Angular release needs no change here, and it filters the way the guide's web page does.
// The file is TypeScript from the network, so it is parsed as text and never run.
// Usage: guide.mjs --from 21 --to 22 [--project .] [--level 3] [--json] [--source <url or file>]
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const DATA = 'https://raw.githubusercontent.com/angular/angular/main/adev/src/app/features/update/recommendations.ts';
const LEVELS = { Basic: 1, Medium: 2, Advanced: 3 };

// Parses the object literals of `RECOMMENDATIONS`: numbers, booleans, enum members and strings, joined with `+`.
export function parseSteps(source) {
  const start = source.search(/RECOMMENDATIONS\s*:\s*Step\[\]\s*=\s*\[/);
  if (start < 0) throw new Error('RECOMMENDATIONS was not found in the guide data');
  let i = source.indexOf('[', source.indexOf('=', start)) + 1;

  const skip = () => {
    for (;;) {
      while (/\s|,/.test(source[i] ?? '')) i++;
      if (source.startsWith('//', i)) i = source.indexOf('\n', i) + 1 || source.length;
      else if (source.startsWith('/*', i)) i = source.indexOf('*/', i) + 2;
      else return;
    }
  };
  const readString = () => {
    const quote = source[i++];
    let out = '';
    while (i < source.length && source[i] !== quote) {
      if (source[i] === '\\') {
        const next = source[i + 1];
        out += { n: '\n', t: '\t', r: '' }[next] ?? next;
        i += 2;
      } else out += source[i++];
    }
    i++;
    return out;
  };
  const readValue = () => {
    skip();
    if (/['"`]/.test(source[i])) {
      let out = readString();
      for (;;) {
        const save = i;
        skip();
        if (source[i] === '+') { i++; skip(); out += readString(); } else { i = save; return out; }
      }
    }
    const match = /^[\w.]+/.exec(source.slice(i, i + 80));
    if (!match) throw new Error(`Unexpected guide data near: ${source.slice(i, i + 40)}`);
    i += match[0].length;
    if (match[0] === 'true') return true;
    if (match[0] === 'false') return false;
    if (/^\d+$/.test(match[0])) return Number(match[0]);
    const member = /^ApplicationComplexity\.(\w+)$/.exec(match[0]);
    if (member) return LEVELS[member[1]];
    throw new Error(`Unexpected value in guide data: ${match[0]}`);
  };

  const steps = [];
  for (;;) {
    skip();
    if (source[i] === ']' || i >= source.length) return steps;
    if (source[i] !== '{') throw new Error(`Unexpected guide data near: ${source.slice(i, i + 40)}`);
    i++;
    const step = {};
    for (;;) {
      skip();
      if (source[i] === '}') { i++; break; }
      const key = /^\w+/.exec(source.slice(i, i + 40));
      if (!key) throw new Error(`Unexpected guide data near: ${source.slice(i, i + 40)}`);
      i += key[0].length;
      skip();
      if (source[i] !== ':') throw new Error(`Expected a value after ${key[0]}`);
      i++;
      step[key[0]] = readValue();
    }
    steps.push(step);
  }
}

// Mirrors update.component.ts on angular.dev, so these match what the web page shows for the same choices.
export function selectSteps(steps, { from, to, level, options }) {
  const out = { before: [], during: [], after: [] };
  const fromN = from * 100;
  const toN = to * 100;
  for (const step of steps) {
    if (!(step.level <= level && step.necessaryAsOf > fromN)) continue;
    const skip = Object.entries(options).some(([id, on]) => (step[id] && !on) || (step[id] === false && on));
    if (skip) continue;
    if (step.possibleIn <= fromN && step.necessaryAsOf >= fromN) out.before.push(step);
    else if (step.possibleIn > fromN && step.necessaryAsOf <= toN) out.during.push(step);
    else if (step.possibleIn <= toN) out.after.push(step);
  }
  return out;
}

async function readSource(source) {
  if (/^https?:/.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }
  return readFileSync(source, 'utf8');
}

async function main() {
  const { values } = parseArgs({ options: {
    from: { type: 'string' }, to: { type: 'string' }, project: { type: 'string' }, level: { type: 'string' },
    json: { type: 'boolean' }, source: { type: 'string' },
  } });
  const from = Number(values.from);
  const to = Number(values.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || to !== from + 1) {
    throw new Error('Pass one major at a time, such as --from 21 --to 22.');
  }
  const level = values.level === undefined ? 3 : Number(values.level);
  if (![1, 2, 3].includes(level)) throw new Error('--level takes 1, 2 or 3.');

  const pkgPath = join(resolve(values.project || '.'), 'package.json');
  const deps = existsSync(pkgPath) ? (() => { const p = JSON.parse(readFileSync(pkgPath, 'utf8')); return { ...p.dependencies, ...p.devDependencies }; })() : {};
  const options = { ngUpgrade: Boolean(deps['@angular/upgrade']), material: Boolean(deps['@angular/material']), windows: process.platform === 'win32' };
  const page = `https://angular.dev/update-guide?v=${from}.0-${to}.0&l=${level}`;

  let text;
  try {
    text = await readSource(values.source || DATA);
  } catch (err) {
    console.error(`Could not read the Update Guide data (${err.cause?.code || err.message}). Read ${page} by hand instead, and say in your report that this major's steps weren't checked automatically.`);
    process.exitCode = 1;
    return;
  }
  const chosen = selectSteps(parseSteps(text), { from, to, level, options });
  if (values.json) {
    process.stdout.write(`${JSON.stringify(chosen, null, 2)}\n`);
    return;
  }
  const lines = [`Angular ${from} to ${to}, from the official Update Guide (${page}). Options: ${Object.entries(options).filter(([, on]) => on).map(([id]) => id).join(', ') || 'none'}.`];
  for (const [phase, title] of [['before', 'Before updating'], ['during', 'During the update'], ['after', 'After the update']]) {
    lines.push('', `${title} (${chosen[phase].length})`);
    for (const step of chosen[phase]) lines.push(`- [${step.step}] ${step.action.replace(/\s+/g, ' ').trim()}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('guide.mjs')) {
  main().catch((err) => { console.error(err.message); process.exitCode = 1; });
}
