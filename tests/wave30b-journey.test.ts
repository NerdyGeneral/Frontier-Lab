import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { createInitialState, submitCommand } from '../src/core/engine';
import { serializeState } from '../src/core/snapshot';
import { freezeDeep } from '../src/core/canonical';
import { getStudioView } from '../src/core/studio';
import { getStudioJourney } from '../src/core/studio-journey';
import type { StudioJourneyFocus } from '../src/core/studio-journey';
import { fixtureState, founder, queue, step } from './fixtures/wave25-studio';

const journey = (game: GameState, focus: StudioJourneyFocus = {}) => getStudioJourney(game, focus, getStudioView(game).projects);
function accepted(game: GameState, payload: CommandPayload, id: string) {
  const result = submitCommand(game, payload, CONTENT, id);
  assert.equal(result.accepted, true, result.reason?.message);
  assert.equal(result.commandId, id);
  return { game: result.state, focus: { command: { id, payload, effectiveWeek: game.week + 1 } } satisfies StudioJourneyFocus };
}
function multipleCandidates() {
  const game = fixtureState('wave16-snapshot.json');
  game.slices.products.offers = {};
  const runs = Object.values(game.slices.models.trainingRuns)
    .filter(item => item.companyId === game.playerCompanyId && item.status === 'complete')
    .sort((a, b) => a.startedWeek - b.startedWeek);
  assert.ok(runs.length > 1);
  return { game, runs };
}

test('W30B-J01: preparation moves from a real queue through recorded work to the same ready dataset', () => {
  const initial = createInitialState();
  assert.deepEqual(journey(initial).primary.action, { kind: 'prepare', packetId: CONTENT.starterData.id });
  const start = accepted(initial, { kind: 'prepare_data', packetId: CONTENT.starterData.id }, 'journey-data');
  const pending = journey(start.game, start.focus);
  assert.equal(pending.status, 'queued');
  assert.match(pending.title, /Week 1/);
  assert.equal(pending.projectId, undefined, 'acceptance is not an active preparation project');
  const working = step(start.game);
  const active = journey(working, start.focus);
  assert.equal(active.status, 'working');
  assert.equal(active.projectId, 'preparation-journey-data');
  assert.equal(active.packetId, CONTENT.starterData.id);
  assert.equal(active.progressBps, 5000);
  const prepared = journey(step(working), start.focus);
  assert.equal(prepared.stage, 'train');
  assert.equal(prepared.status, 'ready');
  assert.deepEqual(prepared.primary.action, { kind: 'train', packetId: CONTENT.starterData.id });
});

test('W30B-J02: ordinary paid commands carry training output, its report, deployment activation and first sale separately', () => {
  let game = queue(createInitialState(CONTENT, 'release'), { kind: 'prepare_data', packetId: CONTENT.starterData.id });
  game = queue(game, { kind: 'hire_staff', role: 'ml' });
  game = step(queue(game, { kind: 'allocate_compute', serving: 0, development: 4 * U, research: 0 }), 2);
  const training = accepted(game, { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id }, 'journey-training');
  const queuedTraining = journey(training.game, training.focus);
  assert.equal(queuedTraining.status, 'queued');
  assert.ok(queuedTraining.detail.includes(CONTENT.seedModel.name));
  assert.ok(queuedTraining.detail.includes(CONTENT.starterData.name));
  assert.match(queuedTraining.detail, /Conversation adaptation/);
  game = step(queue(training.game, { kind: 'assign_founder', allocations: founder('research') }), 3);
  const modelId = game.slices.models.trainingRuns['training-journey-training'].outputModelId;
  const trained = journey(game, training.focus);
  assert.deepEqual(trained.primary.action, { kind: 'evaluate', modelId });
  assert.equal(trained.candidateId, modelId);
  assert.match(trained.detail, /Reliability 70 → 86 compared with Seed 0/);
  const evaluation = accepted(game, { kind: 'evaluate_model', modelId }, 'journey-evaluation');
  assert.equal(journey(evaluation.game, evaluation.focus).status, 'queued');
  game = step(evaluation.game);
  const reportId = game.slices.models.evaluationRuns['evaluation-journey-evaluation'].reportId!;
  const evaluated = journey(game, evaluation.focus);
  assert.equal(evaluated.stage, 'launch');
  assert.deepEqual(evaluated.primary.action, { kind: 'launch', modelId, reportId });
  const deployment = accepted(game, { kind: 'deploy_product', modelId, priceCents: 1200, allowance: 100 }, 'journey-deployment');
  assert.equal(journey(deployment.game, deployment.focus).status, 'queued');
  assert.match(evaluated.detail, /Serving is set to 0 CU/);
  const readyWithoutServing = step(deployment.game);
  assert.equal(journey(readyWithoutServing, deployment.focus).primary.action.kind, 'resources');
  const openWithoutServing = step(readyWithoutServing);
  const noTrials = journey(openWithoutServing, deployment.focus);
  assert.equal(noTrials.status, 'blocked');
  assert.equal(noTrials.primary.label, 'Set serving compute');
  assert.equal(openWithoutServing.slices.markets.lastTrialCount, 0);
  const productId = openWithoutServing.slices.products.deployments['deployment:journey-deployment'].productId;
  const paused = step(queue(openWithoutServing, { kind: 'set_product_paused', productId, paused: true }));
  assert.equal(journey(paused, deployment.focus).primary.action.kind, 'product');
  assert.match(journey(paused, deployment.focus).detail, /Resume Basic Chat/);
  const restore = { kind: 'allocate_compute' as const, serving: U, development: 3 * U, research: 0 };
  for (const change of [restore, { kind: 'apply_studio_plan' as const, commands: [restore] }]) {
    const queuedCapacity = queue(openWithoutServing, change);
    const pending = journey(queuedCapacity, deployment.focus);
    assert.equal(pending.status, 'waiting');
    assert.match(pending.detail, /1 serving CU is queued for Week 9/);
    assert.equal(pending.primary.action.kind, 'product');
    assert.ok(step(queuedCapacity).slices.markets.lastTrialCount > 0);
  }
  game = step(queue(deployment.game, { kind: 'allocate_compute', serving: 4 * U, development: 0, research: 0 }));
  const ready = journey(game, deployment.focus);
  assert.equal(ready.stage, 'launch');
  assert.equal(ready.status, 'waiting');
  assert.match(ready.detail, /opens in Week 8/);
  game = step(game);
  const live = journey(game, deployment.focus);
  assert.equal(live.stage, 'deployed');
  assert.equal(live.status, 'complete');
  assert.equal(game.slices.company.companies[game.playerCompanyId].earnedRevenueCents, 0);
  assert.match(live.detail, /Customers who subscribe can start paying in a later week/);
  game = step(game, 2);
  assert.equal(journey(game, deployment.focus).stage, 'sale');
  assert.ok(game.slices.company.companies[game.playerCompanyId].earnedRevenueCents > 0);
});

test('W30B-J03: cold multiple outputs ask for a named choice and an older run always follows its own candidate', () => {
  const { game, runs } = multipleCandidates();
  const cold = journey(game);
  assert.equal(cold.status, 'choose');
  assert.ok(cold.candidates!.some(item => item.id === runs[0].outputModelId));
  assert.ok(cold.candidates!.some(item => item.id === runs.at(-1)!.outputModelId));
  const older = journey(game, { trainingRunId: runs[0].id });
  assert.equal(older.candidateId, runs[0].outputModelId);
  assert.notEqual(older.candidateId, runs.at(-1)!.outputModelId);
  if (older.primary.action.kind === 'launch' || older.primary.action.kind === 'evaluate') assert.equal(older.primary.action.modelId, runs[0].outputModelId);
  if (older.reportId) assert.equal(game.slices.models.reports[older.reportId].modelId, runs[0].outputModelId);
});

test('W30B-J04: an explicit qualifying report keeps its exact candidate even when a newer candidate exists', () => {
  const { game, runs } = multipleCandidates();
  const report = Object.values(game.slices.models.reports).find(item => item.companyId === game.playerCompanyId && item.modelId === runs[0].outputModelId && item.basicChatEligible)!;
  assert.ok(report);
  const selected = journey(game, { reportId: report.id });
  assert.equal(selected.candidateId, report.modelId);
  assert.equal(selected.reportId, report.id);
  assert.deepEqual(selected.primary.action, { kind: 'launch', modelId: report.modelId, reportId: report.id });
});

test('a failed evaluation opens training on the exact model that missed the release threshold', () => {
  const { game, runs } = multipleCandidates();
  const report = Object.values(game.slices.models.reports).find(item => item.modelId === runs[0].outputModelId && item.basicChatEligible)!;
  report.basicChatEligible = false;
  report.capabilityBps = { ...report.capabilityBps, conversation: 3000 };
  const blocked = journey(game, { reportId: report.id });
  assert.deepEqual(blocked.primary.action, { kind: 'continue-training', baseModelId: report.modelId });
  assert.deepEqual(blocked.secondary?.action, { kind: 'report', reportId: report.id });
});

test('W30B-J05: unrelated evaluation suites cannot qualify the Basic Chat route even when another report passes', () => {
  const { game, runs } = multipleCandidates();
  const capability = Object.values(game.slices.models.reports).find(item => item.companyId === game.playerCompanyId && item.modelId === runs[0].outputModelId && item.basicChatEligible)!;
  const diagnostic = { ...structuredClone(capability), id: 'journey-diagnostic', suiteId: 'behavior-cases-1' as const, basicChatEligible: true };
  game.slices.models.reports[diagnostic.id] = diagnostic;
  const selected = journey(game, { candidateId: diagnostic.modelId, reportId: diagnostic.id });
  assert.equal(selected.stage, 'evaluate');
  assert.equal(selected.reportId, diagnostic.id);
  assert.deepEqual(selected.primary.action, { kind: 'evaluate', modelId: diagnostic.modelId });
  assert.match(selected.detail, /does not qualify/);
});

test('W30B-J06: absent or foreign explicit targets never fall back to available outputs, reports or datasets', () => {
  const { game: base, runs } = multipleCandidates();
  const candidateId = runs[0].outputModelId;
  const report = Object.values(base.slices.models.reports).find(item => item.companyId === base.playerCompanyId && item.modelId === candidateId)!;
  for (const disposition of ['missing', 'foreign'] as const) {
    const game = structuredClone(base);
    if (disposition === 'missing') delete game.slices.models.versions[candidateId];
    else game.slices.models.versions[candidateId].companyId = 'another-company';
    for (const focus of [{ candidateId }, { trainingRunId: runs[0].id }, { reportId: report.id }]) {
      assert.equal(journey(game, focus).status, 'unavailable');
    }
  }
  for (const focus of [{ trainingRunId: 'gone' }, { reportId: 'gone' }, { candidateId: 'gone' }, { packetId: 'gone' }]) assert.equal(journey(base, focus).status, 'unavailable');
  assert.equal(journey(base, { candidateId: runs.at(-1)!.outputModelId, reportId: report.id }).status, 'unavailable');
  const dataOnly = createInitialState();
  const missingData = journey(dataOnly, { packetId: 'missing-data' });
  assert.equal(missingData.status, 'unavailable');
  assert.equal(missingData.packetId, 'missing-data');
});

test('W30B-J07: weekly rejection and missing settled records remain honest despite other available progression', () => {
  const { game } = multipleCandidates();
  const payload: CommandPayload = { kind: 'prepare_data', packetId: CONTENT.starterData.id };
  const focus: StudioJourneyFocus = { command: { id: 'journey-rejected', payload, effectiveWeek: 1 } };
  game.commandReceipts['journey-rejected'] = { id: 'journey-rejected', week: game.week, status: 'rejected', reason: { code: 'NOT_READY', message: 'The selected dataset is no longer available.' } };
  const rejected = journey(game, focus);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.detail, 'The selected dataset is no longer available.');
  assert.deepEqual(rejected.primary.action, { kind: 'prepare', packetId: CONTENT.starterData.id });
  game.commandReceipts['journey-rejected'].status = 'accepted';
  const missing = journey(game, focus);
  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.projectId, undefined);
  assert.match(missing.detail, /this project could not be found/);
  const foreign = createInitialState();
  foreign.queuedCommands.push({ id: 'foreign-decision', companyId: 'another-company', issuedForWeek: 1, payload });
  assert.equal(journey(foreign, { command: { id: 'foreign-decision', payload, effectiveWeek: 1 } }).status, 'unavailable');
});

test('W30B-J08: actual blockers offer resources while a paused job stays waiting', () => {
  const start = accepted(createInitialState(), { kind: 'prepare_data', packetId: CONTENT.starterData.id }, 'journey-blocked');
  let game = step(queue(start.game, { kind: 'assign_founder', allocations: founder('research') }));
  const blocked = journey(game, start.focus);
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.detail, /No Data points available/);
  assert.equal(blocked.secondary?.action.kind, 'resources');
  game = step(queue(game, { kind: 'set_job_paused', jobId: 'preparation-journey-blocked', paused: true }));
  const paused = journey(game, start.focus);
  assert.equal(paused.status, 'waiting');
  assert.match(paused.detail, /project is paused/);
  assert.equal(paused.secondary, undefined, 'a staff reassignment is not presented as resuming paused work');
});

test('W30B-J09: an existing Basic Chat opens its product instead of another first deployment', () => {
  const game = fixtureState('wave16-snapshot.json');
  const product = Object.values(game.slices.products.offers).find(item => item.companyId === game.playerCompanyId && item.kind === 'basic-chat')!;
  assert.ok(product);
  const candidate = Object.values(game.slices.models.trainingRuns).find(item => item.companyId === game.playerCompanyId && item.status === 'complete')!;
  const selected = journey(game, { candidateId: candidate.outputModelId });
  assert.deepEqual(selected.primary.action, { kind: 'product' });
  assert.equal(selected.candidateId, candidate.outputModelId);
  assert.match(selected.title, /already exists/);
  const untested = structuredClone(game);
  for (const report of Object.values(untested.slices.models.reports)) {
    if (report.modelId === candidate.outputModelId) delete untested.slices.models.reports[report.id];
  }
  assert.deepEqual(journey(untested, { trainingRunId: candidate.id }).primary.action,
    { kind: 'evaluate', modelId: candidate.outputModelId }, 'an existing product must not conceal the new version’s test');

});

test('W30B-J10: selected dataset B remains the preparation target even when starter data is ready', () => {
  const game = createInitialState();
  game.slices.data.packets[CONTENT.starterData.id].prepared = true;
  game.slices.data.packets[CONTENT.starterData.id].readyUnits = 100;
  game.slices.data.packets['data-b'] = { ...structuredClone(CONTENT.starterData), id: 'data-b', name: 'Selected dataset B', companyId: game.playerCompanyId };
  assert.deepEqual(journey(game, { packetId: 'data-b' }).primary.action, { kind: 'prepare', packetId: 'data-b' });
  game.slices.data.packets['data-b'].prepared = true;
  game.slices.data.packets['data-b'].readyUnits = 100;
  assert.deepEqual(journey(game, { packetId: 'data-b' }).primary.action, { kind: 'train', packetId: 'data-b' });
});

test('W30B-J11: journey inspection neither mutates nor clones the complete game and retains deterministic continuation', () => {
  const start = accepted(createInitialState(), { kind: 'prepare_data', packetId: CONTENT.starterData.id }, 'journey-pure');
  const game = start.game, projects = getStudioView(game).projects, serialized = serializeState(game);
  const clone = globalThis.structuredClone;
  let fullClones = 0;
  freezeDeep(game);
  globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
    if (value === game) fullClones += 1;
    return clone(value, options);
  }) as typeof structuredClone;
  try {
    const first = getStudioJourney(game, start.focus, projects);
    for (let index = 0; index < 5; index++) assert.deepEqual(getStudioJourney(game, start.focus, projects), first);
    assert.equal(fullClones, 0);
    assert.equal(serializeState(game), serialized);
  } finally { globalThis.structuredClone = clone; }
  assert.equal(serializeState(step(game)), serializeState(step(clone(game))));
});

test('W30B-J12: unavailable results always offer explicit, usable recovery without substituting a model or report', () => {
  const { game, runs } = multipleCandidates();
  const report = Object.values(game.slices.models.reports).find(item => item.companyId === game.playerCompanyId && item.modelId === runs[0].outputModelId)!;
  const mismatch = journey(game, { candidateId: runs.at(-1)!.outputModelId, reportId: report.id });
  assert.equal(mismatch.status, 'unavailable');
  assert.equal(mismatch.primary.action.kind, 'choose');
  assert.ok(mismatch.candidates!.some(item => item.id === runs[0].outputModelId));
  assert.ok(mismatch.candidates!.some(item => item.id === runs.at(-1)!.outputModelId));
  assert.equal(mismatch.candidateId, undefined, 'choosing the same candidate again must be an explicit recovery action');
  assert.equal(mismatch.reportId, undefined);

  const evaluation = Object.values(game.slices.models.evaluationRuns).find(item => item.companyId === game.playerCompanyId && item.status === 'complete' && item.reportId)!;
  const projects = getStudioView(game).projects;
  const originalReportId = evaluation.reportId!;
  game.slices.models.reports['another-report-for-same-candidate'] = { ...structuredClone(game.slices.models.reports[originalReportId]), id: 'another-report-for-same-candidate' };
  delete game.slices.models.reports[originalReportId];
  const missingReport = getStudioJourney(game, { command: { id: evaluation.id.replace(/^evaluation-/, ''), effectiveWeek: evaluation.startedWeek,
    payload: { kind: 'evaluate_model', modelId: evaluation.modelId, suiteId: evaluation.suiteId } } }, projects);
  assert.equal(missingReport.status, 'unavailable', 'a complete project summary is not evidence that the exact report still exists');
  assert.equal(missingReport.primary.action.kind, 'choose');
  assert.ok(missingReport.candidates!.length > 0);
  assert.equal(missingReport.reportId, undefined, 'another report for the same candidate is never substituted');
  assert.equal(missingReport.projectId, undefined);

  const empty = createInitialState();
  const noCandidates = journey(empty, { candidateId: 'missing-candidate' });
  assert.deepEqual(noCandidates.primary.action, { kind: 'train' });
  assert.equal(noCandidates.candidates, undefined);
  const retainedModel = journey(empty, { candidateId: CONTENT.seedModel.id, reportId: 'missing-report' });
  assert.deepEqual(retainedModel.primary.action, { kind: 'evaluate', modelId: CONTENT.seedModel.id });
});

test('W30B-J13: a stale completed project summary cannot label unfinished work complete', () => {
  const start = accepted(createInitialState(), { kind: 'prepare_data', packetId: CONTENT.starterData.id }, 'journey-stale');
  const game = step(start.game);
  const projects = getStudioView(game).projects.map(item => ({ ...item, status: 'complete' as const, progressBps: 10000 }));
  const active = getStudioJourney(game, start.focus, projects);
  assert.notEqual(active.status, 'complete');
  assert.equal(active.progressBps, 5000);
  assert.equal(active.projectId, 'preparation-journey-stale');
});
