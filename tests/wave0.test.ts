import { createPlayerOnlyState } from './fixtures/player-only';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceWeek,
  accumulateFraction,
  canonicalStateHash,
  checkedAdd,
  checkedInteger,
  createDefaultModules,
  deserializeState,
  drawNamed,
  fromUnits,
  mulDiv,
  previewCommand,
  runDiagnostics,
  serializeState,
  submitCommand,
  toUnits,
  validateState,
} from '../src/core/index';
import { CONTENT } from '../src/content/catalog';
import { validateContent } from '../src/content/validate';
import { PHASES, RESOURCE_SCALE } from '../src/contracts/types';
import type { CommandPayload, DomainModule, GameContent, GameState, LedgerFact, WorkRequest } from '../src/contracts/types';

const clone = <T>(value: T): T => structuredClone(value);
const company = (state: GameState) => state.slices.company.companies[state.playerCompanyId];
const fleet = (state: GameState) => state.slices.compute.fleets[state.playerCompanyId];

function step(state: GameState, content = CONTENT, modules?: readonly DomainModule[]): GameState {
  const result = advanceWeek(state, content, modules);
  assert.equal(result.accepted, true, result.reason?.message);
  return result.state;
}

function fixtureFact(week: number, amountCents = 1234): LedgerFact {
  return {
    id: `fixture-fee:${week}`,
    companyId: CONTENT.opening.companyId,
    week,
    sourceId: 'fixture-cost',
    category: 'operating',
    amountCents,
    label: 'Fixture operating cost',
    kind: 'expense',
  };
}

test('W0-C01: opening catalog and initial state preserve the authored values', () => {
  assert.deepEqual(validateContent(CONTENT), []);
  const state = createPlayerOnlyState(CONTENT);
  assert.deepEqual(validateState(state, CONTENT), []);
  assert.equal(state.week, 0);
  assert.equal(company(state).cashCents, 4_800_000);
  assert.equal(company(state).founderFte, RESOURCE_SCALE);
  assert.equal(company(state).activeStaff, 0);
  assert.equal(fleet(state).cloudCU, 4 * RESOURCE_SCALE);
  assert.equal(fleet(state).memoryMU, 8 * RESOURCE_SCALE);
  assert.equal(state.slices.markets.payingConsumers, 0);
  assert.equal(state.slices.markets.waitlistRemaining, 40);
  assert.deepEqual(state.slices.models.versions[CONTENT.seedModel.id].capabilityBps, {
    conversation: 4000, documents: 3000, coding: 2000, tools: 2000,
  });
  assert.equal(state.slices.models.versions[CONTENT.seedModel.id].reliabilityBps, 7000);
  assert.equal(state.slices.data.packets[CONTENT.starterData.id].readyUnits, 0);
  assert.equal(state.slices.data.packets[CONTENT.starterData.id].prepared, false);
});

test('W0-C02: catalog retains existing programs and includes thirteen customization and twelve AI systems discoveries', () => {
  const parents = CONTENT.research.filter((item) => !item.parentId && item.id.startsWith('R'));
  const children = CONTENT.research.filter((item) => item.parentId);
  assert.equal(parents.length, 16);
  assert.equal(children.length, 13);
  assert.deepEqual(CONTENT.research.filter(item => item.id.startsWith('S')).map(item => item.id).sort(), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  assert.equal(CONTENT.research.length, 66);
  assert.deepEqual(CONTENT.research.filter(item => item.id.startsWith('M')).map(item => item.id), ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12', 'M13']);
  assert.deepEqual(children.map((item) => item.id).sort(), [
    'R1A', 'R2A', 'R3B', 'R4B', 'R4C', 'R5A', 'R6A', 'R7A', 'R8A', 'R9A', 'R10A', 'R11A', 'R12A',
  ].sort());
  assert.deepEqual(CONTENT.research.filter(item => item.implemented).map(item => item.id).sort(), ['R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11','R12','R13','R14','R15','R16','R1A','R2A','R3B','R5A','R6A','R7A','R8A','R12A','R4B','R4C','R9A','R10A','R11A','S1','S2','S3','S4','S5','S6','D1','D2','D3','D4','D5','D6','M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11','M12','M13','A1','A2','A3','A4','A5','A6','A7','A8','A9','A10','A11','A12'].sort());
  assert.equal(CONTENT.staff.find((item) => item.id === 'hardware')?.availableOnResearchEntry, 'R16');
});

test('W0-C03: catalog validation rejects duplicate IDs, missing references and prerequisite cycles', () => {
  const duplicate = clone(CONTENT);
  duplicate.research.push(clone(duplicate.research[0]));
  assert.ok(validateContent(duplicate).length > 0);
  const missing = clone(CONTENT);
  missing.research[0].requires = ['R-NOT-PRESENT'];
  assert.ok(validateContent(missing).length > 0);
  const cycle = clone(CONTENT);
  cycle.research[0].requires = [cycle.research[1].id];
  cycle.research[1].requires = [cycle.research[0].id];
  assert.ok(validateContent(cycle).length > 0);
});

test('W0-C04: content validation rejects negative prices and impossible opening allocation', () => {
  const negative = clone(CONTENT);
  negative.opening.rentCentsPerCUWeek = -1;
  assert.ok(validateContent(negative).length > 0);
  const overcommitted = clone(CONTENT);
  overcommitted.opening.allocation = { serving: 5 * RESOURCE_SCALE, development: 0, research: 0 };
  assert.ok(validateContent(overcommitted).length > 0);
});

test('W0-E01: one settled week charges $800 rental and $200 overhead with no invented work or revenue', () => {
  const before = createPlayerOnlyState();
  const original = clone(before);
  const after = step(before);
  assert.deepEqual(before, original, 'advanceWeek must not mutate its input');
  assert.equal(after.week, 1);
  assert.equal(company(after).cashCents, 4_700_000);
  assert.equal(company(after).earnedRevenueCents, 0);
  assert.equal(company(after).lastWeek.operatingExpenseCents, 100_000);
  assert.equal(company(after).lastWeek.cashChangeCents, -100_000);
  assert.equal(after.slices.company.ledger.filter((entry) => entry.category === 'rent').reduce((sum, entry) => sum + entry.amountCents, 0), 80_000);
  assert.equal(after.slices.company.ledger.filter((entry) => entry.category === 'overhead').reduce((sum, entry) => sum + entry.amountCents, 0), 20_000);
  assert.deepEqual(fleet(after).lastWork, { serving: 0, development: 0, research: 0 });
  assert.equal(after.slices.markets.payingConsumers, 0);
  assert.equal(after.slices.markets.waitlistRemaining, 40);
});

test('W0-E02: ten weeks retain $38,000 before any hiring or revenue systems exist', () => {
  let state = createPlayerOnlyState();
  for (let week = 0; week < 10; week++) state = step(state);
  assert.equal(state.week, 10);
  assert.equal(company(state).cashCents, 3_800_000);
  assert.equal(company(state).totalOperatingExpenseCents, 1_000_000);
  assert.equal(company(state).arrearsCents, 0);
});

test('W0-E03: a real shortfall records unpaid bills without negative cash and blocks optional commands', () => {
  const lowCash: GameContent = clone(CONTENT);
  lowCash.opening.cashCents = 50_000;
  const state = step(createPlayerOnlyState(lowCash), lowCash);
  assert.equal(company(state).cashCents, 0);
  assert.equal(company(state).arrearsCents, 50_000);
  assert.equal(state.slices.company.ledger.reduce((sum, entry) => sum + entry.unpaidCents, 0), 50_000);
  const command = submitCommand(state, { kind: 'allocate_compute', serving: 0, development: 0, research: 0 }, lowCash);
  assert.equal(command.accepted, false);
  assert.equal(command.reason?.code, 'ARREARS');
  assert.deepEqual(command.state, state);
});

test('W0-E04: phase order is explicit and stable', () => {
  const state = step(createPlayerOnlyState());
  assert.deepEqual(state.lastTick?.phases.map((entry) => entry.phase), [...PHASES]);
  assert.equal(state.lastTick?.week, 1);
  assert.equal(state.lastTick?.chargedCents, 100_000);
  assert.equal(state.lastTick?.receivedCents, 0);
});

test('W0-E05: a release scheduled by resolve is unavailable until the next weekly commit', () => {
  const release: DomainModule = {
    id: 'fixture-release-producer',
    owns: [],
    handlers: {
      execute: (state) => ({ messages: [{ category: 'system', message: `fixture-status:${state.slices.models.versions[CONTENT.seedModel.id].status}` }] }),
      resolve: (_state, context) => context.week === 1 ? {
        schedule: [{ id: 'fixture-release', companyId: CONTENT.opening.companyId, dueWeek: 2, kind: 'model_release', targetId: CONTENT.seedModel.id }],
      } : {},
    },
  };
  const modules = [...createDefaultModules(CONTENT), release];
  const first = step(createPlayerOnlyState(), CONTENT, modules);
  assert.equal(first.slices.models.versions[CONTENT.seedModel.id].status, 'checkpoint');
  assert.ok(first.journal.some((entry) => entry.message === 'fixture-status:checkpoint'));
  assert.equal(first.scheduled.filter((entry) => entry.id === 'fixture-release').length, 1);
  const second = step(first, CONTENT, modules);
  assert.equal(second.slices.models.versions[CONTENT.seedModel.id].status, 'released');
  assert.ok(second.journal.some((entry) => entry.week === 2 && entry.message === 'fixture-status:released'));
  assert.equal(second.scheduled.filter((entry) => entry.id === 'fixture-release').length, 0);
});

test('W0-E06: delivery records inventory once without creating usable or rented capacity', () => {
  const initial = createPlayerOnlyState();
  initial.scheduled.push({
    id: 'fixture-delivery', companyId: initial.playerCompanyId, dueWeek: 1,
    kind: 'equipment_delivery', targetId: 'fixture-rack', quantityCU: 8 * RESOURCE_SCALE, memoryMU: 16 * RESOURCE_SCALE,
  });
  const arrived = step(initial);
  const later = step(arrived);
  assert.equal(fleet(later).deliveredEquipmentIds.filter((id) => id === 'fixture-rack').length, 1);
  assert.equal(fleet(later).cloudCU, 4 * RESOURCE_SCALE);
  assert.equal(fleet(later).ownedCU, 0);
  assert.equal(fleet(later).memoryMU, 8 * RESOURCE_SCALE);
  assert.deepEqual(fleet(later).inventory['fixture-rack'], { cu: 8 * RESOURCE_SCALE, memoryMU: 16 * RESOURCE_SCALE, arrivedWeek: 1 });
  assert.equal(company(later).lastWeek.operatingExpenseCents, 100_000);
});

test('W0-E07: duplicate economic facts settle once', () => {
  const costs: DomainModule = {
    id: 'fixture-duplicate-cost', owns: [],
    handlers: { execute: (_state, context) => {
      const fact = fixtureFact(context.week);
      return { facts: [fact, clone(fact)] };
    } },
  };
  const state = step(createPlayerOnlyState(), CONTENT, [...createDefaultModules(CONTENT), costs]);
  assert.equal(company(state).cashCents, 4_698_766);
  assert.equal(state.slices.company.ledger.filter((entry) => entry.id === 'fixture-fee:1').length, 1);
  assert.equal(state.slices.company.postedFacts['fixture-fee:1'], true);
});

test('W0-E08: forbidden cross-domain writes reject the entire tick', () => {
  const original = createPlayerOnlyState();
  const before = clone(original);
  const foreign: DomainModule = {
    id: 'fixture-foreign-writer', owns: [],
    handlers: { execute: (state) => ({ updates: { company: clone(state.slices.company) } }) },
  };
  const result = advanceWeek(original, CONTENT, [...createDefaultModules(CONTENT), foreign]);
  assert.equal(result.accepted, false);
  assert.equal(result.reason?.code, 'FOREIGN_SLICE_WRITE');
  assert.deepEqual(result.state, before);
  assert.deepEqual(original, before);
});

test('W0-E09: exceptions and direct snapshot mutation cannot partly commit a week', () => {
  const original = createPlayerOnlyState();
  const before = clone(original);
  const throwing: DomainModule = {
    id: 'fixture-throws', owns: [], handlers: { resolve: () => { throw new Error('fixture failure'); } },
  };
  const rejected = advanceWeek(original, CONTENT, [...createDefaultModules(CONTENT), throwing]);
  assert.equal(rejected.accepted, false);
  assert.deepEqual(rejected.state, before);
  const mutating: DomainModule = {
    id: 'fixture-mutates', owns: [], handlers: { execute: (snapshot) => {
      snapshot.slices.company.companies[snapshot.playerCompanyId].cashCents = 0;
      return {};
    } },
  };
  const mutation = advanceWeek(original, CONTENT, [...createDefaultModules(CONTENT), mutating]);
  assert.equal(mutation.accepted, false);
  assert.deepEqual(mutation.state, before);
  assert.deepEqual(original, before);
});

test('W0-E10: duplicate registrations and invalid economic facts fail atomically', () => {
  const initial = createPlayerOnlyState();
  const modules = createDefaultModules(CONTENT);
  const duplicate = advanceWeek(initial, CONTENT, [...modules, modules[0]]);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason?.code, 'DUPLICATE_MODULE');
  assert.deepEqual(duplicate.state, initial);
  const invalid: DomainModule = {
    id: 'fixture-invalid-cost', owns: [], handlers: { execute: (_state, context) => ({ facts: [fixtureFact(context.week, -1)] }) },
  };
  const cost = advanceWeek(initial, CONTENT, [...modules, invalid]);
  assert.equal(cost.accepted, false);
  assert.deepEqual(cost.state, initial);
  const conflict: DomainModule = {
    id: 'fixture-conflicting-cost', owns: [], handlers: { execute: (_state, context) => ({ facts: [fixtureFact(context.week), fixtureFact(context.week, 5678)] }) },
  };
  const conflicting = advanceWeek(initial, CONTENT, [...modules, conflict]);
  assert.equal(conflicting.accepted, false);
  assert.equal(conflicting.reason?.code, 'INVALID_FACT');
  assert.deepEqual(conflicting.state, initial);
});

test('W0-E11: an unsafe owned-slice update aborts before settlement can hide it', () => {
  const initial = createPlayerOnlyState();
  const before = clone(initial);
  const defaults = createDefaultModules(CONTENT);
  const companyOwner = defaults.find((module) => module.owns.includes('company'))!;
  let settlementReached = false;
  const unsafeOwner: DomainModule = {
    ...companyOwner,
    handlers: {
      ...companyOwner.handlers,
      execute: (state, context) => {
        const result = companyOwner.handlers.execute!(state, context);
        const updated = clone(state.slices.company);
        updated.companies[state.playerCompanyId].cashCents = Number.MAX_SAFE_INTEGER + 1;
        return { ...result, updates: { company: updated } };
      },
      settle: (state, context) => {
        settlementReached = true;
        return companyOwner.handlers.settle!(state, context);
      },
    },
  };
  const result = advanceWeek(initial, CONTENT, defaults.map((module) => module === companyOwner ? unsafeOwner : module));
  assert.equal(result.accepted, false);
  assert.equal(settlementReached, false, 'unsafe intermediate money must not reach another economic phase');
  assert.deepEqual(result.state, before);
  assert.deepEqual(initial, before);
});

test('W0-E12: a scheduled model release must belong to the model owner', () => {
  const initial = createPlayerOnlyState();
  const otherCompanyId = 'fixture-other-company';
  initial.slices.company.companies[otherCompanyId] = { ...clone(company(initial)), id: otherCompanyId, name: 'Other Lab' };
  initial.slices.company.founderAssignments[otherCompanyId] = clone(initial.slices.company.founderAssignments[initial.playerCompanyId]);
  initial.slices.compute.fleets[otherCompanyId] = { ...clone(fleet(initial)), companyId: otherCompanyId };
  assert.deepEqual(validateState(initial), [], 'the second company is valid before the foreign release is added');
  const before = clone(initial);
  const release = {
    id: 'fixture-foreign-release', companyId: otherCompanyId, dueWeek: 2,
    kind: 'model_release' as const, targetId: CONTENT.seedModel.id,
  };
  const producer: DomainModule = {
    id: 'fixture-foreign-release-producer', owns: [],
    handlers: { resolve: () => ({ schedule: [release] }) },
  };
  const result = advanceWeek(initial, CONTENT, [...createDefaultModules(CONTENT), producer]);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.state, before);
  assert.deepEqual(initial, before);

  const invalidSavedState = clone(initial);
  invalidSavedState.scheduled.push({ ...release, dueWeek: 1 });
  assert.ok(validateState(invalidSavedState).length > 0);
  const rejected = advanceWeek(invalidSavedState);
  assert.equal(rejected.accepted, false);
  assert.deepEqual(rejected.state, invalidSavedState);
  assert.equal(rejected.state.slices.models.versions[CONTENT.seedModel.id].status, 'checkpoint');
});

test('W0-E13: all reserve requests precede owner grants and execution sees the complete grants', () => {
  const initial = createPlayerOnlyState();
  const before = clone(initial);
  const trace: string[] = [];
  const requests: WorkRequest[] = ['fixture-work-a', 'fixture-work-b'].map((id) => ({
    id, companyId: initial.playerCompanyId, taskId: `${id}-task`, category: 'development',
    normalizedWorkCUw: RESOURCE_SCALE, memoryMU: RESOURCE_SCALE, priority: 1,
    poolId: 'general-cloud', staffDemand: [{ role: 'research', staffWeeks: 0 }],
  }));
  const requestIds = requests.map((request) => request.id);
  const defaults = createDefaultModules(CONTENT);
  const companyOwner = defaults.find((module) => module.owns.includes('company'))!;
  const computeOwner = defaults.find((module) => module.owns.includes('compute'))!;
  const staffGranter: DomainModule = {
    ...companyOwner,
    grantResources: (_state, context) => {
      trace.push('grant:staff');
      assert.equal(context.phase, 'reserve');
      assert.deepEqual(context.resources.requests.map((request) => request.id), requestIds);
      assert.deepEqual(context.resources.computeGrants, []);
      return { staffGrants: requests.map((request) => ({ requestId: request.id, grants: [{ role: 'research', staffWeeks: 0 }] })) };
    },
  };
  const computeGranter: DomainModule = {
    ...computeOwner,
    grantResources: (_state, context) => {
      trace.push('grant:compute');
      assert.equal(context.phase, 'reserve');
      assert.deepEqual(context.resources.requests.map((request) => request.id), requestIds);
      assert.deepEqual(context.resources.staffGrants.map((grant) => grant.requestId), requestIds);
      return { computeGrants: requests.map((request) => ({
        requestId: request.id, physicalCUw: RESOURCE_SCALE, hardwareEffectiveCUw: RESOURCE_SCALE,
        memoryMU: RESOURCE_SCALE, poolId: request.poolId,
      })) };
    },
  };
  const producer = (request: WorkRequest): DomainModule => ({
    id: `${request.id}-producer`, owns: [],
    handlers: {
      reserve: (_state, context) => {
        trace.push(`reserve:${request.id}`);
        assert.deepEqual(context.resources.computeGrants, []);
        assert.deepEqual(context.resources.staffGrants, []);
        return { workRequests: [request] };
      },
      execute: (_state, context) => {
        trace.push(`execute:${request.id}`);
        assert.deepEqual(context.resources.requests.map((item) => item.id), requestIds);
        assert.deepEqual(context.resources.computeGrants.map((grant) => grant.requestId), requestIds);
        assert.deepEqual(context.resources.staffGrants.map((grant) => grant.requestId), requestIds);
        assert.equal(context.resources.computeGrants.reduce((sum, grant) => sum + grant.physicalCUw, 0), 2 * RESOURCE_SCALE);
        return {};
      },
    },
  });
  // Register the granting owners before the request producers. The engine must
  // still gather every reserve request before invoking either granting hook.
  const modules = [
    ...defaults.map((module) => module === companyOwner ? staffGranter : module === computeOwner ? computeGranter : module),
    ...requests.map(producer),
  ];
  const after = step(initial, CONTENT, modules);
  assert.deepEqual(trace, ['reserve:fixture-work-a', 'reserve:fixture-work-b', 'grant:staff', 'grant:compute', 'execute:fixture-work-a', 'execute:fixture-work-b']);
  assert.deepEqual(initial, before);
  assert.equal(company(after).cashCents, 4_700_000);
});

test('W0-A01: a queued command applies at the next boundary rather than on submission', () => {
  const initial = createPlayerOnlyState();
  const result = submitCommand(initial, { kind: 'rename_company', name: 'The Small Lab' }, CONTENT, 'rename-once');
  assert.equal(result.accepted, true, result.reason?.message);
  assert.equal(company(result.state).name, company(initial).name);
  assert.equal(result.state.queuedCommands.length, 1);
  assert.equal(result.state.queuedCommands[0].issuedForWeek, 1);
  const next = step(result.state);
  assert.equal(company(next).name, 'The Small Lab');
  assert.equal(next.commandReceipts['rename-once'].status, 'accepted');
  assert.equal(next.queuedCommands.length, 0);
});

test('W0-A02: duplicate pending and committed command IDs never create a second action', () => {
  const payload: CommandPayload = { kind: 'rename_company', name: 'One Name' };
  const first = submitCommand(createPlayerOnlyState(), payload, CONTENT, 'same-command');
  assert.equal(first.accepted, true);
  const pending = submitCommand(first.state, payload, CONTENT, 'same-command');
  assert.deepEqual(pending.state, first.state);
  const settled = step(first.state);
  const again = submitCommand(settled, payload, CONTENT, 'same-command');
  assert.deepEqual(again.state, settled);
  assert.equal(Object.values(again.state.commandReceipts).filter((receipt) => receipt.id === 'same-command').length, 1);
});

test('W0-A03: allocations are capacity ceilings, preserve rental cost, and perform no fabricated work', () => {
  const initial = createPlayerOnlyState();
  const payload: CommandPayload = { kind: 'allocate_compute', serving: RESOURCE_SCALE, development: 2 * RESOURCE_SCALE, research: RESOURCE_SCALE };
  const quoted = previewCommand(initial, payload);
  assert.equal(quoted.accepted, true);
  assert.equal(quoted.weeklyCostCents, 100_000);
  const submitted = submitCommand(initial, payload);
  assert.equal(submitted.accepted, true);
  const result = step(submitted.state);
  assert.deepEqual(fleet(result).allocation, { serving: RESOURCE_SCALE, development: 2 * RESOURCE_SCALE, research: RESOURCE_SCALE });
  assert.deepEqual(fleet(result).lastWork, { serving: 0, development: 0, research: 0 });
  assert.equal(company(result).lastWeek.operatingExpenseCents, 100_000);
});

test('W0-A04: invalid or overcommitted commands spend no resources and consume no IDs or draws', () => {
  const initial = createPlayerOnlyState();
  const cases: CommandPayload[] = [
    { kind: 'allocate_compute', serving: -1, development: 0, research: 0 },
    { kind: 'allocate_compute', serving: 0.5, development: 0, research: 0 },
    { kind: 'allocate_compute', serving: Number.NaN, development: 0, research: 0 },
    { kind: 'allocate_compute', serving: Number.POSITIVE_INFINITY, development: 0, research: 0 },
    { kind: 'allocate_compute', serving: 5 * RESOURCE_SCALE, development: 0, research: 0 },
    { kind: 'rename_company', name: '   ' },
    { kind: 'invent_money', amount: 1000 } as unknown as CommandPayload,
  ];
  for (const payload of cases) {
    const rejected = submitCommand(initial, payload);
    assert.equal(rejected.accepted, false, JSON.stringify(payload));
    assert.ok(rejected.reason?.message);
    assert.deepEqual(rejected.state, initial);
  }
});

test('W0-A05: repeated forecasts and diagnostics are read-only', () => {
  const initial = createPlayerOnlyState();
  initial.random['fixture:attempt-1'] = { state: 12345, draws: 7 };
  const before = clone(initial);
  const payload: CommandPayload = { kind: 'allocate_compute', serving: 0, development: 3 * RESOURCE_SCALE, research: RESOURCE_SCALE };
  const first = previewCommand(initial, payload);
  assert.equal(first.sourceRevision, initial.revision);
  for (let i = 0; i < 10; i++) assert.deepEqual(previewCommand(initial, payload), first);
  const diagnostic = runDiagnostics(initial);
  assert.equal(diagnostic.ok, true, JSON.stringify(diagnostic.checks));
  assert.ok(diagnostic.checks.length > 0);
  assert.deepEqual(initial, before);
});

test('W0-A06: command admission rejects exhausted safe counters without changing state', () => {
  for (const counter of ['nextId', 'revision'] as const) {
    const initial = createPlayerOnlyState();
    initial[counter] = Number.MAX_SAFE_INTEGER;
    assert.deepEqual(validateState(initial), [], `${counter} is valid before an increment is requested`);
    const before = clone(initial);
    const result = submitCommand(initial, { kind: 'rename_company', name: 'Counter Boundary Lab' }, CONTENT, 'fixture-counter-command');
    assert.equal(result.accepted, false, `${counter} must not increment outside the safe integer range`);
    assert.ok(result.reason?.message);
    assert.deepEqual(result.state, before);
    assert.deepEqual(initial, before);
  }
});

test('W0-R01: a hundred-command replay produces identical intermediate and final state', () => {
  const play = () => {
    let state = createPlayerOnlyState();
    const hashes: string[] = [];
    for (let index = 0; index < 100; index++) {
      const serving = (index % 3) * RESOURCE_SCALE;
      const payload: CommandPayload = index % 2 === 0
        ? { kind: 'rename_company', name: `Lab ${index}` }
        : { kind: 'allocate_compute', serving, development: 4 * RESOURCE_SCALE - serving, research: 0 };
      const result = submitCommand(state, payload, CONTENT, `replay-${index}`);
      assert.equal(result.accepted, true, result.reason?.message);
      state = result.state;
      if ((index + 1) % 5 === 0) {
        state = step(state);
        hashes.push(canonicalStateHash(state));
      }
    }
    return { state, hashes };
  };
  const first = play();
  const second = play();
  assert.deepEqual(first, second);
  assert.equal(first.state.week, 20);
  assert.equal(company(first.state).cashCents, 2_800_000);
  assert.equal(first.state.queuedCommands.length, 0);
});

test('W0-R02: named random streams replay, survive snapshots, and remain independent', () => {
  const initial = createPlayerOnlyState();
  const first = drawNamed(initial, 'candidate-a:stage-1:attempt-1');
  const repeated = drawNamed(initial, 'candidate-a:stage-1:attempt-1');
  assert.equal(first.value, repeated.value);
  assert.deepEqual(first.state, repeated.state);
  assert.ok(first.value >= 0 && first.value < 1);
  assert.deepEqual(initial.random, {});
  const interleaved = drawNamed(drawNamed(initial, 'unrelated-job:attempt-1').state, 'candidate-a:stage-1:attempt-1');
  assert.equal(interleaved.value, first.value);
  const restored = deserializeState(serializeState(first.state));
  if (!restored.ok) throw new Error(restored.error);
  const nextOriginal = drawNamed(first.state, 'candidate-a:stage-1:attempt-1');
  const nextRestored = drawNamed(restored.state, 'candidate-a:stage-1:attempt-1');
  assert.equal(nextOriginal.value, nextRestored.value);
  assert.deepEqual(nextOriginal.state.random, nextRestored.state.random);
});

test('W0-R03: module draws persist and replay only when their entire tick commits', () => {
  const randomModule = (id: string): DomainModule => ({
    id, owns: [], handlers: { execute: (_state, context) => {
      const value = context.random.draw('candidate-a:attempt-1');
      assert.ok(value >= 0 && value < 1);
      return { messages: [{ category: 'system', message: `${id} drew ${value}` }] };
    } },
  });
  const fixture = randomModule('fixture-module-random');
  const modules = [...createDefaultModules(CONTENT), fixture];
  const initial = createPlayerOnlyState();
  const before = clone(initial);
  const first = step(initial, CONTENT, modules);
  assert.deepEqual(initial, before);
  assert.equal(first.random['fixture-module-random:candidate-a:attempt-1'].draws, 1);
  assert.deepEqual(step(initial, CONTENT, modules), first);

  const restored = deserializeState(serializeState(first));
  if (!restored.ok) throw new Error(restored.error);
  const second = step(first, CONTENT, modules);
  assert.deepEqual(step(restored.state, CONTENT, modules), second);
  assert.equal(second.random['fixture-module-random:candidate-a:attempt-1'].draws, 2);

  const namespaced = step(initial, CONTENT, [...modules, randomModule('fixture-other-module')]);
  assert.equal(Object.keys(namespaced.random).length, 2);
  assert.deepEqual(namespaced.random['fixture-module-random:candidate-a:attempt-1'], first.random['fixture-module-random:candidate-a:attempt-1']);

  const failAfterDraw: DomainModule = {
    id: 'fixture-fails-after-draw', owns: [], handlers: { resolve: () => { throw new Error('Reject after a random draw.'); } },
  };
  const rejected = advanceWeek(first, CONTENT, [...modules, failAfterDraw]);
  assert.equal(rejected.accepted, false);
  assert.deepEqual(rejected.state, first, 'rollback must preserve the saved random draw count as well as economic state');
  assert.equal(first.random['fixture-module-random:candidate-a:attempt-1'].draws, 1);
});

test('W0-N01: work at token scale remains exact and safe', () => {
  assert.equal(toUnits(0.0002), 200_000);
  assert.equal(fromUnits(200_000), 0.0002);
  const input = mulDiv(500, toUnits(0.0002), 1000);
  const output = mulDiv(100, toUnits(0.001), 1000);
  assert.equal(input + output, 200_000);
  assert.equal(mulDiv(2_000_000_000, 2_000_000_000, 1_000_000_000), 4_000_000_000);
  assert.equal(mulDiv(1, 1, 3, 'floor'), 0);
  assert.equal(mulDiv(1, 1, 3, 'ceil'), 1);
  assert.equal(mulDiv(2, 1, 3, 'nearest'), 1);
  assert.throws(() => checkedInteger(Number.MAX_SAFE_INTEGER + 1));
  assert.throws(() => checkedInteger(-1));
  assert.throws(() => toUnits(Number.POSITIVE_INFINITY));
  assert.throws(() => mulDiv(Number.MAX_SAFE_INTEGER, 2, 1));
  assert.throws(() => mulDiv(1, 1, 0));
});

test('W0-N02: fractional operating amounts accumulate rather than vanishing each step', () => {
  let whole = 0;
  let carry = 0;
  for (let i = 0; i < 10; i++) {
    const accumulated = accumulateFraction(1, 10, carry);
    whole += accumulated.whole;
    carry = accumulated.remainder;
  }
  assert.equal(whole, 1);
  assert.equal(carry, 0);
  assert.throws(() => accumulateFraction(1, 10, 10));
});

test('W0-N03: checked addition rejects unsafe operands even when the sum is safe', () => {
  const unsafe = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(Number.isSafeInteger(unsafe - 1), true, 'the fixture result is representable despite its unsafe operand');
  assert.throws(() => checkedAdd(unsafe, -1));
  assert.throws(() => checkedAdd(-1, unsafe));
  assert.throws(() => checkedAdd(0.5, 0.5));
  assert.equal(checkedAdd(Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER), 0);
  assert.equal(checkedAdd(10, -3), 7);
});

test('W0-S01: snapshot roundtrip preserves commands, schedules, draws, and the next exact week', () => {
  let state = step(createPlayerOnlyState());
  state = drawNamed(state, 'saved-job:attempt-1').state;
  const queued = submitCommand(state, { kind: 'rename_company', name: 'Restored Lab' }, CONTENT, 'pending-saved-command');
  assert.equal(queued.accepted, true);
  state = queued.state;
  state.scheduled.push({ id: 'saved-delivery', companyId: state.playerCompanyId, dueWeek: 3, kind: 'equipment_delivery', targetId: 'saved-rack', quantityCU: 8 * RESOURCE_SCALE, memoryMU: 16 * RESOURCE_SCALE });
  const restored = deserializeState(serializeState(state));
  if (!restored.ok) throw new Error(restored.error);
  assert.deepEqual(restored.state, state);
  assert.deepEqual(step(restored.state), step(state));
});

test('W0-S02: bad JSON and a changed payload are rejected without replacing the current state', () => {
  const state = createPlayerOnlyState();
  const original = clone(state);
  assert.equal(deserializeState('{not valid json').ok, false);
  const text = serializeState(state);
  const corrupted = text.replace(/("cashCents"\s*:\s*)4800000/, (_match, prefix: string) => `${prefix}4800001`);
  assert.notEqual(corrupted, text, 'fixture must actually alter the saved cash');
  assert.equal(deserializeState(corrupted).ok, false);
  assert.deepEqual(state, original);
});

test('W0-S03: incompatible versions and unsafe or impossible state fail validation', () => {
  const envelope = JSON.parse(serializeState(createPlayerOnlyState()));
  envelope.schemaVersion = 999;
  assert.equal(deserializeState(JSON.stringify(envelope)).ok, false);
  envelope.schemaVersion = 1;
  envelope.contentVersion = 'unrecognized-content';
  assert.equal(deserializeState(JSON.stringify(envelope)).ok, false);
  const version = createPlayerOnlyState();
  version.schemaVersion = 999;
  assert.ok(validateState(version).length > 0);
  const contentVersion = createPlayerOnlyState();
  contentVersion.contentVersion = 'unrecognized-content';
  assert.ok(validateState(contentVersion).length > 0);
  const invalid = createPlayerOnlyState();
  fleet(invalid).cloudCU = -1;
  assert.ok(validateState(invalid).length > 0);
  const overflow = createPlayerOnlyState();
  company(overflow).cashCents = Number.MAX_SAFE_INTEGER + 1;
  assert.ok(validateState(overflow).length > 0);
  const result = advanceWeek(invalid);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.state, invalid);
});

test('W0-S04: imports reject malformed reports and incomplete model maps even with a matching checksum', () => {
  const state = step(createPlayerOnlyState());
  const original = clone(state);

  // The checksum detects accidental file changes; schema validation must also
  // reject a malformed payload whose checksum has been deliberately recomputed.
  const reportEnvelope = JSON.parse(serializeState(state));
  reportEnvelope.state.lastTick.phases = null;
  reportEnvelope.checksum = canonicalStateHash(reportEnvelope.state);
  assert.equal(deserializeState(JSON.stringify(reportEnvelope)).ok, false);

  const modelEnvelope = JSON.parse(serializeState(state));
  delete modelEnvelope.state.slices.models.versions[CONTENT.seedModel.id].capabilityBps.tools;
  modelEnvelope.checksum = canonicalStateHash(modelEnvelope.state);
  assert.equal(deserializeState(JSON.stringify(modelEnvelope)).ok, false);
  assert.deepEqual(state, original);
});
