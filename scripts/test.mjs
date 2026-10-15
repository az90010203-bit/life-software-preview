import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const tests = readdirSync('tests')
  .filter((file) => file.endsWith('.test.ts'))
  .sort();
for (const file of tests) {
  const name = file.replace('.test.ts', '');
  const outDir = join('output', `${name}-tests`);
  for (const args of [
    [
      join('node_modules', 'vite', 'bin', 'vite.js'),
      'build',
      '--ssr',
      join('tests', file),
      '--outDir',
      outDir,
    ],
    ['--test', join(outDir, file.replace('.ts', '.js'))],
  ]) {
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
