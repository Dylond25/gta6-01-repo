// Meridian Bay — entry program (Agent 1, core world).
// Node 22, standard library only. Menyalin game/ dan screenshots/
// dari repo ke /output lalu menulis /output/dossier.json via
// buildDossier dari vendor/makefun-game.ts. Deterministik: dua run
// menulis byte yang sama. Di luar grader, MAKEFUN_OUTPUT_DIR
// menggantikan /output.
import { buildDossier } from './vendor/makefun-game.ts';
import {
  cpSync, existsSync, mkdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function copyDir(name) {
  const src = join(repoRoot, name);
  const dst = join(outDir, name);
  if (!existsSync(src)) return 0;
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
  return 1;
}

mkdirSync(outDir, { recursive: true });
copyDir('game');
copyDir('screenshots');

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log('Meridian Bay: wrote ' + outDir + '/dossier.json (' +
  dossier.length + ' bytes)');
