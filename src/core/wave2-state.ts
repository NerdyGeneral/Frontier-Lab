import type { GameContent, GameState, MarketSegmentId, ModelVersion, ProductKind, StaffRole } from '../contracts/types';
import { RESOURCE_SCALE } from '../contracts/types';
import { MARKET_SEGMENTS, DEFAULT_FEATURES } from '../content/wave2-market';

const zeroRoles = () => ({ research: 0, ml: 0, data: 0, infrastructure: 0, commercial: 0, hardware: 0 });
export const RIVAL_STARTS = [
  { id: 'atlas', name: 'Atlas Systems', style: 'frontier' as const, cash: 18_000_000, cu: 16, roles: ['research','research','ml','ml','data','commercial'] as StaffRole[], kind: 'basic-chat' as ProductKind, count: 250, interval: 8, reserve: 16, price: 1200, allowance: 100, family: 'medium' as const, scores: { conversation: 6400, documents: 5800, coding: 5000, tools: 4600 }, reliability: 9200, research: ['R1','R2','R3','R4','R5'], activity: 'Established consumer platform; pursuing model research.' },
  { id: 'swift', name: 'Swiftworks', style: 'efficient' as const, cash: 9_000_000, cu: 8, roles: ['ml','ml','data','commercial'] as StaffRole[], kind: 'developer-api' as ProductKind, count: 40, interval: 4, reserve: 10, price: 6000, allowance: 600, family: 'compact' as const, scores: { conversation: 4800, documents: 4000, coding: 5800, tools: 5400 }, reliability: 9000, research: ['R1','R2','R3','R4'], activity: 'Coding API specialist; prioritizing efficient delivery.' },
  { id: 'harbor', name: 'Harbor AI', style: 'enterprise' as const, cash: 12_000_000, cu: 8, roles: ['ml','infrastructure','commercial','commercial'] as StaffRole[], kind: 'business-docs' as ProductKind, count: 8, interval: 6, reserve: 16, price: 30000, allowance: 3000, family: 'compact' as const, scores: { conversation: 6200, documents: 7200, coding: 4000, tools: 5000 }, reliability: 9600, research: ['R1','R2','R3','R5','R6','R9','R10','R12'], activity: 'Private document provider; inherited enterprise certification.' },
];
/** Adds authored competitors once. Starting cash/models/contracts are scenario assets, not periodic grants. */
export function seedRivals(state: GameState, content: GameContent): void {
  for (const seed of RIVAL_STARTS) {
    const companyId = 'rival-' + seed.id; if (state.slices.company.companies[companyId]) continue;
    const week = state.week;
    state.slices.company.companies[companyId] = { id: companyId, name: seed.name, cashCents: seed.cash, arrearsCents: 0, founderOwnershipBps: 10000, founderFte: RESOURCE_SCALE, activeStaff: seed.roles.length, earnedRevenueCents: 0, totalOperatingExpenseCents: 0, lastWeek: { revenueCents: 0, operatingExpenseCents: 0, cashChangeCents: 0 } };
    state.slices.company.founderAssignments[companyId] = { ...zeroRoles(), research: RESOURCE_SCALE };
    for (const [index, role] of seed.roles.entries()) { const id = companyId + '-staff-' + index; state.slices.company.staff[id] = { id, companyId, role, hiredWeek: week, readyWeek: week, assignedFte: RESOURCE_SCALE, scenarioStart: true }; }
    state.slices.compute.fleets[companyId] = { companyId, cloudCU: seed.cu * RESOURCE_SCALE, ownedCU: 0, memoryMU: seed.cu * 2 * RESOURCE_SCALE, occupiedMemoryMU: 0, allocation: { serving: (seed.cu === 16 ? 12 : 6) * RESOURCE_SCALE, development: (seed.cu === 16 ? 2 : 1) * RESOURCE_SCALE, research: (seed.cu === 16 ? 2 : 1) * RESOURCE_SCALE }, lastWork: { serving: 0, development: 0, research: 0 }, reservedCU: 0, deliveredEquipmentIds: [], inventory: {}, lastBottleneck: '', lastReservedMemoryMU: 0, lastGrants: [], variableCostCarry: 0 };
    const modelId = companyId + '-model-1', reportId = companyId + '-baseline-report';
    const model: ModelVersion = { id: modelId, name: seed.name + ' v1', companyId, family: seed.family, architecture: 'dense', status: 'released', capabilityBps: { ...seed.scores }, reliabilityBps: seed.reliability, residentMU: (seed.family === 'medium' ? 8 : 2) * RESOURCE_SCALE, source: 'Authored competitor starting release', evaluationReportId: reportId, createdWeek: week, scenarioStart: true, behavior: { confidentErrorBps: 1000, falseRefusalBps: 700 }, foundationAnchor: { ...seed.scores } };
    state.slices.models.versions[modelId] = model;
    const cases = Array.from({ length: 20 }, (_, i) => ({ id: reportId + '-case-' + i, domain: (['conversation','documents','coding','tools'] as const)[i % 4], difficultyBps: i % 5 * 1000, passed: i % 5 !== 4 }));
    state.slices.models.reports[reportId] = { id: reportId, companyId, modelId, week, heldOut: true, scenarioStart: true, suiteId: 'basic-conversation-1', capabilityBps: { ...model.capabilityBps }, reliabilityBps: model.reliabilityBps, cases, passedCases: 16, basicChatEligible: model.capabilityBps.conversation >= content.firstSale.minConversationBps && model.reliabilityBps >= content.firstSale.minReliabilityBps };
    const dataId = companyId + '-starter-data';
    state.slices.data.packets[dataId] = { ...structuredClone(content.starterData), id: dataId, name: seed.name + ' starting corpus', companyId, catalogId: 'scenario-corpus', sourceIds: [dataId], rawUnits: 500, readyUnits: 500, qualityBps: 8000, coverageBps: { conversation: 6000, documents: 6000, coding: 6000, tools: 6000 }, prepared: true, broadUnits: 500, behaviorUnits: 100 };
    state.slices.research.completedByCompany[companyId] = [...seed.research];
    const productId = companyId + '-product', deploymentId = companyId + '-deployment', contractId = companyId + '-contract';
    state.slices.products.offers[productId] = { id: productId, companyId, name: seed.kind === 'developer-api' ? 'Swift API' : seed.kind === 'business-docs' ? 'Harbor Private Docs' : 'Atlas Chat', kind: seed.kind, features: { ...DEFAULT_FEATURES }, publicModelId: modelId, deploymentId, contractId, status: 'active', createdWeek: week };
    state.slices.products.deployments[deploymentId] = { id: deploymentId, companyId, productId, modelId, status: 'active', startedWeek: week, requiredStaff: RESOURCE_SCALE, completedStaff: RESOURCE_SCALE, readyWeek: week, lastBottleneck: '', scenarioStart: true };
    state.slices.products.contracts[contractId] = { id: contractId, companyId, productId, weeklyPriceCents: seed.price, allowance: seed.allowance, creditBps: 10000, effectiveWeek: week };
    state.slices.products.activeIds.push(productId);
    const allocations: [MarketSegmentId, number][] = seed.kind === 'basic-chat' ? [['casual',113],['regular',87],['heavy',38],['professional',12]] : [[seed.kind === 'developer-api' ? 'developers' : 'business', seed.count]];
    for (const [segmentId, desired] of allocations) {
      const segment = MARKET_SEGMENTS.find(s => s.id === segmentId)!;
      const occupied = state.slices.markets.cohorts.filter(c => (c.segmentId ?? 'regular') === segmentId).reduce((n, c) => n + c.count, 0) + state.slices.markets.trials.filter(t => (t.segmentId ?? 'regular') === segmentId).reduce((n, t) => n + t.count, 0);
      const count = Math.min(desired, Math.max(0, segment.population - occupied));
      if (count) state.slices.markets.cohorts.push({ id: companyId + '-cohort-' + segmentId, companyId, productId, contractId, segmentId, count, activeWeek: week, ...(segmentId === 'business' ? { renewalWeek: week + 12, breachWeeks: 0 } : {}) });
    }
    state.slices.markets.companyTrustBps[companyId] = 5000;
    state.slices.markets.rivals[companyId] = { companyId, style: seed.style, interval: seed.interval, reserveWeeks: seed.reserve, nextPlanWeek: week + seed.interval, lastPriceWeek: week, publicActivity: seed.activity, lastActionWeek: week, withdrawn: false };
    state.slices.markets.activeRivalIds.push(companyId);
  }
}
/** Additive defaults used by both new games and validated historical migrations. */
export function initializeWave2Fields(state: GameState, content: GameContent, includeRivals = true): void {
  state.slices.compute.racks ??= {}; state.slices.compute.facilities ??= {};
  for (const f of Object.values(state.slices.compute.fleets)) f.variableCostCarry ??= 0;
  const r = state.slices.research; r.projects ??= {}; r.completedByCompany ??= {}; r.completedByCompany[state.playerCompanyId] ??= [...r.completed];
  const m = state.slices.markets; m.companyTrustBps ??= {}; m.companyTrustBps[state.playerCompanyId] ??= m.trustBps; m.carries ??= {}; m.shopperCarry ??= {}; m.rivals ??= {}; m.returnedNextWeek ??= {};
  if (!m.carries[state.playerCompanyId + ':regular']) m.carries[state.playerCompanyId + ':regular'] = { conversion: m.conversionCarry, churn: m.churnCarry, reach: m.reachCarry };
  for (const packet of Object.values(state.slices.data.packets)) { packet.companyId ??= state.playerCompanyId; packet.catalogId ??= packet.id; packet.sourceIds ??= [packet.id]; }
  for (const model of Object.values(state.slices.models.versions)) { model.behavior ??= { confidentErrorBps: 1000, falseRefusalBps: 700 }; }
  for (const p of Object.values(state.slices.products.offers)) { p.features ??= { ...DEFAULT_FEATURES }; const deployment = state.slices.products.deployments[p.deploymentId]; if (deployment?.status === 'active') p.publicModelId ??= deployment.modelId; }
  for (const c of m.cohorts) c.segmentId ??= 'regular';
  for (const t of m.trials) { t.segmentId ??= 'regular'; t.workPerAccount ??= content.firstSale.trialWork; }
  // A large legacy regular-only market is split without deleting accounts or work.
  const populations = Object.fromEntries(MARKET_SEGMENTS.map(s => [s.id, s.population]));
  const consumed: Record<string, number> = {};
  for (const collection of [m.cohorts, m.trials]) {
    for (const c of [...collection]) {
      const segment = c.segmentId ?? 'regular', room = Math.max(0, populations[segment] - (consumed[segment] ?? 0));
      let overflow = Math.max(0, c.count - room); const keep = c.count - overflow;
      if (!overflow) { consumed[segment] = (consumed[segment] ?? 0) + c.count; continue; }
      c.count = keep; consumed[segment] = (consumed[segment] ?? 0) + keep;
      if ('requiredWork' in c) c.requiredWork = keep * (c.workPerAccount ?? content.firstSale.trialWork);
      let firstSplit = true;
      for (const target of ['casual','heavy','professional','regular'] as MarketSegmentId[]) {
        if (!overflow) break; const n = Math.min(overflow, Math.max(0, populations[target] - (consumed[target] ?? 0))); if (!n) continue;
        const split = { ...structuredClone(c), id: keep === 0 && firstSplit ? c.id : c.id + '-segment-' + target, segmentId: target, count: n };
        if ('requiredWork' in split && 'workCompleted' in c) { split.requiredWork = n * (split.workPerAccount ?? content.firstSale.trialWork); split.workCompleted = keep ? 0 : c.workCompleted; c.workCompleted = keep ? c.workCompleted : 0; }
        (collection as typeof m.cohorts).push(split as typeof m.cohorts[number]); consumed[target] = (consumed[target] ?? 0) + n; overflow -= n; firstSplit = false;
      }
      if (overflow) throw new Error('Legacy customer population exceeds the finite market.');
    }
  }
  m.cohorts = m.cohorts.filter(c => c.count > 0); m.trials = m.trials.filter(t => t.count > 0);
  if (includeRivals) seedRivals(state, content);
}
