import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import type { EvaluationReport, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { createInitialState } from '../src/core/engine';
import { serializeState } from '../src/core/snapshot';
import { freezeDeep } from '../src/core/canonical';
import { getStudioView } from '../src/core/studio';
import { filterStudioResults, selectStudioAttention, selectStudioResults } from '../src/core/studio-results';
import type { StudioResultFlags } from '../src/core/studio-results';
import { fixtureState, founder, queue, step } from './fixtures/wave25-studio';

function ownTraining(game: GameState) {
  const runs = Object.values(game.slices.models.trainingRuns).filter(run => run.companyId === game.playerCompanyId && run.status === 'complete');
  assert.ok(runs.length > 1);
  return runs.sort((a, b) => a.completedWeek! - b.completedWeek!);
}

function manyReports(count: number) {
  const game = createInitialState(), owner = game.playerCompanyId;
  game.week = 300;
  const report: EvaluationReport = { id: 'report', companyId: owner, modelId: CONTENT.seedModel.id, week: 1, heldOut: true,
    capabilityBps: { ...CONTENT.seedModel.capabilityBps }, reliabilityBps: CONTENT.seedModel.reliabilityBps,
    cases: [], passedCases: 0, basicChatEligible: false };
  for (let index = 0; index < count; index++) {
    const id = 'report-' + index.toString().padStart(3, '0');
    game.slices.models.reports[id] = { ...report, id, week: index + 1 };
  }
  return game;
}

test('W30C-R01: current milestones and research unlock arrays cannot invent dated historical results', () => {
  const game = createInitialState();
  game.slices.data.packets[CONTENT.starterData.id].prepared = true;
  game.slices.research.completedByCompany[game.playerCompanyId] = ['R1'];
  game.slices.company.companies[game.playerCompanyId].earnedRevenueCents = 999999;
  assert.deepEqual(selectStudioResults(game), []);
});

test('W30C-R02: ordinary paid preparation, training, evaluation and activation emit their own exact records and weeks', () => {
  let game = queue(createInitialState(), { kind: 'prepare_data', packetId: CONTENT.starterData.id }, 'inbox-data');
  game = queue(game, { kind: 'hire_staff', role: 'ml' }, 'inbox-hire');
  game = step(queue(game, { kind: 'allocate_compute', serving: 0, development: 4 * U, research: 0 }), 2);
  let result = selectStudioResults(game).find(item => item.sourceId === 'preparation-inbox-data')!;
  assert.equal(result.week, 2);
  assert.deepEqual(result.action?.target, { kind: 'intent', intent: { kind: 'training-data', packetId: CONTENT.starterData.id } });
  game = queue(game, { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id }, 'inbox-training');
  game = step(queue(game, { kind: 'assign_founder', allocations: founder('research') }), 3);
  const run = game.slices.models.trainingRuns['training-inbox-training'];
  assert.equal(run.status, 'complete');
  result = selectStudioResults(game).find(item => item.sourceId === run.id)!;
  assert.equal(result.week, run.completedWeek);
  assert.deepEqual(result.action?.target, { kind: 'intent', intent: { kind: 'training-result', runId: run.id } });
  game = step(queue(game, { kind: 'evaluate_model', modelId: run.outputModelId }, 'inbox-evaluate'));
  const evaluation = game.slices.models.evaluationRuns['evaluation-inbox-evaluate'];
  const reports = selectStudioResults(game).filter(item => item.kind === 'evaluation');
  assert.equal(reports.length, 1, 'the completed run and its report create one outcome');
  assert.equal(reports[0].sourceId, evaluation.reportId);
  assert.equal(reports[0].week, evaluation.completedWeek);
  game = queue(game, { kind: 'deploy_product', modelId: run.outputModelId, priceCents: 1200, allowance: 100 }, 'inbox-launch');
  game = step(queue(game, { kind: 'allocate_compute', serving: 4 * U, development: 0, research: 0 }));
  assert.equal(game.slices.products.deployments['deployment:inbox-launch'].status, 'ready');
  assert.equal(selectStudioResults(game).filter(item => item.kind === 'deployment').length, 0, 'ready work does not invent an activation');
  game = step(game);
  result = selectStudioResults(game).find(item => item.kind === 'deployment')!;
  assert.equal(result.week, game.slices.products.deployments['deployment:inbox-launch'].readyWeek);
  assert.deepEqual(result.action?.target, { kind: 'product', productId: 'product:inbox-launch', deploymentId: 'deployment:inbox-launch', modelId: run.outputModelId });
});

test('W30C-R03: an older completed run retains its original output and unavailable targets never select a newer model', () => {
  const game = fixtureState('wave16-snapshot.json'), runs = ownTraining(game), older = runs[0], newer = runs.at(-1)!;
  const result = selectStudioResults(game).find(item => item.sourceId === older.id)!;
  assert.deepEqual(result.action?.target, { kind: 'intent', intent: { kind: 'training-result', runId: older.id } });
  assert.deepEqual(result.developmentAction?.target, { kind: 'intent', intent: { kind: 'training-base', baseModelId: older.outputModelId } });
  assert.notEqual(older.outputModelId, newer.outputModelId);
  delete game.slices.models.versions[older.outputModelId];
  const missing = selectStudioResults(game).find(item => item.key === result.key)!;
  assert.equal(missing.action, null);
  assert.equal(missing.developmentAction, undefined);
  assert.match(missing.unavailableReason!, /its model is no longer available. Choose another model in the Test station/);
  assert.ok(game.slices.models.versions[newer.outputModelId]);
});

test('W30C-R04: source ownership is required and foreign referenced entities cannot become next actions', () => {
  const game = fixtureState('wave16-snapshot.json'), runs = ownTraining(game), run = runs[0];
  const original = selectStudioResults(game).find(item => item.sourceId === run.id)!;
  game.slices.models.versions[run.outputModelId].companyId = 'foreign-company';
  const foreignTarget = selectStudioResults(game).find(item => item.key === original.key)!;
  assert.equal(foreignTarget.action, null);
  assert.equal(foreignTarget.developmentAction, undefined);
  game.slices.models.trainingRuns[run.id].companyId = 'foreign-company';
  assert.equal(selectStudioResults(game).some(item => item.key === original.key), false);
  game.slices.models.reports.foreign = { ...Object.values(game.slices.models.reports)[0], id: 'foreign-report', companyId: 'foreign-company' };
  assert.equal(selectStudioResults(game).some(item => item.sourceId === 'foreign-report'), false);
});

test('W30C-R05: only real settled dates yield outcomes; current labels cannot substitute for missing completion dates', () => {
  const game = fixtureState('wave16-snapshot.json'), runs = ownTraining(game), run = runs[0];
  delete run.completedWeek;
  assert.equal(selectStudioResults(game).some(item => item.sourceId === run.id), false);
  run.completedWeek = game.week + 1;
  assert.equal(selectStudioResults(game).some(item => item.sourceId === run.id), false);
  run.completedWeek = -1;
  assert.equal(selectStudioResults(game).some(item => item.sourceId === run.id), false);
});

test('W30C-R06: stable source identity deduplicates alias records and is independent of insertion order or names', () => {
  const game = manyReports(4), report = game.slices.models.reports['report-000'];
  game.slices.models.reports.alias = structuredClone(report);
  const before = selectStudioResults(game);
  assert.equal(before.length, 4);
  game.slices.models.reports = Object.fromEntries(Object.entries(game.slices.models.reports).reverse());
  game.slices.models.versions[report.modelId].name = 'Renamed candidate';
  assert.deepEqual(selectStudioResults(game).map(item => item.key), before.map(item => item.key));
});

test('W30C-R07: the newest 200 evidence records are capped before reviewed, dismissed, type and week filters', () => {
  const all = selectStudioResults(manyReports(205));
  assert.equal(all.length, 200);
  assert.equal(all[0].week, 205);
  assert.equal(all.at(-1)!.week, 6);
  const flags: StudioResultFlags = Object.fromEntries(all.map(item => [item.key, { reviewed: true, dismissed: true }]));
  assert.equal(filterStudioResults(all, flags, { kind: 'all', week: null, visibility: 'all' }).length, 0);
  assert.equal(filterStudioResults(all, flags, { kind: 'evaluation', week: 6, visibility: 'dismissed' }).length, 1);
  assert.equal(filterStudioResults(all, {}, { kind: 'all', week: 5, visibility: 'all' }).length, 0, 'hiding newer cards does not revive older outcomes');
});

test('W30C-R08: review and dismissal filters never hide retained evidence from explicit dismissed recovery', () => {
  const result = selectStudioResults(manyReports(3));
  const flags = { [result[0].key]: { reviewed: true, dismissed: false }, [result[1].key]: { reviewed: true, dismissed: true } };
  assert.deepEqual(filterStudioResults(result, flags, { kind: 'all', week: null, visibility: 'unreviewed' }).map(item => item.key), [result[2].key]);
  assert.deepEqual(filterStudioResults(result, flags, { kind: 'all', week: null, visibility: 'reviewed' }).map(item => item.key), [result[0].key]);
  assert.deepEqual(filterStudioResults(result, flags, { kind: 'all', week: null, visibility: 'dismissed' }).map(item => item.key), [result[1].key]);
});

test('W30C-R09: onboarding is current attention until the recorded ready week then becomes a retained outcome', () => {
  let game = step(queue(createInitialState(), { kind: 'hire_staff', role: 'ml' }, 'staff-inbox'));
  const staff = Object.values(game.slices.company.staff).find(item => item.companyId === game.playerCompanyId)!;
  assert.ok(staff.readyWeek > game.week);
  assert.equal(selectStudioResults(game).some(item => item.kind === 'staff'), false);
  assert.ok(selectStudioAttention(game, []).some(item => item.key === 'onboarding:' + staff.id));
  game = step(game, staff.readyWeek - game.week);
  const ready = selectStudioResults(game).find(item => item.sourceId === staff.id)!;
  assert.equal(ready.week, staff.readyWeek);
  assert.deepEqual(ready.action?.target, { kind: 'staff', staffId: staff.id });
  assert.equal(selectStudioAttention(game, []).some(item => item.key === 'onboarding:' + staff.id), false);
});

test('W30C-R10: current constraints disappear with their underlying condition and never create historical cards', () => {
  const game = createInitialState();
  const blocked = { id: 'run-one', title: 'Training one', kind: 'training' as const, status: 'blocked' as const,
    progressBps: 0, detail: 'No work yet', bottleneck: 'Waiting for ML supervision', targetPanel: 'lab-projects' as const, stationId: 'lab' as const, startedWeek: 0 };
  const attention = selectStudioAttention(game, [blocked], [{ key: 'save:failed', title: 'Save failed', detail: 'Retry saving', tone: 'warning', action: { label: 'Open save controls', target: { kind: 'save' } } }]);
  assert.equal(attention[0].key, 'save:failed');
  assert.deepEqual(attention.find(item => item.key === 'project:run-one')!.action?.target, { kind: 'resources', projectId: 'run-one' });
  assert.equal(selectStudioAttention(game, [{ ...blocked, status: 'complete', bottleneck: '' }]).some(item => item.key === 'project:run-one'), false);
  assert.deepEqual(selectStudioResults(game), []);
});

test('W30C-R11: deriving results and attention is pure over a frozen advanced snapshot', () => {
  const game = fixtureState('wave16-snapshot.json'), before = serializeState(game), projects = getStudioView(game).projects;
  freezeDeep(game);
  const first = selectStudioResults(game);
  selectStudioAttention(game, projects);
  assert.deepEqual(selectStudioResults(game), first);
  assert.equal(serializeState(game), before);
});

test('W30C-R12: reports carry their own exact identity even when another report qualifies the same candidate', () => {
  const game = manyReports(2), reports = Object.values(game.slices.models.reports).filter(item => item.companyId === game.playerCompanyId);
  reports[0].suiteId = 'behavior-cases-1'; reports[0].basicChatEligible = false;
  reports[1].basicChatEligible = true;
  const result = selectStudioResults(game).find(item => item.sourceId === reports[0].id)!;
  assert.deepEqual(result.action?.target, { kind: 'intent', intent: { kind: 'report', reportId: reports[0].id } });
  assert.doesNotMatch(result.summary, /Basic Chat ready/);
});
