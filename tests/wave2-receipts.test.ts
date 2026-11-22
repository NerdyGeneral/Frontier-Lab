import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import type { DomainModule, GameState, LedgerFact, ModuleContext } from '../src/contracts/types';
import { advanceWeek, createInitialState, runDiagnostics } from '../src/core/engine';
import { createDefaultModules } from '../src/core/foundation-modules';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';

function overhead(state: Readonly<GameState>, context: ModuleContext, recordedWeek = context.week): LedgerFact {
  return { id: `${state.playerCompanyId}:overhead:${recordedWeek}`, companyId: state.playerCompanyId,
    week: context.week, sourceId: 'founder-and-basic-overhead', category: 'overhead',
    amountCents: context.content.opening.overheadCentsPerWeek, label: 'Founder draw and basic overhead', kind: 'expense' };
}

test('W2-RECEIPTS: seeded operating companies pass 10,000 historical postings with conserved money, retained proofs, and no replay charges', () => {
  const content = structuredClone(CONTENT);
  // Fund the player's operating runway; competitors retain their authored scenario budgets.
  content.opening.cashCents = 100_000_000;
  let state = createInitialState(content);
  const proofs = ['capital:historical-build', 'data-purchase-historical', 'training-historical:setup',
    'research-historical:fee', 'preparation-historical:fee', 'recruit:historical', 'dismiss:historical', 'unknown-one-off:historical'];
  const audit: DomainModule = { id: 'receipt-audit-fixture', owns: [], handlers: { execute(snapshot, context) {
    // Re-emitting an identical current-week overhead fact must not charge it twice.
    const facts: LedgerFact[] = [overhead(snapshot, context)];
    if (context.week === 1) for (const id of proofs) facts.push({ id, companyId: snapshot.playerCompanyId,
      week: context.week, sourceId: 'historical-one-off-fixture', category: id.startsWith('capital:') ? 'capital' : 'operating',
      amountCents: 101, label: 'One-off proof fixture', kind: 'expense' });
    return { facts };
  } } };
  const modules = [...createDefaultModules(content), audit];
  const openingCash = Object.fromEntries(Object.entries(state.slices.company.companies).map(([id, company]) => [id, company.cashCents]));
  const totals = Object.fromEntries(Object.keys(openingCash).map(id => [id, { receipts: 0, paid: 0, unpaid: 0, operating: 0 }]));
  const historicalIds = new Set<string>();

  for (let week = 1; week <= 500; week++) {
    const result = advanceWeek(state, content, modules);
    assert.equal(result.accepted, true, `Week ${week}: ${result.reason?.message ?? ''}`);
    state = result.state;
    const posted = state.slices.company.ledger.filter(entry => entry.week === week);
    for (const entry of posted) {
      assert.equal(historicalIds.has(entry.id), false, 'A fact may enter the settled ledger only once.');
      historicalIds.add(entry.id);
      const total = totals[entry.companyId];
      if (entry.kind === 'receipt') total.receipts += entry.amountCents;
      else {
        total.paid += entry.paidCents; total.unpaid += entry.unpaidCents;
        if (entry.category !== 'capital') total.operating += entry.amountCents;
      }
    }
    assert.equal(posted.filter(entry => entry.id === `${state.playerCompanyId}:overhead:${week}`).length, 1);
    for (const [id, company] of Object.entries(state.slices.company.companies)) {
      const total = totals[id];
      assert.equal(company.cashCents, openingCash[id] + total.receipts - total.paid, id + ' cash must reconcile.');
      assert.equal(company.earnedRevenueCents, total.receipts, id + ' receipts must not be duplicated.');
      assert.equal(company.totalOperatingExpenseCents, total.operating, id + ' expenses must include unpaid bills.');
      assert.equal(company.arrearsCents, total.unpaid, id + ' arrears must reconcile.');
    }
  }

  assert.ok(historicalIds.size > 10_000, 'The regression must cross the old receipt-record limit.');
  assert.equal(state.slices.company.companies[state.playerCompanyId].arrearsCents, 0);
  assert.ok(Object.keys(state.slices.company.postedFacts).length < 500, 'Periodic receipts must follow retained history instead of campaign age.');
  for (const id of proofs) assert.equal(state.slices.company.postedFacts[id], true, id + ' must remain a permanent proof.');
  assert.equal(state.slices.company.postedFacts[`${state.playerCompanyId}:overhead:1`], undefined);
  for (const entry of state.slices.company.ledger) assert.equal(state.slices.company.postedFacts[entry.id], true);
  for (const invoice of state.slices.products.invoices) assert.equal(state.slices.company.postedFacts[invoice.id], true);
  const restored = deserializeState(serializeState(state, content), content);
  assert.equal(restored.ok, true);
  assert.equal(canonicalStateHash(restored.state), canonicalStateHash(state));

  // An old periodic ID cannot be relabeled with today's week after its receipt expires.
  const replay: DomainModule = { id: 'expired-receipt-replay', owns: [], handlers: {
    execute: (snapshot, context) => ({ facts: [overhead(snapshot, context, 1)] }),
  } };
  const beforeReplay = canonicalStateHash(state);
  const rejected = advanceWeek(state, content, [...createDefaultModules(content), replay]);
  assert.equal(rejected.accepted, false);
  assert.match(rejected.reason?.message ?? '', /periodic receipt.*settlement week/i);
  assert.equal(canonicalStateHash(rejected.state), beforeReplay);

  // Permanent proofs retain idempotency even after their original ledger row expires.
  const oneOffReplay: DomainModule = { id: 'one-off-receipt-replay', owns: [], handlers: {
    execute: (snapshot, context) => ({ facts: [{ id: proofs[0], companyId: snapshot.playerCompanyId,
      week: context.week, sourceId: 'historical-one-off-fixture', category: 'capital',
      amountCents: 101, label: 'One-off proof fixture', kind: 'expense' }] }),
  } };
  const baseline = advanceWeek(state, content);
  const replayed = advanceWeek(state, content, [...createDefaultModules(content), oneOffReplay]);
  assert.equal(baseline.accepted, true, baseline.reason?.message);
  assert.equal(replayed.accepted, true, replayed.reason?.message);
  assert.deepEqual(replayed.state.slices.company, baseline.state.slices.company);
  assert.equal(runDiagnostics(state, content).ok, true);
});
