import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Retain the existing task, review, navigation and Results coverage while adding
// the dark-UI changes. DOM observation and focus still require browser checks.
const result = spawnSync(process.execPath, [
  'scripts/check-wave30d-ui.mjs',
  'tests/wave30e-research-ui.test.tsx',
  'tests/wave30e-summary-ui.test.tsx',
  'tests/wave30e-task-primary-ui.test.tsx',
  'tests/wave30e-staffing-helper-ui.test.tsx',
  ...process.argv.slice(2),
], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
