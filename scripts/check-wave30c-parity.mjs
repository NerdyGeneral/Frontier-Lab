import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative } from 'node:path';

const repo = process.cwd();
const output = process.argv[2] ?? join(repo, 'docs/evidence/wave30c-parity.json');
const require = createRequire(join(repo, 'package.json'));
const ts = require('typescript');
const baselineCommit = '94795f80b62a7b05ab1dd0b012e3ca2a49b86b71';
const roots = ['src/contracts', 'src/core', 'src/content', 'src/modules', 'src/persistence'];
const temporary = mkdtempSync(join(tmpdir(), 'frontier-wave30c-parity-'));
const digest = text => createHash('sha256').update(text).digest('hex');
const summary = { baselineCommit, currentBuild: null, baselineBuild: null,
  method: 'Baseline normalizes each fixture once, then both implementations import the identical serialized bytes. Full command results, states, serialized saves and final browser-storage writes are compared. The additive saved-byte receipt is checked against the exact primary snapshot. No browser UI is involved.',
  normalization: 'Only the newly created company buildVersion header is normalized for the initial-state comparison. Subsequent full results, states, saves and browser-storage bytes use identical imported fixture headers and are compared without normalization.',
  newCompanyEqualExceptBuildVersion: false, checkpoints: [], fixtures: [], persistence: [], savedByteReceipts: [], allEqual: false };

function filesUnder(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}

function compile(sourceRoot, destinationRoot) {
  mkdirSync(destinationRoot, { recursive: true });
  writeFileSync(join(destinationRoot, 'package.json'), '{"type":"commonjs"}\n');
  for (const source of roots.flatMap(root => filesUnder(join(sourceRoot, root)))) {
    const extension = extname(source);
    if (!['.ts', '.json'].includes(extension) || source.endsWith('.d.ts')) continue;
    const destination = join(destinationRoot, relative(sourceRoot, source).replace(/\.ts$/, '.js'));
    mkdirSync(dirname(destination), { recursive: true });
    if (extension === '.json') { writeFileSync(destination, readFileSync(source)); continue; }
    const result = ts.transpileModule(readFileSync(source, 'utf8'), {
      fileName: source, reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        esModuleInterop: true, isolatedModules: true, sourceMap: false },
    });
    const errors = (result.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, 'Cannot transpile ' + relative(sourceRoot, source));
    writeFileSync(destination, result.outputText);
  }
}

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index) { return [...this.values.keys()][index] ?? null; }
}

function withStorage(storage, operation) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  try { return operation(); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

try {
  // Reuse existing dependencies for the unchanged recovery codec; install nothing.
  symlinkSync(join(repo, 'node_modules'), join(temporary, 'node_modules'), 'dir');
  const baselineSource = join(temporary, 'source');
  mkdirSync(baselineSource);
  const archive = execFileSync('git', ['archive', baselineCommit, ...roots], { cwd: repo, maxBuffer: 30 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', baselineSource], { input: archive });
  const baselineRoot = join(temporary, 'baseline'), currentRoot = join(temporary, 'current');
  compile(baselineSource, baselineRoot); compile(repo, currentRoot);
  const baseline = require(join(baselineRoot, 'src/core/index.js'));
  const current = require(join(currentRoot, 'src/core/index.js'));
  const baselineContent = require(join(baselineRoot, 'src/content/catalog.js')).CONTENT;
  const currentContent = require(join(currentRoot, 'src/content/catalog.js')).CONTENT;
  const baselinePersistence = require(join(baselineRoot, 'src/persistence/wave0-browser.js'));
  const currentPersistence = require(join(currentRoot, 'src/persistence/wave0-browser.js'));
  summary.baselineBuild = baselineContent.buildVersion; summary.currentBuild = currentContent.buildVersion;
  const U = require(join(baselineRoot, 'src/contracts/types.js')).RESOURCE_SCALE;

  function scenario(name, normalized, source) {
    const a = baseline.deserializeState(normalized), b = current.deserializeState(normalized);
    assert.ok(a.ok && b.ok, name + ': imported fixture must validate');
    let oldState = a.state, newState = b.state;
    summary.fixtures.push({ name, source, bytes: Buffer.byteLength(normalized), sha256: digest(normalized),
      week: oldState.week, retainedBuildHeader: oldState.buildVersion });

    function checkpoint(label, result) {
      assert.deepStrictEqual(newState, oldState, name + ': ' + label + ' complete state');
      const oldSave = baseline.serializeState(oldState), newSave = current.serializeState(newState);
      assert.equal(newSave, oldSave, name + ': ' + label + ' exact serialized bytes');
      summary.checkpoints.push({ scenario: name, label, accepted: result?.accepted,
        commandId: result?.commandId, rejectionReason: result?.reason?.message, week: oldState.week,
        cashCents: oldState.slices.company.companies[oldState.playerCompanyId].cashCents,
        queuedCount: oldState.queuedCommands.length, checksum: baseline.canonicalStateHash(oldState),
        serializedBytes: Buffer.byteLength(oldSave), sha256: digest(oldSave) });
    }
    checkpoint('identical imported baseline');
    return {
      state: () => oldState,
      command(label, payload, accepted = true) {
        const oldResult = baseline.submitCommand(oldState, structuredClone(payload));
        const newResult = current.submitCommand(newState, structuredClone(payload));
        assert.equal(oldResult.accepted, accepted, name + ': expected admission for ' + label + ': ' + oldResult.reason?.message);
        assert.deepStrictEqual(newResult, oldResult, name + ': ' + label + ' full command result');
        oldState = oldResult.state; newState = newResult.state;
        checkpoint(label, oldResult);
      },
      step(label, count = 1) {
        for (let i = 0; i < count; i++) {
          const oldResult = baseline.advanceWeek(oldState), newResult = current.advanceWeek(newState);
          assert.ok(oldResult.accepted && newResult.accepted, name + ': settlement must succeed');
          assert.deepStrictEqual(newResult, oldResult, name + ': ' + label + ' full settlement result');
          oldState = oldResult.state; newState = newResult.state;
          checkpoint(label + (count > 1 ? ' ' + (i + 1) : ''), oldResult);
        }
      },
      save() {
        const oldStorage = new MemoryStorage(), newStorage = new MemoryStorage();
        oldStorage.setItem('frontier-lab.wave0.snapshot', normalized);
        newStorage.setItem('frontier-lab.wave0.snapshot', normalized);
        for (let i = 0; i < 2; i++) {
          const a = withStorage(oldStorage, () => baselinePersistence.writeBrowserSnapshot(oldState));
          const b = withStorage(newStorage, () => currentPersistence.writeBrowserSnapshot(newState));
          assert.deepStrictEqual(b, a); assert.equal(a.ok, true);
          assert.deepStrictEqual([...newStorage.values], [...oldStorage.values], name + ': exact browser storage bytes');
        }
        // The original writer contract remains exactly equal. The new additive
        // receipt must expose only bytes actually persisted by the same path.
        const receipt = withStorage(newStorage, () => currentPersistence.writeBrowserSnapshotWithBytes(newState));
        const legacy = withStorage(oldStorage, () => baselinePersistence.writeBrowserSnapshot(oldState));
        assert.equal(receipt.ok, true); assert.equal(legacy.ok, true);
        assert.equal(receipt.savedBytes, newStorage.getItem('frontier-lab.wave0.snapshot'));
        assert.equal(receipt.savedBytes, baseline.serializeState(oldState));
        assert.deepStrictEqual([...newStorage.values], [...oldStorage.values], name + ': additive receipt preserves storage');
        summary.savedByteReceipts.push({ scenario: name, bytes: Buffer.byteLength(receipt.savedBytes), sha256: digest(receipt.savedBytes) });
        summary.persistence.push({ scenario: name, writesCompared: 3, legacyWritesCompared: 2, additiveReceiptWritesCompared: 1, keys: [...oldStorage.values].map(([key, value]) =>
          ({ key, bytes: Buffer.byteLength(value), sha256: digest(value) })) });
      },
    };
  }

  const oldOpening = baseline.createInitialState(baselineContent, 'release');
  const newOpening = current.createInitialState(currentContent, 'release');
  assert.deepStrictEqual({ ...newOpening, buildVersion: oldOpening.buildVersion }, oldOpening,
    'new company differs only in its documented buildVersion header');
  summary.newCompanyEqualExceptBuildVersion = true;
  const openingBytes = baseline.serializeState(oldOpening);
  const opening = scenario('opening-first-sale', openingBytes, 'Baseline-created opening serialized before either implementation imports it');
  opening.command('reject training on unprepared data', { kind: 'start_training', baseModelId: baselineContent.seedModel.id, packetId: baselineContent.starterData.id }, false);
  opening.command('prepare starter data', { kind: 'prepare_data', packetId: baselineContent.starterData.id });
  opening.command('hire ML engineer', { kind: 'hire_staff', role: 'ml' });
  opening.command('allocate development compute', { kind: 'allocate_compute', serving: 0, development: 4 * U, research: 0 });
  opening.step('preparation/onboarding', 2);
  opening.command('assign founder to research', { kind: 'assign_founder', allocations: { research: U, ml: 0, data: 0, infrastructure: 0, commercial: 0, hardware: 0 } });
  opening.command('train exact starter candidate', { kind: 'start_training', baseModelId: baselineContent.seedModel.id, packetId: baselineContent.starterData.id });
  opening.step('training', 3);
  const outputModelId = Object.values(opening.state().slices.models.trainingRuns).find(run => run.companyId === opening.state().playerCompanyId).outputModelId;
  opening.command('evaluate exact output', { kind: 'evaluate_model', modelId: outputModelId });
  opening.step('evaluation');
  opening.command('deploy Basic Chat', { kind: 'deploy_product', modelId: outputModelId, priceCents: 1200, allowance: 100 });
  opening.command('allocate serving compute', { kind: 'allocate_compute', serving: 4 * U, development: 0, research: 0 });
  opening.step('deployment through first billing', 4);
  opening.save();

  const sourcePath = 'tests/fixtures/wave27-canary-published.json';
  const sourceBytes = execFileSync('git', ['show', baselineCommit + ':' + sourcePath], { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const imported = baseline.deserializeState(sourceBytes); assert.equal(imported.ok, true);
  const advanced = scenario('advanced-commercial-company', baseline.serializeState(imported.state),
    { path: sourcePath, sourceSha256: digest(sourceBytes), normalization: 'Baseline migration once; shared content 0.28.0 snapshot imported by both implementations' });
  advanced.command('reject missing research', { kind: 'start_research', researchId: 'missing-ui-research' }, false);
  advanced.command('hire data employee', { kind: 'hire_staff', role: 'data' });
  advanced.command('rebalance shared capacity', { kind: 'allocate_compute', serving: 159 * U, development: 9 * U, research: 8 * U });
  const chat = Object.values(advanced.state().slices.products.offers).find(product => product.companyId === advanced.state().playerCompanyId && product.kind === 'basic-chat');
  assert.ok(chat);
  advanced.command('reject terms change while a prepared release owns the exact Chat product',
    { kind: 'set_product_terms', productId: chat.id, priceCents: 1300, allowance: 100 }, false);
  advanced.step('advanced settlement', 2);
  advanced.save();
  // Focused 30C decisions use the same paid command path during onboarding and
  // after readiness. The combined planner remains one atomic commitment.
  const staffing = scenario('focused-staffing-and-resources', openingBytes,
    'Baseline-created opening; ordinary hires, founder/employee assignments and one atomic people/compute plan');
  staffing.command('hire ML for focused staffing', { kind: 'hire_staff', role: 'ml' });
  staffing.step('hire boundary and payroll before readiness');
  const employee = Object.values(staffing.state().slices.company.staff)
    .find(member => member.companyId === staffing.state().playerCompanyId && member.role === 'ml');
  assert.ok(employee); assert.ok(employee.readyWeek > staffing.state().week);
  staffing.command('assign onboarding employee half FTE', { kind: 'set_staff_allocation', staffId: employee.id, fte: U / 2 });
  staffing.command('split founder research and data', { kind: 'assign_founder', allocations: { research: U / 2, ml: 0, data: U / 2, infrastructure: 0, commercial: 0, hardware: 0 } });
  staffing.step('assignment boundary before onboarding completes');
  assert.equal(staffing.state().slices.company.staff[employee.id].assignedFte, U / 2);
  assert.ok(employee.readyWeek > staffing.state().week);
  staffing.step('employee reaches recorded ready week', employee.readyWeek - staffing.state().week);
  staffing.command('reject missing employee assignment', { kind: 'set_staff_allocation', staffId: 'missing-ui-employee', fte: U }, false);
  staffing.command('atomic people and compute plan', { kind: 'apply_studio_plan', commands: [
    { kind: 'assign_founder', allocations: { research: 0, ml: U, data: 0, infrastructure: 0, commercial: 0, hardware: 0 } },
    { kind: 'set_staff_allocation', staffId: employee.id, fte: U },
    { kind: 'set_cloud_capacity', cu: 8 * U },
    { kind: 'allocate_compute', serving: 0, development: 8 * U, research: 0 },
  ] });
  staffing.step('atomic plan settlement');
  assert.equal(staffing.state().slices.company.staff[employee.id].assignedFte, U);
  assert.equal(staffing.state().slices.compute.fleets[staffing.state().playerCompanyId].cloudCU, 8 * U);
  staffing.save();
  summary.allEqual = true;
  writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ output, baselineCommit, currentBuild: summary.currentBuild, fixtureCount: summary.fixtures.length,
    newCompanyEqualExceptBuildVersion: summary.newCompanyEqualExceptBuildVersion, checkpoints: summary.checkpoints.length, persistenceComparisons: summary.persistence.reduce((n, item) => n + item.writesCompared, 0), allEqual: true }));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
