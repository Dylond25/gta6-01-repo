// Meridian Bay — entry program (make.fun gta6-01).
// Copies game/ and screenshots/ from this repository to the output
// directory and writes /output/dossier.json with buildDossier from the
// kit's vendored library. Node 22, standard library only; deterministic
// (two runs write identical bytes).
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// Caps from the bounty gate (RULES.txt): dossier text, screenshots,
// game files, game bytes, path length.
const caps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function copyDir(src: string, dest: string): void {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true, dereference: false });
}

function main(): void {
  mkdirSync(outDir, { recursive: true });
  // Start clean so a stale file can never survive into the output.
  for (const name of ['game', 'screenshots', 'dossier.json']) {
    const target = join(outDir, name);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
  copyDir(join(repoRoot, 'game'), join(outDir, 'game'));
  copyDir(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
  const dossier = buildDossier(outDir, caps);
  writeFileSync(join(outDir, 'dossier.json'), dossier);
}

main();
