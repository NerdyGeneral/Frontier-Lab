import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

// Keep the production toolchain unchanged. Emit only the pure engine, its content,
// and acceptance suites to a disposable CommonJS tree for node:test.
const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'frontier-lab-wave0-'));
const targets = ['src/contracts', 'src/core', 'src/content', 'src/modules', 'src/persistence', 'tests/fixtures'];
const availableTests = readdirSync(join(root, 'tests')).filter(name => name.endsWith('.test.ts')).sort();
const requestedTests = process.argv.slice(2).map(name => name.endsWith('.test.ts') ? name : name + '.test.ts');
for (const name of requestedTests) if (!availableTests.includes(name)) throw new Error('Unknown acceptance suite: ' + name);
const tests = (requestedTests.length ? [...new Set(requestedTests)] : availableTests).map(name => 'tests/' + name);
let status = 1;

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

try {
  writeFileSync(join(temporary, 'package.json'), '{"type":"commonjs"}\n');
  const sources = [
    ...targets.flatMap((target) => filesUnder(join(root, target))),
    ...tests.map((test) => join(root, test)),
  ];
  for (const source of sources) {
    const extension = extname(source);
    if (extension !== '.ts' && extension !== '.json') continue;
    const destination = join(temporary, relative(root, source).replace(/\.ts$/, '.js'));
    mkdirSync(dirname(destination), { recursive: true });
    if (extension === '.json') {
      writeFileSync(destination, readFileSync(source));
      continue;
    }
    const result = ts.transpileModule(readFileSync(source, 'utf8'), {
      fileName: source,
      reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        isolatedModules: true,
        sourceMap: false,
      },
    });
    const errors = (result.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
    if (errors.length) {
      for (const error of errors) console.error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
      throw new Error(`Cannot transpile ${relative(root, source)}`);
    }
    writeFileSync(destination, result.outputText);
  }
  const result = spawnSync(process.execPath, [
    '--test', '--test-reporter=spec',
    ...tests.map((test) => join(temporary, test.replace(/\.ts$/, '.js'))),
  ], { cwd: temporary, stdio: 'inherit', env: { ...process.env, NODE_PATH: [join(root, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(delimiter) } });
  if (result.error) throw result.error;
  status = result.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
process.exitCode = status;
