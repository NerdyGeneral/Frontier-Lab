import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek, createInitialState, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { qualifiesForEnding } from '../src/modules/campaign-progress';
import type { GameState } from '../src/contracts/types';
import type { EndingId } from '../src/contracts/wave4-campaign';
import { getMarketView } from '../src/modules/markets';
import { createDefaultModules } from '../src/core/foundation-modules';
import { rivalTacticFor } from '../src/modules/rival-tactics';
import { rivalOperatingBudget } from '../src/modules/rivals';
import { openNaturalBusiness, playNaturalBusiness } from './fixtures/wave5-business';
import { continueToFrontier } from './fixtures/wave5-frontier';

function verifyCampaign(state: GameState, id: EndingId) {
  const ending = state.slices.campaign.endings[id];
  assert.ok(ending, id);
  assert.equal(state.slices.campaign.rules, 'release');
  assert.ok(ending.proof.every(row => qualifiesForEnding(row, id, 'release') && row.arrearsCents === 0));
  const bytes = serializeState(state);
  const loaded = deserializeState(bytes);
  assert.ok(loaded.ok);
  assert.equal(serializeState(loaded.state), bytes);
  const continued = advanceWeek(loaded.state);
  assert.ok(continued.accepted);
  assert.deepEqual(continued.state.slices.campaign.endings[id], ending);
  console.log(id + ' earned in Week ' + ending.achievedWeek);
}

test('W21-R01: a fresh platform serves consumer and developer customers without a business product', () => {
  const { lab } = playNaturalBusiness(undefined, 'release', 'platform');
  assert.ok(lab.minimumCashCents > 0);
  assert.ok(lab.offers().every(offer => offer.kind !== 'business-docs'));
  verifyCampaign(lab.state, 'platform');
});

test('W21-R02: a fresh specialist competes for a buyer, delivers its licensed weights and renews', () => {
  const { lab } = playNaturalBusiness(undefined, 'release', 'specialist');
  assert.ok(lab.minimumCashCents > 0);
  const contract = lab.state.slices.products.commercialContracts['business:vector-studio'];
  assert.equal(contract.companyId, lab.state.playerCompanyId);
  assert.ok(contract.termIndex > 1);
  assert.equal(contract.lastUsage?.physicalWorkCUw, 0);
  verifyCampaign(lab.state, 'specialist');
});

test('W21-R03: a fresh frontier company funds hardware and delivers a held-out frontier model', () => {
  const opening = openNaturalBusiness('release').funded(30_000_000);
  const lab = continueToFrontier(opening.state);
  assert.ok(opening.minimumCashCents > 0 && lab.minimumCashCents > 0);
  assert.ok(lab.commands.some(command => command.payload.kind === 'order_rack'));
  verifyCampaign(lab.state, 'frontier');
});

test('W20-R01: rivals use ordinary commands, finite buyers and the same quoted terms', () => {
  const lab = openNaturalBusiness('release');
  const modules = createDefaultModules(CONTENT);
  const priceChanges: { companyId: string; from: number; to: number }[] = [];
  for (let week = 0; week < 60; week++) {
    const pending = lab.state.queuedCommands.filter(command => command.companyId !== lab.state.playerCompanyId);
    const priorPrices = new Map(Object.values(lab.state.slices.products.contracts).map(contract => [contract.productId, contract.weeklyPriceCents]));
    for (const command of pending) {
      const module = modules.find(owner => owner.commandKinds?.includes(command.payload.kind)); assert.ok(module?.quoteCommand);
      const quote = module.quoteCommand(lab.state, command, CONTENT);
      assert.equal(command.reservedCents ?? 0, quote.upfrontCostCents, 'A rival reserves the same entry fee as an ordinary command.');
      assert.ok(quote.upfrontCostCents <= lab.state.slices.company.companies[command.companyId].cashCents, 'A queued rival action must be funded.');
      const budget = rivalOperatingBudget(lab.state, command.companyId, CONTENT);
      assert.ok(quote.upfrontCostCents + Math.max(0, quote.weeklyCostDeltaCents) * 8 <= budget.budget + (command.reservedCents ?? 0),
        'The current systems plan protects its operating reserve and funds eight weeks of new recurring cost.');
    }
    lab.step();
    for (const owner of Object.keys(lab.state.slices.markets.rivals)) assert.equal(lab.state.slices.company.companies[owner].arrearsCents, 0,
      owner + ' cannot finance its systems program with unpaid bills in Week ' + lab.week);
    for (const command of pending) if (lab.state.commandReceipts[command.id]?.status === 'accepted') {
      if (command.payload.kind === 'set_product_terms') {
        const offer = lab.state.slices.products.offers[command.payload.productId], contract = lab.state.slices.products.contracts[offer.contractId];
        assert.equal(contract.weeklyPriceCents, command.payload.priceCents);
        assert.equal(contract.allowance, command.payload.allowance);
        priceChanges.push({ companyId: command.companyId, from: priorPrices.get(offer.id)!, to: contract.weeklyPriceCents });
      }
    }
  }
  const state = lab.state;
  const license = state.slices.products.commercialContracts['business:northline-operations'];
  assert.ok(license?.companyId === 'rival-harbor' && license.contractKind === 'customer-hosted');
  assert.ok(license.lifetimeBilledCents > 0 && license.termIndex > 1);
  assert.equal(license.lastUsage?.physicalWorkCUw, 0);
  const swift = state.slices.markets.rivals['rival-swift'], campaign = swift.campaign!;
  assert.equal(campaign.tactics?.focus, rivalTacticFor(state.seed, swift.companyId, campaign.startedWeek, swift.style));
  assert.ok(priceChanges.some(change => change.companyId === swift.companyId && change.from !== change.to),
    'The seeded campaign changes its actual public bill through accepted commands; cash recovery may later raise it.');
  const strategy = state.slices.products.offers['rival-swift-product'].strategy;
  assert.ok(strategy); assert.equal(state.commandReceipts[strategy.commandId]?.status, 'accepted', 'The rival’s saved positioning comes from an accepted ordinary command.');
  assert.ok([...Object.values(state.slices.models.trainingRuns), ...Object.values(state.slices.models.applicationRuns)]
    .some(run => run.companyId === 'rival-atlas' && run.completedWork > 0), 'Atlas funds real model work, including an efficiency variant when its tactic calls for one.');
  const market = getMarketView(state, CONTENT);
  assert.ok(market.segments.some(segment => segment.contenders.length > 1));
  assert.ok(market.segments.every(segment => segment.outside + segment.paying + segment.trials + segment.committed + segment.returning === segment.population));
  assert.deepEqual(validateState(state), []);
});

test('W21-R04: previous content migrates without changing its campaign rules or company', () => {
  const prior = { ...CONTENT, version: '0.21.0', buildVersion: '0.21.0' };
  const classic = createInitialState(prior);
  const resumed = deserializeState(serializeState(classic, prior));
  assert.ok(resumed.ok);
  assert.equal(resumed.migratedFrom, 19);
  assert.deepEqual(resumed.state.slices, { ...classic.slices, markets: { ...classic.slices.markets, opportunityCalendar: { startedWeek: classic.week, sequenceVersion: 2 as const } } });
  const release = createInitialState(CONTENT, 'release');
  assert.ok(deserializeState(serializeState(release)).ok);
  const historicalReleaseContent = { ...CONTENT, version: '0.36.0', buildVersion: '0.36.0' };
  const historicalRelease = createInitialState(historicalReleaseContent, 'release');
  assert.deepEqual(validateState(historicalRelease, historicalReleaseContent), [], 'Isolate the older feature gates without removing current progression proof.');
  const invalidDowngrade = { ...structuredClone(historicalRelease), contentVersion: prior.version, buildVersion: prior.buildVersion };
  assert.throws(() => serializeState(invalidDowngrade, prior), /varied campaign schedules were unavailable/);
  delete invalidDowngrade.slices.markets.opportunityCalendar!.sequenceVersion;
  assert.throws(() => serializeState(invalidDowngrade, prior), /strategy evidence were unavailable/);
  delete invalidDowngrade.slices.markets.opportunityCalendar;
  assert.throws(() => serializeState(invalidDowngrade, prior), /workforce/i);
  delete invalidDowngrade.slices.company.passiveWorkforce;
  assert.throws(() => serializeState(invalidDowngrade, prior), /campaign rules/);
});
