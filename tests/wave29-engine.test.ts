import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, DomainModule, GameState, ModuleContext } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, createInitialState, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { createDefaultModules } from '../src/core/foundation-modules';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';

const opening = () => createInitialState(CONTENT, 'release');
const researchFounder = { research: U, ml: 0, data: 0, infrastructure: 0, commercial: 0, hardware: 0 };
const paidPlan: CommandPayload = { kind: 'apply_studio_plan', commands: [
  { kind: 'hire_staff', role: 'data' }, { kind: 'assign_founder', allocations: researchFounder },
] };
const dataRole = () => CONTENT.staff.find(role => role.id === 'data')!;
function queue(source: GameState, payload: CommandPayload) {
  const result = submitCommand(source, payload);
  assert.equal(result.accepted, true, result.reason?.message);
  assert.ok(result.commandId);
  return { state: result.state, id: result.commandId };
}
function step(source: GameState, modules?: readonly DomainModule[]) {
  const result = advanceWeek(source, CONTENT, modules);
  assert.equal(result.accepted, true, result.reason?.message);
  return result.state;
}

test('W29-E01: current cash and queued identity are revalidated after every public call, including a retained unaffordable quote', () => {
  const source = opening(), original = serializeState(source), owner = source.playerCompanyId;
  const payload: CommandPayload = { kind: 'hire_staff', role: 'data' };
  const quoted = previewCommand(source, payload);
  assert.equal(quoted.accepted, true);
  assert.equal(quoted.upfrontCostCents, dataRole().recruitmentCents);
  const queued = queue(source, payload);
  assert.equal(queued.state.queuedCommands.find(command => command.id === queued.id)!.reservedCents, quoted.upfrontCostCents);
  assert.equal(serializeState(source), original);
  const duplicate = submitCommand(queued.state, payload, CONTENT, queued.id);
  assert.equal(duplicate.reason?.code, 'DUPLICATE_COMMAND');
  assert.strictEqual(duplicate.state, queued.state);

  // A public caller may change its own object between calls; no validation or
  // approval may be remembered merely because its object identity is the same.
  source.slices.company.companies[owner].cashCents = 0;
  assert.deepEqual(validateState(source), []);
  const blocked = previewCommand(source, payload), rejected = submitCommand(source, payload);
  assert.equal(blocked.accepted, false); assert.equal(blocked.reason?.code, 'INSUFFICIENT_FUNDS');
  assert.equal(blocked.upfrontCostCents, quoted.upfrontCostCents);
  assert.equal(blocked.cashAfterCommitmentsCents, -quoted.upfrontCostCents);
  assert.deepEqual(rejected.reason, blocked.reason); assert.strictEqual(rejected.state, source);
  assert.equal(Object.isFrozen(source), false);
  assert.equal(Object.isFrozen(source.slices.company), false);
});

test('W29-E02: a paid Studio transaction keeps its exact quote, one recruitment fee and reload continuation', () => {
  const source = opening(), encoded = serializeState(source), owner = source.playerCompanyId;
  const preview = previewCommand(source, paidPlan), queued = queue(source, paidPlan);
  assert.equal(preview.accepted, true); assert.equal(preview.upfrontCostCents, dataRole().recruitmentCents);
  assert.equal(queued.state.queuedCommands.find(command => command.id === queued.id)!.reservedCents, preview.upfrontCostCents);
  const restored = deserializeState(serializeState(queued.state)); assert.ok(restored.ok);
  const first = step(queued.state), replay = step(restored.state);
  assert.equal(serializeState(first), serializeState(replay));
  assert.equal(first.commandReceipts[queued.id].status, 'accepted');
  assert.deepEqual(first.slices.company.founderAssignments[owner], source.slices.company.founderAssignments[owner],
    'a legacy founder setting inside the paid order does not override automatic contributions');
  const feeId = 'recruit:' + queued.id + ':plan:0', staffId = 'staff:' + queued.id + ':plan:0';
  assert.equal(first.slices.company.staff[staffId].role, 'data');
  assert.equal(first.slices.company.postedFacts[feeId], true);
  const second = step(first);
  const fees = second.slices.company.ledger.filter(fact => fact.id === feeId);
  assert.equal(fees.length, 1); assert.equal(fees[0].amountCents, preview.upfrontCostCents);
  assert.equal(submitCommand(second, paidPlan, CONTENT, queued.id).reason?.code, 'DUPLICATE_COMMAND');
  assert.equal(serializeState(source), encoded);
});

test('W29-E03: later handlers see replaced slices, commands, receipts, events and random draws from the same tick', () => {
  const source = opening(), queued = queue(source, { kind: 'rename_company', name: 'Queued lab' });
  const originalHash = canonicalStateHash(queued.state), owner = source.playerCompanyId;
  const defaults = createDefaultModules(CONTENT), company = defaults.find(module => module.id === 'company')!;
  let firstRead: Readonly<GameState> | undefined, commitRead: Readonly<GameState> | undefined;
  let emitted: GameState['slices']['company'] | undefined;
  let commitObserved = false, reserveObserved = false;
  const changedCompany: DomainModule = { ...company, handlers: { ...company.handlers,
    commit(snapshot, context) {
      firstRead = snapshot;
      context.random.draw('same-tick');
      const result = company.handlers.commit!(snapshot, context);
      emitted = structuredClone(result.updates?.company ?? snapshot.slices.company);
      emitted.companies[owner].name = 'Before queued command';
      return { ...result, updates: { ...result.updates, company: emitted },
        messages: [...result.messages ?? [], { category: 'system', message: 'Observe the committed slice.', companyId: owner }] };
    },
  } };
  const observer: DomainModule = { id: 'wave29-read-observer', owns: [], handlers: {
    commit(snapshot) {
      commitRead = snapshot;
      assert.ok(firstRead && emitted);
      assert.equal(snapshot.slices.company.companies[owner].name, 'Before queued command');
      assert.equal(firstRead.slices.company.companies[owner].name, source.slices.company.companies[owner].name);
      assert.equal(snapshot.random['company:same-tick'].draws, 1);
      assert.equal(firstRead.random['company:same-tick'], undefined);
      assert.equal(snapshot.queuedCommands.some(command => command.id === queued.id), true);
      assert.equal(snapshot.commandReceipts[queued.id], undefined);
      assert.equal(snapshot.journal.at(-1)?.message, 'Observe the committed slice.');
      // A module can retain its own result object, but later mutation of that
      // object must never alter the engine-owned replacement or frozen views.
      emitted.companies[owner].name = 'External result mutation';
      assert.equal(snapshot.slices.company.companies[owner].name, 'Before queued command');
      commitObserved = true; return {};
    },
    reserve(snapshot) {
      assert.ok(commitRead);
      assert.equal(snapshot.slices.company.companies[owner].name, 'Queued lab');
      assert.equal(snapshot.queuedCommands.some(command => command.id === queued.id), false);
      assert.equal(snapshot.commandReceipts[queued.id].status, 'accepted');
      assert.equal(snapshot.journal.at(-1)?.message, 'Company renamed to Queued lab.');
      assert.equal(commitRead.slices.company.companies[owner].name, 'Before queued command');
      assert.equal(commitRead.queuedCommands.some(command => command.id === queued.id), true);
      assert.equal(commitRead.commandReceipts[queued.id], undefined);
      reserveObserved = true; return {};
    },
  } };
  const modules = defaults.flatMap(module => module === company ? [changedCompany, observer] : [module]);
  const result = step(queued.state, modules);
  assert.equal(commitObserved, true); assert.equal(reserveObserved, true);
  assert.equal(result.slices.company.companies[owner].name, 'Queued lab');
  assert.equal(result.random['company:same-tick'].draws, 1);
  assert.equal(canonicalStateHash(queued.state), originalHash);
});

test('W29-E04: cached durable views and fresh coordinator/context fields reject attempted writes and preserve rollback identity', () => {
  const source = opening(), encoded = serializeState(source);
  const mutations: ((snapshot: Readonly<GameState>, context: ModuleContext) => void)[] = [
    snapshot => { snapshot.slices.company.companies[snapshot.playerCompanyId].cashCents = 0; },
    snapshot => { snapshot.slices.models.versions[CONTENT.seedModel.id].capabilityBps.documents = 0; },
    snapshot => { snapshot.commandReceipts.injected = { id: 'injected', week: snapshot.week, status: 'accepted' }; },
    snapshot => { snapshot.queuedCommands.push({ id: 'injected', companyId: snapshot.playerCompanyId, issuedForWeek: snapshot.week + 1, payload: { kind: 'hire_staff', role: 'data' } }); },
    snapshot => { snapshot.random.injected = { state: 1, draws: 0 }; },
    (_snapshot, context) => { context.content.opening.cashCents = 0; },
    (_snapshot, context) => { (context.facts as unknown as { amountCents: number }[]).push({ amountCents: 1 }); },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const mutationProbe: DomainModule = { id: 'wave29-mutation-' + index, owns: [], handlers: { execute(snapshot, context) { mutate(snapshot, context); return {}; } } };
    const result = advanceWeek(source, CONTENT, [...createDefaultModules(CONTENT), mutationProbe]);
    assert.equal(result.accepted, false, 'Mutation case ' + index);
    assert.strictEqual(result.state, source);
    assert.equal(serializeState(source), encoded);
  }
  assert.equal(Object.isFrozen(source.slices.models), false);
  assert.equal(Object.isFrozen(CONTENT.opening), false);
  assert.equal(advanceWeek(source).accepted, true, 'Rejected operations leave no cached failure or candidate state.');
});

test('W29-E05: both full validation boundaries still reject invalid caller state and invalid final module output', () => {
  const invalid = opening(); invalid.slices.company.companies[invalid.playerCompanyId].cashCents = -1;
  let invoked = false;
  const spy: DomainModule = { id: 'wave29-input-spy', owns: [], handlers: { commit() { invoked = true; return {}; } } };
  const badInput = advanceWeek(invalid, CONTENT, [...createDefaultModules(CONTENT), spy]);
  assert.equal(badInput.reason?.code, 'INVALID_STATE'); assert.strictEqual(badInput.state, invalid); assert.equal(invoked, false);
  const rejectedCommand = submitCommand(invalid, { kind: 'hire_staff', role: 'data' });
  assert.equal(rejectedCommand.reason?.code, 'INVALID_STATE'); assert.strictEqual(rejectedCommand.state, invalid);

  const source = opening(), before = canonicalStateHash(source), defaults = createDefaultModules(CONTENT);
  const owner = defaults.find(module => module.id === 'company')!;
  const badOutput: DomainModule = { ...owner, handlers: { ...owner.handlers, plan(snapshot) {
    const company = structuredClone(snapshot.slices.company); company.companies[snapshot.playerCompanyId].name = '';
    return { updates: { company } };
  } } };
  const result = advanceWeek(source, CONTENT, defaults.map(module => module === owner ? badOutput : module));
  assert.equal(result.accepted, false); assert.equal(result.reason?.code, 'INVARIANT_FAILED');
  assert.match(result.reason!.message, /Company name/); assert.strictEqual(result.state, source);
  assert.equal(canonicalStateHash(source), before);
});

test('W29-E06: a single authoritative commit quote still detects a mismatched charge and rolls back the whole week', () => {
  const queued = queue(opening(), { kind: 'hire_staff', role: 'data' }), before = serializeState(queued.state);
  const defaults = createDefaultModules(CONTENT), owner = defaults.find(module => module.id === 'company')!;
  let quotes = 0;
  const mismatched: DomainModule = { ...owner, quoteCommand(snapshot, command, content) {
    const quote = owner.quoteCommand!(snapshot, command, content); quotes++;
    return { ...quote, upfrontCostCents: quote.upfrontCostCents + 1 };
  } };
  const result = advanceWeek(queued.state, CONTENT, defaults.map(module => module === owner ? mismatched : module));
  assert.equal(result.accepted, false); assert.equal(result.reason?.code, 'INVALID_FACT');
  assert.equal(quotes, 1); assert.strictEqual(result.state, queued.state);
  assert.equal(serializeState(queued.state), before);
});

test('W29-E07: a failed later Studio child discards earlier hiring and fees while the ordinary week settles', () => {
  const source = opening(), baseline = step(source), queued = queue(source, paidPlan), encoded = serializeState(queued.state);
  const defaults = createDefaultModules(CONTENT), owner = defaults.find(module => module.id === 'company')!;
  let stagedHire = false;
  const malicious: DomainModule = { ...owner, applyCommand(snapshot, command, content) {
    if (command.payload.kind === 'hire_staff') stagedHire = true;
    if (command.payload.kind === 'assign_founder') {
      assert.equal(stagedHire, true);
      assert.ok(snapshot.slices.company.staff['staff:' + queued.id + ':plan:0']);
      snapshot.slices.company.companies[snapshot.playerCompanyId].cashCents = 0;
    }
    return owner.applyCommand!(snapshot, command, content);
  } };
  const result = step(queued.state, defaults.map(module => module === owner ? malicious : module));
  assert.equal(result.commandReceipts[queued.id].status, 'rejected');
  assert.equal(result.slices.company.staff['staff:' + queued.id + ':plan:0'], undefined);
  assert.equal(result.slices.company.postedFacts['recruit:' + queued.id + ':plan:0'], undefined);
  assert.equal(result.slices.company.companies[source.playerCompanyId].cashCents, baseline.slices.company.companies[source.playerCompanyId].cashCents);
  assert.deepEqual(result.slices.company.staff, baseline.slices.company.staff);
  assert.equal(serializeState(queued.state), encoded);
});

type Probe = Map<string, number> | Set<number> | Date;
type ProbedCompany = GameState['slices']['company'] & { probe: Probe };
const probes: { name: string; create: () => Probe; read: (probe: Probe) => number; mutate: (probe: Probe) => void }[] = [
  { name: 'Map', create: () => new Map([['value', 1]]), read: probe => (probe as Map<string, number>).get('value')!, mutate: probe => { (probe as Map<string, number>).set('value', 2); } },
  { name: 'Set', create: () => new Set([1]), read: probe => (probe as Set<number>).has(2) ? 2 : 1, mutate: probe => { (probe as Set<number>).add(2); } },
  { name: 'Date', create: () => new Date(1), read: probe => (probe as Date).getTime(), mutate: probe => { (probe as Date).setTime(2); } },
];
const probeOf = (snapshot: Readonly<GameState>) => (snapshot.slices.company as ProbedCompany).probe;

test('W29-E08: legacy extra Map, Set and Date fields retain per-handler copy isolation despite Object.freeze', () => {
  for (const probe of probes) {
    const source = opening(); Object.assign(source.slices.company, { probe: probe.create() });
    assert.deepEqual(validateState(source), [], probe.name + ' remains accepted by the existing state boundary.');
    let changed = false, observed = false;
    const writer: DomainModule = { id: 'wave29-exotic-writer', owns: [], handlers: { execute(snapshot) {
      assert.equal(Object.isFrozen(probeOf(snapshot)), true);
      probe.mutate(probeOf(snapshot)); assert.equal(probe.read(probeOf(snapshot)), 2);
      changed = true; return {};
    } } };
    const reader: DomainModule = { id: 'wave29-exotic-reader', owns: [], handlers: { execute(snapshot) {
      assert.equal(changed, true); assert.equal(probe.read(probeOf(snapshot)), 1, probe.name + ' leaked between handlers.');
      observed = true; return {};
    } } };
    const result = step(source, [...createDefaultModules(CONTENT), writer, reader]);
    assert.equal(observed, true); assert.equal(probe.read(probeOf(source)), 1); assert.equal(probe.read(probeOf(result)), 1);
  }
});

test('W29-E09: command validation cannot alter exotic fields seen by its quote or command application', () => {
  for (const probe of probes) {
    const source = opening(); Object.assign(source.slices.company, { probe: probe.create() });
    assert.deepEqual(validateState(source), []);
    const queued = queue(source, { kind: 'hire_staff', role: 'data' }), defaults = createDefaultModules(CONTENT);
    const owner = defaults.find(module => module.id === 'company')!;
    let quotes = 0, applied = false;
    const observedOwner: DomainModule = { ...owner,
      validateCommand(snapshot, command, content) {
        probe.mutate(probeOf(snapshot));
        return owner.validateCommand!(snapshot, command, content);
      },
      quoteCommand(snapshot, command, content) {
        assert.equal(probe.read(probeOf(snapshot)), 1, probe.name + ' leaked from validation into the quote.');
        quotes++; return owner.quoteCommand!(snapshot, command, content);
      },
      applyCommand(snapshot, command, content) {
        assert.equal(probe.read(probeOf(snapshot)), 1, probe.name + ' leaked into application.');
        applied = true; return owner.applyCommand!(snapshot, command, content);
      },
    };
    const result = step(queued.state, defaults.map(item => item === owner ? observedOwner : item));
    assert.equal(quotes, 1); assert.equal(applied, true); assert.equal(result.commandReceipts[queued.id].status, 'accepted');
    assert.equal(probe.read(probeOf(source)), 1); assert.equal(probe.read(probeOf(queued.state)), 1); assert.equal(probe.read(probeOf(result)), 1);
  }
});
