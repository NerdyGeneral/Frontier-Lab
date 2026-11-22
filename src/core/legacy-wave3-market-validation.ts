/** Frozen schema-4 validation for authentic Wave 3 saves. */
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { GameContent, GameState } from '../contracts/types';
import { MARKET_SEGMENTS, SEGMENT_BY_ID } from '../content/wave2-market';
import { checkedAdd, checkedInteger, mulDiv } from './math';
import { canonicalStateHash } from './canonical';
import { behaviorMeter, meteredBill, productRequestMeter, segmentForProduct } from '../modules/products';
import { commercialOrganizationCount } from '../modules/business';
const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (a: unknown, b: unknown): boolean => canonicalStateHash(a) === canonicalStateHash(b);
function record(value: unknown, name: string): void { check(!!value && typeof value === 'object' && !Array.isArray(value), name + ' must be a record.'); }
function bps(value: number): void { checkedInteger(value); check(value <= 10000, 'Market score exceeds 100%.'); }
function fraction(value: number, denominator: number): void { checkedInteger(value); check(value < denominator, 'Market fractional carry is outside its denominator.'); }
function note(value: unknown): void { check(typeof value === 'string' && value.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(value), 'Public activity text is invalid.'); }

/** Cross-company finite markets, public releases, and physically metered customer bills. */
export function assertWave2MarketState(state: GameState, content: GameContent): void {
  const { company, models, products, markets } = state.slices;
  const ownCompany = (id: string) => check(Object.hasOwn(company.companies, id), 'Market record has an unknown company.');
  for (const product of Object.values(products.offers)) {
    if (product.features !== undefined) {
      check(Object.keys(product.features).sort().join() === ['deepReasoning', 'extendedContext', 'memory'].sort().join()
        && Object.values(product.features).every(value => typeof value === 'boolean'), 'Product features must be three explicit boolean choices.');
    }
    if (product.publicModelId !== undefined) {
      const model = models.versions[product.publicModelId];
      check(model && model.companyId === product.companyId && model.status === 'released', 'A public product exposes an unreleased or foreign model.');
      if (product.status !== 'deploying') check(product.publicModelId === products.deployments[product.deploymentId].modelId, 'An active product advertises a different model from the one it serves.');
    }
    const deployment = products.deployments[product.deploymentId];
    if (!deployment.scenarioStart) check(deployment.requiredStaff === content.firstSale.deploymentStaff, 'Deployment rollout staff requirement was changed.');
    if (deployment.status === 'ready') check(state.scheduled.some(item => item.kind === 'model_release' && item.targetId === deployment.modelId && item.companyId === deployment.companyId && item.dueWeek === deployment.readyWeek), 'A ready deployment has no matching future release boundary.');
  }
  for (const contract of Object.values(products.contracts)) {
    if (contract.tokenBillRemainder !== undefined) { fraction(contract.tokenBillRemainder, 1_000_000); check(products.offers[contract.productId]?.kind === 'developer-api', 'Only token contracts can carry token billing fractions.'); }
  }
  for (const usage of Object.values(products.lastUsage)) {
    const product = products.offers[usage.productId], contract = products.contracts[product.contractId];
    if (product.kind === 'developer-api') check(usage.tokens !== undefined, 'Developer API usage requires its executed-token meter.');
    if (usage.paidRequestedWork > 0) check(usage.fulfillmentBps === mulDiv(usage.paidExecutedWork, 10000, usage.paidRequestedWork), 'Service fulfillment differs from actually executed paid work.');
    check(usage.paidAccounts > 0 || usage.grossBillCents === 0, 'A product billed nonexistent paid accounts.');
    if (usage.behavior !== undefined) {
      bps(usage.behavior.confidentErrorBps); bps(usage.behavior.falseRefusalBps);
      check(usage.behavior.confidentErrorBps <= usage.errorBps, 'Confident errors exceed all technical errors.');
    }
    if (usage.segments !== undefined) {
      check(Array.isArray(usage.segments) && usage.segments.length <= 6, 'Usage segments are invalid.');
      const seen = new Set<string>(); let accounts = 0, requested = 0;
      for (const row of usage.segments) {
        const segment = SEGMENT_BY_ID[row.segmentId];
        check(segment && segmentForProduct(product.kind).some(item => item.id === segment.id) && !seen.has(segment.id), 'Usage has duplicate or incompatible market segments.'); seen.add(segment.id);
        for (const value of [row.accounts, row.requestedExchanges, row.requestedWork]) checkedInteger(value);
        bps(row.errorBps); check(row.accounts <= segment.population, 'Segment usage exceeds its entire market.');
        accounts = checkedAdd(accounts, row.accounts); requested = checkedAdd(requested, row.requestedWork);
      }
      check(accounts === usage.paidAccounts && requested === usage.paidRequestedWork, 'Segment accounts or requested work do not reconcile with the bill.');
    }
    if (usage.tokens !== undefined) {
      const tokens = usage.tokens;
      for (const value of [tokens.inputTokens, tokens.outputTokens, tokens.internalTokens, tokens.inputPriceCentsPerMillion, tokens.outputPriceCentsPerMillion, tokens.physicalWork, tokens.ownedVariableCostCents]) checkedInteger(value);
      if (tokens.billCarryIn !== undefined) fraction(tokens.billCarryIn, 1_000_000);
      if (tokens.billCarryOut !== undefined) fraction(tokens.billCarryOut, 1_000_000);
      check(usage.executedWork > 0 || (tokens.physicalWork === 0 && tokens.inputTokens === 0 && tokens.outputTokens === 0 && tokens.internalTokens === 0), 'A failed or unexecuted operation created billable tokens.');
      check(usage.paidExecutedWork > 0 || tokens.inputTokens + tokens.outputTokens + tokens.internalTokens === 0, 'Free trial tokens became a paid API bill.');
      if (usage.week === state.week) {
        const model = models.versions[products.deployments[product.deploymentId].modelId], meter = productRequestMeter(state, product, model);
        check(tokens.inputTokens === mulDiv(usage.paidExecutedWork, meter.inputTokens, meter.work)
          && tokens.outputTokens === mulDiv(usage.paidExecutedWork, meter.outputTokens, meter.work)
          && tokens.internalTokens === mulDiv(usage.paidExecutedWork, meter.internalTokens, meter.work), 'Token meter differs from actual executed paid work.');
        check(tokens.inputPriceCentsPerMillion === mulDiv(contract.weeklyPriceCents, 5, 3) && tokens.outputPriceCentsPerMillion === mulDiv(contract.weeklyPriceCents, 25, 3), 'Token prices differ from the current contract.');
        if (usage.behavior) check(same(usage.behavior, behaviorMeter(model, usage.errorBps)), 'Behavior meter differs from the executing model.');
        if (usage.segments) for (const row of usage.segments) {
          check(row.requestedExchanges === row.accounts * Math.min(SEGMENT_BY_ID[row.segmentId].exchanges, contract.allowance)
            && row.requestedWork === row.requestedExchanges * meter.work, 'Feature or family costs disappeared from requested usage.');
        }
      }
      if (product.kind === 'developer-api') {
        const bill = meteredBill(tokens.inputTokens, tokens.outputTokens, tokens.internalTokens, tokens.inputPriceCentsPerMillion, tokens.outputPriceCentsPerMillion, tokens.billCarryIn ?? 0);
        check(usage.creditsCents === 0 && usage.grossBillCents === bill.cents && usage.billedCents === bill.cents, 'API revenue is not the executed-token bill.');
        if (tokens.billCarryOut !== undefined) check(tokens.billCarryOut === bill.remainder, 'API billing fraction was lost or duplicated.');
        if (usage.week === state.week && tokens.billCarryOut !== undefined) check(contract.tokenBillRemainder === tokens.billCarryOut, 'Token contract lost its saved billing remainder.');
      } else {
        check((tokens.billCarryIn ?? 0) === 0 && (tokens.billCarryOut ?? 0) === 0, 'A subscription contains an API billing carry.');
        if (usage.week === state.week) check(usage.grossBillCents === usage.paidAccounts * contract.weeklyPriceCents && usage.creditsCents === mulDiv(usage.grossBillCents, 10000 - usage.fulfillmentBps, 10000, 'nearest'), 'Subscription credits do not match unserved usage.');
      }
    }
  }
  for (const invoice of products.invoices) {
    if (invoice.billing !== undefined) check(invoice.billing === (products.offers[invoice.productId].kind === 'developer-api' ? 'tokens' : 'subscription'), 'Invoice billing mode differs from its product.');
    if (invoice.inputTokens !== undefined) checkedInteger(invoice.inputTokens);
    if (invoice.outputTokens !== undefined) checkedInteger(invoice.outputTokens);
    const usage = products.lastUsage[invoice.productId];
    if (usage && usage.week === invoice.week) check(invoice.amountCents === usage.billedCents && invoice.grossCents === usage.grossBillCents && invoice.creditsCents === usage.creditsCents && invoice.accounts === usage.paidAccounts, 'Invoice and executed weekly usage differ.');
  }
  record(markets.companyTrustBps, 'Company trust'); record(markets.carries, 'Company market carries'); record(markets.shopperCarry, 'Shopper carries'); record(markets.returnedNextWeek, 'Deferred market returns'); record(markets.rivals, 'Rival policies');
  for (const [id, value] of Object.entries(markets.companyTrustBps)) { ownCompany(id); bps(value); }
  check(markets.trustBps === (markets.companyTrustBps[state.playerCompanyId] ?? 5000), 'Player trust alias includes another company’s reputation.');
  const companyIds = Object.keys(company.companies).sort((a, b) => b.length - a.length);
  for (const [key, value] of Object.entries(markets.carries)) {
    const owner = companyIds.find(id => key.startsWith(id + ':'));
    check(owner, 'Market fractional carry has no company owner.');
    const suffix = key.slice(owner!.length + 1);
    check(MARKET_SEGMENTS.some(segment => segment.id === suffix) || ['reach:basic-chat', 'reach:developer-api', 'reach:business-docs'].includes(suffix), 'Market fractional carry has an unknown segment.');
    fraction(value.conversion, 10000); fraction(value.churn, 10000); fraction(value.reach, U);
  }
  for (const [id, value] of Object.entries(markets.shopperCarry)) { check(Object.hasOwn(SEGMENT_BY_ID, id), 'Shopper carry has an unknown segment.'); fraction(value, 10000); }
  for (const [id, value] of Object.entries(markets.returnedNextWeek)) { check(Object.hasOwn(SEGMENT_BY_ID, id), 'Deferred return has an unknown segment.'); checkedInteger(value); }
  for (const cohort of markets.cohorts) {
    const product = products.offers[cohort.productId], segment = SEGMENT_BY_ID[cohort.segmentId ?? 'regular'];
    check(segment && segmentForProduct(product.kind).some(item => item.id === segment.id), 'Customer cohort is assigned to an incompatible product market.');
    if (segment.market === 'business') {
      if (cohort.renewalWeek !== undefined) { checkedInteger(cohort.renewalWeek); check(cohort.renewalWeek > state.week && cohort.renewalWeek <= state.week + 13 && cohort.renewalWeek >= cohort.activeWeek, 'Business renewal is outside its next twelve-week term.'); }
      if (cohort.breachWeeks !== undefined) { checkedInteger(cohort.breachWeeks); check(cohort.breachWeeks < 2, 'An organization stayed after two consecutive service breaches.'); }
    } else check(cohort.renewalWeek === undefined && cohort.breachWeeks === undefined, 'Consumer or developer accounts acquired an enterprise commitment.');
  }
  for (const trial of markets.trials) {
    const product = products.offers[trial.productId], segment = SEGMENT_BY_ID[trial.segmentId ?? 'regular'];
    check(segment && segmentForProduct(product.kind).some(item => item.id === segment.id), 'Trial is assigned to an incompatible product market.');
    const perAccount = trial.workPerAccount ?? content.firstSale.trialWork;
    checkedInteger(perAccount); check(perAccount > 0 && trial.requiredWork === trial.count * perAccount && trial.workCompleted < perAccount, 'Trial work does not retain a valid unfinished account fraction.');
  }
  for (const segment of MARKET_SEGMENTS) {
    const occupied = markets.cohorts.filter(item => (item.segmentId ?? 'regular') === segment.id).reduce((sum, item) => checkedAdd(sum, item.count), 0)
      + markets.trials.filter(item => (item.segmentId ?? 'regular') === segment.id).reduce((sum, item) => checkedAdd(sum, item.count), 0);
    check(occupied + (markets.returnedNextWeek[segment.id] ?? 0) + (segment.market === 'business' ? commercialOrganizationCount(state) : 0) <= segment.population, 'Customers, trials, commercial commitments and deferred returns exceed a finite segment.');
  }
  check(new Set(markets.activeRivalIds).size === markets.activeRivalIds.length && same([...markets.activeRivalIds].sort(), Object.keys(markets.rivals).sort()), 'Registered rival identities do not reconcile.');
  for (const [id, rival] of Object.entries(markets.rivals)) {
    ownCompany(id); check(id !== state.playerCompanyId && id === rival.companyId && ['frontier', 'efficient', 'enterprise'].includes(rival.style), 'Rival policy has an invalid owner or style.');
    for (const value of [rival.interval, rival.reserveWeeks, rival.nextPlanWeek, rival.lastPriceWeek, rival.lastActionWeek]) checkedInteger(value);
    check(rival.interval > 0 && rival.interval <= 52 && rival.reserveWeeks > 0 && rival.reserveWeeks <= 52 && rival.lastPriceWeek <= state.week && rival.lastActionWeek <= state.week && typeof rival.withdrawn === 'boolean', 'Rival policy timing or reserves are invalid.');
    note(rival.publicActivity);
  }
}
