import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState, RoleAllocation } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, canonicalStateHash, createInitialState, deserializeState, serializeState, submitCommand } from '../src/core/index';
import { getStudioView } from '../src/core/studio';

function queue(state: GameState, payload: CommandPayload): GameState {
  const result = submitCommand(state, payload); assert.equal(result.accepted, true, result.reason?.message); return result.state;
}
function step(state: GameState): GameState {
  const result = advanceWeek(state); assert.equal(result.accepted, true, result.reason?.message); return result.state;
}
const founder = (role: keyof RoleAllocation): RoleAllocation => ({ research: 0, ml: 0, data: 0, infrastructure: 0, commercial: 0, hardware: 0, [role]: U });

test('W24-S01: opening Studio shows the actual company and six reachable stations without inventing work', () => {
  const state = createInitialState(), hash = canonicalStateHash(state), view = getStudioView(state);
  assert.equal(view.summary.cashCents, CONTENT.opening.cashCents);
  assert.equal(view.summary.totalStaff, 1);
  assert.equal(view.summary.workforceFte, U);
  assert.equal(view.summary.executedCUw, 0);
  assert.equal(view.projects.length, 0);
  assert.deepEqual(view.stations.map(station => station.id), ['data', 'lab', 'models', 'people', 'compute', 'product']);
  assert.deepEqual(view.stations.map(station => station.targetPanel), ['data', 'lab-projects', 'models', 'people', 'compute', 'product']);
  assert.equal(view.stations.some(station => station.status === 'working'), false);
  assert.equal(view.nextAction.stage, 'prepare');
  assert.equal(view.nextAction.targetPanel, 'data');
  assert.equal(Object.isFrozen(view.stations[0]), true);
  for (let i = 0; i < 5; i++) assert.deepEqual(getStudioView(state), view);
  assert.equal(canonicalStateHash(state), hash);
});

test('W24-S02: queued preparation is a pending change, while settled staff work creates a stable project', () => {
  let state = queue(createInitialState(), { kind: 'prepare_data', packetId: CONTENT.starterData.id });
  const pending = getStudioView(state);
  assert.equal(pending.summary.queuedCount, 1);
  assert.equal(pending.summary.reservedCashCents, CONTENT.preparation.feeCents);
  assert.equal(pending.projects.length, 0);
  assert.equal(pending.stations[0].status, 'waiting');
  assert.match(pending.stations[0].detail, /queued for Week 1/);
  state = step(state);
  const working = getStudioView(state), project = working.projects.find(item => item.kind === 'data')!;
  assert.equal(project.status, 'working');
  assert.equal(project.progressBps, 5000);
  assert.equal(working.summary.queuedCount, 0);
  assert.equal(working.stations[0].projectId, project.id);
  const hash = canonicalStateHash(state), reloaded = deserializeState(serializeState(state));
  if (!reloaded.ok) throw new Error(reloaded.error);
  assert.deepEqual(getStudioView(reloaded.state), working);
  const completed = getStudioView(step(state)).projects.find(item => item.id === project.id)!;
  assert.equal(completed.status, 'complete');
  assert.equal(completed.progressBps, 10000);
  assert.equal(canonicalStateHash(state), hash);
});

test('W24-S03: missing staff and paused work never animate as working', () => {
  let state = queue(createInitialState(), { kind: 'prepare_data', packetId: CONTENT.starterData.id });
  state = queue(state, { kind: 'assign_founder', allocations: founder('research') });
  state = step(state);
  const view = getStudioView(state), project = view.projects.find(item => item.kind === 'data')!;
  assert.equal(project.status, 'blocked');
  assert.equal(project.progressBps, 0);
  assert.match(project.bottleneck, /No Data points available/i);
  assert.equal(view.stations[0].status, 'blocked');
  state = step(queue(state, { kind: 'set_job_paused', jobId: project.id, paused: true }));
  assert.equal(getStudioView(state).projects.find(item => item.id === project.id)!.status, 'waiting');
});

test('W24-S04: Studio tracks the real first-sale path through release, trials and billing without affecting continuation', () => {
  let state = queue(createInitialState(CONTENT, 'release'), { kind: 'prepare_data', packetId: CONTENT.starterData.id });
  state = queue(state, { kind: 'hire_staff', role: 'ml' });
  state = queue(state, { kind: 'allocate_compute', serving: 0, development: 4 * U, research: 0 });
  state = step(step(state));
  assert.equal(getStudioView(state).nextAction.stage, 'train');
  state = queue(state, { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id });
  state = step(step(step(state)));
  const modelId = Object.values(state.slices.models.trainingRuns).find(run => run.companyId === state.playerCompanyId)!.outputModelId;
  assert.equal(getStudioView(state).nextAction.stage, 'evaluate');
  state = step(queue(state, { kind: 'evaluate_model', modelId }));
  assert.equal(getStudioView(state).nextAction.stage, 'release');
  state = queue(state, { kind: 'deploy_product', modelId, priceCents: 1200, allowance: 100 });
  state = queue(state, { kind: 'allocate_compute', serving: 4 * U, development: 0, research: 0 });
  state = step(state);
  const deployment = getStudioView(state).projects.find(project => project.kind === 'deployment')!;
  assert.equal(deployment.status, 'waiting');
  assert.match(deployment.detail, /Activates in Week 8/);
  state = step(state);
  assert.equal(getStudioView(state).nextAction.stage, 'earn');
  const enrolled = state.slices.markets.lastTrialCount;
  assert.equal(enrolled, CONTENT.firstSale.weeklyReach + CONTENT.firstSale.reachPerCommercialFte,
    'after the launch, the available founder contributes one full week to customer acquisition');
  assert.match(getStudioView(state).stations.find(station => station.id === 'product')!.detail, new RegExp(enrolled + ' trial accounts'));
  state = step(state);
  assert.equal(getStudioView(state).stations.find(station => station.id === 'product')!.status, 'working');
  const hash = canonicalStateHash(state), before = serializeState(state);
  for (let i = 0; i < 5; i++) getStudioView(state);
  assert.equal(canonicalStateHash(state), hash);
  assert.equal(serializeState(state), before);
  const reload = deserializeState(before); if (!reload.ok) throw new Error(reload.error);
  const fromStudio = step(state), fromClassic = step(reload.state);
  assert.equal(canonicalStateHash(fromStudio), canonicalStateHash(fromClassic));
  const sold = getStudioView(fromStudio);
  assert.equal(sold.nextAction.stage, 'grow');
  assert.equal(sold.milestones.every(milestone => milestone.complete), true);
  const company = fromStudio.slices.company.companies[fromStudio.playerCompanyId];
  const invoices = fromStudio.slices.products.invoices.filter(item => item.companyId === company.id);
  assert.equal(invoices.length, 1);
  assert.ok(invoices[0].amountCents > 0);
  assert.equal(sold.summary.revenueCents, invoices[0].amountCents);
  assert.equal(sold.summary.cashCents, company.cashCents);
});

test('W24-S05: historical snapshots still deserialize into immutable Studio views with stable project IDs', () => {
  for (const file of ['wave0-snapshot.json', 'wave1-inflight-snapshot.json', 'wave16-snapshot.json']) {
    const loaded = deserializeState(readFileSync(join(__dirname, 'fixtures', file), 'utf8'));
    if (!loaded.ok) throw new Error(`${file}: ${loaded.error}`);
    const state = loaded.state, hash = canonicalStateHash(state), first = getStudioView(state);
    assert.equal(new Set(first.projects.map(project => project.id)).size, first.projects.length);
    assert.deepEqual(getStudioView(state), first);
    assert.equal(canonicalStateHash(state), hash);
    assert.equal(first.summary.cashCents, state.slices.company.companies[state.playerCompanyId].cashCents);
    assert.equal(first.projects.every(project => project.progressBps >= 0 && project.progressBps <= 10000), true);
  }
});
