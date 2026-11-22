import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek, submitCommand } from '../src/core/engine';
import { getStudioView } from '../src/core/studio';
import { getStudioWorkQueue } from '../src/core/studio-work-queue';
import { withPassiveWorkforce } from '../src/modules/workforce';
import { createPlayerOnlyState } from './fixtures/player-only';

test('delegated stages are grouped once, while unfinished cancelled or archived work remains reachable', () => {
  let game = withPassiveWorkforce(createPlayerOnlyState());
  const started = submitCommand(game, { kind: 'start_development_plan', name: 'Retained work',
    training: { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id },
    suiteId: 'basic-conversation-1', feeBudgetCents: 500_000, cashReserveCents: 0, deadlineWeek: 64,
  }, CONTENT, 'queue-grouping');
  assert.ok(started.accepted); game = started.state;
  const id = 'development-queue-grouping';
  for (let week = 0; week < 20 && Object.values(game.slices.models.trainingRuns).length === 0; week++) {
    const next = advanceWeek(game); assert.ok(next.accepted); game = next.state;
  }
  const plan = game.slices.models.developmentPlans![id];
  assert.ok(plan.steps.length >= 2, 'The paid plan must have produced preparation and training jobs.');
  const working = getStudioWorkQueue(game, getStudioView(game).projects);
  assert.ok(working.planStageJobs[id].length >= 2);
  assert.ok(working.planStageJobs[id].some(job => job.status !== 'complete'));
  assert.ok(working.planStageJobs[id].every(job => !working.individualProjects.some(item => item.id === job.id)));

  const blockedJobs = getStudioView(game).projects.map(job => working.planStageJobs[id].some(stage => stage.id === job.id) && job.status !== 'complete'
    ? { ...job, status: 'blocked' as const, bottleneck: 'More development capacity needed' } : job);
  assert.ok(getStudioWorkQueue(game, blockedJobs).blockedPlanIds.has(id), 'A running plan retains attention for its resource-blocked child.');

  const cancelled = submitCommand(game, { kind: 'cancel_development_plan', planId: id }, CONTENT, 'stop-grouping');
  assert.ok(cancelled.accepted);
  const next = advanceWeek(cancelled.state); assert.ok(next.accepted); game = next.state;
  assert.equal(game.slices.models.developmentPlans![id].status, 'cancelled');
  const afterCancel = getStudioWorkQueue(game, getStudioView(game).projects);
  const unfinished = afterCancel.planStageJobs[id].filter(job => job.status !== 'complete');
  assert.ok(unfinished.length > 0);
  assert.equal(afterCancel.blockedPlanIds.has(id), false, 'Cancelled work returns to individual job attention.');
  for (const job of unfinished) assert.ok(afterCancel.individualProjects.some(item => item.id === job.id), job.id);
  for (const job of afterCancel.planStageJobs[id].filter(item => item.status === 'complete')) {
    assert.ok(!afterCancel.individualProjects.some(item => item.id === job.id), 'Finished stage history stays grouped.');
  }

  const ended = game.slices.models.developmentPlans![id];
  const archived = structuredClone(game);
  archived.slices.models.developmentPlanArchive = { [id]: {
    id, name: ended.name, companyId: ended.companyId, createdWeek: ended.createdWeek,
    endedWeek: game.week, archivedWeek: game.week, status: 'cancelled',
    feeSpentCents: ended.steps.reduce((total, step) => total + step.feeCents, 0),
    stageCommandIds: ended.steps.map(step => step.commandId),
  } };
  delete archived.slices.models.developmentPlans![id];
  const afterArchive = getStudioWorkQueue(archived, getStudioView(archived).projects);
  for (const job of unfinished) assert.ok(afterArchive.individualProjects.some(item => item.id === job.id), job.id);
  assert.equal(afterArchive.planStageJobs[id], undefined);
  assert.equal(game.slices.models.developmentPlans![id], ended, 'Queue projection does not alter the campaign.');
});
