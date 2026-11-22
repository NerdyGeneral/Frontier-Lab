import { sessionChurnRelief, settledSessionHistory } from './consumer-sessions';
import type { CustomerCohort, DomainModule, GameContent, GameState, MarketSegmentId, MarketsSlice, ProductOffer, SegmentDefinition, TrialBatch, WorkRequest } from '../contracts/types';
import { RESOURCE_SCALE } from '../contracts/types';
import { MARKET_SEGMENTS, SEGMENT_BY_ID } from '../content/wave2-market';
import { checkedAdd, mulDiv } from '../core/math';
import { getAvailableRoleCapacity, getWorkforce } from './workforce';
import { executionErrorBps, productDemand, requestMeter, segmentForProduct, standardServingRequests, taskScore } from './products';
import { planRivals } from './rivals';
import { createComputeModule } from './compute';
import { BASE_BEHAVIOR } from './lab-planner';
import { activeEfficiency } from './product-efficiency';
import { PREFIX_CACHE } from '../content/wave4-research';
import { TRUST_PACING } from '../content/wave5-balance';
import { commercialCapacityRequests, commercialOrganizationCount } from './business';
import { EVIDENCE_LINKS } from '../content/wave6-evidence';
import { evidenceGoodForTrust, evidenceWithheldBps } from './retrieval-evidence';
import { audienceAcquisitionBps } from './product-strategy';
import { marketOpportunityDemandMultiplierBps } from './market-opportunities';
import { hasConnectedCompanyRules } from '../core/connected-company-version';
import { workloadAcquisitionBps, workloadChurnReliefBps, workloadErrorToleranceBps } from './product-workloads';
import { clientRelationshipAcquisitionBps } from './systems-client-relationships';
import { getCompanyWorld } from './company-progression';
import { getResearchProgramLevel } from './research-programs';

export { MARKET_SEGMENTS } from '../content/wave2-market';
const clamp = (n: number, min = 0, max = 10000) => Math.max(min, Math.min(max, n));
function carry(market: MarketsSlice, company: string, segment: string) {
  const key = company + ':' + segment;
  return market.carries[key] ?? (market.carries[key] = { conversion: 0, churn: 0, reach: 0 });
}
export function expectedProductBill(product: ProductOffer, price: number, meter: ReturnType<typeof requestMeter>): number {
  return product.kind === 'developer-api' ? mulDiv(price, meter.inputTokens + 5 * (meter.outputTokens + meter.internalTokens), 1000) : price;
}
function billFit(product: ProductOffer, price: number, segment: SegmentDefinition, meter: ReturnType<typeof requestMeter>): number {
  return Math.min(15000, mulDiv(segment.referencePriceCents, 10000, Math.max(1, expectedProductBill(product, price, meter))));
}
export function offerEligible(state: Readonly<GameState>, product: ProductOffer, segment: SegmentDefinition, content: GameContent): boolean {
  if (product.retiredWeek !== undefined || product.status !== 'active' || state.slices.company.companies[product.companyId].arrearsCents || !segmentForProduct(product.kind).some(s => s.id === segment.id)) return false;
  const d = productDemand(state, product, content, state.week), s = d.model.capabilityBps;
  const bonus = (d.features.deepReasoning ? 1000 : 0) + (d.features.extendedContext && (segment.market !== 'consumer' || segment.id === 'professional') ? 500 : 0) + (segment.market === 'business' ? d.documentBonusBps : 0);
  if (s.conversation + bonus < segment.minConversationBps || s.documents + bonus < segment.minDocumentsBps || s.coding + bonus < segment.minCodingBps || d.model.reliabilityBps < segment.minReliabilityBps) return false;
  if (segment.market === 'consumer' && (d.workload ? d.segments.find(row => row.segmentId === segment.id)!.errorBps : executionErrorBps(d.model, segment, d.features)) > workloadErrorToleranceBps(segment, product.workload)) return false;
  if (segment.market === 'business') return (state.slices.research.completedByCompany[product.companyId] ?? []).some(id => id === 'R6' || id === 'R12') && getWorkforce(state, product.companyId, state.week).capacity.commercial >= RESOURCE_SCALE / 4 && (state.slices.products.lastUsage[product.id]?.fulfillmentBps ?? 10000) >= 9800;
  return true;
}
export function getProductDemandAccess(state: Readonly<GameState>, product: ProductOffer) {
  if (!product.workload || !hasConnectedCompanyRules(state.contentVersion)) return { relationshipBps: 10000, researchBps: 10000, worldBps: 10000, originBps: 10000, totalBps: 10000 };
  const workload = product.workload.id;
  const program = workload === 'responsive' || workload === 'local' ? 'efficient-systems' : workload === 'continuity' ? 'persistent-systems' : workload === 'verified' ? 'verified-systems' : null;
  const relationshipBps = clientRelationshipAcquisitionBps(state, product.companyId, workload);
  const researchBps = 10000 + (program && product.companyId === state.playerCompanyId ? Math.min(4, getResearchProgramLevel(state, program)) * 200 : 0);
  const world = getCompanyWorld(state), worldBps = world?.favoredWorkload === workload ? world.acquisitionBps : 10000;
  const originBps = product.companyId === state.playerCompanyId && state.slices.campaign.origin === 'consultancy' && relationshipBps > 10000 ? 10300 : 10000;
  return { relationshipBps, researchBps, worldBps, originBps, totalBps: mulDiv(mulDiv(mulDiv(relationshipBps, researchBps, 10000), worldBps, 10000), originBps, 10000) };
}
function conversionRate(state: Readonly<GameState>, market: MarketsSlice, p: ProductOffer, segment: SegmentDefinition, content: GameContent, service = 10000): number {
  const d = productDemand(state, p, content, state.week);
  const requirement = segment.market === 'developer' ? 5000 : segment.market === 'business' ? 5500 : segment.minConversationBps;
  let rate = mulDiv(4500, Math.min(15000, mulDiv(taskScore(d.model, segment, d.features, d.documentBonusBps), 10000, requirement)), 10000);
  rate = mulDiv(rate, billFit(p, d.contract.weeklyPriceCents, segment, d.meter), 10000);
  rate = mulDiv(rate, Math.min(15000, 5000 + (market.companyTrustBps[p.companyId] ?? 5000)), 10000);
  rate = mulDiv(rate, Math.min(10000, mulDiv(d.contract.allowance, 10000, segment.exchanges)), 10000);
  rate = mulDiv(rate, service, 10000);
  rate = mulDiv(rate, audienceAcquisitionBps(p, segment, {
    expectedBillCents: expectedProductBill(p, d.contract.weeklyPriceCents, d.meter),
    taskScoreBps: taskScore(d.model, segment, d.features, d.documentBonusBps), reliabilityBps: d.model.reliabilityBps,
    fulfillmentBps: state.slices.products.lastUsage[p.id]?.fulfillmentBps ?? 10000,
  }), 10000);
  if (d.features.memory && segment.market === 'consumer' && segment.id !== 'casual') rate = mulDiv(rate, 10500, 10000);
  if (d.workload) {
    rate = mulDiv(rate, workloadAcquisitionBps(segment, d.workload), 10000);
    rate = mulDiv(rate, getProductDemandAccess(state, p).totalBps, 10000);
  }
  return clamp(rate, 500, 8000);
}
/** Compare only published terms and observed service. Qualification is checked separately. */
function shortlistWeight(state: Readonly<GameState>, market: MarketsSlice, product: ProductOffer, segment: SegmentDefinition, content: GameContent): number {
  const base = conversionRate(state, market, product, segment, content);
  if (state.slices.campaign.rules !== 'release') return base;
  const demand = productDemand(state, product, content, state.week);
  const usage = state.slices.products.lastUsage[product.id];
  const fulfilled = usage?.paidAccounts ? Math.max(4000, usage.fulfillmentBps) : 10000;
  // Budget shoppers care more about the bill. Heavy, professional and enterprise
  // buyers put more weight on a relevant model and observed reliability.
  const budget = segment.id === 'casual' || segment.market === 'developer';
  const value = budget
    ? billFit(product, demand.contract.weeklyPriceCents, segment, demand.meter)
    : Math.floor((demand.model.reliabilityBps + taskScore(demand.model, segment, demand.features, demand.documentBonusBps)) / 2);
  return Math.max(1, mulDiv(mulDiv(base, 5000 + Math.floor(value / 2), 10000), fulfilled, 10000));
}

export function getMarketView(state: GameState, content: GameContent) {
  const offers = Object.values(state.slices.products.offers);
  const market = state.slices.markets;
  const segments = MARKET_SEGMENTS.map(segment => {
    const cohorts = state.slices.markets.cohorts.filter(c => (c.segmentId ?? 'regular') === segment.id);
    const trials = state.slices.markets.trials.filter(c => (c.segmentId ?? 'regular') === segment.id);
    const paying = cohorts.reduce((n, c) => n + c.count, 0), trialCount = trials.reduce((n, c) => n + c.count, 0);
    const committed = segment.market === 'business' ? commercialOrganizationCount(state) : 0;
    const publicContenders = offers.filter(product => offerEligible(state, product, segment, content))
      .map(product => ({ companyId: product.companyId, name: state.slices.company.companies[product.companyId].name,
        score: shortlistWeight(state, market, product, segment, content) }))
      .sort((a, b) => b.score - a.score || a.companyId.localeCompare(b.companyId));
    const contenders = publicContenders.filter((contender, index) => publicContenders.findIndex(other => other.companyId === contender.companyId) === index);
    const opportunityMultiplierBps = marketOpportunityDemandMultiplierBps(state, segment.id);
    return { ...segment, opportunityMultiplierBps, effectiveShoppingBps: mulDiv(segment.shoppingBps, opportunityMultiplierBps, 10000), contenders, paying, trials: trialCount, committed, returning: state.slices.markets.returnedNextWeek[segment.id] ?? 0, outside: Math.max(0, segment.population - paying - trialCount - committed - (state.slices.markets.returnedNextWeek[segment.id] ?? 0)), yours: cohorts.filter(c => c.companyId === state.playerCompanyId).reduce((n, c) => n + c.count, 0), eligible: contenders.some(offer => offer.companyId === state.playerCompanyId) };
  });
  const rivals = Object.values(state.slices.markets.rivals).map(r => ({ companyId: r.companyId, name: state.slices.company.companies[r.companyId].name, style: r.style, publicActivity: r.publicActivity, withdrawn: r.withdrawn,
    products: Object.values(state.slices.products.offers).filter(p => p.companyId === r.companyId).flatMap(p => { const deployment = state.slices.products.deployments[p.deploymentId], model = state.slices.models.versions[p.publicModelId ?? deployment.modelId]; if (!model || model.status !== 'released') return []; const contract = state.slices.products.contracts[p.contractId]; return [{ name: p.name, kind: p.kind, status: p.status, priceCents: contract.weeklyPriceCents, accounts: state.slices.markets.cohorts.filter(c => c.productId === p.id).reduce((n, c) => n + c.count, 0), model: model.name, capabilityBps: model.capabilityBps, reliabilityBps: model.reliabilityBps, allowance: contract.allowance, serviceBps: state.slices.products.lastUsage[p.id]?.fulfillmentBps }]; }),
    commitments: Object.values(state.slices.products.commercialContracts).filter(contract => contract.companyId === r.companyId
      && ['building', 'ready', 'active'].includes(contract.status)) }));
  return { segments, rivals, trustBps: state.slices.markets.companyTrustBps[state.playerCompanyId] ?? 5000, lastExplanation: state.slices.markets.lastExplanation };
}

/** Every acquisition reserves one member of a finite segment until conversion or expiry. */
export function createMarketsModule(content: GameContent): DomainModule {
  const forecastCompute = createComputeModule(content);
  return {
    id: 'markets', owns: ['markets'],
    handlers: {
      reserve(state, ctx) {
        const workRequests: WorkRequest[] = [];
        // One shared commercial request per company; products never duplicate its staff.
        for (const companyId of Object.keys(state.slices.company.companies)) if (Object.values(state.slices.products.offers).some(p => p.companyId === companyId && p.status === 'active')) {
          const commercial = getAvailableRoleCapacity(state, companyId, 'commercial', ctx.week);
          if (commercial > 0) workRequests.push({ id: 'acquire-company:' + companyId, companyId, taskId: companyId, category: 'serving', normalizedWorkCUw: 0, memoryMU: 0, priority: 70, poolId: 'auto', staffDemand: [{ role: 'commercial', staffWeeks: commercial }] });
        }
        return { workRequests };
      },
      market(state, ctx) {
        const market = structuredClone(state.slices.markets), messages: { category: 'market'; message: string; companyId: string }[] = [];
        market.lastGained = 0; market.lastLost = 0; market.lastTrialCount = 0; market.returnedNextWeek = {};
        const returned = (segment: string, count: number) => { market.returnedNextWeek[segment] = (market.returnedNextWeek[segment] ?? 0) + count; };
        const offers = Object.values(state.slices.products.offers).filter(offer => offer.retiredWeek === undefined).sort((a, b) => a.id.localeCompare(b.id));
        const trustObservations: Record<string, { good: boolean; calibrated: boolean }> = {};
        for (const p of offers) {
          const d = productDemand(state, p, content, ctx.week), u = state.slices.products.lastUsage[p.id];
          if (!u || u.week !== ctx.week) continue;
          let availableTrialWork = u.trialExecutedWork, gainedTotal = 0, lostTotal = 0, expiredTotal = 0;
          const gainedBySegment: Partial<Record<MarketSegmentId, number>> = {};
          const remainingTrials: TrialBatch[] = [];
          for (const savedTrial of [...market.trials].sort((a, b) => a.activeWeek - b.activeWeek || a.id.localeCompare(b.id))) {
            if (savedTrial.productId !== p.id || savedTrial.activeWeek > ctx.week) { remainingTrials.push(savedTrial); continue; }
            const t = structuredClone(d.trials.find(trial => trial.id === savedTrial.id) ?? savedTrial);
            const segment = SEGMENT_BY_ID[t.segmentId ?? 'regular'], perAccount = t.workPerAccount ?? content.firstSale.trialWork;
            const work = t.expiresWeek >= ctx.week ? Math.min(availableTrialWork, t.requiredWork - t.workCompleted) : 0;
            availableTrialWork -= work; const total = checkedAdd(t.workCompleted, work);
            const finished = Math.min(t.count, Math.floor(total / perAccount));
            const c = carry(market, p.companyId, segment.id), rate = conversionRate(state, market, p, segment, content, u.fulfillmentBps);
            const numerator = finished * rate + c.conversion, gained = Math.floor(numerator / 10000); c.conversion = numerator % 10000;
            gainedBySegment[segment.id] = (gainedBySegment[segment.id] ?? 0) + gained; gainedTotal += gained;
            returned(segment.id, finished - gained); t.count -= finished; t.requiredWork = t.count * perAccount; t.workCompleted = total - finished * perAccount;
            if (t.count > 0 && t.expiresWeek > ctx.week) remainingTrials.push(t);
            else if (t.count > 0) { returned(segment.id, t.count); expiredTotal += t.count; }
          }
          market.trials = remainingTrials;
          const retained: CustomerCohort[] = market.cohorts.filter(c => c.productId !== p.id || c.activeWeek > ctx.week);
          for (const segment of segmentForProduct(p.kind)) {
            const cohorts = market.cohorts.filter(c => c.productId === p.id && c.activeWeek <= ctx.week && (c.segmentId ?? 'regular') === segment.id);
            const accounts = cohorts.reduce((n, c) => n + c.count, 0), c = carry(market, p.companyId, segment.id);
            const sessionRow = u.consumerSessions || u.canary || u.workload ? u.segments?.find(row => row.segmentId === segment.id) : undefined;
            const tolerance = workloadErrorToleranceBps(segment, p.workload);
            const excess = clamp((sessionRow?.errorBps ?? executionErrorBps(d.model, segment, d.features, d.documentBonusBps)) - tolerance);
            const overprice = clamp(mulDiv(d.contract.weeklyPriceCents, 10000, segment.referencePriceCents) - 10000);
            const confidentExcess = Math.max(0, (u.behavior?.confidentErrorBps ?? Math.min(u.errorBps, BASE_BEHAVIOR.confidentErrorBps)) - Math.floor(tolerance / 2));
            const refusalExcess = Math.max(0, (u.behavior?.falseRefusalBps ?? BASE_BEHAVIOR.falseRefusalBps) - 500);
            // Fictional retention rule: confident errors and needless refusals create distinct friction.
            const behaviorFriction = mulDiv(400, confidentExcess, 10000) + mulDiv(200, refusalExcess, 10000)
              + mulDiv(EVIDENCE_LINKS.maximumWithheldChurnBps, evidenceWithheldBps(u.evidence), 10000);
            const unmet = 10000 - u.fulfillmentBps, lowAllowance = 10000 - Math.min(10000, mulDiv(d.contract.allowance, 10000, segment.exchanges));
            let lost = 0;
            if (segment.market === 'business') {
              for (const cohort of cohorts) {
                const breachWeeks = u.fulfillmentBps < 9000 ? (cohort.breachWeeks ?? 0) + 1 : 0;
                const renewal = cohort.renewalWeek ?? (cohort.activeWeek + 12);
                let count = cohort.count;
                if (breachWeeks >= 2 || renewal <= ctx.week) {
                  const good = d.model.capabilityBps.documents >= 5500 && d.model.reliabilityBps >= 9000 && d.contract.weeklyPriceCents <= mulDiv(segment.referencePriceCents, 12500, 10000) && (!u.workload || u.workload.fitBps >= 9500);
                  let competitivePressure = 0;
                  if (state.slices.campaign.rules === 'release' && breachWeeks < 2) {
                    const own = shortlistWeight(state, market, p, segment, content);
                    const bestAlternative = offers.filter(other => other.companyId !== p.companyId && offerEligible(state, other, segment, content))
                      .reduce((best, other) => Math.max(best, shortlistWeight(state, market, other, segment, content)), own);
                    competitivePressure = Math.min(1000, Math.floor((bestAlternative - own) / 2));
                  }
                  const continuity = u.workload?.id === 'continuity' && u.workload.fitBps === 10000 ? 500 : 0;
                  const renewalRate = breachWeeks >= 2 ? 0 : clamp((good ? 9000 : 6000) + continuity - Math.min(3000, mulDiv(unmet + excess, 3000, 10000) + behaviorFriction) - competitivePressure);
                  const numerator = count * (10000 - renewalRate) + c.churn, churn = Math.min(count, Math.floor(numerator / 10000)); c.churn = numerator % 10000; count -= churn; lost += churn;
                }
                if (count > 0) retained.push({ ...cohort, count, breachWeeks, renewalWeek: renewal <= ctx.week ? ctx.week + 12 : renewal });
              }
            } else {
              const baseChurn = d.features.memory && segment.market === 'consumer' && segment.id !== 'casual' ? mulDiv(segment.churnBps, 7500, 10000) : segment.churnBps;
              const churnBps = Math.max(0, Math.min(2500, baseChurn - sessionChurnRelief(u, segment, baseChurn) - workloadChurnReliefBps(baseChurn, u.workload) + mulDiv(600, unmet, 10000) + mulDiv(400, excess, 10000) + mulDiv(200, overprice, 10000) + mulDiv(600, lowAllowance, 10000) + behaviorFriction));
              const numerator = accounts * churnBps + c.churn; lost = Math.min(accounts, Math.floor(numerator / 10000)); c.churn = numerator % 10000;
              if (accounts > lost) {
                const history = settledSessionHistory(sessionRow, accounts - lost, u);
                retained.push({ id: 'renewals:' + p.id + ':' + segment.id, companyId: p.companyId, productId: p.id, contractId: p.contractId, segmentId: segment.id,
                  count: accounts - lost, activeWeek: ctx.week, ...(history ? { sessionHistory: history } : {}) });
              }
            }
            returned(segment.id, lost); lostTotal += lost;
            const gained = gainedBySegment[segment.id] ?? 0;
            if (gained > 0) retained.push({ id: 'cohort:' + p.id + ':' + segment.id + ':' + ctx.week, companyId: p.companyId, productId: p.id, contractId: p.contractId, segmentId: segment.id, count: gained, activeWeek: ctx.week + 1, ...(segment.market === 'business' ? { renewalWeek: ctx.week + 13, breachWeeks: 0 } : {}) });
          }
          market.cohorts = retained;
          if (d.accounts > 0) {
            const observation = trustObservations[p.companyId] ??= { good: true, calibrated: true };
            const promisedErrorTolerance = u.workload?.id === 'verified' ? 2000 : 1800;
            observation.good &&= u.fulfillmentBps >= 9800 && u.errorBps <= promisedErrorTolerance && (!u.workload || u.workload.fitBps >= 9500) && evidenceGoodForTrust(u.evidence);
            observation.calibrated &&= (u.canary ? u.behavior?.confidentErrorBps ?? BASE_BEHAVIOR.confidentErrorBps
              : d.model.behavior?.confidentErrorBps ?? BASE_BEHAVIOR.confidentErrorBps) < BASE_BEHAVIOR.confidentErrorBps;
          }
          if (p.companyId === state.playerCompanyId) { market.lastGained += gainedTotal; market.lastLost += lostTotal; }
          if (gainedTotal || lostTotal || expiredTotal) messages.push({ category: 'market', companyId: p.companyId, message: `${p.name}: ${gainedTotal} subscriptions start next week; ${lostTotal} accounts left; ${expiredTotal} unfinished trials expired.` });
        }
        for (const [companyId, observation] of Object.entries(trustObservations)) market.companyTrustBps[companyId] = clamp((market.companyTrustBps[companyId] ?? 5000)
          + (observation.good ? observation.calibrated ? TRUST_PACING.calibratedGoodWeekBps : TRUST_PACING.goodWeekBps : -TRUST_PACING.poorWeekLossBps));
        const transient = (): GameState => ({ ...state, slices: { ...state.slices, markets: market } });
        const outside = (segment: SegmentDefinition) => Math.max(0, segment.population - market.cohorts.filter(c => (c.segmentId ?? 'regular') === segment.id).reduce((n, c) => n + c.count, 0) - market.trials.filter(t => (t.segmentId ?? 'regular') === segment.id).reduce((n, t) => n + t.count, 0) - (market.returnedNextWeek[segment.id] ?? 0) - (segment.market === 'business' ? commercialOrganizationCount(state, ctx.week) : 0));
        const reach: Record<string, number> = {};
        for (const p of offers) {
          const granted = ctx.resources.staffGrants.find(g => g.requestId === 'acquire-company:' + p.companyId)?.grants.find(g => g.role === 'commercial')?.staffWeeks ?? 0;
          const activeCount = offers.filter(o => o.companyId === p.companyId && o.status === 'active').length || 1;
          const commercial = Math.floor(granted / activeCount), c = carry(market, p.companyId, 'reach:' + p.kind);
          const sameKind = hasConnectedCompanyRules(state.contentVersion) ? offers.filter(o => o.companyId === p.companyId && o.kind === p.kind && o.status === 'active').length || 1 : 1;
          const base = Math.floor((p.kind === 'basic-chat' ? 20 * RESOURCE_SCALE : p.kind === 'developer-api' ? 3 * RESOURCE_SCALE : RESOURCE_SCALE / 4) / sameKind);
          const perFte = p.kind === 'basic-chat' ? 15 * RESOURCE_SCALE : p.kind === 'developer-api' ? 3 * RESOURCE_SCALE : RESOURCE_SCALE / 2;
          const numerator = base + mulDiv(commercial, perFte, RESOURCE_SCALE) + c.reach;
          reach[p.id] = Math.floor(numerator / RESOURCE_SCALE); c.reach = numerator % RESOURCE_SCALE;
        }
        const slots = (p: ProductOffer, segment: SegmentDefinition) => {
          const s = transient(), demand = productDemand(s, p, content, ctx.week + 1);
          const serving = standardServingRequests(s, content, ctx.week + 1).filter(request => request.companyId === p.companyId);
          const fits = (extra: number) => {
            // New trials remain with the incumbent while the candidate keeps its
            // real work, resident memory and allocator priority in the forecast.
            const requests: WorkRequest[] = serving.map(request => request.id === 'serve:' + p.id ? { ...request,
              normalizedWorkCUw: request.normalizedWorkCUw + extra * segment.trialExchanges * demand.meter.work,
              memoryMU: request.memoryMU + extra * (demand.meter.sessionMemory + (activeEfficiency(s, p.id, 'prefix-cache') ? PREFIX_CACHE.tenantMemoryMU : 0)) } : request);
            requests.push(...commercialCapacityRequests(s, p.companyId));
            const forecast = forecastCompute.grantResources!(s, { ...ctx, resources: { requests, computeGrants: [], staffGrants: ctx.resources.staffGrants } });
            return requests.every(request => { const grant = forecast.computeGrants?.find(item => item.requestId === request.id); return grant && grant.hardwareEffectiveCUw === request.normalizedWorkCUw && grant.memoryMU >= request.memoryMU; });
          };
          let low = 0, high = Math.max(0, reach[p.id] ?? 0);
          if (!high || !fits(0)) return 0;
          while (low < high) { const middle = Math.ceil((low + high) / 2); if (fits(middle)) low = middle; else high = middle - 1; }
          return low;
        };
        const admit = (p: ProductOffer, segment: SegmentDefinition, requested: number) => {
          const count = Math.min(requested, outside(segment), slots(p, segment)); if (count <= 0) return 0;
          const d = productDemand(transient(), p, content, ctx.week + 1), perAccount = segment.trialExchanges * d.meter.work;
          const id = 'trial-' + market.nextTrialId; market.nextTrialId = checkedAdd(market.nextTrialId, 1);
          market.trials.push({ id, companyId: p.companyId, productId: p.id, segmentId: segment.id, count, createdWeek: ctx.week, activeWeek: ctx.week + 1, expiresWeek: ctx.week + 2, workCompleted: 0, requiredWork: count * perAccount, workPerAccount: perAccount });
          reach[p.id] -= count; if (p.companyId === state.playerCompanyId) market.lastTrialCount += count; return count;
        };
        // Preserve the authored 40-person opening waitlist, within the regular population.
        const opening = offers.find(p => p.companyId === state.playerCompanyId && p.kind === 'basic-chat' && offerEligible(state, p, SEGMENT_BY_ID.regular, content));
        if (opening && market.waitlistRemaining > 0) market.waitlistRemaining -= admit(opening, SEGMENT_BY_ID.regular, market.waitlistRemaining);
        for (const segment of MARKET_SEGMENTS) {
          const shoppingBps = mulDiv(segment.shoppingBps, marketOpportunityDemandMultiplierBps(state, segment.id, ctx.week), 10000);
          const available = outside(segment), numerator = available * shoppingBps + (market.shopperCarry[segment.id] ?? 0);
          let shoppers = Math.floor(numerator / 10000); market.shopperCarry[segment.id] = numerator % 10000;
          const eligible = offers.filter(p => offerEligible(state, p, segment, content)).map(p => ({ p, weight: shortlistWeight(state, market, p, segment, content) }));
          if (hasConnectedCompanyRules(state.contentVersion)) {
            // One company earns one competitive share. Its offers split that
            // share; cloning the same product cannot manufacture new shoppers.
            const groups = new Map<string, { total: number; best: number }>();
            for (const item of eligible) { const group = groups.get(item.p.companyId) ?? { total: 0, best: 0 }; group.total += item.weight; group.best = Math.max(group.best, item.weight); groups.set(item.p.companyId, group); }
            for (const item of eligible) { const group = groups.get(item.p.companyId)!; item.weight = Math.max(1, mulDiv(item.weight, group.best, group.total)); }
          }
          if (state.slices.campaign.rules === 'release') eligible.sort((a, b) => b.weight - a.weight || a.p.id.localeCompare(b.p.id));
          // Reallocate leftover shares only among offers with remaining reach and capacity.
          for (let round = 0; shoppers > 0 && round < eligible.length + 1; round++) {
            const candidates = eligible.filter(x => slots(x.p, segment) > 0); if (!candidates.length) break;
            const sum = candidates.reduce((n, x) => n + x.weight, 0), before = shoppers; let admitted = 0;
            for (const x of candidates) admitted += admit(x.p, segment, Math.min(shoppers - admitted, Math.max(1, Math.floor(before * x.weight / sum))));
            if (!admitted) break; shoppers -= admitted;
          }
        }
        market.payingConsumers = market.cohorts.filter(c => c.companyId === state.playerCompanyId && SEGMENT_BY_ID[c.segmentId ?? 'regular'].market === 'consumer').reduce((n, c) => n + c.count, 0);
        market.trustBps = market.companyTrustBps[state.playerCompanyId] ?? 5000;
        const regularCarry = carry(market, state.playerCompanyId, 'regular'); market.conversionCarry = regularCarry.conversion; market.churnCarry = regularCarry.churn;
        market.lastExplanation = `${market.lastTrialCount} new trials; ${market.lastGained} paid accounts start next week; ${market.lastLost} left. Offers compete on model fit, price, service and trust; reach, serving capacity and memory limit growth.`;
        return { updates: { markets: market }, messages };
      },
      plan(state, ctx) { return planRivals(state, ctx); },
    },
  };
}
