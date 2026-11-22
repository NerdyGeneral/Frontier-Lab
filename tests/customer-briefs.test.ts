import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CONTENT } from '../src/content/catalog';
import { CUSTOMER_BRIEFS } from '../src/content/customer-briefs';
import type { BriefId, OptionalBriefId } from '../src/contracts/customer-briefs';
import { RESOURCE_SCALE as U, type CommandPayload, type GameState } from '../src/contracts/types';
import { advanceWeek, createInitialState, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { selectStudioResults } from '../src/core/studio-results';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { briefPaymentId, getCustomerBriefSpotlight } from '../src/modules/customer-briefs';
import { withPassiveWorkforce } from '../src/modules/workforce';

const accept = (briefId: OptionalBriefId): CommandPayload => ({ kind: 'accept_customer_brief', briefId });
const get = (s: GameState, id: BriefId) => s.slices.campaign.customerBriefs?.[id];
function queue(s: GameState, payload: CommandPayload, id?: string) {
  const result = submitCommand(s, payload, CONTENT, id); assert.ok(result.accepted, result.reason?.message); return result.state;
}
function step(s: GameState) {
  const result = advanceWeek(s); assert.ok(result.accepted, result.reason?.message);
  for (const cmd of s.queuedCommands.filter(c => c.companyId === s.playerCompanyId)) {
    const receipt = result.state.commandReceipts[cmd.id]; assert.equal(receipt?.status, 'accepted', receipt?.reason?.message);
  }
  return result.state;
}
function reload(s: GameState) {
  const loaded = deserializeState(serializeState(s)); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error); return loaded.state;
}
function until(s: GameState, done: (s: GameState) => boolean, limit: number) {
  for (let i = 0; i < limit && !done(s); i++) s = step(s);
  assert.ok(done(s), 'Expected goal in Week ' + s.week + ' · ' + JSON.stringify(getCustomerBriefSpotlight(s))); return s;
}
function checkFee(s: GameState, id: BriefId) {
  const entries = s.slices.company.ledger.filter(f => f.id === briefPaymentId(s.playerCompanyId, id));
  assert.equal(entries.length, 1); assert.equal(entries[0].amountCents, CUSTOMER_BRIEFS[id].feeCents);
  assert.equal(entries[0].kind, 'receipt'); assert.equal(entries[0].category, 'revenue');
}
let paidGame: GameState;
function firstSale() {
  if (paidGame) return structuredClone(paidGame);
  let s = createInitialState(CONTENT, 'release');
  assert.equal(previewCommand(s, accept('research-sprint')).accepted, false);
  s = queue(s, {kind: 'prepare_data', packetId: 'starter-public'});
  s = step(queue(s, {kind: 'allocate_compute', serving: 0, research: 0, development: 4 * U}));
  s = until(s, g => g.slices.data.packets['starter-public'].prepared, 3);
  s = queue(s, {kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: 'starter-public'}, 'opening-train');
  s = until(s, g => g.slices.models.trainingRuns['training-opening-train']?.status === 'complete', 5);
  const modelId = s.slices.models.trainingRuns['training-opening-train'].outputModelId;
  s = step(queue(s, {kind: 'evaluate_model', modelId}));
  s = queue(s, {kind: 'deploy_product', modelId, priceCents: 1200, allowance: 100});
  s = step(queue(s, {kind: 'allocate_compute', serving: 4 * U, development: 0, research: 0}));
  s = until(s, g => g.slices.company.companies[g.playerCompanyId].earnedRevenueCents > 0, 6);
  assert.equal(s.slices.campaign.customerBriefs, undefined);
  paidGame = s; return structuredClone(s);
}

test('first-sale launch brief requires real incremental serving and paying ordinary users, settles once, and survives reload', () => {
  let s = queue(firstSale(), accept('launch-window'));
  assert.equal(previewCommand(s, accept('research-sprint')).accepted, false);
  s = step(s);
  assert.equal(get(s, 'launch-window')!.qualifyingWeeks, 1);
  assert.match(get(s, 'launch-window')!.feedback, /Burst 1\/1 CUw/);
  const resumed = step(reload(s)); s = step(s);
  assert.deepEqual(resumed, s);
  assert.equal(get(s, 'launch-window')!.status, 'completed');
  checkFee(step(s), 'launch-window');
  assert.equal(previewCommand(s, accept('launch-window')).accepted, false);
  const corrupt = structuredClone(s); delete corrupt.slices.company.postedFacts[briefPaymentId(s.playerCompanyId, 'launch-window')];
  assert.ok(validateState(corrupt).length > 0);
});

test('an underprovisioned burst expires on its inclusive deadline and can be accepted again', () => {
  let s = queue(firstSale(), accept('launch-window'));
  s = step(queue(s, {kind: 'allocate_compute', serving: 0, development: 4 * U, research: 0}));
  const deadline = get(s, 'launch-window')!.deadlineWeek;
  s = until(s, g => g.week === deadline, 4);
  assert.equal(get(s, 'launch-window')!.status, 'expired');
  assert.ok(!s.slices.company.postedFacts[briefPaymentId(s.playerCompanyId, 'launch-window')]);
  s = step(queue(s, {kind: 'allocate_compute', serving: 4 * U, development: 0, research: 0}));
  s = until(s, g => previewCommand(g, accept('launch-window')).accepted, 4);
  assert.equal(get(step(queue(s, accept('launch-window'))), 'launch-window')!.status, 'active');
});

test('fellowship excludes prior projects and rewards a discovery started during its window', () => {
  let s = queue(firstSale(), {kind: 'start_research', researchId: 'R1'});
  s = step(queue(s, {kind: 'allocate_compute', research: 2 * U, serving: 2 * U, development: 0}));
  s = step(queue(s, accept('research-sprint')));
  assert.equal(get(s, 'research-sprint')!.qualifyingWeeks, 0);
  s = until(s, g => g.slices.research.completedByCompany[g.playerCompanyId].includes('R1'), 2);
  s = until(queue(s, {kind: 'start_research', researchId: 'R3'}), g => get(g, 'research-sprint')?.status === 'completed', 4);
  checkFee(s, 'research-sprint');
});

test('the acceptance test requires a new trained and evaluated model, even with an existing release', () => {
  let s = step(queue(firstSale(), {kind: 'buy_data', catalogId: 'specialist-conversation-1'}));
  const packet = Object.values(s.slices.data.packets).find(p => p.catalogId === 'specialist-conversation-1')!;
  s = until(queue(s, {kind: 'prepare_data', packetId: packet.id}), g => g.slices.data.packets[packet.id].prepared, 3);
  s = step(queue(s, accept('model-acceptance')));
  assert.equal(get(s, 'model-acceptance')!.status, 'active');
  s = queue(s, {kind: 'allocate_compute', serving: 0, development: 4 * U, research: 0});
  s = queue(s, {kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: packet.id}, 'commission-model');
  s = until(s, g => g.slices.models.trainingRuns['training-commission-model']?.status === 'complete', 5);
  assert.equal(get(s, 'model-acceptance')!.status, 'active');
  s = step(queue(s, {kind: 'evaluate_model', modelId: s.slices.models.trainingRuns['training-commission-model'].outputModelId}));
  assert.equal(get(s, 'model-acceptance')!.status, 'completed'); checkFee(s, 'model-acceptance');
});

test('a private hosting client pays for a smaller compute bill only while its contracted workload is delivered', () => {
  const file = readFileSync(join(__dirname, 'fixtures', 'wave5-snapshot.json'), 'utf8');
  const loaded = deserializeState(file); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  let s = withPassiveWorkforce(loaded.state);
  assert.equal(previewCommand(s, accept('lean-service')).accepted, false, 'A weight license is ineligible.');
  s = step(queue(s, {kind: 'set_cloud_capacity', cu: 118 * U}));
  s = step(queue(s, {kind: 'allocate_compute', serving: 92 * U, development: 8 * U, research: 0}));
  const model = Object.values(s.slices.models.versions).find(m => m.companyId === s.playerCompanyId && m.status === 'released' && m.capabilityBps.documents >= 5500 && m.reliabilityBps >= 9000)!;
  s = queue(s, {kind: 'sign_business_contract', customerId: 'aster-services', modelId: model.id, contractKind: 'private-hosted', packetId: 'starter-public'});
  s = until(s, g => previewCommand(g, accept('lean-service')).accepted, 8);
  s = step(queue(s, accept('lean-service')));
  const brief = get(s, 'lean-service')!;
  assert.equal(brief.qualifyingWeeks, 0);
  assert.equal(brief.targetId, 'business:aster-services');
  assert.ok(brief.baselineCostCents >= 118 * CONTENT.opening.rentCentsPerCUWeek);
  let undersupplied = queue(s, {kind: 'allocate_compute', serving: 0, development: 8 * U, research: 0});
  undersupplied = step(queue(undersupplied, {kind: 'set_cloud_capacity', cu: 103 * U}));
  assert.equal(get(undersupplied, 'lean-service')!.qualifyingWeeks, 0);
  assert.match(get(undersupplied, 'lean-service')!.feedback, /Client service 0%/);
  s = until(queue(s, {kind: 'set_cloud_capacity', cu: 103 * U}), g => get(g, 'lean-service')?.status === 'completed', 4);
  checkFee(s, 'lean-service'); assert.deepEqual(reload(s), s);
});

test('the consultancy receives its signed fee on live handover by Week 8, and an undelivered pilot expires without a charge', () => {
  const opening = createInitialState(CONTENT, 'release', 'consultancy');
  assert.equal(getCustomerBriefSpotlight(opening)?.deadlineWeek, 8);
  const missed = until(opening, g => g.week === 8, 8);
  assert.equal(get(missed, 'consultancy-pilot')!.status, 'expired');
  const expiry = selectStudioResults(missed).find(result => result.kind === 'brief');
  assert.equal(expiry?.week, 8);
  assert.equal(expiry?.title, 'Deliver the chat pilot');
  assert.equal(expiry?.summary, 'Missed the week 8 deadline for Alder & Finch.');
  assert.equal(missed.slices.company.companies[missed.playerCompanyId].earnedRevenueCents, 0);
  assert.equal(previewCommand(missed, {kind: 'accept_customer_brief', briefId: 'consultancy-pilot'} as unknown as CommandPayload).accepted, false);

  let s = queue(opening, {kind: 'prepare_data', packetId: 'starter-public'});
  s = until(s, g => g.slices.data.packets['starter-public'].prepared, 2);
  s = queue(s, {kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: 'starter-public'}, 'pilot-train');
  s = until(s, g => g.slices.models.trainingRuns['training-pilot-train']?.status === 'complete', 3);
  const modelId = s.slices.models.trainingRuns['training-pilot-train'].outputModelId;
  s = step(queue(s, {kind: 'evaluate_model', modelId}));
  assert.equal(get(s, 'consultancy-pilot')!.status, 'active');
  s = step(queue(s, {kind: 'deploy_product', modelId, priceCents: 1200, allowance: 100}));
  assert.equal(get(s, 'consultancy-pilot')!.status, 'active');
  s = step(reload(s));
  assert.equal(get(s, 'consultancy-pilot')!.status, 'completed');
  assert.ok(s.week <= 8); checkFee(s, 'consultancy-pilot');
  const delivery = selectStudioResults(s).find(result => result.kind === 'brief');
  assert.equal(delivery?.summary, 'Alder & Finch paid $8,000.');
  assert.deepEqual(delivery?.action?.target, { kind: 'intent', intent: { kind: 'panel', panel: 'customer-briefs' } });
});
