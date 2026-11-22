import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Keep the TSX/React SSR checks separate from the core-only temporary build.
// Uses the already-installed tsx loader; no browser or renderer dependency.
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', 'tests/wave29-workbench-ui.test.tsx'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
