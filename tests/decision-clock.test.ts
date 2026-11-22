import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { createInitialState, advanceWeek, submitCommand } from '../src/core/engine';
import { DEFAULT_DECISION_CLOCK_POLICY, decisionCashGuard, decisionStartGuard, nextDecisionStop, decisionRunPreview } from '../src/core/decision-clock';
import { getWeeklyBaseCost } from '../src/core/selectors';
import { canonicalStateHash } from '../src/core/canonical';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { createConnectedSystemsBriefTerms } from '../src/modules/systems-briefs';
import { deserializeState } from '../src/core/snapshot';

const policy = { ...DEFAULT_DECISION_CLOCK_POLICY, cashReserveCents: 0, opportunities: false };

test('decision run observes real paid completion without changing weekly engine results', () => {
  let game = createInitialState();
  const queued = submitCommand(game, { kind: 'prepare_data', packetId: CONTENT.starterData.id });
  assert.ok(queued.accepted, queued.reason?.message); game = queued.state;
  let stop = null;
  for (let week = 0; week < 12 && !stop; week++) {
    const before = game, next = advanceWeek(before);
    assert.ok(next.accepted, next.reason?.message); game = next.state;
    stop = nextDecisionStop(before, game, policy, 0);
  }
  assert.match(stop?.reason ?? '', /Data preparation finished/);
  assert.equal(stop?.target, '#data');
  assert.ok(game.slices.company.ledger.some(fact => fact.id.startsWith('preparation-')));
});

test('cash reserve includes queued purchases and known recurring bills', () => {
  const game = createInitialState();
  assert.equal(decisionCashGuard(game, policy), null);
  const guarded = { ...policy, cashReserveCents: game.slices.company.companies[game.playerCompanyId].cashCents };
  assert.match(decisionStartGuard(game, guarded)?.reason ?? '', /cash reserve/);
  const queued = submitCommand(game, { kind: 'prepare_data', packetId: CONTENT.starterData.id });
  assert.ok(queued.accepted);
  const reserved = queued.state.queuedCommands[0].reservedCents!;
  assert.ok(reserved > 0);
  assert.ok(decisionCashGuard(queued.state, { ...policy, cashReserveCents: game.slices.company.companies[game.playerCompanyId].cashCents - reserved + 1 }));
});

function queue(game: GameState, payload: CommandPayload): GameState {
  const result = submitCommand(game, payload); assert.ok(result.accepted, result.reason?.message); return result.state;
}

test('cash guard catches a zero-upfront cloud increase before known rent crosses the reserve', () => {
  const game = createInitialState(), owner = game.playerCompanyId;
  const queued = queue(game, { kind: 'set_cloud_capacity', cu: game.slices.compute.fleets[owner].cloudCU + 10 * U });
  const reserve = game.slices.company.companies[owner].cashCents - getWeeklyBaseCost(game), before = canonicalStateHash(queued);
  assert.equal(queued.queuedCommands[0].reservedCents, 0);
  assert.match(decisionCashGuard(queued, { ...policy, cashReserveCents: reserve })?.reason ?? '', /cash reserve/);
  assert.equal(canonicalStateHash(queued), before, 'The guard must not commit or forecast a different engine state.');
  const settled = advanceWeek(queued); assert.ok(settled.accepted, settled.reason?.message);
  assert.ok(settled.state.slices.company.companies[owner].cashCents < reserve, 'The guarded bill is an actual charge on the next ordinary week.');
});

test('multiple queued cloud changes use the last reservation rather than adding original-state deltas', () => {
  const game = createInitialState(), owner = game.playerCompanyId, initialCU = game.slices.compute.fleets[owner].cloudCU;
  const queued = queue(queue(game, { kind: 'set_cloud_capacity', cu: initialCU + 10 * U }), { kind: 'set_cloud_capacity', cu: initialCU + 2 * U });
  const finalCost = getWeeklyBaseCost(game) + 2 * CONTENT.opening.rentCentsPerCUWeek;
  const reserve = game.slices.company.companies[owner].cashCents - finalCost;
  assert.equal(decisionCashGuard(queued, { ...policy, cashReserveCents: reserve }), null);
  assert.ok(decisionCashGuard(queued, { ...policy, cashReserveCents: reserve + 1 }));
  const settled = advanceWeek(queued); assert.ok(settled.accepted, settled.reason?.message);
  assert.equal(settled.state.slices.company.companies[owner].cashCents, reserve);
});

test('a grouped staffing and cloud plan includes new salaries while an ordinary cloud cut can fund the reserve', () => {
  const game = createInitialState(), owner = game.playerCompanyId, role = CONTENT.staff.find(role => role.id === 'data')!;
  const queued = queue(game, { kind: 'apply_studio_plan', commands: [
    { kind: 'set_cloud_capacity', cu: game.slices.compute.fleets[owner].cloudCU + 2 * U }, { kind: 'hire_staff', role: 'data' },
  ] });
  const finalCost = getWeeklyBaseCost(game) + 2 * CONTENT.opening.rentCentsPerCUWeek + role.weeklyCents;
  const reserve = game.slices.company.companies[owner].cashCents - role.recruitmentCents - finalCost;
  assert.equal(decisionCashGuard(queued, { ...policy, cashReserveCents: reserve }), null);
  assert.ok(decisionCashGuard(queued, { ...policy, cashReserveCents: reserve + 1 }));
  const settled = advanceWeek(queued); assert.ok(settled.accepted, settled.reason?.message);
  assert.equal(settled.state.slices.company.companies[owner].cashCents, reserve);
  const cut = queue(settled.state, { kind: 'set_cloud_capacity', cu: game.slices.compute.fleets[owner].cloudCU });
  const cutReserve = reserve - getWeeklyBaseCost(game) - role.weeklyCents;
  assert.ok(decisionCashGuard(settled.state, { ...policy, cashReserveCents: cutReserve }));
  assert.equal(decisionCashGuard(cut, { ...policy, cashReserveCents: cutReserve }), null);
  const dismissed = queue(settled.state, { kind: 'dismiss_staff', staffId: Object.keys(settled.state.slices.company.staff).find(id => settled.state.slices.company.staff[id].companyId === owner)! });
  const dismissalReserve = reserve - 2 * role.weeklyCents - (finalCost - role.weeklyCents);
  assert.equal(decisionCashGuard(dismissed, { ...policy, cashReserveCents: dismissalReserve }), null);
  assert.ok(decisionCashGuard(dismissed, { ...policy, cashReserveCents: dismissalReserve + 1 }));
});

test('a pinned offer stops before its acceptance deadline and expired immutable goals do not trap later decision runs', () => {
  const before = createInitialState(), terms = createConnectedSystemsBriefTerms(before, 'continuity-desk', 0);
  // Policy observation fixture: the engine owns admission and execution. These
  // snapshots isolate a running objective whose project deadline is much later.
  before.week = terms.acceptUntilWeek - 2;
  before.slices.models.developmentPlans = { 'offer-plan': {
    id: 'offer-plan', companyId: before.playerCompanyId, name: 'Build the customer model', createdWeek: 0,
    status: 'running', stage: 'train', steps: [], message: 'Training is in progress.',
    training: { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id },
    suiteId: 'basic-conversation-1', feeBudgetCents: 100000, cashReserveCents: 0, deadlineWeek: terms.acceptUntilWeek + 24,
    objective: { kind: 'renewable-brief', id: terms.briefId, terms },
  } };
  const deadlinePolicy = { ...policy, projects: false, research: false, service: false };
  const after = structuredClone(before); after.week++;
  assert.equal(decisionStartGuard(before, deadlinePolicy), null);
  assert.match(decisionRunPreview(before, deadlinePolicy), /up to 1 weeks/);
  assert.match(nextDecisionStop(before, after, deadlinePolicy, before.week)?.reason ?? '', /offer acceptance.*Week 8/);
  assert.match(decisionStartGuard(after, deadlinePolicy)?.reason ?? '', /offer acceptance/);
  const expired = structuredClone(after); expired.week = terms.acceptUntilWeek;
  assert.equal(decisionStartGuard(expired, deadlinePolicy), null, 'The next command is already outside the window; a historical goal must not permanently stop unrelated work.');
  const later = structuredClone(expired); later.week++;
  assert.equal(nextDecisionStop(expired, later, deadlinePolicy, expired.week), null);
  assert.deepEqual(later.slices.models.developmentPlans!['offer-plan'].objective?.kind === 'renewable-brief' && later.slices.models.developmentPlans!['offer-plan'].objective.terms, terms);
});

test('disabled optional stops still obey bounded duration and terminal cash state', () => {
  const before = createInitialState();
  const result = advanceWeek(before); assert.ok(result.accepted);
  const bounded = { ...policy, projects: false, research: false, deadlines: false, service: false, maxWeeks: 1 };
  assert.match(nextDecisionStop(before, result.state, bounded, 0)?.reason ?? '', /Completed 1 weeks/);
  const ended = structuredClone(result.state); ended.slices.company.companies[ended.playerCompanyId].arrearsCents = 1;
  assert.equal(nextDecisionStop(result.state, ended, bounded, 0)?.target, '#save');
});

test('current paid private service and customer-hosted support stop on a new shortfall, including fully credited outages', () => {
  const directory = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
  const restored = deserializeState(readFileSync(join(directory, 'connected-037-paid-published.json'), 'utf8'));
  assert.ok(restored.ok, restored.ok ? undefined : restored.error);
  const servicePolicy = { ...policy, projects: false, research: false, deadlines: false };
  const paidUsage = restored.state.slices.products.commercialContracts['business:vector-studio'].lastUsage!;
  for (const contractId of ['business:vector-studio', 'business:aster-services']) {
    // Observe service transitions for the fixture's actual contracted clients.
    // This policy test does not execute or authorize the synthetic shortfall.
    const before: GameState = structuredClone(restored.state);
    const previous = before.slices.products.commercialContracts[contractId];
    previous.lastUsage = { ...paidUsage, week: before.week, serviceBps: 9500 };
    const after = structuredClone(before); after.week++;
    const usage = after.slices.products.commercialContracts[contractId].lastUsage!;
    usage.week = after.week;
    const observe = (): ReturnType<typeof nextDecisionStop> => nextDecisionStop(before, after, servicePolicy, before.week);
    assert.equal(observe(), null, 'Exactly 95% service meets the stop threshold.');
    usage.serviceBps = 9499;
    assert.equal(observe()?.target, '#business-commitments');
    assert.match(observe()?.reason ?? '', previous.contractKind === 'customer-hosted' ? /support fell below 95%/ : /private service fell below 95%/);
    usage.serviceBps = 0; usage.creditsCents = usage.grossCents; usage.billedCents = 0;
    assert.ok(observe(), 'A full service credit must not disguise an outage in a paid commitment.');
    assert.equal(nextDecisionStop(before, after, { ...servicePolicy, service: false }, before.week), null);
    previous.lastUsage.serviceBps = 9499;
    assert.equal(observe(), null, 'An already reviewed ongoing shortfall does not stop every subsequent week.');
    previous.lastUsage.serviceBps = 9500;
    usage.week = before.week;
    assert.equal(observe(), null, 'Stale usage is not a new service failure.');
    usage.week = after.week; usage.grossCents = 0;
    assert.equal(observe(), null, 'Unbilled or inactive service creates no paid-service event.');
  }
});

test('assured API support and qualification shortfalls stop even when public fulfillment remains healthy', () => {
  const directory = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
  const restored = deserializeState(readFileSync(join(directory, 'connected-037-paid-published.json'), 'utf8'));
  assert.ok(restored.ok, restored.ok ? undefined : restored.error);
  const before = restored.state, servicePolicy = { ...policy, projects: false, research: false, deadlines: false };
  const contract = Object.values(before.slices.products.assuranceContracts!)[0];
  contract.lastUsage!.serviceBps = 9500;
  const after = structuredClone(before); after.week++;
  const current = after.slices.products.assuranceContracts![contract.id], usage = current.lastUsage!;
  usage.week = after.week;
  const observe = () => nextDecisionStop(before, after, servicePolicy, before.week);
  assert.equal(observe(), null, 'Exactly 95% meets the monitoring threshold.');
  usage.fulfillmentBps = 10000; usage.supportBps = 9000; usage.qualificationBps = 10000; usage.serviceBps = 9000;
  assert.equal(observe()?.target, '#developer-api');
  assert.match(observe()?.reason ?? '', /assured API service fell below 95%/);
  usage.supportBps = 10000; usage.qualificationBps = 0; usage.serviceBps = 0;
  usage.creditsCents = usage.grossCents; usage.billedCents = 0;
  assert.ok(observe(), 'A completely credited qualification failure still needs review.');
  assert.equal(nextDecisionStop(before, after, { ...servicePolicy, service: false }, before.week), null);
  contract.lastUsage!.serviceBps = 9000;
  assert.equal(observe(), null, 'A continuing shortfall does not repeatedly stop.');
  contract.lastUsage!.serviceBps = 9500; usage.week = before.week;
  assert.equal(observe(), null, 'Historical usage is not a fresh paid-service failure.');
  usage.week = after.week; usage.grossCents = 0;
  assert.equal(observe(), null);
  usage.grossCents = 1; current.companyId = 'another-company';
  assert.equal(observe(), null, 'Another company’s SLA cannot stop the player’s clock.');
});
