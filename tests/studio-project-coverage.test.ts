import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deserializeState } from '../src/core/index';
import { getStudioView } from '../src/core/studio';
import { getCampaignView } from '../src/modules/campaign-progress';

function savedGame(wave: number) {
  const imported = deserializeState(readFileSync(join(__dirname, 'fixtures', 'wave' + wave + '-snapshot.json'), 'utf8'));
  if (!imported.ok) throw new Error(imported.error);
  return imported.state;
}

test('Projects lists research applications and routes installation work to the workbench that owns it', () => {
  const game = savedGame(4);
  const projects = getStudioView(game).projects;
  const rollout = projects.find(project => project.id === 'system-rollout:published-assistant')!;
  assert.deepEqual([rollout.kind, rollout.status, rollout.progressBps, rollout.targetPanel], ['system rollout', 'working', 5000, 'applied-research']);
  const run = Object.values(game.slices.models.applicationRuns)[0];
  const application = projects.find(project => project.id === run.id)!;
  assert.deepEqual([application.kind, application.status, application.progressBps, application.targetPanel], ['model application', 'complete', 10000, 'applied-research']);
  run.status = 'running'; run.completedStaff = 0; run.lastBottleneck = 'More Design points needed';
  const blocked = getStudioView(game).projects.find(project => project.id === run.id)!;
  assert.deepEqual([blocked.status, blocked.bottleneck, blocked.progressBps], ['blocked', run.lastBottleneck, 0]);
});

test('Projects distinguishes live preparation, pending switch, discarded work and a separate rollback', () => {
  const game = savedGame(9);
  const release = Object.values(game.slices.products.preparedReleases!)[0];
  const card = () => getStudioView(game).projects.find(project => project.id === release.id);
  const handover = card()!;
  assert.deepEqual([handover.kind, handover.status, handover.progressBps, handover.targetPanel], ['handover', 'working', 5000, 'release-desk']);
  release.status = 'scheduled'; release.cutoverWeek = game.week + 1;
  assert.equal(card()!.status, 'waiting'); assert.match(card()!.detail, new RegExp('Week ' + release.cutoverWeek));
  release.status = 'discarded'; assert.equal(card(), undefined);

  const later = savedGame(14);
  const previous = Object.values(later.slices.products.preparedReleases!).find(item => item.rollback)!;
  const rollback = previous.rollback!;
  rollback.status = 'preparing'; rollback.paused = true;
  const projects = getStudioView(later).projects;
  const restoring = projects.find(project => project.id === rollback.id)!;
  assert.deepEqual([restoring.kind, restoring.status, restoring.targetPanel], ['rollback', 'waiting', 'release-desk']);
  assert.match(restoring.detail, /paused/i);
  assert.equal(projects.find(project => project.id === previous.id)!.status, 'complete');
  assert.equal(new Set(projects.map(project => project.id)).size, projects.length);
  const meter = Object.values(later.slices.research.systemRollouts).find(item => item.method === 'cost-accounting')!;
  assert.equal(projects.find(project => project.id === meter.id)?.targetPanel, 'compute-costs');
});

test('After the first sale the Studio suggests a real, unfinished ambition target', () => {
  const game = savedGame(9);
  const action = getStudioView(game).nextAction;
  assert.equal(action.stage, 'grow');
  assert.equal(action.targetPanel, 'campaign');
  const route = getCampaignView(game).routes.find(item => item.name === action.title)!;
  assert.equal(route.achievedWeek, null);
  const requirement = route.criteria.find(item => !item.met)!;
  for (const text of [requirement.label, requirement.current, requirement.target]) assert.ok(action.detail.includes(text));
});
