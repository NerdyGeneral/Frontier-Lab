import { historicalContent, loadHistoricalSnapshot, upgradeHistoricalState } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, submitCommand } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateState } from '../src/core/validation';
import { getComputeCostView } from '../src/modules/compute-costs';
import { inheritedModelRights } from '../src/modules/model-runtime';
import { getQualifiedReleaseRehearsal, releaseModelFingerprint } from '../src/modules/release-rehearsals';
import { policyHoldoutReport, policyReleaseRejection } from '../src/modules/policy-holdouts';
import { requestMeter } from '../src/modules/product-models';
import { getReviewableFeedbackStudy } from '../src/modules/feedback';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

test('W11-N01: earned company buys policy pairs, compares paid refusal strategies, tests and releases an exact candidate', () => {
  const raw = readFileSync(join(__dirname, 'fixtures/wave10-snapshot.json'), 'utf8'), imported = loadHistoricalSnapshot(raw);
  assert.ok(imported.ok);
  const previous = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave10-expected.json'), 'utf8')) as {
    sourceCommit: string; sourceContent: string; commands: { week: number; id: string; payload: CommandPayload }[];
  };
  let earned = imported.state;
  while (earned.week < 408) {
    for (const command of previous.commands.filter(item => item.week === earned.week)) {
      const result = submitCommand(earned, command.payload, historicalContent(earned), command.id);
      assert.ok(result.accepted, result.reason?.message); earned = result.state;
    }
    const next = advanceWeek(earned, historicalContent(earned)); assert.ok(next.accepted, next.reason?.message); earned = next.state;
  }
  assert.equal(canonicalStateHash({ ...earned, contentVersion: '0.11.0', buildVersion: '0.11.0' }), '282813c5');
  earned = upgradeHistoricalState(earned);
  const run = new NaturalBusinessCampaign(earned, 'wave11-natural'), owner = run.state.playerCompanyId;
  const product = run.offers().find(item => item.kind === 'developer-api')!, productId = product.id;
  const sourceModelId = run.state.slices.products.deployments[product.deploymentId].modelId;
  const source = structuredClone(run.state.slices.models.versions[sourceModelId]);
  const originalFingerprint = releaseModelFingerprint(source);
  const fixedContract = { ...run.state.slices.products.contracts[product.contractId], tokenBillRemainder: 0 };
  const snapshots: Record<string, string> = { 'before-policy': serializeState(run.state) };
  const service: { week: number; modelId: string; paidAccounts: number; fulfillmentBps: number; falseRefusalBps: number; billedCents: number; carryIn: number; carryOut: number }[] = [];
  const costs: ReturnType<typeof getComputeCostView>['reports'] = [];
  const step = () => {
    const priorCarry = run.state.slices.products.contracts[product.contractId].tokenBillRemainder ?? 0;
    run.step();
    const current = run.state.slices.products.offers[productId], usage = run.state.slices.products.lastUsage[productId];
    assert.equal(current.status, 'active'); assert.equal(current.contractId, product.contractId);
    assert.equal(usage.fulfillmentBps, 10000, 'Policy projects share funded development resources while the API keeps serving.');
    assert.equal(usage.tokens!.billCarryIn, priorCarry);
    assert.deepEqual({ ...run.state.slices.products.contracts[product.contractId], tokenBillRemainder: 0 }, fixedContract);
    const invoices = run.state.slices.products.invoices.filter(item => item.productId === productId && item.week === run.week);
    assert.equal(invoices.length, 1); assert.equal(invoices[0].amountCents, usage.billedCents);
    const cost = getComputeCostView(run.state).latest!;
    assert.equal(cost.totals.totalComputeCents + cost.totals.otherOperatingCents, run.company.lastWeek.operatingExpenseCents);
    assert.equal(cost.totals.attributedComputeCents + cost.totals.sharedComputeCents, cost.totals.totalComputeCents);
    costs.push(cost);
    service.push({ week: run.week, modelId: current.publicModelId!, paidAccounts: usage.paidAccounts,
      fulfillmentBps: usage.fulfillmentBps, falseRefusalBps: usage.behavior!.falseRefusalBps,
      billedCents: usage.billedCents, carryIn: usage.tokens!.billCarryIn!, carryOut: usage.tokens!.billCarryOut! });
  };
  const until = (condition: () => boolean, limit: number, label: string) => {
    const start = run.week; while (!condition() && run.week - start < limit) step();
    assert.ok(condition(), label + ' did not finish through ordinary weekly work.');
  };
  const report = (modelId: string, suiteId: string) => Object.values(run.state.slices.models.reports).find(item => item.modelId === modelId && item.suiteId === suiteId);
  run.mark('Published Wave 10 company; calibrated API still serves with its original price and billing carry');

  run.queue({ kind: 'buy_data', catalogId: 'policy-boundary-pairs-1' }); step();
  const packetId = run.packet('policy-boundary-pairs-1')!.id;
  run.queue({ kind: 'prepare_data', packetId });
  until(() => run.state.slices.data.packets[packetId].prepared, 8, 'licensed pair preparation');
  const packet = run.state.slices.data.packets[packetId];
  assert.equal(packet.policy!.pairs, 100); assert.equal(packet.readyUnits, 200); assert.equal(packet.qualityBps, 9000);
  assert.equal(packet.behaviorUnits, 0); assert.equal(packet.broadUnits, 0);
  assert.deepEqual(packet.coverageBps, { conversation: 0, documents: 0, coding: 0, tools: 0 });
  assert.deepEqual(packet.rights, { hosted: true, weights: true, feedback: false });
  const preparation = Object.values(run.state.slices.data.preparationJobs).find(item => item.packetId === packetId)!;
  assert.equal(preparation.completedStaff, 3 * U);
  snapshots['after-data'] = serializeState(run.state);
  run.mark('Licensed 100 matched pairs prepared with three actual data staff-weeks');

  const boundaryCommand = run.queue({ kind: 'start_training', baseModelId: sourceModelId, packetId, recipeId: 'policy-boundary-discrimination' });
  const conservativeCommand = run.queue({ kind: 'start_training', baseModelId: sourceModelId, packetId, recipeId: 'policy-conservative-refusal' });
  const boundaryId = 'model-' + boundaryCommand, conservativeId = 'model-' + conservativeCommand;
  run.queue({ kind: 'evaluate_model', modelId: sourceModelId, suiteId: 'policy-boundaries-1' });
  until(() => run.state.slices.models.trainingRuns['training-' + boundaryCommand]?.status === 'complete'
    && run.state.slices.models.trainingRuns['training-' + conservativeCommand]?.status === 'complete'
    && !!policyHoldoutReport(run.state, sourceModelId), 18, 'both fixed policy recipes and baseline diagnostic');
  const boundary = run.state.slices.models.versions[boundaryId], conservative = run.state.slices.models.versions[conservativeId];
  assert.equal(boundary.policy!.currentUnsafeComplianceBps, 660); assert.equal(boundary.behavior!.falseRefusalBps, 385);
  assert.equal(conservative.policy!.currentUnsafeComplianceBps, 390); assert.equal(conservative.behavior!.falseRefusalBps, 1150);
  for (const candidate of [boundary, conservative]) {
    assert.deepEqual(candidate.capabilityBps, source.capabilityBps); assert.equal(candidate.reliabilityBps, source.reliabilityBps);
    assert.equal(candidate.behavior!.confidentErrorBps, source.behavior!.confidentErrorBps); assert.deepEqual(candidate.planner, source.planner);
    assert.deepEqual(requestMeter(candidate, product.features!), requestMeter(source, product.features!));
    assert.deepEqual(inheritedModelRights(run.state, candidate.id, CONTENT), { hosted: true, weights: false }, 'Licensed policy data does not erase hosted-only ancestry.');
    assert.ok(policyReleaseRejection(run.state, candidate.id));
    assert.equal(submitCommand(run.state, { kind: 'upgrade_product', productId, modelId: candidate.id }, CONTENT, 'blocked-policy-' + candidate.id).accepted, false);
  }
  assert.equal(releaseModelFingerprint(run.state.slices.models.versions[sourceModelId]), originalFingerprint);
  assert.equal(run.state.slices.products.offers[productId].publicModelId, sourceModelId);
  run.queue({ kind: 'evaluate_model', modelId: boundaryId, suiteId: 'expanded-capabilities-1' });
  run.queue({ kind: 'evaluate_model', modelId: conservativeId, suiteId: 'expanded-capabilities-1' });
  until(() => !!report(boundaryId, 'expanded-capabilities-1') && !!report(conservativeId, 'expanded-capabilities-1'), 6, 'exact capability evidence');
  snapshots['before-holdouts'] = serializeState(run.state);
  run.queue({ kind: 'evaluate_model', modelId: boundaryId, suiteId: 'policy-boundaries-1' });
  run.queue({ kind: 'evaluate_model', modelId: conservativeId, suiteId: 'policy-boundaries-1' });
  until(() => !!policyHoldoutReport(run.state, boundaryId) && !!policyHoldoutReport(run.state, conservativeId), 6, 'separate paid policy holdouts');
  const baselineReport = policyHoldoutReport(run.state, sourceModelId)!, boundaryReport = policyHoldoutReport(run.state, boundaryId)!, conservativeReport = policyHoldoutReport(run.state, conservativeId)!;
  for (const result of [baselineReport, boundaryReport, conservativeReport]) {
    assert.equal(result.policy!.totals.allowedCases, 50); assert.equal(result.policy!.totals.restrictedCases, 50);
    assert.equal(result.basicChatEligible, false); assert.equal(result.policy!.evidenceKey, baselineReport.policy!.evidenceKey);
  }
  assert.ok(boundaryReport.policy!.totals.falseRefusals <= baselineReport.policy!.totals.falseRefusals);
  assert.ok(conservativeReport.policy!.totals.unsafeCompliances <= boundaryReport.policy!.totals.unsafeCompliances);
  assert.ok(conservativeReport.policy!.totals.falseRefusals >= boundaryReport.policy!.totals.falseRefusals);
  assert.equal(policyReleaseRejection(run.state, boundaryId), undefined);
  const selectedId = boundaryId;
  snapshots['after-holdouts'] = serializeState(run.state);
  run.mark('Two paid policy holdouts expose the allowed-help versus restricted-compliance tradeoff');

  const rehearsalId = 'release-rehearsal:' + run.queue({ kind: 'start_release_rehearsal', productId, candidateModelId: selectedId });
  until(() => !!getQualifiedReleaseRehearsal(run.state, productId, selectedId), 8, 'paid comparison of useful service');
  const releaseId = 'prepared-release:' + run.queue({ kind: 'start_prepared_release', productId, candidateModelId: selectedId });
  until(() => run.state.slices.products.preparedReleases?.[releaseId]?.status === 'ready'
    && run.state.slices.products.preparedReleases[releaseId].availableWeek! <= run.week, 6, 'prepared release');
  snapshots['before-promotion'] = serializeState(run.state);
  run.queue({ kind: 'promote_prepared_release', releaseId }); step();
  assert.equal(run.state.slices.products.offers[productId].publicModelId, sourceModelId);
  step();
  assert.equal(run.state.slices.products.offers[productId].publicModelId, selectedId);
  assert.equal(run.state.slices.products.lastUsage[productId].behavior!.falseRefusalBps, 385);
  run.mark('Explicit handover delivers the learned refusal behavior with unchanged per-exchange GPU work');

  const studyId = 'feedback-study:' + run.queue({ kind: 'start_feedback_study', productId, sampling: 'representative', consent: 'hosted-only' });
  until(() => !!getReviewableFeedbackStudy(run.state, owner, studyId), 6, 'new model customer feedback');
  const study = run.state.slices.data.feedbackStudies![studyId];
  assert.equal(study.sourceModelId, selectedId); assert.equal(study.totalCases, 100);
  assert.equal(study.sourceModelFingerprint, releaseModelFingerprint(run.state.slices.models.versions[selectedId]));
  assert.equal(releaseModelFingerprint(run.state.slices.models.versions[sourceModelId]), originalFingerprint);
  const originalStudy = Object.values(earned.slices.data.feedbackStudies!)[0];
  const originalInvoice = originalStudy.weeks[0].paidUsage.invoiceId!;
  assert.equal(run.state.slices.products.invoices.some(item => item.id === originalInvoice), false);
  assert.equal(run.state.slices.company.postedFacts[originalInvoice], true, 'Bounded feedback evidence retains its settled payment proof after ordinary invoice history expires.');
  assert.equal(canonicalStateHash(run.state.slices.data.feedbackStudies![originalStudy.id]), canonicalStateHash(originalStudy));
  run.mark('Four weeks of consenting paid customers preserve the new policy model identity in feedback');

  assert.deepEqual(validateState(run.state, CONTENT), []);
  const snapshot = serializeState(run.state), loaded = deserializeState(snapshot); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  assert.equal(serializeState(loaded.state), snapshot); assert.ok(Buffer.byteLength(snapshot) < 2_000_000);
  snapshots.complete = snapshot;
  const training = [boundaryCommand, conservativeCommand].map(id => run.state.slices.models.trainingRuns['training-' + id]);
  assert.deepEqual(training.map(item => item.completedWork), [24 * U, 16 * U]);
  assert.ok(training.every(item => item.physicalWork > 0));
  const evidence = { sourceCommit: previous.sourceCommit, sourceWeek: 408, sourceChecksum: '282813c5', finalWeek: run.week,
    finalHash: canonicalStateHash(run.state), snapshotBytes: Buffer.byteLength(snapshot), cashCents: run.cash, minimumCashCents: run.minimumCashCents,
    productId, sourceModelId, selectedId, boundaryId, conservativeId, packetId, rehearsalId, releaseId, studyId,
    commands: run.commands, milestones: run.milestones, packet, preparation, training, baselineReport, boundaryReport, conservativeReport,
    rehearsal: run.state.slices.products.releaseRehearsals![rehearsalId], release: run.state.slices.products.preparedReleases![releaseId], study, service, costs,
    assertions: ['Exact published Wave 10 company replayed with ordinary commands and no injected resources',
      'Licensed pairs are purchased, prepared and deduplicated separately from generic feedback and behavior data',
      'Both strategies consume actual paid training work and preserve capabilities, reliability, confidence, permissions and request cost',
      'All three candidate versions face one reserved 50 allowed / 50 restricted policy cohort after their own paid capability evidence',
      'Commercial admission rejects both policy-trained models before their exact policy reports',
      'A paid rehearsal, prepared release and explicit handover precede the new production behavior',
      'Hosted-only ancestry survives licensed policy evidence; the API retains one invoice and continuous token billing carry',
      'Policy and ordinary feedback evidence stay separate after four real paid service weeks',
      'Snapshot round-trips byte-for-byte below two megabytes; weekly operating and compute bills reconcile'] };
  if (process.env.FRONTIER_WAVE11_OUTPUT) {
    const dir = process.env.FRONTIER_WAVE11_OUTPUT; mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(snapshots)) writeFileSync(join(dir, 'frontier-lab-wave11-' + name + '.json'), text + '\n');
    writeFileSync(join(dir, 'wave11-progression.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
});
