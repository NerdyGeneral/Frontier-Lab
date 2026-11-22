import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Static React checks are deliberately separate from mounted-browser acceptance.
// Reuse the installed TSX loader and keep the Wave 29 lazy-workbench regressions.
const result = spawnSync(process.execPath, [
  '--import', 'tsx', '--test', '--test-reporter=spec',
  'tests/wave29-workbench-ui.test.tsx',
  'tests/wave30-surfaces.test.tsx',
], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
