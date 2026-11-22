import test from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { previewCommand, submitCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { getQualifiedReleaseRehearsal, releaseConfiguration, releaseConfigurationFingerprint } from '../src/modules/release-rehearsals';
import { activeRuntimeGuardrail } from '../src/modules/runtime-guardrails';
import { requestMeter } from '../src/modules/product-models';
import { DEFAULT_FEATURES } from '../src/content/wave2-market';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { activeGuardrailScenario, createGuardrailCandidate, deployedGuardrailScenario, installGuardrail } from './fixtures/wave12-guardrails';

interface ReleaseFixture { state: GameState; productId: string; modelId: string; candidateId: string; installationId?: string }
const compared = new Map<boolean, ReleaseFixture>();
function setup(guarded = true): ReleaseFixture {
  const cached = compared.get(guarded); if (cached) return structuredClone(cached);
  const base = guarded ? activeGuardrailScenario() : deployedGuardrailScenario();
  const run = new NaturalBusinessCampaign(base.state, 'w12-release-fixture-' + guarded);
  const candidateId = createGuardrailCandidate(run, base.modelId);
  rehearse(run, base.productId, candidateId);
  const result = { ...base, state: run.state, candidateId };
  compared.set(guarded, structuredClone(result)); return structuredClone(result);
}
function rehearse(run: NaturalBusinessCampaign, productId: string, candidateId: string): string {
  const id = 'release-rehearsal:' + run.queue({ kind: 'start_release_rehearsal', productId, candidateModelId: candidateId });
  run.until(state => !!getQualifiedReleaseRehearsal(state, productId, candidateId), 10, 'paid current-configuration rehearsal');
  return id;
}
function prepare(run: NaturalBusinessCampaign, productId: string, candidateId: string) {
  const id = 'prepared-release:' + run.queue({ kind: 'start_prepared_release', productId, candidateModelId: candidateId });
  run.until(state => state.slices.products.preparedReleases?.[id]?.status === 'ready', 6, 'paid release preparation');
  run.step(); return id;
}
function deny(state: GameState, payload: CommandPayload, expectedCode = 'NOT_READY') {
  const before = canonicalStateHash(state), proposed = previewCommand(state, payload), submitted = submitCommand(state, payload);
  assert.equal(proposed.accepted, false, payload.kind); assert.equal(submitted.accepted, false, payload.kind);
  assert.equal(proposed.reason!.code, expectedCode, payload.kind);
  assert.equal(canonicalStateHash(state), before); assert.equal(canonicalStateHash(submitted.state), before);
}

test('W12-R01: installing or toggling runtime checks invalidates old release configuration evidence without rewriting it', () => {
  const base = setup(false), run = new NaturalBusinessCampaign(base.state, 'w12-release-binding');
  const before = getQualifiedReleaseRehearsal(run.state, base.productId, base.candidateId)!;
  assert.ok(before); assert.equal(Object.hasOwn(before.configuration, 'guardrail'), false);
  const beforeHash = canonicalStateHash(before), originalConfig = releaseConfigurationFingerprint(run.state, base.productId);
  installGuardrail(run, base.productId, 'balanced');
  assert.notEqual(releaseConfigurationFingerprint(run.state, base.productId), originalConfig);
  assert.equal(getQualifiedReleaseRehearsal(run.state, base.productId, base.candidateId), undefined);
  assert.equal(canonicalStateHash(run.state.slices.products.releaseRehearsals![before.id]), beforeHash);
  const freshId = rehearse(run, base.productId, base.candidateId), fresh = run.state.slices.products.releaseRehearsals![freshId];
  assert.ok(fresh.configuration.guardrail);
  assert.equal(canonicalStateHash(fresh.configuration), canonicalStateHash(releaseConfiguration(run.state, base.productId)));
  for (const arm of Object.values(fresh.arms)) {
    assert.equal(arm.requiredWork, requestMeter(run.state.slices.models.versions[arm.modelId], DEFAULT_FEATURES).work * 10_000,
      'The ordinary release bank stays a standard model comparison; the paid checker audit is separate evidence.');
  }
  const preserved = canonicalStateHash(fresh);
  run.queue({ kind: 'set_runtime_guardrail_enabled', productId: base.productId, enabled: false }); run.step();
  assert.equal(getQualifiedReleaseRehearsal(run.state, base.productId, base.candidateId), undefined);
  assert.equal(canonicalStateHash(run.state.slices.products.releaseRehearsals![freshId]), preserved);
  assert.deepEqual(validateState(run.state), []);
  const restored = deserializeState(serializeState(run.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
});

test('W12-R02: prepared release admission locks both guardrail commands in both queue orders until discard', () => {
  const base = setup(), run = new NaturalBusinessCampaign(base.state, 'w12-release-lock');
  const guardrailCommands: CommandPayload[] = [
    { kind: 'install_runtime_guardrail', productId: base.productId, profile: 'strict' },
    { kind: 'set_runtime_guardrail_enabled', productId: base.productId, enabled: false },
  ];
  const releaseId = 'prepared-release:' + run.queue({ kind: 'start_prepared_release', productId: base.productId, candidateModelId: base.candidateId });
  for (const command of guardrailCommands) deny(run.state, command);
  run.step();
  for (const command of guardrailCommands) deny(run.state, command);
  assert.equal(run.state.slices.products.preparedReleases![releaseId].completedWork, U);
  run.queue({ kind: 'discard_prepared_release', releaseId }); run.step();
  for (const command of guardrailCommands) assert.equal(previewCommand(run.state, command).accepted, true);
  for (const command of guardrailCommands) {
    const reverse = new NaturalBusinessCampaign(structuredClone(base.state), 'w12-release-reverse-' + command.kind);
    reverse.queue(command);
    deny(reverse.state, { kind: 'start_prepared_release', productId: base.productId, candidateModelId: base.candidateId }, 'ALREADY_ACTIVE');
  }
  assert.deepEqual(validateState(run.state), []);
});

test('W12-R03: model handover preserves historical audit proof but requires a new paid rollout for the new exact model', () => {
  const base = setup(), run = new NaturalBusinessCampaign(base.state, 'w12-release-cutover');
  const old = structuredClone(run.state.slices.products.runtimeGuardrails![base.installationId!]);
  const oldDeploymentId = run.state.slices.products.offers[base.productId].deploymentId;
  const releaseId = prepare(run, base.productId, base.candidateId);
  run.queue({ kind: 'promote_prepared_release', releaseId }); run.step(2);
  assert.equal(run.state.slices.products.offers[base.productId].publicModelId, base.candidateId);
  assert.equal(run.state.slices.products.deployments[oldDeploymentId], undefined);
  assert.equal(activeRuntimeGuardrail(run.state, base.productId), null);
  assert.equal(run.state.slices.products.lastUsage[base.productId].guardrail, undefined);
  assert.equal(run.state.slices.products.lastUsage[base.productId].behavior!.falseRefusalBps,
    run.state.slices.models.versions[base.candidateId].behavior!.falseRefusalBps);
  assert.equal(run.state.slices.products.runtimeGuardrails![old.id].completedWork, old.completedWork);
  assert.deepEqual(validateState(run.state), []);
  const restored = deserializeState(serializeState(run.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
  const nextId = installGuardrail(run, base.productId, 'balanced');
  assert.notEqual(nextId, old.id); assert.equal(activeRuntimeGuardrail(run.state, base.productId)!.id, nextId);
  assert.equal(Object.keys(run.state.slices.products.runtimeGuardrails!).length, 2);
  assert.equal(run.state.slices.products.runtimeGuardrails![old.id].completedWork, old.completedWork);
  assert.equal(run.state.slices.products.runtimeGuardrails![nextId].completedWork, 2 * U);
  assert.equal(run.state.slices.products.runtimeGuardrails![nextId].completedStaff, 2 * U);
  assert.equal(run.state.slices.products.invoices.filter(row => row.productId === base.productId && row.week === run.week).length, 1);
  assert.deepEqual(validateState(run.state), []);
});

test('W12-R04: checker feature binding becomes stale on a real product option change and its historical receipts still reload', () => {
  const base = activeGuardrailScenario(), run = new NaturalBusinessCampaign(base.state, 'w12-feature-binding');
  const saved = canonicalStateHash(run.state.slices.products.runtimeGuardrails![base.installationId]);
  run.queue({ kind: 'set_product_features', productId: base.productId, features: { memory: true, extendedContext: false, deepReasoning: false } });
  run.step();
  assert.equal(activeRuntimeGuardrail(run.state, base.productId), null);
  assert.equal(run.state.slices.products.lastUsage[base.productId].guardrail, undefined);
  assert.equal(canonicalStateHash(run.state.slices.products.runtimeGuardrails![base.installationId]), saved);
  assert.equal(run.state.slices.products.lastUsage[base.productId].tokens!.inputTokens,
    run.state.slices.products.lastUsage[base.productId].segments!.reduce((sum, item) => sum + item.requestedExchanges, 0) * 600);
  const restored = deserializeState(serializeState(run.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
  assert.deepEqual(validateState(run.state), []);
});
