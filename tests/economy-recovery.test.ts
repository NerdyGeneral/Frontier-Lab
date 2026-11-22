import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CONTENT } from '../src/content/catalog';
import { CUSTOMER_BRIEFS } from '../src/content/customer-briefs';
import { RESOURCE_SCALE as U, type GameState, type LedgerEntry, type ModuleContext } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { createInitialState, validateState } from '../src/core/engine';
import { getGameView, getRecentRecurringRevenueCents } from '../src/core/selectors';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { briefPaymentId } from '../src/modules/customer-briefs';
import { planRivals } from '../src/modules/rivals';
import { NaturalBusinessCampaign, openNaturalBusiness } from './fixtures/wave5-business';

test('a paid consultancy pilot adds cash without turning a nonpaying service into infinite runway', () => {
  const lab = new NaturalBusinessCampaign(createInitialState(CONTENT, 'release', 'consultancy'), 'runway-pilot');
  lab.queue({ kind: 'prepare_data', packetId: CONTENT.starterData.id });
  lab.until(state => state.slices.data.packets[CONTENT.starterData.id].prepared, 2);
  const modelId = lab.train({ baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id });
  lab.evaluate(modelId, 'basic-conversation-1');
  lab.queue({ kind: 'deploy_product', modelId, priceCents: 1200, allowance: 100 });
  lab.until(state => state.slices.campaign.customerBriefs?.['consultancy-pilot']?.status === 'completed', 2);

  const fee = CUSTOMER_BRIEFS['consultancy-pilot'].feeCents, view = getGameView(lab.state);
  assert.equal(lab.week, 8);
  assert.equal(lab.company.lastWeek.revenueCents, fee);
  assert.equal(lab.company.earnedRevenueCents, fee, 'The one-time delivery remains earned income.');
  assert.equal(lab.company.cashCents, 3_260_000, 'The full pilot fee remains spendable cash.');
  assert.equal(getRecentRecurringRevenueCents(lab.state), 0);
  assert.equal(view.runwayWeeks, 25, 'Cash funds a finite 25 weeks at $1,300/week, not a self-funding company.');
  assert.equal(lab.state.slices.company.ledger.filter(entry => entry.id === briefPaymentId(lab.state.playerCompanyId, 'consultancy-pilot')).length, 1);
  assert.deepEqual(validateState(lab.state), []);
  const loaded = deserializeState(serializeState(lab.state)); assert.ok(loaded.ok);
  assert.equal(getGameView(loaded.state).runwayWeeks, 25);
  lab.step();
  assert.equal(lab.company.lastWeek.revenueCents, 0);
  assert.equal(getGameView(lab.state).runwayWeeks, 24);
});

test('mixed cash receipts retain recurring licenses, token bills and assurance after service credits', () => {
  const loaded = deserializeState(readFileSync(join(__dirname, 'fixtures', 'wave13-snapshot.json'), 'utf8'));
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  const state = loaded.state, company = state.slices.company.companies[state.playerCompanyId];
  // This published campaign earned $41,277.25 in public service, a $250 license,
  // and a $2,200 assured-service retainer in its latest settled week.
  assert.equal(getRecentRecurringRevenueCents(state), 4_372_725);
  const currentLicense = state.slices.products.commercialInvoices.find(invoice => invoice.companyId === state.playerCompanyId && invoice.week === state.week)!;
  assert.equal(currentLicense.contractKind, 'customer-hosted');
  assert.equal(currentLicense.amountCents, 25_000);
  assert.equal(state.slices.products.assuranceInvoices!.filter(invoice => invoice.companyId === state.playerCompanyId && invoice.week === state.week)
    .reduce((total, invoice) => total + invoice.amountCents, 0), 220_000);

  const oneTimeIds = ['brief-payment:company-player:launch-window', 'invoice:agent:review-job:' + state.week,
    'batch-invoice:batch:delivery', 'hardware-order:delivery:receipt', 'private-appliance:delivery:bundle-receipt'];
  const oneTime: LedgerEntry[] = oneTimeIds.map(id => ({ id, sourceId: id, companyId: state.playerCompanyId, week: state.week,
    kind: 'receipt', category: 'revenue', amountCents: 800_000, paidCents: 800_000, unpaidCents: 0, label: 'One-time delivery' }));
  state.slices.company.ledger.push(...oneTime);
  const windfall = oneTime.reduce((sum, entry) => sum + entry.amountCents, 0);
  company.cashCents += windfall; company.earnedRevenueCents += windfall; company.lastWeek.revenueCents += windfall;
  company.lastWeek.cashChangeCents += windfall;
  // Neither another company's invoices nor a previous/future billing week is projected.
  const invoice = state.slices.products.invoices.find(item => item.companyId === state.playerCompanyId && item.week === state.week)!;
  state.slices.products.invoices.push({ ...invoice, id: 'foreign-service', companyId: 'rival-swift', amountCents: 999_999 },
    { ...invoice, id: 'previous-service', week: state.week - 1, amountCents: 999_999 },
    { ...invoice, id: 'future-service', week: state.week + 1, amountCents: 999_999 });
  const before = canonicalStateHash(state), balance = company.cashCents;
  assert.equal(getRecentRecurringRevenueCents(state), 4_372_725);
  assert.equal(getGameView(state).availableCashCents, balance);
  assert.equal(company.lastWeek.revenueCents, 4_372_725 + windfall);
  assert.equal(canonicalStateHash(state), before, 'Projection must not rewrite cash, receipts or revenue.');
  state.slices.company.ledger = [];
  assert.equal(getRecentRecurringRevenueCents(state), 4_372_725, 'A busy week can evict receipts from the bounded ledger without losing service income.');

  // Keep the named recurring license even when it is the only source of income.
  state.slices.products.invoices = []; state.slices.products.assuranceInvoices = [];
  state.slices.products.commercialInvoices = [currentLicense];
  assert.equal(getRecentRecurringRevenueCents(state), 25_000);
});

function preservesPaidWorkDuringRepair(source: GameState, companyId: string, category: 'research' | 'development') {
  const state = structuredClone(source), rival = state.slices.markets.rivals[companyId];
  // Planning-only fault injection: a low-cash rival must repair its zeroed
  // allocations without forgetting an already funded, unfinished project.
  state.slices.company.companies[companyId].cashCents = 1;
  state.queuedCommands = state.queuedCommands.filter(command => command.companyId !== companyId);
  rival.nextPlanWeek = state.week; rival.lastPriceWeek = state.week;
  state.slices.compute.fleets[companyId].allocation = { serving: 0, development: 0, research: 0 };
  const context: ModuleContext = { week: state.week, phase: 'plan', content: CONTENT, facts: [],
    resources: { requests: [], staffGrants: [], computeGrants: [] }, random: { draw: () => assert.fail('Planning must not reroll.') } };
  const result = planRivals(state, context), action = result.commands?.find(command => command.companyId === companyId)?.payload;
  assert.equal(action?.kind, 'allocate_compute');
  assert.ok(action?.kind === 'allocate_compute');
  assert.ok(action[category] >= U, 'The paid ' + category + ' project keeps capacity during cash recovery.');
  assert.equal(result.updates?.company, undefined, 'A capacity plan cannot grant a cash subsidy.');
  assert.equal(result.facts, undefined);
}

test('a natural rival releases idle rentals and survives recovery while paid engineering remains funded', () => {
  const lab = openNaturalBusiness('release'), owner = 'rival-harbor';
  let reducedRental = false, researchChecked = false, developmentChecked = false, recoveredRental = false;
  const completedModelWork = () => Object.values(lab.state.slices.models.trainingRuns).some(run => run.companyId === owner && run.status === 'complete');
  // A systems foundation has a real 640-CUw budget; recovery must preserve it
  // through completion rather than require the former short calibration job by Week 130.
  for (; lab.week < 360 && (lab.week < 130 || !completedModelWork());) {
    const state = lab.state, fleet = state.slices.compute.fleets[owner];
    assert.ok(state.slices.campaign.progression && state.slices.markets.rivals[owner].campaign?.systems, 'Exercise the current paid systems policy.');
    reducedRental ||= state.queuedCommands.some(command => command.companyId === owner && command.payload.kind === 'set_cloud_capacity' && command.payload.cu < fleet.cloudCU);
    recoveredRental ||= reducedRental && fleet.cloudCU < 16 * U;
    if (!researchChecked && Object.values(state.slices.research.projects).some(project => project.companyId === owner && project.status === 'running')) {
      preservesPaidWorkDuringRepair(state, owner, 'research'); researchChecked = true;
    }
    if (!developmentChecked && Object.values(state.slices.models.trainingRuns).some(run => run.companyId === owner && run.status === 'running')) {
      preservesPaidWorkDuringRepair(state, owner, 'development'); developmentChecked = true;
    }
    lab.step();
    assert.equal(lab.state.slices.company.companies[owner].arrearsCents, 0, 'Harbor failed in Week ' + lab.week);
  }
  assert.ok(reducedRental, 'Cash recovery must release paid capacity, not endlessly reset its allocation.');
  assert.ok(researchChecked && developmentChecked, 'Exercise serving repair while both kinds of paid work are unfinished.');
  assert.ok(lab.state.slices.company.companies[owner].cashCents > 0);
  assert.equal(lab.state.slices.markets.rivals[owner].withdrawn, false);
  assert.ok(recoveredRental, 'Recovery releases idle rentals; a later funded foundation may need to rent more memory again.');
  assert.ok(completedModelWork(), 'Paid model work must finish after recovering, not remain stranded indefinitely.');
  assert.deepEqual(validateState(lab.state), []);
});
