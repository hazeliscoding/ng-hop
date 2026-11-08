// Narration: one WAV per sentence from Kokoro (through the HyperFrames CLI), cached by its spoken text, then one WAV per
// chapter with a lead-in, a pause between sentences and a tail, plus timings.json with each sentence's start and end
// within its chapter. Usage: node tools/voice.mjs   (needs HYPERFRAMES_PYTHON pointing at a Python with kokoro-onnx)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { chapters, voice = 'af_heart', speed = 1 } = (await import(pathToFileURL(join(ROOT, 'script.mjs')).href)).default;
const CACHE = join(ROOT, '.voice');
const ASSETS = join(ROOT, 'assets');
mkdirSync(CACHE, { recursive: true });
mkdirSync(ASSETS, { recursive: true });
const LEAD = 0.7;
const GAP = 0.5;
const TAIL = 1.0;

// npx is a .cmd shim on Windows, which only runs through a shell, so the text goes in a file rather than on the command
// line, and every argument here is a plain path or option with no spaces.
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: cmd === 'npx' && process.platform === 'win32' });
const duration = (file) => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim());

function speak(text) {
  const base = join(CACHE, createHash('sha256').update(`${voice}|${speed}|${text}`).digest('hex').slice(0, 16));
  if (!existsSync(`${base}.wav`)) {
    writeFileSync(`${base}.txt`, text);
    run('npx', ['--yes', 'hyperframes@0.9.22', 'tts', `${base}.txt`, '--voice', voice, '--speed', String(speed), '--output', `${base}.wav`, '--json']);
  }
  return `${base}.wav`;
}

function silence(seconds, like) {
  const file = join(CACHE, `silence-${seconds}.wav`);
  if (!existsSync(file)) {
    const [rate, channels] = run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'csv=p=0', like]).trim().split(',');
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `anullsrc=r=${rate}:cl=${channels === '1' ? 'mono' : 'stereo'}`, '-t', String(seconds), '-c:a', 'pcm_s16le', file]);
  }
  return file;
}

const timings = {};
for (const chapter of chapters) {
  const parts = [];
  const sentences = [];
  let at = LEAD;
  for (const s of chapter.sentences) {
    const file = speak(s.say || s.text);
    const length = duration(file);
    sentences.push({ id: s.id, start: Number(at.toFixed(3)), end: Number((at + length).toFixed(3)) });
    parts.push(file);
    at += length + (s.pause ?? GAP);
    process.stdout.write('.');
  }
  const total = Number((at - GAP + TAIL + (chapter.hold || 0)).toFixed(3));
  // The concat demuxer needs one format throughout, so the pauses are made like the speech.
  const list = [silence(LEAD, parts[0]), ...parts.flatMap((p, i) => (i < parts.length - 1 ? [p, silence(chapter.sentences[i].pause ?? GAP, p)] : [p])), silence(TAIL + (chapter.hold || 0), parts[0])];
  const listFile = join(CACHE, `${chapter.id}.txt`);
  writeFileSync(listFile, list.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', join(ASSETS, `vo-${chapter.id}.wav`)]);
  timings[chapter.id] = { duration: total, sentences };
  console.log(`\n${chapter.id}: ${chapter.sentences.length} sentences, ${total.toFixed(1)}s`);
}
writeFileSync(join(ROOT, 'timings.json'), `${JSON.stringify(timings, null, 2)}\n`);
const all = Object.values(timings).reduce((sum, c) => sum + c.duration, 0);
console.log(`total ${Math.floor(all / 60)}:${String(Math.round(all % 60)).padStart(2, '0')}`);
