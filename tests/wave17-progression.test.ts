import { historicalContent, loadHistoricalSnapshot, upgradeHistoricalState } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState, TrainingRun } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { TrainingCurriculumChoice } from '../src/contracts/wave17-curriculum';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { getTrainingPreview } from '../src/modules/lab-planner';
import { getComputeCostView } from '../src/modules/compute-costs';
import { inheritedModelRights } from '../src/modules/model-runtime';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

test('W17-N01: an earned company prepares separate data, compares three paid designs, preserves two skills, and evaluates its exact candidates', () => {
  const oracle = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave16-expected.json'), 'utf8')) as {
    sourceCommit: string; sourceContent: string; finalWeek: number; finalChecksum: string;
    commands: { week: number; id: string; payload: CommandPayload }[];
  };
  const imported = loadHistoricalSnapshot(readFileSync(join(__dirname, 'fixtures/wave16-snapshot.json'), 'utf8'));
  assert.ok(imported.ok);
  let earned: GameState = imported.state;
  while (earned.week < oracle.finalWeek) {
    for (const command of oracle.commands.filter(item => item.week === earned.week)) {
      const queued = submitCommand(earned, command.payload, historicalContent(earned), command.id);
      assert.ok(queued.accepted, queued.reason?.message); earned = queued.state;
    }
    const next = advanceWeek(earned, historicalContent(earned)); assert.ok(next.accepted, next.reason?.message); earned = next.state;
  }
  assert.equal(canonicalStateHash({ ...earned, contentVersion: oracle.sourceContent, buildVersion: oracle.sourceContent }), oracle.finalChecksum);
  earned = upgradeHistoricalState(earned);
  const run = new NaturalBusinessCampaign(earned, 'wave17-natural'), companyId = earned.playerCompanyId;
  const baseModelId = 'model-wave15-natural-command-9', originalBase = structuredClone(earned.slices.models.versions[baseModelId]);
  assert.ok(run.research.includes('R4C'));
  assert.equal(Object.values(earned.slices.models.trainingRuns).some(item => item.plan?.curriculum), false);
  const oldBatchIds = Object.keys(earned.slices.products.batchJobs!);
  const oldBatches = canonicalStateHash(oldBatchIds.map(id => earned.slices.products.batchJobs![id]));
  const deployed = run.offers().filter(offer => offer.status === 'active').map(offer => ({
    id: offer.id, deployment: structuredClone(earned.slices.products.deployments[offer.deploymentId]),
    model: structuredClone(earned.slices.models.versions[earned.slices.products.deployments[offer.deploymentId].modelId]),
  }));
  const costs: Record<string, { physicalCUw: number; ownedVariableCents: number; cloudAttributedCents: number }> = {};
  const weeks: object[] = [], dataFacts: object[] = [];
  const snapshots: Record<string, string> = { start: serializeState(run.state) };
  const step = () => {
    run.step();
    assert.deepEqual(run.state.slices.models.versions[baseModelId], originalBase);
    assert.equal(canonicalStateHash(oldBatchIds.map(id => run.state.slices.products.batchJobs![id])), oldBatches);
    for (const item of deployed) {
      assert.deepEqual(run.state.slices.products.deployments[item.deployment.id], item.deployment);
      assert.deepEqual(run.state.slices.models.versions[item.model.id], item.model);
      assert.equal(run.state.slices.products.lastUsage[item.id].fulfillmentBps, 10000, `Public service in Week ${run.week}`);
    }
    const report = getComputeCostView(run.state).latest!;
    assert.equal(report.totals.totalComputeCents + report.totals.otherOperatingCents, run.company.lastWeek.operatingExpenseCents);
    for (const work of report.workloads.filter(item => item.requestId.startsWith('training-wave17-natural-'))) {
      const id = work.requestId.replace(/:work$/, '');
      const total = costs[id] ??= { physicalCUw: 0, ownedVariableCents: 0, cloudAttributedCents: 0 };
      total.physicalCUw += work.physicalWorkCUw; total.ownedVariableCents += work.ownedVariableCents; total.cloudAttributedCents += work.cloudRentCents;
    }
    dataFacts.push(...report.ledgerFacts.filter(fact => /Conversation specialist|Curat/i.test(fact.label)));
    weeks.push({ week: run.week, cashCents: run.cash, totals: report.totals,
      projects: Object.values(run.state.slices.models.trainingRuns).filter(item => item.id.startsWith('training-wave17-natural-'))
        .map(item => ({ id: item.id, status: item.status, completedWork: item.completedWork, physicalWork: item.physicalWork })) });
  };
  const until = (predicate: () => boolean, limit: number, label: string) => {
    const start = run.week;
    while (!predicate() && run.week - start < limit) step();
    assert.ok(predicate(), `${label} did not finish within ${limit} ordinary weeks.`);
  };
  const evaluate = (modelId: string) => {
    const id = 'evaluation-' + run.queue({ kind: 'evaluate_model', modelId, suiteId: 'expanded-capabilities-1' });
    until(() => run.state.slices.models.evaluationRuns[id]?.status === 'complete', 10, 'Paid expanded evaluation');
    const job = run.state.slices.models.evaluationRuns[id], report = run.state.slices.models.reports[job.reportId!];
    assert.equal(job.completedWork, 4 * U); assert.equal(job.completedStaff, U);
    assert.deepEqual(report.capabilityBps, run.state.slices.models.versions[modelId].capabilityBps);
    return { job: structuredClone(job), report: structuredClone(report) };
  };

  // The existing company funds a new, distinct primary corpus. No data, staff,
  // research, hardware, scores, or cash are granted directly by this test.
  run.queue({ kind: 'allocate_compute', serving: 128 * U, development: 16 * U, research: 0 });
  run.queue({ kind: 'buy_data', catalogId: 'specialist-conversation-1' }); step();
  const primaryRaw = run.packet('specialist-conversation-1')!;
  run.queue({ kind: 'prepare_data', packetId: primaryRaw.id });
  until(() => run.state.slices.data.packets[primaryRaw.id].prepared, 10, 'Primary source preparation');
  run.queue({ kind: 'curate_data', packetId: primaryRaw.id });
  until(() => run.bestPacket('specialist-conversation-1')?.qualityBps === 9500, 10, 'Primary source curation');
  const primary = run.bestPacket('specialist-conversation-1'), documents = run.bestPacket('specialist-documents-1'), coding = run.bestPacket('specialist-coding-1');
  const choices = { baseModelId, packetId: primary.id, recipeId: 'compact-conversation-adaptation', profile: 'stable' as const };
  const curriculum = (shareBps: 5000 | 7500): TrainingCurriculumChoice => ({ shareBps, tracks: [
    { domain: 'documents', packetIds: [documents.id] }, { domain: 'coding', packetIds: [coding.id] },
  ] });
  const designs = { ordinary: choices, split: { ...choices, curriculum: curriculum(5000) }, deep: { ...choices, curriculum: curriculum(7500) } };
  const before = serializeState(run.state);
  const previews = Object.fromEntries(Object.entries(designs).map(([key, options]) => {
    const admission = previewCommand(run.state, { kind: 'start_training', ...options });
    assert.ok(admission.accepted, `${key}: ${admission.reason?.message}`);
    return [key, getTrainingPreview(run.state, companyId, options)];
  })) as Record<keyof typeof designs, ReturnType<typeof getTrainingPreview>>;
  assert.equal(serializeState(run.state), before, 'Comparing designs does not spend, train, or change randomness.');
  assert.equal(previews.ordinary.workCUw, 9.9 * U);
  assert.equal(previews.split.workCUw, 19.8 * U); assert.equal(previews.deep.workCUw, 39.6 * U);
  for (const key of ['split', 'deep'] as const) {
    assert.equal(previews[key].capabilityRange.minimum.conversation, previews.ordinary.capabilityRange.minimum.conversation);
    assert.equal(previews[key].capabilityRange.maximum.conversation, previews.ordinary.capabilityRange.maximum.conversation);
    assert.deepEqual(previews[key].reliabilityRange, previews.ordinary.reliabilityRange);
    assert.equal(previews[key].memoryMU, previews.ordinary.memoryMU);
  }
  const singleSkill = getTrainingPreview(run.state, companyId, { ...choices, replay: { domain: 'coding', shareBps: 5000, packetIds: [coding.id] } });
  assert.equal(singleSkill.workCUw, previews.split.workCUw);
  assert.ok(singleSkill.replay!.preservationFloorBps > previews.deep.curriculum!.tracks.find(track => track.domain === 'coding')!.preservationFloorBps);
  snapshots['comparison-ready'] = before;

  const trainings: Record<string, TrainingRun> = {}, evaluations: Record<string, ReturnType<typeof evaluate>> = {};
  for (const key of ['ordinary', 'split', 'deep'] as const) {
    const id = 'training-' + run.queue({ kind: 'start_training', ...designs[key] });
    step();
    if (key === 'deep') {
      const first = run.state.slices.models.trainingRuns[id]; assert.ok(first.completedWork > 0 && first.completedWork < first.requiredWork);
      run.queue({ kind: 'set_job_paused', jobId: id, paused: true }); step();
      const paused = structuredClone(run.state.slices.models.trainingRuns[id]);
      assert.equal(paused.status, 'paused'); snapshots['paused-curriculum'] = serializeState(run.state);
      const restored = deserializeState(snapshots['paused-curriculum']); assert.ok(restored.ok, restored.ok ? '' : restored.error);
      assert.equal(serializeState(restored.state), snapshots['paused-curriculum']); run.state = restored.state;
      step(); assert.deepEqual(run.state.slices.models.trainingRuns[id], paused);
      run.queue({ kind: 'set_job_paused', jobId: id, paused: false });
    }
    until(() => run.state.slices.models.trainingRuns[id].status === 'complete', 20, `${key} training`);
    const training = run.state.slices.models.trainingRuns[id], model = run.state.slices.models.versions[training.outputModelId];
    assert.equal(training.completedWork, previews[key].workCUw);
    assert.equal(costs[id].physicalCUw, training.physicalWork);
    assert.equal(Object.values(run.state.slices.models.reports).some(report => report.modelId === model.id), false, 'Training does not grant evaluation evidence.');
    trainings[key] = structuredClone(training); evaluations[key] = evaluate(model.id);
    snapshots[`${key}-evaluated`] = serializeState(run.state);
  }
  const candidates = Object.fromEntries(Object.entries(trainings).map(([key, training]) => [key, run.state.slices.models.versions[training.outputModelId]]));
  for (const key of ['split', 'deep'] as const) {
    assert.deepEqual(trainings[key].plan!.savedAdjustments, trainings.ordinary.plan!.savedAdjustments);
    assert.equal(trainings[key].plan!.curriculum!.ordinaryIdentity, trainings.ordinary.plan!.identity);
    assert.equal(candidates[key].capabilityBps.conversation, candidates.ordinary.capabilityBps.conversation);
    assert.equal(candidates[key].reliabilityBps, candidates.ordinary.reliabilityBps);
    assert.deepEqual(candidates[key].policy, originalBase.policy);
    for (const track of trainings[key].plan!.curriculum!.tracks) {
      assert.equal(candidates[key].capabilityBps[track.domain], Math.max(candidates.ordinary.capabilityBps[track.domain], track.preservationFloorBps));
      assert.ok(candidates[key].capabilityBps[track.domain] <= originalBase.capabilityBps[track.domain]);
    }
  }
  for (const domain of ['documents', 'coding'] as const) {
    assert.ok(candidates.deep.capabilityBps[domain] > candidates.split.capabilityBps[domain], `${domain}: the larger replay budget raises the preservation floor`);
    assert.ok(candidates.split.capabilityBps[domain] >= candidates.ordinary.capabilityBps[domain], `${domain}: replay never lowers the ordinary outcome`);
  }
  assert.ok((['documents', 'coding'] as const).some(domain => candidates.split.capabilityBps[domain] > candidates.ordinary.capabilityBps[domain]), 'The smaller replay budget preserves an otherwise forgotten skill.');
  assert.ok(costs[trainings.deep.id].ownedVariableCents > costs[trainings.split.id].ownedVariableCents);
  assert.ok(costs[trainings.split.id].ownedVariableCents > costs[trainings.ordinary.id].ownedVariableCents);
  assert.deepEqual(inheritedModelRights(run.state, candidates.deep.id, CONTENT), inheritedModelRights(run.state, baseModelId, CONTENT));
  const reversed = curriculum(7500); reversed.tracks.reverse();
  assert.equal(previewCommand(run.state, { kind: 'start_training', ...choices, curriculum: reversed }).reason?.code, 'NO_IMPROVEMENT');
  assert.deepEqual(validateState(run.state), []);
  const final = serializeState(run.state), reloaded = deserializeState(final); assert.ok(reloaded.ok, reloaded.ok ? '' : reloaded.error);
  assert.equal(serializeState(reloaded.state), final); snapshots.complete = final;
  const evidence = { sourceCommit: oracle.sourceCommit, sourceWeek: earned.week, sourceChecksum: oracle.finalChecksum,
    finalWeek: run.week, finalChecksum: canonicalStateHash(run.state), snapshotBytes: Buffer.byteLength(final),
    cashCents: run.cash, minimumCashCents: run.minimumCashCents, base: originalBase, primary, documents, coding,
    previews, singleSkillComparison: singleSkill, trainings, candidates, evaluations, costs, dataFacts, weeks, commands: run.commands,
    assertions: ['All continuation actions are ordinary commands from the independently verified Wave16 company.',
      'Separate primary data is purchased, prepared, and curated through paid work.', 'Comparison preserves full serialized state and randomness.',
      'Nominal budgets of 9.9, 19.8, and 39.6 CUw execute on shared GPUs under real ML supervision.',
      'Both retained skills are bounded by the original evaluated model and independent source quality.',
      'Focus draws, focus outcome, reliability, policy, and live deployments stay consistent across the designs.',
      'Fresh Expanded capabilities reports consume their own four CUw and one research staff-week each.',
      'Pause/reload preserves paid progress exactly; reversed track order cannot create a repeat attempt.',
      'Public products remain fully served, original batch receipts remain unchanged, and the company stays funded.'],
    costBoundary: 'Recorded training usage excludes existing cloud rent, payroll, data purchase/curation, and later evaluation. Cloud-work attribution is already within reservation rent. All such expenses remain in the actual company ledger.' };
  if (process.env.FRONTIER_WAVE17_OUTPUT) {
    mkdirSync(process.env.FRONTIER_WAVE17_OUTPUT, { recursive: true });
    for (const [name, text] of Object.entries(snapshots)) writeFileSync(join(process.env.FRONTIER_WAVE17_OUTPUT, `frontier-lab-wave17-${name}.json`), text);
    writeFileSync(join(process.env.FRONTIER_WAVE17_OUTPUT, 'wave17-progression.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(JSON.stringify({ finalWeek: run.week, finalChecksum: evidence.finalChecksum, commands: run.commands.length,
    candidates: Object.fromEntries(Object.entries(candidates).map(([key, model]) => [key, model.capabilityBps])), costs, snapshotBytes: evidence.snapshotBytes }));
});
