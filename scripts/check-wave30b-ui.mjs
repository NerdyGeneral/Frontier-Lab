import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Static React checks are separate from the mounted-browser opening journey.
// Retain lazy-workbench and 30A surface coverage alongside the 30B forms.
const result = spawnSync(process.execPath, [
  '--import', 'tsx', '--test', '--test-reporter=spec',
  'tests/wave29-workbench-ui.test.tsx',
  'tests/wave30-surfaces.test.tsx',
  'src/ui/lab-journey.test.tsx',
  'tests/wave30b-launch-ui.test.tsx',
], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
