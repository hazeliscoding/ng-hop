// Builds the HyperFrames project from script.mjs and timings.json: index.html lays the chapters end to end with their
// narration, and compositions/<chapter>.html holds each chapter's visuals and captions. In a visual, an element with
// data-cue="s12" appears when sentence s12 starts ("s12+0.8" a little after, "s12$" at its end), and data-out takes it
// away the same way. Usage: node tools/build.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const script = (await import(pathToFileURL(join(ROOT, 'script.mjs')).href)).default;
const timings = JSON.parse(readFileSync(join(ROOT, 'timings.json'), 'utf8'));
mkdirSync(join(ROOT, 'compositions'), { recursive: true });

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cueTime(cue, chapterId) {
  if (cue === undefined || cue === '0') return 0;
  const m = /^(s[\w-]+)(\$)?([+-][\d.]+)?$/.exec(cue);
  if (!m) throw new Error(`${chapterId}: bad cue ${cue}`);
  const s = timings[chapterId].sentences.find((x) => x.id === m[1]);
  if (!s) throw new Error(`${chapterId}: no sentence ${m[1]} for cue ${cue}`);
  return Number(((m[2] ? s.end : s.start) + Number(m[3] || 0)).toFixed(3));
}

function chapterHtml(chapter, index) {
  const t = timings[chapter.id];
  let n = 0;
  const steps = [];
  // Give every cued element an id and a timeline step, in document order.
  const html = chapter.visuals.replace(/<([a-z][\w-]*)([^>]*?)\sdata-cue="([^"]+)"([^>]*)>/g, (all, tag, before, cue, after) => {
    const id = `${chapter.id}-c${++n}`;
    const out = /data-out="([^"]+)"/.exec(all)?.[1];
    const kind = /class="[^"]*\bpop\b/.test(all) ? 'pop' : 'rise';
    const step = { id, at: cueTime(cue, chapter.id), out: out && cueTime(out, chapter.id), kind };
    // A cue past its sentence's end shows the element over the next sentence: say so, since narration edits move them.
    const sentence = /^(s[\w-]+)/.exec(cue)?.[1];
    const end = sentence && t.sentences.find((x) => x.id === sentence)?.end;
    if (end !== undefined && step.at > end + 0.5) console.warn(`  ${chapter.id}: ${cue} lands ${(step.at - end).toFixed(1)}s after ${sentence} ends`);
    if (step.at >= t.duration || (step.out !== undefined && step.out > t.duration)) console.warn(`  ${chapter.id}: ${cue} is past the chapter's end`);
    steps.push(step);
    return `<${tag} id="${id}"${before}${after}>`;
  });
  // A thin bar across the top fills over the chapter, so the frame is never quite still while the narration runs.
  steps.push({ id: `${chapter.id}-progress`, at: 0, kind: 'progress', duration: t.duration });
  const captions = chapter.sentences.map((s, i) => {
    const c = t.sentences[i];
    // A caption stays until the next one starts, so a short sentence is on screen long enough to read.
    const next = t.sentences[i + 1];
    steps.push({ id: `${chapter.id}-cap${i}`, at: c.start, out: next ? next.start - 0.05 : Math.min(c.end + 0.8, t.duration - 0.05), kind: 'caption' });
    return `<p class="cap" id="${chapter.id}-cap${i}">${escape(s.text)}</p>`;
  }).join('\n      ');
  const tweens = steps.map((s) => {
    const lines = [];
    if (s.kind === 'progress') lines.push(`tl.fromTo("#${s.id}", { scaleX: 0 }, { scaleX: 1, duration: ${s.duration}, ease: "none" }, 0);`);
    else if (s.kind === 'caption') lines.push(`tl.fromTo("#${s.id}", { opacity: 0 }, { opacity: 1, duration: 0.15 }, ${s.at});`);
    else if (s.kind === 'pop') lines.push(`tl.fromTo("#${s.id}", { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.6)" }, ${s.at});`);
    else lines.push(`tl.fromTo("#${s.id}", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }, ${s.at});`);
    if (s.out !== undefined) lines.push(`tl.to("#${s.id}", { opacity: 0, duration: ${s.kind === 'caption' ? 0.15 : 0.35} }, ${s.out});`);
    return lines.join('\n        ');
  }).join('\n        ');
  return `<template id="${chapter.id}-template">
  <div data-composition-id="${chapter.id}" data-width="1920" data-height="1080" data-duration="${t.duration}" class="scene">
    <style>
${chapter.css || ''}
    </style>
    <div class="progress" id="${chapter.id}-progress"></div>
    <div class="chapter"><span class="chapter-n">${index + 1}</span>${escape(chapter.title)}</div>
    ${html}
    <div class="captions" data-track-kind="captions">
      ${captions}
    </div>
    <script>
      (() => {
        const tl = gsap.timeline({ paused: true });
        ${tweens}
        window.__timelines["${chapter.id}"] = tl;
      })();
    </script>
  </div>
</template>
`;
}

let at = 0;
const slots = [];
const audio = [];
script.chapters.forEach((chapter, i) => {
  const d = timings[chapter.id].duration;
  writeFileSync(join(ROOT, 'compositions', `${chapter.id}.html`), chapterHtml(chapter, i));
  slots.push(`<div id="el-${chapter.id}" data-composition-id="${chapter.id}" data-composition-src="compositions/${chapter.id}.html" data-start="${at.toFixed(3)}" data-duration="${d}" data-track-index="1"></div>`);
  audio.push(`<audio id="vo-${chapter.id}" src="assets/vo-${chapter.id}.wav" data-start="${at.toFixed(3)}" data-duration="${d}" data-track-index="10"></audio>`);
  at += d;
});
const total = Number(at.toFixed(3));

writeFileSync(join(ROOT, 'index.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>${escape(script.title)}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
${script.css}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="${total}">
      ${slots.join('\n      ')}
      ${audio.join('\n      ')}
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`);

// Chapters for the video's description, as YouTube reads them.
const chapters = [];
let start = 0;
for (const chapter of script.chapters) {
  chapters.push(`${Math.floor(start / 60)}:${String(Math.floor(start % 60)).padStart(2, '0')} ${chapter.title}`);
  start += timings[chapter.id].duration;
}
writeFileSync(join(ROOT, 'chapters.txt'), `${chapters.join('\n')}\n`);
console.log(`built ${script.chapters.length} chapters, ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')}`);
