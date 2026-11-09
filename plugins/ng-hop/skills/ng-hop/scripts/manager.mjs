// Finds the project's pnpm or yarn and runs it with no shell, for the scripts that start it.
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

// Node cannot exec a Windows .cmd file without a shell. Read only the standard shim's literal script path instead.
// pnpm runs a whole hop this way, and yarn only installs a library first. The plan asks either for its release age.
export function managerCommand(cwd, name) {
  const execpath = process.env.npm_execpath && resolve(cwd, process.env.npm_execpath);
  if (execpath && existsSync(execpath)) {
    if (new RegExp(String.raw`[\\/]${name}[^\\/]*\.[cm]?js$`, 'i').test(execpath)) return { file: process.execPath, prefix: [execpath] };
    // pnpm 12 ships a native binary, and `pnpm exec` names it here.
    if (new RegExp(String.raw`[\\/]${name}(?:-[a-z]+)?(?:\.exe)?$`, 'i').test(execpath)) return { file: execpath, prefix: [] };
  }
  const corepack = process.env.COREPACK_ROOT && join(process.env.COREPACK_ROOT, 'dist', `${name}.js`);
  if (corepack && existsSync(corepack)) return { file: process.execPath, prefix: [corepack] };
  const path = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  const extensions = process.platform === 'win32' ? ['.exe', '.com', '.cmd', '.bat'] : [''];
  for (const dir of path.split(delimiter).filter(Boolean)) for (const extension of extensions) {
    const file = resolve(cwd, dir, name + extension);
    if (!existsSync(file)) continue;
    if (!/\.(?:cmd|bat)$/i.test(file)) return { file, prefix: [] };
    // Corepack's shim names the same script twice, once for each way it finds Node.
    const targets = new Set([...readFileSync(file, 'utf8').matchAll(new RegExp(String.raw`"%(?:dp0%|~dp0)[\\/]?([^"\r\n%]*${name}\.[cm]?js)"`, 'gi'))].map((m) => m[1]));
    if (targets.size === 1) {
      const target = resolve(dirname(file), [...targets][0].replace(/[\\/]/g, '/'));
      if (existsSync(target)) return { file: process.execPath, prefix: [target] };
    }
    throw new Error(`Cannot resolve this ${name} shim without a shell. Use the existing Corepack or Node-script installation; no fallback was run.`);
  }
  throw new Error(`Could not find ${name}. Run the printed command with the already installed project package manager.`);
}
