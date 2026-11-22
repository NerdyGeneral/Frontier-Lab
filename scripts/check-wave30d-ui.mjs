import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Keep inherited workspace, launch, Results and staffing coverage alongside
// focused research, shared command review and object-aware navigation.
// Mounted browser journeys exercise focus and the shared task host separately.
const result = spawnSync(process.execPath, [
  '--import', 'tsx', '--test', '--test-reporter=spec',
  'tests/wave29-workbench-ui.test.tsx',
  'tests/wave30-surfaces.test.tsx',
  'src/ui/lab-journey.test.tsx',
  'tests/wave30b-launch-ui.test.tsx',
  'tests/wave30c-results-ui.test.tsx',
  'tests/wave30c-staffing-ui.test.tsx',
  'tests/wave30d-research-ui.test.tsx',
  'tests/wave30d-review-ui.test.tsx',
  'tests/wave30d-navigation-ui.test.tsx',
  ...process.argv.slice(2),
], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
