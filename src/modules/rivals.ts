import type { CommandPayload, DomainModule, DomainResult, GameContent, GameState, ModelVersion, ModuleContext, ProductOffer } from '../contracts/types';
import type { RivalCampaign, RivalCampaignKind } from '../contracts/market-dynamics';
import type { RivalState } from '../contracts/wave2-market';
import { RESOURCE_SCALE } from '../contracts/types';
import { BUSINESS_BY_ID, COMMERCE_RULES } from '../content/wave3-commerce';
import { RIVAL_CAMPAIGN_RULES, RIVAL_TACTIC_RULES } from '../content/market-dynamics';
import { DEFAULT_FEATURES, SEGMENT_BY_ID } from '../content/wave2-market';
import { GAMEPLAY_POLISH_CONTENT_VERSION } from '../core/gameplay-polish-version';
import { getWeeklyBaseCost } from '../core/selectors';
import { createLabModule } from './lab';
import { getTrainingPreview } from './lab-planner';
import { createResearchModule, getResearchView } from './research';
import { createProductsModule, productDemand, taskScore } from './products';
import { createComputeModule } from './compute';
import { marketOpportunityAnnouncement } from './market-opportunities';
import { rivalCampaignPriceTarget, rivalTacticFor } from './rival-tactics';
import { requestMeter } from './product-models';

/** An observed-state policy proposes normal commands; the engine validates/quotes/applies them. */
export function planRivals(state: Readonly<GameState>, ctx: ModuleContext): DomainResult {
  if (state.slices.markets.opportunityCalendar) return planRivalCampaigns(state, ctx);
  return planLegacyRivals(state, ctx);
}

/** Frozen historical policy for saves that have not adopted the market calendar. */
function planLegacyRivals(state: Readonly<GameState>, ctx: ModuleContext): DomainResult {
  const lab = createLabModule(ctx.content);
  const markets = structuredClone(state.slices.markets), commands: NonNullable<DomainResult['commands']> = [];
  for (const rival of Object.values(markets.rivals)) {
    const company = state.slices.company.companies[rival.companyId], fleet = state.slices.compute.fleets[rival.companyId];
    if (company.arrearsCents > 0) { rival.withdrawn = true; rival.publicActivity = 'Operations suspended after unpaid bills.'; continue; }
    if (rival.nextPlanWeek > ctx.week || state.queuedCommands.some(c => c.companyId === rival.companyId)) continue;
    rival.nextPlanWeek = ctx.week + rival.interval;
    const base = getWeeklyBaseCost(state as GameState, ctx.content, company.id);
    const loss = Math.max(0, base - company.lastWeek.revenueCents), reserve = Math.max(base * 8, loss * rival.reserveWeeks);
    const budget = Math.max(0, company.cashCents - reserve);
    const offers = Object.values(state.slices.products.offers).filter(p => p.companyId === company.id), live = offers.find(p => p.status === 'active');
    const competitive = state.slices.campaign.rules === 'release';
    let action: CommandPayload | undefined, activity = '';
    const publish = (payload: CommandPayload, label: string) => { action = payload; activity = label; };
    // Preserve already-paid work. Operational repairs take precedence over speculative research.
    const pressure = offers.reduce((n, p) => n + (state.slices.products.lastUsage[p.id]?.requestedWork ?? 0), 0);
    const desiredServing = Math.ceil(pressure * 1.1 / (RESOURCE_SCALE / 4)) * (RESOURCE_SCALE / 4);
    const failing = offers.some(p => (state.slices.products.lastUsage[p.id]?.paidAccounts ?? 0) > 0 && (state.slices.products.lastUsage[p.id]?.fulfillmentBps ?? 10000) < 9800);
    if (failing && desiredServing > fleet.allocation.serving && desiredServing <= fleet.cloudCU + fleet.ownedCU) {
      const remaining = fleet.cloudCU + fleet.ownedCU - desiredServing, research = Math.min(fleet.allocation.research, remaining);
      publish({ kind: 'allocate_compute', serving: desiredServing, research, development: Math.max(0, remaining - research) }, 'Reallocated capacity to improve service.');
    } else if (failing && budget > base * 4 && fleet.cloudCU < ctx.content.firstSale.maxCloudCU) {
      publish({ kind: 'set_cloud_capacity', cu: Math.min(ctx.content.firstSale.maxCloudCU, fleet.cloudCU + 4 * RESOURCE_SCALE) }, 'Reserved additional cloud capacity.');
    } else if (company.cashCents < reserve && live && ctx.week - rival.lastPriceWeek >= 8) {
      const d = productDemand(state, live, ctx.content, ctx.week), max = live.kind === 'basic-chat' ? 10000 : 100000;
      publish({ kind: 'set_product_terms', productId: live.id, priceCents: Math.min(max, Math.ceil(d.contract.weeklyPriceCents * 1.1)), allowance: d.contract.allowance }, 'Adjusted public prices to protect operating runway.');
      rival.lastPriceWeek = ctx.week;
    } else {
      if (competitive && rival.style === 'enterprise' && live) {
        const customer = BUSINESS_BY_ID['northline-operations'];
        const contract = state.slices.products.commercialContracts['business:' + customer.id];
        const terms = productDemand(state, live, ctx.content, ctx.week);
        if (contract?.companyId === company.id && ['building', 'ready', 'active'].includes(contract.status) && !contract.autoRenew && company.cashCents >= reserve) {
          publish({ kind: 'set_business_renewal', contractId: contract.id, renew: true }, `Offered to renew its license with ${customer.name} if service meets the SLA.`);
        } else if (ctx.week >= 36 && (!contract || (contract.endedWeek !== null && ctx.week >= contract.endedWeek + COMMERCE_RULES.reofferDelayWeeks))
          && budget >= customer.licenseSetupCents + base && terms.model.capabilityBps.documents >= customer.minimumScoreBps
          && terms.model.reliabilityBps >= customer.minimumReliabilityBps) {
          publish({ kind: 'sign_business_contract', customerId: customer.id, contractKind: 'customer-hosted', modelId: terms.model.id }, `Pursuing a buyer-hosted weight license with ${customer.name}.`);
        }
      }
      if (competitive && rival.style === 'efficient' && live && ctx.week - rival.lastPriceWeek >= 8 && budget >= base * 2) {
        const demand = productDemand(state, live, ctx.content, ctx.week);
        const proposed = Math.max(4800, demand.contract.weeklyPriceCents - 300);
        const usage = state.slices.products.lastUsage[live.id];
        // Protect paid workload contribution. The separate cash reserve limits
        // how long this strategy can carry an underused fleet.
        const servingCost = Math.ceil(fleet.lastWork.serving / RESOURCE_SCALE * ctx.content.opening.rentCentsPerCUWeek);
        if (usage?.paidAccounts && proposed < demand.contract.weeklyPriceCents
          && usage.billedCents * proposed >= servingCost * 1.25 * demand.contract.weeklyPriceCents) {
          publish({ kind: 'set_product_terms', productId: live.id, priceCents: proposed, allowance: demand.contract.allowance }, 'Cut its API reference bill while protecting paid serving contribution.');
          rival.lastPriceWeek = ctx.week;
        }
      }
      const unfinished = Object.values(state.slices.research.projects).some(p => p.companyId === company.id && p.status !== 'complete') || Object.values(state.slices.models.trainingRuns).some(p => p.companyId === company.id && p.status !== 'complete') || Object.values(state.slices.models.evaluationRuns).some(p => p.companyId === company.id && p.status !== 'complete');
      if (!action && unfinished) { rival.publicActivity = 'Continuing funded research and model work.'; continue; }
      const newCandidate = Object.values(state.slices.models.versions).filter(m => m.companyId === company.id && m.trainingRunId && state.slices.models.trainingRuns[m.trainingRunId]?.outputModelId === m.id && state.slices.models.trainingRuns[m.trainingRunId]?.status === 'complete').find(m => !m.evaluationReportId);
      if (!action && newCandidate) publish({ kind: 'evaluate_model', modelId: newCandidate.id, suiteId: 'expanded-capabilities-1' }, 'Testing a new candidate before release.');
      if (!action && live) {
        const d = productDemand(state, live, ctx.content, ctx.week);
        const better = Object.values(state.slices.models.versions).find(m => m.companyId === company.id && m.id !== d.model.id && m.evaluationReportId && m.reliabilityBps >= d.model.reliabilityBps && m.capabilityBps[live.kind === 'developer-api' ? 'coding' : live.kind === 'business-docs' ? 'documents' : 'conversation'] >= d.model.capabilityBps[live.kind === 'developer-api' ? 'coding' : live.kind === 'business-docs' ? 'documents' : 'conversation'] && (m.reliabilityBps > d.model.reliabilityBps || (m.behavior?.confidentErrorBps ?? 1000) < (d.model.behavior?.confidentErrorBps ?? 1000)));
        if (better) publish({ kind: 'upgrade_product', productId: live.id, modelId: better.id }, 'Deploying a tested model update.');
      }
      if (!action) {
        const priority = rival.style === 'efficient' ? ['R5','R1A','R5A'] : ['R1A','R5A','R5','R4','R3'];
        const options = getResearchView(state, company.id, ctx.content).filter(r => r.status === 'available' && r.feeCents <= budget);
        const research = priority.map(id => options.find(r => r.id === id)).find(Boolean);
        if (research) publish({ kind: 'start_research', researchId: research.id }, 'Investing in evaluation and model research.');
      }
      if (!action && live && budget >= base * 2) {
        const modelId = state.slices.products.deployments[live.deploymentId].modelId;
        const packets = Object.values(state.slices.data.packets).filter(p => p.companyId === company.id && p.prepared);
        for (const recipeId of ['calibration-curriculum','behavior-reliability']) {
          const p = packets.find(p => (p.behaviorUnits ?? 0) >= 100); if (!p) continue;
          const payload = { kind: 'start_training' as const, baseModelId: modelId, packetId: p.id, recipeId };
          if (!lab.validateCommand!(state, { id: `rival-preview-${company.id}-${ctx.week}-${recipeId}`, companyId: company.id, issuedForWeek: ctx.week + 1, payload }, ctx.content)) { publish(payload, 'Training a behavior-focused model candidate.'); break; }
        }
      }
      if (!action && !competitive && live && budget > base * 8 && ctx.week - rival.lastPriceWeek >= 8) {
        const d = productDemand(state, live, ctx.content, ctx.week);
        const proposed = Math.max(100, Math.floor(d.contract.weeklyPriceCents * .95));
        const marginal = Math.ceil(d.meter.work * Math.min(d.contract.allowance, live.kind === 'developer-api' ? 600 : live.kind === 'business-docs' ? 3000 : 100) / RESOURCE_SCALE * ctx.content.opening.rentCentsPerCUWeek);
        if (proposed > marginal * 1.25) { publish({ kind: 'set_product_terms', productId: live.id, priceCents: proposed, allowance: d.contract.allowance }, 'Lowered public prices while retaining a positive contribution.'); rival.lastPriceWeek = ctx.week; }
      }
    }
    if (action) { commands.push({ companyId: company.id, payload: action }); rival.publicActivity = 'Planning: ' + activity; rival.lastActionWeek = ctx.week; }
    else rival.publicActivity = 'Maintaining current products and cash reserves.';
  }
  return { updates: { markets }, commands };
}

export function rivalOperatingBudget(state: Readonly<GameState>, companyId: string, content: GameContent) {
  const company = state.slices.company.companies[companyId], rival = state.slices.markets.rivals[companyId];
  const base = getWeeklyBaseCost(state as GameState, content, companyId);
  const loss = Math.max(0, base - company.lastWeek.revenueCents);
  const reserve = Math.max(base * 8, loss * rival.reserveWeeks);
  const committed = state.queuedCommands.filter(command => command.companyId === companyId).reduce((sum, command) => sum + (command.reservedCents ?? 0), 0);
  return { base, reserve, budget: Math.max(0, company.cashCents - reserve - committed) };
}

function campaignSegment(kind: RivalCampaignKind, style: RivalState['style']) {
  return kind === 'value-expansion' ? 'developers' : kind === 'enterprise-service' ? 'business' : kind === 'quality-leadership' ? 'professional'
    : style === 'efficient' ? 'developers' : style === 'enterprise' ? 'business' : 'regular';
}

export function createRivalCampaign(state: Readonly<GameState>, rival: RivalState, content: GameContent, week = state.week): RivalCampaign {
  const company = state.slices.company.companies[rival.companyId], financial = rivalOperatingBudget(state, rival.companyId, content);
  const kind: RivalCampaignKind = company.cashCents < financial.reserve ? 'cash-recovery' : rival.style === 'efficient' ? 'value-expansion'
    : rival.style === 'enterprise' ? 'enterprise-service' : 'quality-leadership';
  const offer = Object.values(state.slices.products.offers).find(product => product.companyId === rival.companyId && product.status === 'active');
  const demand = offer ? productDemand(state, offer, content, week) : null;
  const targetSegment = campaignSegment(kind, rival.style);
  const tactics = state.contentVersion === GAMEPLAY_POLISH_CONTENT_VERSION
    ? { version: 1 as const, focus: rivalTacticFor(state.seed, rival.companyId, week, rival.style) } : undefined;
  return { id: `rival-campaign:${rival.companyId}:${week}`, kind, startedWeek: week,
    ...(tactics ? { tactics } : {}),
    reviewWeek: week + RIVAL_CAMPAIGN_RULES[kind].durationWeeks, targetSegment,
    startingCashCents: company.cashCents, startingAccounts: state.slices.markets.cohorts.filter(cohort => cohort.companyId === rival.companyId
      && (cohort.segmentId ?? 'regular') === targetSegment && cohort.activeWeek <= week).reduce((sum, cohort) => sum + cohort.count, 0),
    startingModelId: demand?.model.id ?? null, startingPriceCents: demand?.contract.weeklyPriceCents ?? null,
    priceTargetCents: rivalCampaignPriceTarget(kind, demand?.contract.weeklyPriceCents ?? null, tactics?.focus),
    reserveTargetCents: financial.reserve, status: kind === 'cash-recovery' ? 'protecting-cash' : 'pursuing',
    lastDecisionWeek: week, lastDecision: 'A public direction; individual steps still need available cash, capacity and completed work.' };
}

function efficientModelImprovement(candidate: ModelVersion, baseline: ModelVersion, domain: keyof ModelVersion['capabilityBps']): boolean {
  return candidate.reliabilityBps >= baseline.reliabilityBps && candidate.capabilityBps[domain] >= baseline.capabilityBps[domain] - 300
    && requestMeter(candidate, { ...DEFAULT_FEATURES }).work <= Math.floor(requestMeter(baseline, { ...DEFAULT_FEATURES }).work * 0.9);
}

function campaignAchieved(state: Readonly<GameState>, rival: RivalState, live: ProductOffer | undefined, content: GameContent): boolean {
  const campaign = rival.campaign!;
  if (campaign.kind === 'cash-recovery') return state.slices.company.companies[rival.companyId].cashCents >= campaign.reserveTargetCents;
  if (!live) return false;
  const demand = productDemand(state, live, content, state.week), baseline = campaign.startingModelId ? state.slices.models.versions[campaign.startingModelId] : null;
  const domain = campaign.tactics ? live.kind === 'developer-api' ? 'coding' : live.kind === 'business-docs' ? 'documents' : 'conversation'
    : campaign.kind === 'enterprise-service' ? 'documents' : 'conversation';
  if (campaign.tactics?.focus === 'efficiency' && (!baseline || !efficientModelImprovement(demand.model, baseline, domain))) return false;
  if (campaign.kind === 'value-expansion') {
    const accounts = state.slices.markets.cohorts.filter(cohort => cohort.companyId === rival.companyId && cohort.segmentId === 'developers'
      && cohort.activeWeek <= state.week).reduce((sum, cohort) => sum + cohort.count, 0);
    return campaign.priceTargetCents !== null && demand.contract.weeklyPriceCents <= campaign.priceTargetCents && accounts >= campaign.startingAccounts;
  }
  if (campaign.kind === 'enterprise-service' && Object.values(state.slices.products.commercialContracts).some(contract => contract.companyId === rival.companyId
    && contract.status === 'active' && contract.signedWeek >= campaign.startedWeek)) return true;
  if (campaign.tactics?.focus === 'efficiency' && baseline && demand.model.id !== baseline.id) return true;
  return !!baseline && demand.model.id !== baseline.id && demand.model.status === 'released' && demand.model.reliabilityBps >= baseline.reliabilityBps
    && demand.model.capabilityBps[domain] >= baseline.capabilityBps[domain]
    && (demand.model.reliabilityBps > baseline.reliabilityBps || demand.model.capabilityBps[domain] > baseline.capabilityBps[domain]
      || (demand.model.behavior?.confidentErrorBps ?? 1000) < (baseline.behavior?.confidentErrorBps ?? 1000));
}

/** A campaign persists across review intervals. Each step is still an ordinary paid command. */
function planRivalCampaigns(state: Readonly<GameState>, ctx: ModuleContext): DomainResult {
  const markets = structuredClone(state.slices.markets), commands: NonNullable<DomainResult['commands']> = [];
  const messages: NonNullable<DomainResult['messages']> = [];
  const announcement = marketOpportunityAnnouncement(state, ctx.week);
  if (announcement) messages.push({ category: 'market', message: announcement });
  const owners: DomainModule[] = [createLabModule(ctx.content), createResearchModule(ctx.content), createProductsModule(ctx.content), createComputeModule(ctx.content)];
  for (const rival of Object.values(markets.rivals)) {
    const company = state.slices.company.companies[rival.companyId], fleet = state.slices.compute.fleets[rival.companyId];
    if (company.arrearsCents > 0) {
      rival.withdrawn = true; rival.publicActivity = 'Operations suspended after unpaid bills.';
      if (rival.campaign) { rival.campaign.status = 'protecting-cash'; rival.campaign.lastDecisionWeek = ctx.week; rival.campaign.lastDecision = rival.publicActivity; }
      continue;
    }
    const financial = rivalOperatingBudget(state, company.id, ctx.content);
    const offers = Object.values(state.slices.products.offers).filter(product => product.companyId === company.id), live = offers.find(product => product.status === 'active');
    if (!rival.campaign || ctx.week >= rival.campaign.reviewWeek) {
      rival.campaign = createRivalCampaign(state, rival, ctx.content, ctx.week);
      messages.push({ category: 'market', public: true, companyId: company.id,
        message: `${company.name} announced “${RIVAL_CAMPAIGN_RULES[rival.campaign.kind].name}”${rival.campaign.tactics ? ' · ' + RIVAL_TACTIC_RULES[rival.campaign.tactics.focus].name : ''}, with a strategy review in Week ${rival.campaign.reviewWeek}. Plans depend on its ordinary budget and delivered results.` });
    }
    const campaign = rival.campaign;
    campaign.status = company.cashCents < financial.reserve ? 'protecting-cash' : campaignAchieved(state, rival, live, ctx.content) ? 'completed' : 'pursuing';
    if (rival.nextPlanWeek > ctx.week || state.queuedCommands.some(command => command.companyId === company.id)) continue;
    // Tactical steps may advance every two weeks; strategic direction lasts a full campaign.
    rival.nextPlanWeek = ctx.week + Math.min(2, rival.interval);
    let action: CommandPayload | undefined, activity = '';
    const propose = (payload: CommandPayload, label: string, speculative = false): boolean => {
      if (action || speculative && (campaign.status !== 'pursuing' || financial.budget < financial.base * 2)) return false;
      const owner = owners.find(module => module.commandKinds?.includes(payload.kind));
      if (!owner?.validateCommand || !owner.quoteCommand) return false;
      const command = { id: `rival-preview-${company.id}-${ctx.week}`, companyId: company.id, issuedForWeek: ctx.week + 1, payload };
      if (owner.validateCommand(state, command, ctx.content)) return false;
      const quote = owner.quoteCommand(state, command, ctx.content);
      // Include eight weeks of a new recurring obligation; ordinary overhead remains reserved.
      if (quote.upfrontCostCents + Math.max(0, quote.weeklyCostDeltaCents) * 8 > financial.budget) return false;
      action = payload; activity = label; return true;
    };
    const pressure = offers.filter(product => product.status === 'active').reduce((sum, product) => {
      const demand = productDemand(state, product, ctx.content, ctx.week + 1); return sum + demand.paidWork + demand.trialWork;
    }, 0);
    const researching = Object.values(state.slices.research.projects).some(project => project.companyId === company.id && project.status !== 'complete');
    const developing = Object.values(state.slices.models.trainingRuns).some(run => run.companyId === company.id && run.status !== 'complete')
      || Object.values(state.slices.models.evaluationRuns).some(run => run.companyId === company.id && run.status !== 'complete')
      || !!campaign.tactics && Object.values(state.slices.models.applicationRuns ?? {}).some(run => run.companyId === company.id && run.status !== 'complete');
    const unfinished = researching || developing;
    const minimumResearch = campaign.tactics && (researching || campaign.status === 'pursuing') ? RESOURCE_SCALE : 0;
    const minimumDevelopment = campaign.tactics && (developing || campaign.status === 'pursuing') ? RESOURCE_SCALE : 0;
    const desiredServing = Math.ceil(pressure * (campaign.tactics ? 1.25 : 1.1) / (RESOURCE_SCALE / 4)) * (RESOURCE_SCALE / 4);
    const failing = offers.some(product => (state.slices.products.lastUsage[product.id]?.paidAccounts ?? 0) > 0
      && (state.slices.products.lastUsage[product.id]?.fulfillmentBps ?? 10000) < 9800);
    const needsCapacity = campaign.tactics ? failing || pressure > fleet.allocation.serving * 0.95
      || fleet.allocation.research < minimumResearch || fleet.allocation.development < minimumDevelopment : failing || desiredServing > fleet.allocation.serving;
    const plannedCapacity = desiredServing + minimumResearch + minimumDevelopment;
    if (needsCapacity && plannedCapacity <= fleet.cloudCU + fleet.ownedCU) {
      const remaining = fleet.cloudCU + fleet.ownedCU - desiredServing;
      const research = campaign.tactics ? Math.max(minimumResearch, Math.min(fleet.allocation.research, remaining - minimumDevelopment)) : Math.min(fleet.allocation.research, remaining);
      if (desiredServing > fleet.allocation.serving || campaign.tactics && (fleet.allocation.research < minimumResearch || fleet.allocation.development < minimumDevelopment))
        propose({ kind: 'allocate_compute', serving: desiredServing, research, development: Math.max(0, remaining - research) }, campaign.tactics
          ? 'Reserved serving headroom while retaining a small funded engineering budget.' : 'Moved existing capacity to protect customer service.');
    }
    if (!action && (campaign.tactics ? failing || needsCapacity && plannedCapacity > fleet.cloudCU + fleet.ownedCU : failing || desiredServing > fleet.cloudCU + fleet.ownedCU) && fleet.cloudCU < ctx.content.firstSale.maxCloudCU)
      propose({ kind: 'set_cloud_capacity', cu: Math.min(ctx.content.firstSale.maxCloudCU, fleet.cloudCU + 4 * RESOURCE_SCALE) }, 'Reserved additional paid cloud capacity to repair service.');
    if (!action && campaign.status === 'protecting-cash' && live && ctx.week - rival.lastPriceWeek >= 8) {
      const demand = productDemand(state, live, ctx.content, ctx.week), maximum = live.kind === 'basic-chat' ? 10000 : 100000;
      const price = Math.min(maximum, Math.ceil(demand.contract.weeklyPriceCents * 1.1));
      if (price > demand.contract.weeklyPriceCents && propose({ kind: 'set_product_terms', productId: live.id, priceCents: price, allowance: demand.contract.allowance }, 'Protected operating runway with a revised public price.')) rival.lastPriceWeek = ctx.week;
    }
    // A tight budget stops new projects; it does not erase or restart already-paid work.
    if (!action && campaign.status === 'protecting-cash' && !unfinished) {
      const target = Math.min(fleet.cloudCU, Math.max(4 * RESOURCE_SCALE, Math.ceil((desiredServing + 2 * RESOURCE_SCALE) / RESOURCE_SCALE) * RESOURCE_SCALE));
      const allocated = fleet.allocation.serving + fleet.allocation.development + fleet.allocation.research;
      if (target < fleet.cloudCU && allocated > target + fleet.ownedCU) propose({ kind: 'allocate_compute', serving: Math.min(fleet.allocation.serving, desiredServing), development: RESOURCE_SCALE, research: RESOURCE_SCALE }, 'Reduced idle allocations before releasing cloud capacity.');
      else if (target < fleet.cloudCU) propose({ kind: 'set_cloud_capacity', cu: target }, 'Released idle cloud capacity to reduce ongoing costs.');
    }
    if (!action && campaign.status === 'pursuing' && live) {
      const demand = productDemand(state, live, ctx.content, ctx.week), usage = state.slices.products.lastUsage[live.id];
      if (campaign.kind === 'value-expansion') {
        if (live.strategy?.audience !== 'value') propose({ kind: 'set_product_strategy', productId: live.id, audience: 'value', routingPolicy: 'balanced' }, 'Positioned its API for value-conscious developer teams.');
        if (!action && campaign.priceTargetCents !== null && ctx.week - rival.lastPriceWeek >= 8) {
          const price = Math.max(campaign.priceTargetCents, demand.contract.weeklyPriceCents - 300);
          const servingCost = Math.ceil(fleet.lastWork.serving / RESOURCE_SCALE * ctx.content.opening.rentCentsPerCUWeek);
          if (usage?.paidAccounts && price < demand.contract.weeklyPriceCents && usage.billedCents * price >= servingCost * 1.25 * demand.contract.weeklyPriceCents
            && propose({ kind: 'set_product_terms', productId: live.id, priceCents: price, allowance: demand.contract.allowance }, 'Advanced its announced lower-bill target while protecting serving contribution.')) rival.lastPriceWeek = ctx.week;
        }
      } else if (campaign.kind === 'enterprise-service') {
        const customer = BUSINESS_BY_ID['northline-operations'], contract = state.slices.products.commercialContracts['business:' + customer.id];
        if (contract?.companyId === company.id && ['building', 'ready', 'active'].includes(contract.status) && !contract.autoRenew)
          propose({ kind: 'set_business_renewal', contractId: contract.id, renew: true }, `Offered to renew with ${customer.name}, subject to delivered service.`);
        if (!action && ctx.week >= 36 && (!contract || contract.endedWeek !== null && ctx.week >= contract.endedWeek + COMMERCE_RULES.reofferDelayWeeks))
          propose({ kind: 'sign_business_contract', customerId: customer.id, contractKind: 'customer-hosted', modelId: demand.model.id }, `Pursuing a paid, qualified license with ${customer.name}.`, true);
      }
      if (!action && campaign.tactics?.focus === 'reach' && campaign.kind !== 'value-expansion') {
        if (live.strategy?.audience !== 'broad') propose({ kind: 'set_product_strategy', productId: live.id, audience: 'broad', routingPolicy: 'balanced' }, 'Opened its existing service to a broader audience without adding free customers.');
        const price = campaign.priceTargetCents;
        const servingCost = Math.ceil(fleet.lastWork.serving / RESOURCE_SCALE * ctx.content.opening.rentCentsPerCUWeek);
        if (!action && price !== null && ctx.week - rival.lastPriceWeek >= 8 && price < demand.contract.weeklyPriceCents && usage?.paidAccounts
          && usage.billedCents * price >= servingCost * 1.25 * demand.contract.weeklyPriceCents
          && propose({ kind: 'set_product_terms', productId: live.id, priceCents: price, allowance: demand.contract.allowance }, 'Tested its announced five-percent lower bill while preserving serving contribution.')) rival.lastPriceWeek = ctx.week;
      }
      if (!action && campaign.tactics?.focus !== 'reach' && campaign.kind !== 'value-expansion' && taskScore(demand.model, SEGMENT_BY_ID[campaign.targetSegment], demand.features, demand.documentBonusBps) >= 7500
        && demand.model.reliabilityBps >= 9000 && (usage?.fulfillmentBps ?? 10000) >= 9500 && live.strategy?.audience !== 'professional')
        propose({ kind: 'set_product_strategy', productId: live.id, audience: 'professional', routingPolicy: 'balanced' }, 'Positioned its qualified service for demanding professional work.');
    }
    if (!action && unfinished) {
      const servingMemory = offers.filter(product => product.status === 'active').reduce((sum, product) => sum + productDemand(state, product, ctx.content, ctx.week + 1).memory, 0);
      const trainingMemory = Math.max(0, ...Object.values(state.slices.models.trainingRuns).filter(run => run.companyId === company.id && run.status === 'running').map(run => run.requiredMemory));
      if (servingMemory + trainingMemory > fleet.memoryMU && fleet.cloudCU < ctx.content.firstSale.maxCloudCU)
        propose({ kind: 'set_cloud_capacity', cu: Math.min(ctx.content.firstSale.maxCloudCU, fleet.cloudCU + 4 * RESOURCE_SCALE) }, 'Funded memory headroom so paid model work can continue alongside service.');
      if (!action) activity = 'Continuing funded research, training or evaluation before the next campaign step.';
    }
    if (!action && !unfinished && campaign.status === 'pursuing' && live) {
      const demand = productDemand(state, live, ctx.content, ctx.week), domain = live.kind === 'developer-api' ? 'coding' : live.kind === 'business-docs' ? 'documents' : 'conversation';
      const models = Object.values(state.slices.models.versions).filter(model => model.companyId === company.id);
      const candidate = models.find(model => !model.evaluationReportId && (model.trainingRunId && state.slices.models.trainingRuns[model.trainingRunId]?.outputModelId === model.id
        && state.slices.models.trainingRuns[model.trainingRunId]?.status === 'complete' || campaign.tactics && model.runtimeVariant
        && state.slices.models.applicationRuns[model.runtimeVariant.applicationId]?.outputModelId === model.id
        && state.slices.models.applicationRuns[model.runtimeVariant.applicationId]?.status === 'complete'));
      if (candidate) propose({ kind: 'evaluate_model', modelId: candidate.id, suiteId: 'expanded-capabilities-1' }, 'Independently testing its finished candidate before a public release.');
      const better = models.filter(model => model.id !== demand.model.id && model.evaluationReportId && (campaign.tactics?.focus === 'efficiency' && efficientModelImprovement(model, demand.model, domain)
        || (campaign.tactics?.focus !== 'efficiency' || requestMeter(model, { ...DEFAULT_FEATURES }).work <= requestMeter(demand.model, { ...DEFAULT_FEATURES }).work)
        && model.reliabilityBps >= demand.model.reliabilityBps && model.capabilityBps[domain] >= demand.model.capabilityBps[domain] && (model.reliabilityBps > demand.model.reliabilityBps
          || model.capabilityBps[domain] > demand.model.capabilityBps[domain] || (model.behavior?.confidentErrorBps ?? 1000) < (demand.model.behavior?.confidentErrorBps ?? 1000))))
        .sort((left, right) => right.capabilityBps[domain] - left.capabilityBps[domain] || right.reliabilityBps - left.reliabilityBps || left.id.localeCompare(right.id))[0];
      if (!action && better) propose({ kind: 'upgrade_product', productId: live.id, modelId: better.id }, 'Releasing its independently tested model improvement.');
      if (!action && campaign.tactics?.focus === 'efficiency' && !demand.model.runtimeVariant)
        propose({ kind: 'create_model_variant', modelId: demand.model.id, variant: 'compression' }, 'Funding a compressed deployment candidate; its task tradeoff will need a separate paid evaluation.', true);
      if (!action) {
        const priority = campaign.tactics?.focus === 'efficiency' ? ['R7', 'R1A', 'R5A', 'R5']
          : campaign.tactics?.focus === 'reach' || campaign.kind === 'value-expansion' ? ['R5', 'R1A', 'R5A'] : ['R1A', 'R5A', 'R5'];
        const options = getResearchView(state, company.id, ctx.content).filter(research => research.status === 'available');
        for (const id of priority) if (options.some(research => research.id === id) && propose({ kind: 'start_research', researchId: id }, 'Funded the next research prerequisite for its announced model campaign.', true)) break;
      }
      if (!action) {
        const packet = Object.values(state.slices.data.packets).find(item => item.companyId === company.id && item.prepared && (item.behaviorUnits ?? 0) >= 100);
        const recipes = campaign.tactics?.focus === 'reliability' ? ['calibration-curriculum', 'behavior-reliability', ...(campaign.kind === 'quality-leadership' ? ['medium-foundation'] : [])]
          : [...(campaign.kind === 'quality-leadership' ? ['medium-foundation'] : []), 'behavior-reliability', 'calibration-curriculum'];
        if (packet) for (const recipeId of recipes) {
          const payload: Extract<CommandPayload, { kind: 'start_training' }> = { kind: 'start_training', baseModelId: demand.model.id, packetId: packet.id, recipeId };
          const preview = getTrainingPreview(state, company.id, payload, ctx.content);
          if (preview.reason || preview.feeCents > financial.budget || preview.capabilityRange.minimum[domain] < demand.model.capabilityBps[domain]
            || preview.reliabilityRange.minimum < demand.model.reliabilityBps) continue;
          if (preview.memoryMU + demand.memory > fleet.memoryMU) {
            if (fleet.cloudCU < ctx.content.firstSale.maxCloudCU && propose({ kind: 'set_cloud_capacity', cu: Math.min(ctx.content.firstSale.maxCloudCU, fleet.cloudCU + 4 * RESOURCE_SCALE) }, 'Reserved paid memory capacity before starting its model candidate.', true)) break;
          } else if (propose(payload, 'Started a paid model candidate for its multiweek campaign.', true)) break;
        }
      }
    }
    if (action) { commands.push({ companyId: company.id, payload: action }); rival.lastActionWeek = ctx.week; }
    campaign.lastDecisionWeek = ctx.week;
    campaign.lastDecision = activity || (campaign.status === 'completed' ? 'The announced objective was reached; maintaining service until the scheduled strategy review.'
      : campaign.status === 'protecting-cash' ? 'Holding new projects while protecting operating reserves.' : 'Maintaining the current offer; the next affordable improvement is not ready yet.');
    rival.publicActivity = `${RIVAL_CAMPAIGN_RULES[campaign.kind].name}${campaign.tactics ? ' · ' + RIVAL_TACTIC_RULES[campaign.tactics.focus].name : ''}: ${action ? 'planning to act next week. ' : ''}${campaign.lastDecision}`;
  }
  return { updates: { markets }, commands, messages };
}
