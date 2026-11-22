import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState, RoleAllocation } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, canonicalStateHash, createDefaultModules, createInitialState, deserializeState, getGameView, previewCommand, serializeState, submitCommand, validateState } from '../src/core/index';

const company = (s: GameState) => s.slices.company.companies[s.playerCompanyId];
function queue(s: GameState, payload: CommandPayload): GameState { const r = submitCommand(s, payload); assert.equal(r.accepted, true, r.reason?.message); return r.state; }
function step(s: GameState): GameState { const r = advanceWeek(s); assert.equal(r.accepted, true, r.reason?.message); return r.state; }
const founder = (role: keyof RoleAllocation): RoleAllocation => ({ research: 0, ml: 0, data: 0, infrastructure: 0, commercial: 0, hardware: 0, [role]: U });

function trainedLab(): GameState {
  let s = createInitialState();
  s = queue(s, { kind: 'prepare_data', packetId: CONTENT.starterData.id });
  s = queue(s, { kind: 'hire_staff', role: 'ml' });
  s = queue(s, { kind: 'allocate_compute', serving: 0, development: 4 * U, research: 0 });
  s = step(step(s));
  assert.equal(s.slices.data.packets[CONTENT.starterData.id].prepared, true);
  s = queue(s, { kind: 'assign_founder', allocations: founder('research') });
  s = queue(s, { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id });
  s = step(step(step(s)));
  assert.equal(s.week, 5);
  return s;
}
function launchedLab(): GameState {
  let s = trainedLab();
  const run = Object.values(s.slices.models.trainingRuns).find(r => r.companyId === s.playerCompanyId)!;
  s = queue(s, { kind: 'evaluate_model', modelId: run.outputModelId }); s = step(s);
  s = queue(s, { kind: 'deploy_product', modelId: run.outputModelId, priceCents: 1200, allowance: 100 });
  s = queue(s, { kind: 'allocate_compute', serving: 4 * U, development: 0, research: 0 });
  s = step(s); assert.equal(s.slices.products.activeIds.filter(id => s.slices.products.offers[id].companyId === s.playerCompanyId).length, 0);
  assert.equal(Object.values(s.slices.products.deployments).find(r => r.companyId === s.playerCompanyId)!.status, 'ready');
  s = step(s); assert.equal(s.week, 8); assert.equal(s.slices.products.activeIds.filter(id => s.slices.products.offers[id].companyId === s.playerCompanyId).length, 1);
  return s;
}

test('W1-I01: a real first sale follows preparation, onboarding, training, evaluation, release, and compute-backed trials', () => {
  let s = launchedLab();
  const run = Object.values(s.slices.models.trainingRuns).find(r => r.companyId === s.playerCompanyId)!, model = s.slices.models.versions[run.outputModelId];
  assert.deepEqual(model.capabilityBps, { conversation: 4800, documents: 3056, coding: 2000, tools: 2080 });
  assert.equal(model.reliabilityBps, 8600);
  assert.equal(Object.values(s.slices.models.reports).find(r => r.companyId === s.playerCompanyId)!.cases.length, 20);
  assert.equal(company(s).earnedRevenueCents, 0);
  assert.equal(s.slices.markets.trials.find(t => t.companyId === s.playerCompanyId)!.count, 20);
  assert.equal(s.slices.markets.waitlistRemaining, 20);
  s = step(s);
  assert.equal(s.week, 9); assert.equal(s.slices.markets.payingConsumers, 9);
  assert.equal(company(s).earnedRevenueCents, 0, 'converted customers do not pay in the trial execution week');
  assert.equal(s.slices.markets.waitlistRemaining, 0);
  assert.equal(s.slices.compute.fleets[s.playerCompanyId].lastWork.serving, 100_000_000);
  s = step(s);
  const usage = Object.values(s.slices.products.lastUsage).find(u => s.slices.products.offers[u.productId].companyId === s.playerCompanyId)!;
  assert.equal(usage.paidAccounts, 9); assert.equal(usage.paidExecutedWork, 180_000_000);
  assert.equal(usage.trialExecutedWork, 100_000_000); assert.equal(usage.errorBps, 1572);
  assert.equal(usage.billedCents, 10_800); assert.equal(usage.creditsCents, 0);
  assert.equal(company(s).cashCents, 3_260_800);
  assert.equal(s.slices.products.invoices.filter(i => i.companyId === s.playerCompanyId).length, 1);
  assert.equal(company(s).earnedRevenueCents, 10_800);
  assert.ok(s.slices.campaign.milestones.includes('first-paid-customer'));
  assert.equal(getGameView(s).progress.firstSale, true);
  assert.deepEqual(validateState(s), []);
});

test('W1-I02: trial starvation produces no subscribers or revenue and the trial expires after two service weeks', () => {
  let s = launchedLab();
  s = queue(s, { kind: 'allocate_compute', serving: 0, development: 4 * U, research: 0 });
  s = step(s); assert.equal(s.slices.markets.trials.filter(t => t.companyId === s.playerCompanyId).length, 1); assert.equal(s.slices.markets.payingConsumers, 0);
  s = step(s); assert.equal(s.slices.markets.trials.filter(t => t.companyId === s.playerCompanyId).length, 0); assert.equal(s.slices.markets.payingConsumers, 0);
  assert.equal(company(s).earnedRevenueCents, 0); assert.equal(Object.values(s.slices.products.lastUsage).find(u => s.slices.products.offers[u.productId].companyId === s.playerCompanyId)!.executedWork, 0);
  assert.equal(s.slices.markets.waitlistRemaining, 20, 'the other half of the waitlist was never enrolled without capacity');
});

test('W1-I03: partial fulfillment credits only the unmet fraction, while failed attempts still consume compute', () => {
  let s = step(launchedLab());
  s = queue(s, { kind: 'allocate_compute', serving: 99_000_000, development: 0, research: 0 });
  s = step(s);
  const usage = Object.values(s.slices.products.lastUsage).find(u => s.slices.products.offers[u.productId].companyId === s.playerCompanyId)!;
  assert.equal(usage.paidRequestedWork, 180_000_000);
  assert.equal(usage.paidExecutedWork, 90_000_000, 'ten percent headroom fits within the physical ceiling');
  assert.equal(usage.fulfillmentBps, 5000); assert.equal(usage.grossBillCents, 10_800);
  assert.equal(usage.creditsCents, 5400); assert.equal(usage.billedCents, 5400);
  assert.equal(usage.trialExecutedWork, 0, 'current subscribers have priority over trials');
  assert.equal(s.slices.compute.fleets[s.playerCompanyId].lastWork.serving, 90_000_000);
  assert.equal(company(s).lastWeek.operatingExpenseCents, 130_000, 'reserved rent and payroll do not shrink with actual work');
});

test('W1-I04: pausing an active product grants full service credits and prevents new trial enrollment', () => {
  let s = step(launchedLab());
  const productId = s.slices.products.activeIds.find(id => s.slices.products.offers[id].companyId === s.playerCompanyId)!;
  s = queue(s, { kind: 'set_product_paused', productId, paused: true }); s = step(s);
  const usage = s.slices.products.lastUsage[productId];
  assert.equal(usage.paidAccounts, 9); assert.equal(usage.billedCents, 0); assert.equal(usage.creditsCents, 10_800);
  assert.equal(s.slices.markets.lastTrialCount, 0); assert.equal(s.slices.products.activeIds.filter(id => s.slices.products.offers[id].companyId === s.playerCompanyId).length, 0);
  assert.equal(company(s).earnedRevenueCents, 0);
});

test('W1-I05: checkpoints, model evidence, trial carries, invoices and future weeks replay exactly after a save', () => {
  const checkpoints = [trainedLab(), launchedLab(), step(launchedLab()), step(step(launchedLab()))];
  for (const checkpoint of checkpoints) {
    const saved = deserializeState(serializeState(checkpoint));
    if (!saved.ok) throw new Error(saved.error);
    let left = checkpoint, right = saved.state;
    for (let i = 0; i < 8; i++) { left = step(left); right = step(right); assert.equal(canonicalStateHash(left), canonicalStateHash(right)); }
  }
});

test('W1-I06: repeated finite training, untested deployments, and premature repeat evaluation are rejected without charges', () => {
  const s = trainedLab(), modelId = Object.values(s.slices.models.trainingRuns).find(r => r.companyId === s.playerCompanyId)!.outputModelId;
  for (const action of [
    { kind: 'start_training', baseModelId: modelId, packetId: CONTENT.starterData.id },
    { kind: 'deploy_product', modelId, priceCents: 1200, allowance: 100 },
  ] as CommandPayload[]) { const result = submitCommand(s, action); assert.equal(result.accepted, false); assert.equal(canonicalStateHash(result.state), canonicalStateHash(s)); }
  const queued = queue(s, { kind: 'evaluate_model', modelId });
  assert.equal(submitCommand(queued, { kind: 'evaluate_model', modelId }).accepted, false);
});

test('W1-I07: action fees must match the validated quote and a corrupt module cannot partially charge the company', () => {
  const s = queue(createInitialState(), { kind: 'hire_staff', role: 'ml' });
  const modules = createDefaultModules(CONTENT).map(module => module.id !== 'company' ? module : { ...module, applyCommand: (...args: Parameters<NonNullable<typeof module.applyCommand>>) => {
    const result = module.applyCommand!(...args); result.facts![0].amountCents += 1; return result;
  } });
  const r = advanceWeek(s, CONTENT, modules);
  assert.equal(r.accepted, false); assert.equal(r.reason?.code, 'INVALID_FACT'); assert.equal(canonicalStateHash(r.state), canonicalStateHash(s));
});

test('W1-I08: forecast and invalid imported references cannot mutate the live company', () => {
  const s = step(step(launchedLab())), hash = canonicalStateHash(s);
  assert.ok(previewCommand(s, { kind: 'set_product_terms', productId: s.slices.products.activeIds.find(id => s.slices.products.offers[id].companyId === s.playerCompanyId)!, priceCents: 1500, allowance: 100 }).accepted);
  getGameView(s); assert.equal(canonicalStateHash(s), hash);
  for (const mutate of [
    (x: GameState) => { x.slices.markets.trials[0].requiredWork += 1; },
    (x: GameState) => { Object.values(x.slices.products.deployments)[0].modelId = 'missing'; },
    (x: GameState) => { x.slices.products.invoices[0].amountCents += 1; },
    (x: GameState) => { Object.values(x.slices.models.reports)[0].capabilityBps.conversation += 1; },
  ]) { const changed = structuredClone(s); mutate(changed); assert.ok(validateState(changed).length > 0); }
});
