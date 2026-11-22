import { historicalContent, loadHistoricalSnapshot, upgradeHistoricalState } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, submitCommand } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState, MAX_SNAPSHOT_BYTES, SnapshotTooLargeError } from '../src/core/snapshot';
import { validateState } from '../src/core/validation';
import { getComputeCostView } from '../src/modules/compute-costs';
import { getReviewableFeedbackStudy } from '../src/modules/feedback';
import { getQualifiedReleaseRehearsal, releaseConfigurationFingerprint, releaseModelFingerprint } from '../src/modules/release-rehearsals';
import { activeRuntimeGuardrail, currentRuntimeGuardrail } from '../src/modules/runtime-guardrails';
import { productRequestMeter } from '../src/modules/products';
import { readBrowserRecovery, readBrowserSnapshot, writeBrowserSnapshot } from '../src/persistence/wave0-browser';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

test('W12-N01: an earned company audits two profiles, pays recurring GPU costs, preserves feedback scope and requalifies changed serving inputs', () => {
  const original = loadHistoricalSnapshot(readFileSync(join(__dirname, 'fixtures/wave11-snapshot.json'), 'utf8'));
  assert.ok(original.ok);
  const previous = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave11-expected.json'), 'utf8')) as {
    sourceCommit: string; commands: { week: number; id: string; payload: CommandPayload }[];
  };
  let earned: GameState = original.state;
  while (earned.week < 432) {
    for (const command of previous.commands.filter(item => item.week === earned.week)) {
      const queued = submitCommand(earned, command.payload, historicalContent(earned), command.id);
      assert.ok(queued.accepted, queued.reason?.message); earned = queued.state;
    }
    const next = advanceWeek(earned, historicalContent(earned)); assert.ok(next.accepted, next.reason?.message); earned = next.state;
  }
  assert.equal(canonicalStateHash({ ...earned, contentVersion: '0.12.0', buildVersion: '0.12.0' }), '473327f1');
  earned = upgradeHistoricalState(earned);
  const run = new NaturalBusinessCampaign(earned, 'wave12-natural'), productId = 'product:natural-business-command-67';
  const originalProduct = earned.slices.products.offers[productId], modelId = earned.slices.products.deployments[originalProduct.deploymentId].modelId;
  const originalModel = releaseModelFingerprint(earned.slices.models.versions[modelId]);
  const originalStudies = canonicalStateHash(earned.slices.data.feedbackStudies);
  const beforeWork = productRequestMeter(earned, originalProduct, earned.slices.models.versions[modelId]).work;
  const snapshots: Record<string, string> = { start: serializeState(run.state) };
  const service: object[] = [], costs: ReturnType<typeof getComputeCostView>['reports'] = [];
  let expandedCapacity = false;
  const step = () => {
    const carry = run.state.slices.products.contracts[originalProduct.contractId].tokenBillRemainder ?? 0;
    run.step();
    const product = run.state.slices.products.offers[productId], usage = run.state.slices.products.lastUsage[productId];
    assert.equal(product.status, 'active'); assert.equal(product.deploymentId, originalProduct.deploymentId);
    assert.equal(product.publicModelId, modelId);
    assert.equal(releaseModelFingerprint(run.state.slices.models.versions[modelId]), originalModel);
    if (expandedCapacity) assert.equal(usage.fulfillmentBps, 10000, 'Expanded serving headroom must cover the earned company’s checker and customer workload.');
    assert.equal(usage.tokens!.billCarryIn, carry);
    const invoices = run.state.slices.products.invoices.filter(item => item.productId === productId && item.week === run.week);
    assert.equal(invoices.length, 1); assert.equal(invoices[0].amountCents, usage.billedCents);
    const cost = getComputeCostView(run.state).latest!;
    assert.equal(cost.totals.totalComputeCents + cost.totals.otherOperatingCents, run.company.lastWeek.operatingExpenseCents);
    assert.equal(cost.totals.attributedComputeCents + cost.totals.sharedComputeCents, cost.totals.totalComputeCents);
    costs.push(cost);
    service.push({ week: run.week, paidAccounts: usage.paidAccounts, fulfillmentBps: usage.fulfillmentBps,
      falseRefusalBps: usage.behavior!.falseRefusalBps, physicalWork: usage.tokens!.physicalWork,
      billedCents: usage.billedCents, inputTokens: usage.tokens!.inputTokens, outputTokens: usage.tokens!.outputTokens,
      internalTokens: usage.tokens!.internalTokens, billCarryIn: usage.tokens!.billCarryIn, billCarryOut: usage.tokens!.billCarryOut,
      guardrail: usage.guardrail ?? null });
  };
  const until = (predicate: () => boolean, label: string, limit = 12) => {
    const start = run.week; while (!predicate() && run.week - start < limit) step();
    assert.ok(predicate(), label + ' did not complete through ordinary weekly resource grants.');
  };
  run.mark('Published policy-trained API retained with its paid model tests and original customer contract');
  const balancedId = 'guardrail:' + run.queue({ kind: 'install_runtime_guardrail', productId, profile: 'balanced' });
  step();
  assert.equal(run.state.slices.products.runtimeGuardrails![balancedId].completedWork, U);
  assert.equal(run.state.slices.products.runtimeGuardrails![balancedId].audit, null);
  assert.equal(activeRuntimeGuardrail(run.state, productId), null);
  snapshots['balanced-building'] = serializeState(run.state);
  until(() => activeRuntimeGuardrail(run.state, productId)?.id === balancedId, 'balanced rollout');
  const balanced = structuredClone(run.state.slices.products.runtimeGuardrails![balancedId]);
  assert.equal(balanced.completedWork, 2 * U); assert.equal(balanced.completedStaff, 2 * U);
  assert.ok(balanced.physicalWork > 0); assert.equal(balanced.availableWeek, balanced.completedWeek! + 1);
  assert.equal(productRequestMeter(run.state, run.state.slices.products.offers[productId], run.state.slices.models.versions[modelId]).work, beforeWork + 20_000);
  assert.equal(balanced.audit!.baseline.allowedCases, 50); assert.equal(balanced.audit!.baseline.restrictedCases, 50);
  snapshots.balanced = serializeState(run.state);
  run.mark('Balanced checks become live only after two paid implementation meters and the next boundary');

  const studyId = 'feedback-study:' + run.queue({ kind: 'start_feedback_study', productId, sampling: 'representative', consent: 'hosted-only' });
  const strictId = 'guardrail:' + run.queue({ kind: 'install_runtime_guardrail', productId, profile: 'strict' });
  step();
  assert.equal(activeRuntimeGuardrail(run.state, productId)?.id, balancedId, 'The previous paid checker continues through replacement work.');
  until(() => activeRuntimeGuardrail(run.state, productId)?.id === strictId, 'strict replacement');
  const strict = structuredClone(run.state.slices.products.runtimeGuardrails![strictId]);
  assert.equal(strict.bindingFingerprint, balanced.bindingFingerprint);
  assert.equal(strict.evidenceKey, balanced.evidenceKey);
  assert.deepEqual(strict.audit!.baseline, balanced.audit!.baseline);
  assert.ok(strict.audit!.guarded.unsafeCompliances <= balanced.audit!.guarded.unsafeCompliances);
  assert.ok(strict.audit!.guarded.falseRefusals >= balanced.audit!.guarded.falseRefusals);
  assert.equal(run.state.slices.products.runtimeGuardrails![balancedId].enabled, false);
  assert.equal(productRequestMeter(run.state, run.state.slices.products.offers[productId], run.state.slices.models.versions[modelId]).work, beforeWork + 50_000);
  until(() => run.state.slices.products.lastUsage[productId].fulfillmentBps < 10000, 'strict service meets its finite serving allocation', 6);
  const strictShortfallBps = run.state.slices.products.lastUsage[productId].fulfillmentBps;
  assert.ok(strictShortfallBps > 0 && strictShortfallBps < 10000, 'Strict checking must expose the inherited company’s exhausted serving headroom.');
  snapshots['strict-capacity-shortfall'] = serializeState(run.state);
  run.queue({ kind: 'set_cloud_capacity', cu: 80 * U }); step();
  run.queue({ kind: 'allocate_compute', serving: 132 * U, development: 6 * U, research: 6 * U }); step();
  expandedCapacity = true;
  assert.equal(run.state.slices.products.lastUsage[productId].fulfillmentBps, 10000);
  until(() => !!getReviewableFeedbackStudy(run.state, run.state.playerCompanyId, studyId), 'four paid feedback weeks', 6);
  const study = run.state.slices.data.feedbackStudies![studyId];
  assert.equal(study.totalCases, 100);
  assert.deepEqual([...new Set(study.weeks.map(row => row.paidUsage.guardrail?.profile))].sort(), ['balanced', 'strict']);
  assert.ok(study.weeks.every(row => row.outcomes.cases === row.outcomes.useful + row.outcomes.confidentError + row.outcomes.falseRefusal + row.outcomes.clarification));
  snapshots.strict = serializeState(run.state);
  run.mark('Strict checking exposes finite serving headroom; paid cloud capacity restores fulfillment while feedback preserves each profile');

  const features = { ...run.state.slices.products.offers[productId].features!, memory: true };
  run.queue({ kind: 'set_product_features', productId, features }); step();
  assert.equal(activeRuntimeGuardrail(run.state, productId), null);
  assert.equal(run.state.slices.products.lastUsage[productId].guardrail, undefined);
  assert.equal(currentRuntimeGuardrail(run.state, productId)?.audit?.evidenceKey, strict.audit!.evidenceKey);
  snapshots['inputs-changed'] = serializeState(run.state);
  const requalifiedId = 'guardrail:' + run.queue({ kind: 'install_runtime_guardrail', productId, profile: 'strict' });
  until(() => activeRuntimeGuardrail(run.state, productId)?.id === requalifiedId, 'changed-input requalification');
  assert.notEqual(run.state.slices.products.runtimeGuardrails![requalifiedId].bindingFingerprint, strict.bindingFingerprint);
  assert.equal(run.state.slices.products.runtimeGuardrails![requalifiedId].audit!.evidenceKey, strict.audit!.evidenceKey);
  snapshots.requalified = serializeState(run.state);
  run.mark('Changed conversation inputs stop the old checker; a fresh paid rollout requalifies the exact new configuration');

  const candidateId = 'model-wave11-natural-command-4';
  const rehearsalId = 'release-rehearsal:' + run.queue({ kind: 'start_release_rehearsal', productId, candidateModelId: candidateId });
  until(() => !!getQualifiedReleaseRehearsal(run.state, productId, candidateId), 'configuration-bound model comparison');
  const configurationBefore = releaseConfigurationFingerprint(run.state, productId), rehearsal = structuredClone(run.state.slices.products.releaseRehearsals![rehearsalId]);
  run.queue({ kind: 'set_runtime_guardrail_enabled', productId, enabled: false }); step();
  assert.notEqual(releaseConfigurationFingerprint(run.state, productId), configurationBefore);
  assert.equal(getQualifiedReleaseRehearsal(run.state, productId, candidateId), undefined);
  assert.equal(run.state.slices.products.lastUsage[productId].guardrail, undefined);
  assert.deepEqual(run.state.slices.products.releaseRehearsals![rehearsalId], rehearsal);
  snapshots.disabled = serializeState(run.state);
  run.queue({ kind: 'set_runtime_guardrail_enabled', productId, enabled: true }); step();
  assert.equal(activeRuntimeGuardrail(run.state, productId)?.id, requalifiedId);
  assert.equal(releaseConfigurationFingerprint(run.state, productId), configurationBefore);
  assert.equal(getQualifiedReleaseRehearsal(run.state, productId, candidateId)?.id, rehearsalId);
  run.mark('Disabling checks changes the release configuration; restoring the exact setting restores matching evidence without rerolling it');

  const oldStudies = Object.fromEntries(Object.keys(earned.slices.data.feedbackStudies!).map(id => [id, run.state.slices.data.feedbackStudies![id]]));
  assert.equal(canonicalStateHash(oldStudies), originalStudies);
  assert.deepEqual(validateState(run.state, CONTENT), []);
  const final = serializeState(run.state), imported = deserializeState(final);
  assert.ok(imported.ok); assert.equal(serializeState(imported.state), final);
  assert.ok(Buffer.byteLength(final) < 2_000_000, 'The earned continuation stays inside the supported portable snapshot bound.');
  snapshots.complete = final;
  const evidence = { sourceCommit: previous.sourceCommit, sourceWeek: 432, sourceHash: '473327f1', finalWeek: run.week,
    finalHash: canonicalStateHash(run.state), snapshotBytes: Buffer.byteLength(final), cashCents: run.cash, minimumCashCents: run.minimumCashCents,
    productId, modelId, balancedId, strictId, requalifiedId, studyId, rehearsalId, strictShortfallBps, commands: run.commands, milestones: run.milestones,
    installations: Object.values(run.state.slices.products.runtimeGuardrails!), study, rehearsal, service, costs,
    assertions: ['Exact published Wave11 company continued through ordinary commands without injected resources',
      'Both rollout meters and separate resident workspace consume real grants before next-boundary audit publication',
      'Fixed paired profiles preserve models and prior evidence, with previous protection continuing during replacement',
      'Recurring checker work and memory affect serving costs while API invoices retain actual token counts and billing carry',
      'Ordinary feedback retains only allowed-response outcomes and captures the applied runtime profile',
      'Changed features invalidate protection until paid requalification; profile toggles bind release evidence',
      'Strict checking exposes inherited capacity scarcity; paid cloud expansion restores full fulfillment, with one customer invoice and reconciled ledgers throughout',
      'Final save reloads byte-for-byte below two megabytes and preserves all pre-existing feedback histories'] };
  if (process.env.FRONTIER_WAVE12_OUTPUT) {
    mkdirSync(process.env.FRONTIER_WAVE12_OUTPUT, { recursive: true });
    for (const [name, snapshot] of Object.entries(snapshots)) writeFileSync(join(process.env.FRONTIER_WAVE12_OUTPUT, `frontier-lab-wave12-${name}.json`), snapshot);
    writeFileSync(join(process.env.FRONTIER_WAVE12_OUTPUT, 'wave12-progression.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(JSON.stringify({ finalWeek: run.week, finalHash: evidence.finalHash, commands: run.commands.length,
    snapshotBytes: evidence.snapshotBytes, balancedAudit: balanced.audit!.guarded, strictAudit: strict.audit!.guarded,
    finalCashCents: run.cash, minimumCashCents: run.minimumCashCents }));

  // A separate ordinary-play branch reaches the allowed history cap. Keep the
  // captured campaign and its evidence above unchanged; saving must remain usable
  // before the player has exhausted these legitimate paid operating choices.
  const saveBranch = new NaturalBusinessCampaign(structuredClone(run.state), 'wave12-save-limit');
  const saveObservations: { week: number; installations: number; hash: string; prettyBytes: number; compactBytes: number; savedBytes: number; compacted: boolean }[] = [];
  const envelopeFor = (state: GameState) => ({ format: 'frontier-lab', schemaVersion: state.schemaVersion,
    contentVersion: CONTENT.version, checksum: canonicalStateHash(state), state });
  const initialPretty = JSON.stringify(envelopeFor(saveBranch.state), null, 2);
  assert.equal(initialPretty, final, 'Saves that still fit must retain their exact published formatting.');
  // Record the starting pretty save too: modern secondary staff output changes
  // which paid boundary first crosses the portable snapshot size threshold.
  const initialCompact = JSON.stringify(envelopeFor(saveBranch.state));
  saveObservations.push({ week: saveBranch.week,
    installations: Object.values(saveBranch.state.slices.products.runtimeGuardrails!).filter(item => item.productId === productId).length,
    hash: canonicalStateHash(saveBranch.state), prettyBytes: Buffer.byteLength(initialPretty),
    compactBytes: Buffer.byteLength(initialCompact), savedBytes: Buffer.byteLength(final), compacted: false });
  for (let count = 3; count < 8; count++) {
    const current = currentRuntimeGuardrail(saveBranch.state, productId)!;
    const profile = current.profile === 'strict' ? 'balanced' : 'strict';
    const id = 'guardrail:' + saveBranch.queue({ kind: 'install_runtime_guardrail', productId, profile });
    saveBranch.until(state => activeRuntimeGuardrail(state, productId)?.id === id, 8, 'paid alternating-profile save limit check');
    const envelope = envelopeFor(saveBranch.state), pretty = JSON.stringify(envelope, null, 2), compact = JSON.stringify(envelope);
    const saved = serializeState(saveBranch.state), prettyBytes = Buffer.byteLength(pretty), compactBytes = Buffer.byteLength(compact);
    assert.equal(saved, prettyBytes <= MAX_SNAPSHOT_BYTES ? pretty : compact);
    assert.ok(Buffer.byteLength(saved) <= MAX_SNAPSHOT_BYTES);
    const restored = deserializeState(saved); assert.ok(restored.ok, restored.ok ? '' : restored.error);
    assert.deepEqual(restored.state, saveBranch.state); assert.equal(serializeState(restored.state), saved);
    saveObservations.push({ week: saveBranch.week, installations: count + 1, hash: envelope.checksum, prettyBytes,
      compactBytes, savedBytes: Buffer.byteLength(saved), compacted: saved === compact });
  }
  assert.equal(Object.values(saveBranch.state.slices.products.runtimeGuardrails!).filter(item => item.productId === productId).length, 8);
  assert.equal(saveBranch.commands.length, 5); assert.ok(saveObservations.some(item => !item.compacted));
  assert.ok(saveObservations.some(item => item.compacted));
  assert.ok(saveObservations.at(-1)!.prettyBytes > MAX_SNAPSHOT_BYTES);
  assert.ok(saveObservations.at(-1)!.compactBytes < MAX_SNAPSHOT_BYTES);
  assert.equal(serializeState(run.state), final, 'The separate capacity branch must not mutate the captured natural campaign.');

  const oversized = structuredClone(saveBranch.state);
  for (let index = 0; index < 700; index++) {
    const id = 'save-budget-rejection-' + index;
    oversized.commandReceipts[id] = { id, week: 0, status: 'rejected', reason: { code: 'NOT_READY', message: '界'.repeat(1000) } };
  }
  assert.deepEqual(validateState(oversized, CONTENT), []);
  const oversizedCompact = JSON.stringify(envelopeFor(oversized));
  assert.ok(Buffer.byteLength(oversizedCompact) > MAX_SNAPSHOT_BYTES);
  assert.throws(() => serializeState(oversized), SnapshotTooLargeError);
  assert.equal(deserializeState(oversizedCompact).ok, false, 'Compacting must not enlarge the accepted UTF-8 input boundary.');

  const primaryKey = 'frontier-lab.wave0.snapshot', priorRaw = readFileSync(join(__dirname, 'fixtures/wave11-snapshot.json'), 'utf8');
  const stored = new Map<string, string>([[primaryKey, priorRaw]]), writes: string[] = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); writes.push(key); },
  } } });
  try {
    const compactSave = serializeState(saveBranch.state);
    assert.deepEqual(writeBrowserSnapshot(saveBranch.state), { ok: true });
    assert.equal(stored.get(primaryKey), compactSave);
    assert.equal(readBrowserRecovery('wave11')!.text, priorRaw, 'Compacted current writes must retain the exact original archive.');
    assert.deepEqual(writes, ['frontier-lab.wave11.original', primaryKey]);
    const reopened = readBrowserSnapshot(); assert.equal(reopened.kind, 'loaded');
    if (reopened.kind !== 'loaded') throw new Error('Expected the compacted legal history to reopen.');
    assert.deepEqual(reopened.state, saveBranch.state); assert.equal(reopened.migratedFrom, undefined);
    const rejected = writeBrowserSnapshot(oversized); assert.equal(rejected.ok, false);
    if (rejected.ok) throw new Error('Expected a truly oversized save to fail.');
    assert.match(rejected.error, /2 MB save limit/); assert.equal(stored.get(primaryKey), compactSave);
    assert.deepEqual(writes, ['frontier-lab.wave11.original', primaryKey], 'Oversized attempts must preserve the last usable compacted save.');
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
  if (process.env.FRONTIER_WAVE12_OUTPUT) {
    writeFileSync(join(process.env.FRONTIER_WAVE12_OUTPUT, 'wave12-save-budget.json'), JSON.stringify({ sourceWeek: run.week,
      sourceHash: evidence.finalHash, sourceBytes: evidence.snapshotBytes, maximumSnapshotBytes: MAX_SNAPSHOT_BYTES,
      commands: saveBranch.commands, observations: saveObservations,
      assertions: ['Only ordinary paid alternating-profile rollouts extend the earned company to its eight-installation history cap',
        'Existing pretty saves retain identical bytes; legal larger histories compact without losing any evidence',
        'Every compact save reopens and reserializes byte-for-byte within the unchanged two-megabyte UTF-8 limit',
        'Browser writes archive the exact prior original before storing compact current history',
        'Truly oversized UTF-8 histories remain rejected and cannot replace the last usable save'] }, null, 2) + '\n');
  }
});
