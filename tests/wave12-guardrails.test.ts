import { staffContributors } from './fixtures/staff-contributors';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { RUNTIME_GUARDRAIL_PROFILES as PROFILES } from '../src/content/wave12-guardrails';
import type { GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { RuntimeGuardrailInstallation } from '../src/contracts/wave12-guardrails';
import { canonicalStateHash } from '../src/core/canonical';
import { previewCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { mulDiv } from '../src/core/math';
import { policyModelFingerprint } from '../src/modules/policy-holdouts';
import { activeRuntimeGuardrail, getRuntimeGuardrailView, guardrailFalseRefusalBps, measuredRuntimeGuardrailUsage,
  runtimeGuardrailAudit, runtimeGuardrailBinding, runtimeGuardrailBindingFingerprint, runtimeGuardrailInputsMatch,
  runtimeGuardrailMemory, runtimeGuardrailRequests, runtimeGuardrailWorkPerRequest } from '../src/modules/runtime-guardrails';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { activeGuardrailScenario, deployedGuardrailScenario, installGuardrail, installGuardrailRouteAndCache } from './fixtures/wave12-guardrails';

const install = (state: GameState, id: string): RuntimeGuardrailInstallation => state.slices.products.runtimeGuardrails![id];

function assertInvalidSnapshot(state: GameState, message: string): void {
  assert.ok(validateState(state).length > 0, message);
  const envelope = { format: 'frontier-lab', schemaVersion: state.schemaVersion, contentVersion: state.contentVersion,
    checksum: canonicalStateHash(state), state };
  assert.equal(deserializeState(JSON.stringify(envelope)).ok, false, message + ' after a valid checksum');
}

test('W12-G01: rollout admission requires prior research, exact paid model reports and compatible resident capacity', () => {
  const base = deployedGuardrailScenario();
  const payload = { kind: 'install_runtime_guardrail' as const, productId: base.productId, profile: 'balanced' as const };
  const before = canonicalStateHash(base.state), binding = runtimeGuardrailBinding(base.state, base.productId)!;
  const quote = previewCommand(base.state, payload);
  assert.ok(quote.accepted, quote.reason?.message); assert.equal(quote.upfrontCostCents, 0);
  assert.match(quote.summary, /2 development CUw and 40 Design points/);
  assert.equal(canonicalStateHash(base.state), before, 'Reading a rollout quote consumes no work, cases, or randomness.');
  for (const id of ['R1A', 'R5']) {
    const missing = structuredClone(base.state);
    missing.slices.research.completedByCompany[missing.playerCompanyId] = missing.slices.research.completedByCompany[missing.playerCompanyId].filter(value => value !== id);
    assert.equal(previewCommand(missing, payload).accepted, false, 'Both authored research prerequisites apply.');
  }
  const noPolicy = structuredClone(base.state); delete noPolicy.slices.models.reports[binding.primary.policyReportId];
  assert.equal(previewCommand(noPolicy, payload).accepted, false);
  const noPaidCapability = structuredClone(base.state);
  const capabilityRun = Object.values(noPaidCapability.slices.models.evaluationRuns).find(run => run.reportId === binding.primary.capabilityReportId)!;
  delete noPaidCapability.slices.models.evaluationRuns[capabilityRun.id];
  assert.equal(previewCommand(noPaidCapability, payload).accepted, false, 'A copied report is not paid capability evidence.');
  const changedVersion = structuredClone(base.state); changedVersion.slices.models.versions[base.modelId].behavior!.falseRefusalBps++;
  assert.equal(previewCommand(changedVersion, payload).accepted, false, 'An old report cannot authorize changed weights.');
  const memory = structuredClone(base.state); memory.slices.compute.fleets[memory.playerCompanyId].cloudCU = U;
  assert.equal(previewCommand(memory, payload).reason?.code, 'MISSING_MEMORY');
  const unsupported = structuredClone(base.state); unsupported.slices.products.offers[base.productId].kind = 'business-docs';
  assert.equal(previewCommand(unsupported, payload).accepted, false);
});

test('W12-G02: compute and ML finish independently, obey weekly caps, and expose no audit before the next boundary', () => {
  const base = deployedGuardrailScenario(), run = new NaturalBusinessCampaign(base.state, 'guardrail-independent');
  const modelBefore = structuredClone(run.state.slices.models.versions[base.modelId]), dataBefore = canonicalStateHash(run.state.slices.data);
  const companyId = run.state.playerCompanyId, staff = run.staff('ml')[0];
  run.founder('data');
  for (const person of staffContributors(run.state, 'ml')) run.queue({ kind: 'set_staff_allocation', staffId: person.id, fte: 0 });
  run.queue({ kind: 'allocate_compute', serving: 48 * U, development: 16 * U, research: 0 });
  const id = 'guardrail:' + run.queue({ kind: 'install_runtime_guardrail', productId: base.productId, profile: 'strict' });
  assert.equal(previewCommand(run.state, { kind: 'install_runtime_guardrail', productId: base.productId, profile: 'balanced' }).accepted, false);
  run.step();
  let item = install(run.state, id);
  assert.equal(item.completedWork, U); assert.equal(item.completedStaff, 0); assert.equal(item.audit, null);
  assert.equal(item.latestGrant!.requestedWork, U); assert.equal(item.latestGrant!.effectiveCUw, U);
  assert.equal(item.physicalWork, U); assert.equal(item.status, 'building');
  assert.equal(activeRuntimeGuardrail(run.state, base.productId), null); assert.equal(runtimeGuardrailWorkPerRequest(run.state, base.productId), 0);
  assert.equal(runtimeGuardrailMemory(run.state, base.productId), 0, 'An unfinished checker gives no resident runtime feature.');
  run.step(); item = install(run.state, id);
  assert.equal(item.completedWork, 2 * U); assert.equal(item.completedStaff, 0); assert.equal(item.audit, null);
  assert.ok(runtimeGuardrailRequests(run.state).every(request => request.normalizedWorkCUw === 0), 'Finished GPU work cannot be charged twice while ML is absent.');
  const restored = deserializeState(serializeState(run.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
  assert.equal(canonicalStateHash(restored.state), canonicalStateHash(run.state)); run.state = restored.state;
  run.queue({ kind: 'allocate_compute', serving: 48 * U, development: 0, research: 0 });
  run.queue({ kind: 'set_staff_allocation', staffId: staff.id, fte: U }); run.step();
  assert.equal(install(run.state, id).completedStaff, U); assert.equal(install(run.state, id).audit, null);
  run.step(); item = install(run.state, id);
  assert.equal(item.status, 'ready'); assert.equal(item.completedStaff, 2 * U); assert.equal(item.audit, null);
  assert.equal(item.availableWeek, run.week + 1); assert.equal(item.physicalWork, 2 * U);
  assert.equal(activeRuntimeGuardrail(run.state, base.productId), null);
  run.step(); item = install(run.state, id);
  assert.equal(item.status, 'active'); assert.ok(item.audit); assert.equal(activeRuntimeGuardrail(run.state, base.productId)!.id, id);
  assert.equal(runtimeGuardrailMemory(run.state, base.productId), 2 * U); assert.equal(runtimeGuardrailWorkPerRequest(run.state, base.productId), 50_000);
  assert.deepEqual(run.state.slices.models.versions[base.modelId], modelBefore, 'Runtime work does not train or mutate weights.');
  assert.equal(canonicalStateHash(run.state.slices.data), dataBefore, 'An audit creates neither customer feedback nor training packets.');
  assert.equal(run.state.slices.compute.fleets[companyId].lastWork.development, 0, 'Activation has no second rollout charge.');
  assert.deepEqual(validateState(run.state), []);
});

test('W12-G03: paired audit separates allowed mistakes from correct policy refusals and preserves a nested profile tradeoff', () => {
  const base = activeGuardrailScenario(), item = install(base.state, base.installationId), balanced = item.audit!;
  const strict = runtimeGuardrailAudit(base.state, { ...item, profile: 'strict' });
  for (const report of [balanced, strict]) {
    assert.equal(report.cases.length, 100); assert.equal(report.baseline.allowedCases, 50); assert.equal(report.baseline.restrictedCases, 50);
    assert.equal(report.baseline.usefulAnswers + report.baseline.confidentErrors + report.baseline.falseRefusals + report.baseline.clarifications, 50);
    assert.equal(report.guarded.usefulAnswers + report.guarded.confidentErrors + report.guarded.falseRefusals + report.guarded.clarifications, 50);
    assert.equal(report.guarded.correctPolicyRefusals + report.guarded.unsafeCompliances, 50);
    assert.equal(report.guarded.directRestrictedCases, 25); assert.equal(report.guarded.adversarialRestrictedCases, 25);
    assert.equal(report.guarded.confidentErrors, report.baseline.confidentErrors);
    assert.equal(report.guarded.clarifications, report.baseline.clarifications);
    assert.ok(report.guarded.usefulAnswers <= report.baseline.usefulAnswers);
    assert.ok(report.guarded.unsafeCompliances <= report.baseline.unsafeCompliances);
    assert.equal(report.guardedStandardWorkCUw - report.baselineStandardWorkCUw, 100 * PROFILES[report.profile].workPerRequestCUw);
    for (const probe of report.cases) {
      if (probe.eligibility === 'restricted') assert.ok(['correct-policy-refusal', 'unsafe-compliance'].includes(probe.guarded));
      if (probe.baseline === 'false-refusal') assert.equal(probe.guarded, 'false-refusal', 'The checker cannot fix a learned refusal.');
    }
  }
  assert.deepEqual(strict.baseline, balanced.baseline);
  assert.ok(strict.guarded.unsafeCompliances <= balanced.guarded.unsafeCompliances);
  assert.ok(strict.guarded.falseRefusals >= balanced.guarded.falseRefusals);
  assert.ok(strict.guarded.usefulAnswers <= balanced.guarded.usefulAnswers);
  assert.equal(strict.evidenceKey, balanced.evidenceKey);
});

test('W12-G04: time, identifiers, mutable names and simulation random state cannot reroll a paid audit', () => {
  const base = activeGuardrailScenario(), item = install(base.state, base.installationId), before = canonicalStateHash(base.state);
  const later = structuredClone(base.state); later.week += 70; later.random['guardrail-unrelated'] = { state: 123, draws: 70 };
  const original = later.slices.models.versions[item.binding.primary.modelId];
  original.name = 'Renamed after release';
  const repeated = runtimeGuardrailAudit(later, { ...item, id: 'guardrail:different-command', startedWeek: later.week } as RuntimeGuardrailInstallation);
  assert.deepEqual(repeated, item.audit);
  const aliasId = 'same-policy-another-identifier'; later.slices.models.versions[aliasId] = { ...original, id: aliasId };
  const binding = { ...item.binding, primary: { ...item.binding.primary, modelId: aliasId,
    modelFingerprint: policyModelFingerprint(later.slices.models.versions[aliasId]), capabilityReportId: 'another-report', policyReportId: 'another-policy-report' } };
  const alias = runtimeGuardrailAudit(later, { ...item, binding, bindingFingerprint: runtimeGuardrailBindingFingerprint(binding) });
  const outcomes = (report: typeof alias) => report.cases.map(({ modelId: _modelId, ...probe }) => probe);
  assert.deepEqual(outcomes(alias), outcomes(item.audit!)); assert.deepEqual(alias.guarded, item.audit!.guarded);
  assert.equal(canonicalStateHash(base.state), before, 'The diagnostic recipe does not consume the game random stream or mutate evidence.');
});

test('W12-G05: actual routed audits cover each model and require the secondary’s own paid policy report', () => {
  const base = deployedGuardrailScenario(), run = new NaturalBusinessCampaign(base.state, 'guardrail-route-audit');
  const secondaryId = installGuardrailRouteAndCache(run, base.productId, base.modelId);
  const binding = runtimeGuardrailBinding(run.state, base.productId)!;
  assert.equal(binding.secondary!.modelId, secondaryId); assert.notEqual(binding.primary.policyReportId, binding.secondary!.policyReportId);
  const missing = structuredClone(run.state); delete missing.slices.models.reports[binding.secondary!.policyReportId];
  assert.equal(previewCommand(missing, { kind: 'install_runtime_guardrail', productId: base.productId, profile: 'balanced' }).accepted, false);
  const id = installGuardrail(run, base.productId, 'balanced'), item = install(run.state, id), report = item.audit!;
  assert.equal(report.primaryCases, 40); assert.equal(report.secondaryCases, 60);
  for (const eligibility of ['allowed', 'restricted'] as const) {
    assert.equal(report.cases.filter(row => row.eligibility === eligibility && row.route === 'primary').length, 20);
    assert.equal(report.cases.filter(row => row.eligibility === eligibility && row.route === 'secondary').length, 30);
  }
  assert.equal(item.memoryMU, run.state.slices.models.versions[base.modelId].residentMU
    + run.state.slices.models.versions[secondaryId].residentMU + 20_000_000 + U);
  // Pure formula counterfactual: a weak secondary must not inherit the primary's .policy through a spread object.
  const counterfactual = structuredClone(run.state); counterfactual.slices.models.versions[secondaryId].policy!.currentUnsafeComplianceBps = 10000;
  const changed = runtimeGuardrailAudit(counterfactual, item);
  assert.ok(changed.baseline.unsafeCompliances > report.baseline.unsafeCompliances);
  for (const [index, probe] of report.cases.entries()) if (probe.route === 'primary') assert.deepEqual(changed.cases[index], probe);
  assert.deepEqual(validateState(run.state), []);
});

test('W12-G06: replacement is staged, returning to a prior profile reuses identical cases, and retained history is bounded', () => {
  const base = activeGuardrailScenario(), run = new NaturalBusinessCampaign(base.state, 'guardrail-profile-return');
  const original = structuredClone(install(run.state, base.installationId));
  const next = 'guardrail:' + run.queue({ kind: 'install_runtime_guardrail', productId: base.productId, profile: 'strict' });
  run.step(); assert.equal(activeRuntimeGuardrail(run.state, base.productId)!.id, original.id);
  assert.equal(install(run.state, next).status, 'building'); assert.equal(install(run.state, next).audit, null);
  run.step(); assert.equal(activeRuntimeGuardrail(run.state, base.productId)!.id, original.id);
  assert.equal(install(run.state, next).status, 'ready'); run.step();
  assert.equal(activeRuntimeGuardrail(run.state, base.productId)!.id, next); assert.equal(install(run.state, original.id).enabled, false);
  const restoredId = installGuardrail(run, base.productId, 'balanced');
  assert.notEqual(restoredId, original.id); assert.deepEqual(install(run.state, restoredId).audit, original.audit);
  assert.deepEqual(install(run.state, original.id).audit, original.audit, 'Replacing a profile preserves its historical paid result.');
  assert.equal(install(run.state, restoredId).completedWork, 2 * U, 'A new rollout still pays its authored implementation work.');
  for (let index = 3; index < 8; index++) installGuardrail(run, base.productId, index % 2 === 1 ? 'strict' : 'balanced');
  assert.equal(Object.keys(run.state.slices.products.runtimeGuardrails!).length, 8);
  const active = activeRuntimeGuardrail(run.state, base.productId)!;
  assert.equal(previewCommand(run.state, { kind: 'install_runtime_guardrail', productId: base.productId,
    profile: active.profile === 'strict' ? 'balanced' : 'strict' }).reason?.code, 'CAPACITY_EXCEEDED');
  const roundtrip = deserializeState(serializeState(run.state)); assert.ok(roundtrip.ok, roundtrip.ok ? '' : roundtrip.error);
  assert.equal(canonicalStateHash(roundtrip.state), canonicalStateHash(run.state));
});

test('W12-G07: partial requests spend checking work but produce no completed check or false-refusal outcome', () => {
  const input = { installationId: 'guardrail:example', profile: 'balanced' as const, bindingFingerprint: '12345678',
    requestWorkCUw: 220_000, baselineFalseRefusalBps: 385, technicalErrorBps: 1200, baselineUnsafeComplianceBps: 660 };
  const zero = measuredRuntimeGuardrailUsage(input, 440_000, 0), partial = measuredRuntimeGuardrailUsage(input, 440_000, 219_999);
  assert.equal(zero.checkWorkCUw, 0); assert.equal(zero.checkedRequests, 0); assert.equal(zero.addedFalseRefusalBps, 0);
  assert.equal(partial.checkedRequests, 0); assert.equal(partial.uncheckedRequests, 2); assert.equal(partial.additionalFalseRefusals, 0);
  assert.equal(partial.addedFalseRefusalBps, 0); assert.ok(partial.checkWorkCUw > 0);
  assert.equal(guardrailFalseRefusalBps(385, 1200, partial), 385);
  const one = measuredRuntimeGuardrailUsage(input, 440_000, 220_000), fraction = measuredRuntimeGuardrailUsage(input, 440_000, 330_000);
  assert.equal(one.checkedRequests, 1); assert.equal(one.checkWorkCUw, 20_000);
  assert.equal(one.addedFalseRefusalBps, mulDiv(10000 - 1200 - 385, 200, 10000));
  assert.equal(fraction.checkedRequests, 1); assert.equal(fraction.checkWorkCUw, 30_000);
  assert.equal(one.baselineUnsafeComplianceBps, 660); assert.equal(one.guardedUnsafeComplianceBps, 198);
  const noUseful = measuredRuntimeGuardrailUsage({ ...input, technicalErrorBps: 9900 }, 220_000, 220_000);
  assert.equal(noUseful.addedFalseRefusalBps, 0, 'The checker only blocks remaining useful allowed answers.');
});

test('W12-G08: forged paid work, model evidence, audit outcomes, memory and serving counts fail checksum-correct import', () => {
  const base = activeGuardrailScenario();
  const corruptions: ((state: GameState) => void)[] = [
    state => { install(state, base.installationId).requiredWork--; },
    state => { install(state, base.installationId).completedWork = 0; },
    state => { install(state, base.installationId).physicalWork = 0; },
    state => { install(state, base.installationId).workReceipts = {}; },
    state => { install(state, base.installationId).latestGrant!.physicalCUw++; },
    state => { install(state, base.installationId).latestGrant!.requestedWork++; },
    state => { install(state, base.installationId).completedStaff = U; },
    state => { install(state, base.installationId).staffGrantCount = 1; },
    state => { install(state, base.installationId).latestStaffGrant!.grantedStaff++; },
    state => { install(state, base.installationId).memoryMU--; },
    state => { install(state, base.installationId).profile = 'strict'; },
    state => { install(state, base.installationId).binding.primary.policyReportId = install(state, base.installationId).binding.primary.capabilityReportId; },
    state => { install(state, base.installationId).evidenceKey = '00000000'; },
    state => { install(state, base.installationId).audit!.guarded.unsafeCompliances++; },
    state => { install(state, base.installationId).audit!.cases[0].guarded = 'unsafe-compliance'; },
    state => { install(state, base.installationId).audit!.guardedStandardWorkCUw--; },
    state => { delete state.commandReceipts[base.installationId.slice('guardrail:'.length)]; },
    state => { delete state.slices.products.lastUsage[base.productId].guardrail; },
    state => { state.slices.products.lastUsage[base.productId].guardrail!.checkedRequests++; },
    state => { state.slices.products.lastUsage[base.productId].guardrail!.checkWorkCUw = 0; },
    state => { state.slices.products.lastUsage[base.productId].guardrail!.addedFalseRefusalBps = 0; },
    state => { Object.assign(install(state, base.installationId), { unsupportedBenefit: true }); },
  ];
  for (const [index, corrupt] of corruptions.entries()) {
    const forged = structuredClone(base.state); corrupt(forged); assertInvalidSnapshot(forged, `Runtime corruption ${index + 1}`);
  }
  assert.deepEqual(validateState(base.state), []);
});

test('W12-G09: source changes during rollout preserve paid audit history but cannot activate a mismatched checker', () => {
  const base = deployedGuardrailScenario(), run = new NaturalBusinessCampaign(base.state, 'guardrail-stale-rollout');
  const id = 'guardrail:' + run.queue({ kind: 'install_runtime_guardrail', productId: base.productId, profile: 'balanced' });
  run.step();
  run.queue({ kind: 'set_product_features', productId: base.productId, features: { memory: true, extendedContext: false, deepReasoning: false } });
  run.step(2);
  const item = install(run.state, id); assert.equal(item.status, 'active'); assert.ok(item.audit);
  assert.equal(runtimeGuardrailInputsMatch(run.state, item), false); assert.equal(activeRuntimeGuardrail(run.state, base.productId), null);
  assert.equal(runtimeGuardrailWorkPerRequest(run.state, base.productId), 0); assert.equal(runtimeGuardrailMemory(run.state, base.productId), 0);
  assert.equal(getRuntimeGuardrailView(run.state, base.productId).active, false); assert.match(getRuntimeGuardrailView(run.state, base.productId).status, /stale/);
  assert.equal(run.state.slices.products.lastUsage[base.productId].guardrail, undefined);
  assert.equal(previewCommand(run.state, { kind: 'install_runtime_guardrail', productId: base.productId, profile: 'balanced' }).accepted, true);
  assert.deepEqual(validateState(run.state), []);
});
