import assert from 'node:assert/strict';
import type { CommandPayload, GameState, StaffRole } from '../../src/contracts/types';
import { RESOURCE_SCALE as U } from '../../src/contracts/types';
import { CONTENT } from '../../src/content/catalog';
import { advanceWeek, submitCommand, validateState } from '../../src/core/engine';
import { canonicalStateHash } from '../../src/core/canonical';
import { getComputePools } from '../../src/modules/compute-pools';
import { productDemand } from '../../src/modules/products';
import { commercialCapacityRequests } from '../../src/modules/business';
import { getCampaignView } from '../../src/modules/campaign-progress';

export interface FrontierReceipt {
  stage: string; week: number; cashCents: number; revenueCents: number; expenseCents: number;
  cloudCU: number; ownedCU: number; hash: string;
}
export interface FrontierPlaythrough {
  state: GameState; receipts: FrontierReceipt[];
  commands: { week: number; id: string; payload: CommandPayload }[];
  modelId: string; minimumCashCents: number;
}

/**
 * A deterministic player strategy. It only changes the run through public commands
 * and weekly ticks. The initial run must itself be produced by the natural opening
 * strategy; this continuation supplies no money, model scores, research or assets.
 */
export function continueToFrontier(initial: GameState, report?: (receipt: FrontierReceipt) => void): FrontierPlaythrough {
  let state = initial, serial = 0, minimumCashCents = initial.slices.company.companies[initial.playerCompanyId].cashCents;
  let developmentBudget = 0, researchBudget = 0, cloudFloor = 0;
  const receipts: FrontierReceipt[] = [], commands: FrontierPlaythrough['commands'] = [];
  const owner = initial.playerCompanyId;
  const company = () => state.slices.company.companies[owner];
  const fleet = () => state.slices.compute.fleets[owner];
  const own = <T extends { companyId: string }>(records: Record<string, T>) => Object.values(records).filter(item => item.companyId === owner);
  const known = (id: string) => state.slices.research.completedByCompany[owner].includes(id);
  const mark = (stage: string) => {
    const c = company(), pools = getComputePools(state, owner);
    const receipt = { stage, week: state.week, cashCents: c.cashCents, revenueCents: c.lastWeek.revenueCents,
      expenseCents: c.lastWeek.operatingExpenseCents, cloudCU: fleet().cloudCU,
      ownedCU: pools.filter(pool => pool.ownership === 'owned').reduce((sum, pool) => sum + pool.capacityCU, 0), hash: canonicalStateHash(state) };
    receipts.push(receipt); report?.(receipt);
  };
  const queue = (payload: CommandPayload, label: string = payload.kind): string => {
    const id = `frontier:${label}:${++serial}`;
    const result = submitCommand(state, payload, CONTENT, id);
    assert.equal(result.accepted, true, `Week ${state.week}, ${label}: ${result.reason?.message}`);
    state = result.state; commands.push({ week: state.week, id, payload }); return id;
  };
  const tick = () => {
    manageCapacity();
    const pending = state.queuedCommands.filter(command => command.companyId === owner).map(command => command.id);
    const result = advanceWeek(state); assert.equal(result.accepted, true, `Week ${state.week}: ${result.reason?.message}`);
    state = result.state;
    for (const id of pending) assert.equal(state.commandReceipts[id]?.status, 'accepted', state.commandReceipts[id]?.reason?.message);
    minimumCashCents = Math.min(minimumCashCents, company().cashCents);
    assert.equal(company().arrearsCents, 0, `Week ${state.week}: the strategy ran out of operating cash.`);
  };
  const until = (done: () => boolean, label: string, limit = 160) => {
    let weeks = 0;
    while (!done() && weeks++ < limit) tick();
    assert.ok(done(), `${label} did not finish by Week ${state.week}. ${fleet().lastBottleneck}`);
  };
  const founder = (role: Exclude<StaffRole, 'hardware'>) => queue({ kind: 'assign_founder', allocations: { research: 0, ml: 0, data: 0, infrastructure: 0, commercial: 0, hardware: 0, [role]: U } });
  const ensureStaff = (role: StaffRole, count: number) => {
    const current = own(state.slices.company.staff).filter(member => member.role === role).length;
    for (let index = current; index < count; index++) queue({ kind: 'hire_staff', role });
  };
  const servingRequirement = () => {
    const offers = own(state.slices.products.offers).filter(offer => offer.status === 'active');
    const publicWork = offers.reduce((sum, offer) => {
      const demand = productDemand(state, offer, CONTENT, state.week + 1);
      return sum + demand.paidWork + demand.trialWork;
    }, 0);
    const privateWork = commercialCapacityRequests(state, owner).reduce((sum, request) => sum + request.normalizedWorkCUw, 0);
    // A visible planning reserve for the next week's trials, rounded to a physical CU.
    return Math.ceil((publicWork + privateWork) * 1.15 / U + 2) * U;
  };
  const manageCapacity = () => {
    const current = fleet(), serving = servingRequirement();
    const owned = getComputePools(state, owner).filter(pool => pool.ownership === 'owned').reduce((sum, pool) => sum + pool.capacityCU, 0);
    const cloud = Math.max(cloudFloor, Math.ceil(Math.max(0, serving + developmentBudget + researchBudget - owned) / U) * U);
    const pending = state.queuedCommands.filter(command => command.companyId === owner).map(command => command.payload.kind);
    if (cloud > current.cloudCU && !pending.includes('set_cloud_capacity')) queue({ kind: 'set_cloud_capacity', cu: cloud });
    // Renting and resizing remain separate weekly-boundary actions. An allocation
    // may only use capacity already installed or reserved in the current state.
    const available = current.cloudCU + current.ownedCU;
    const allocation = { serving: Math.min(serving, Math.max(0, available - developmentBudget - researchBudget)), development: developmentBudget, research: researchBudget };
    if (developmentBudget + researchBudget <= available && !pending.includes('allocate_compute')
      && Object.keys(allocation).some(key => allocation[key as keyof typeof allocation] !== current.allocation[key as keyof typeof allocation])) queue({ kind: 'allocate_compute', ...allocation });
    if (cloud < current.cloudCU && current.allocation.serving + current.allocation.development + current.allocation.research <= cloud + current.ownedCU
      && !pending.includes('set_cloud_capacity')) queue({ kind: 'set_cloud_capacity', cu: cloud });
  };
  const allocate = (development: number, research: number, minimumCloud = 0) => {
    developmentBudget = development; researchBudget = research; cloudFloor = minimumCloud;
  };
  const research = (id: string) => {
    if (known(id)) return;
    const commandId = queue({ kind: 'start_research', researchId: id });
    until(() => known(id), id, 32);
    assert.equal(state.slices.research.projects['research-' + commandId].status, 'complete');
  };
  const evaluate = (modelId: string, suiteId: 'expanded-capabilities-1' | 'behavior-cases-1') => {
    const commandId = queue({ kind: 'evaluate_model', modelId, suiteId });
    until(() => state.slices.models.evaluationRuns['evaluation-' + commandId]?.status === 'complete', suiteId, 16);
  };
  const train = (payload: Extract<CommandPayload, { kind: 'start_training' }>, label: string) => {
    const commandId = queue(payload, label), runId = 'training-' + commandId;
    until(() => state.slices.models.trainingRuns[runId]?.status === 'complete', label);
    return state.slices.models.trainingRuns[runId].outputModelId;
  };
  const data = (catalogId: string) => {
    if (!Object.values(state.slices.data.packets).some(packet => (packet.companyId ?? owner) === owner && packet.catalogId === catalogId)) { queue({ kind: 'buy_data', catalogId }); tick(); }
    let packet = Object.values(state.slices.data.packets).filter(packet => (packet.companyId ?? owner) === owner && packet.catalogId === catalogId).sort((a, b) => b.qualityBps - a.qualityBps)[0];
    if (!packet.prepared) { queue({ kind: 'prepare_data', packetId: packet.id }); until(() => !!state.slices.data.packets[packet.id].prepared, 'prepare ' + catalogId, 16); }
    while (packet.qualityBps < 9500) {
      const commandId = queue({ kind: 'curate_data', packetId: packet.id });
      const nextId = 'curated-' + commandId;
      until(() => !!state.slices.data.packets[nextId]?.prepared, 'curate ' + catalogId, 16);
      packet = state.slices.data.packets[nextId];
    }
    return packet.id;
  };

  mark('Natural operating company');
  assert.ok(company().cashCents >= 30_000_000, 'Accumulate $300,000 through normal business operations before the capital-intensive frontier continuation.');
  ensureStaff('ml', 3); ensureStaff('research', 2); ensureStaff('data', 2); ensureStaff('infrastructure', 3);
  founder('research'); tick(); tick(); tick();
  // Owned pools remain separate by hardware class. Five memory-rich racks provide
  // 160 MU for the 72-MU workspace; general racks keep current customers supplied.
  for (const [hardwareId, count] of [['general', 3], ['memory-rich', 5]] as const) {
    const current = own(state.slices.compute.racks).filter(rack => rack.hardwareId === hardwareId && rack.location === 'colocation').length;
    for (let index = current; index < count; index++) queue({ kind: 'order_rack', hardwareId, location: 'colocation' });
  }
  tick();
  until(() => own(state.slices.compute.racks).every(rack => rack.status !== 'ordered'), 'rack delivery', 12);
  for (const rack of own(state.slices.compute.racks).filter(rack => rack.status === 'inventory')) queue({ kind: 'install_rack', rackId: rack.id });
  until(() => own(state.slices.compute.racks).every(rack => rack.status === 'installed' || rack.status === 'parked'), 'rack installation', 24);
  allocate(4 * U, 4 * U); tick(); mark('Paid racks and specialist workforce');
  for (const id of ['R1', 'R2', 'R5', 'R1A', 'R5A', 'R3', 'R3B']) research(id);
  if (!own(state.slices.research.systemRollouts).some(rollout => rollout.method === 'run-supervisor' && rollout.status === 'active')) {
    queue({ kind: 'start_system_rollout', method: 'run-supervisor' });
    until(() => own(state.slices.research.systemRollouts).some(rollout => rollout.method === 'run-supervisor' && rollout.status === 'active'), 'training supervisor', 8);
  }
  mark('Research and supervision paid');
  const behaviorId = data('specialist-conversation-1');
  const consumer = own(state.slices.products.offers).find(offer => offer.kind === 'basic-chat');
  assert.ok(consumer, 'Keep a paying consumer business for the frontier release.');
  // The foundation gate counts actual evaluated releases. Make the existing
  // consumer product more reliable and release that second compact version.
  const originalConsumerModel = state.slices.products.deployments[consumer.deploymentId].modelId;
  const reliableConsumer = train({ kind: 'start_training', baseModelId: originalConsumerModel, packetId: behaviorId, recipeId: 'behavior-reliability' }, 'consumer-preferences');
  evaluate(reliableConsumer, 'expanded-capabilities-1');
  queue({ kind: 'upgrade_product', productId: consumer.id, modelId: reliableConsumer });
  until(() => state.slices.models.versions[reliableConsumer].status === 'released', 'second evaluated release', 8);
  mark('Second evaluated compact release');
  const packetIds = [data('broad-corpus-1'), data('broad-corpus-2'), data('broad-corpus-3'), behaviorId];
  mark('Three distinct broad editions curated to 95');
  allocate(40 * U, 0); tick();
  const foundation = train({ kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: packetIds[0], packetIds, recipeId: 'large-foundation', profile: 'stable' }, 'large-foundation');
  mark('Stable large foundation complete');
  const reliable = train({ kind: 'start_training', baseModelId: foundation, packetId: behaviorId, recipeId: 'behavior-reliability' }, 'frontier-preferences');
  let modelId = train({ kind: 'start_training', baseModelId: reliable, packetId: behaviorId, recipeId: 'calibration-curriculum' }, 'frontier-calibration');
  allocate(4 * U, 0); tick();
  evaluate(modelId, 'expanded-capabilities-1'); evaluate(modelId, 'behavior-cases-1');
  const behaviorReport = () => own(state.slices.models.reports).find(report => report.modelId === modelId && report.suiteId === 'behavior-cases-1')?.outcomes;
  // When the paid holdout reveals too many confident errors, commission fresh
  // curated evidence and test the resulting candidate before committing to it.
  for (const catalogId of ['specialist-documents-1', 'specialist-coding-1', 'specialist-tools-1']) {
    const outcomes = behaviorReport();
    assert.ok(outcomes);
    if (outcomes.confidentErrors <= 5) break;
    const extraEvidence = data(catalogId);
    allocate(16 * U, 0); tick();
    modelId = train({ kind: 'start_training', baseModelId: reliable, packetId: behaviorId,
      packetIds: [behaviorId, extraEvidence], recipeId: 'calibration-curriculum' }, 'expanded-calibration-' + catalogId);
    allocate(4 * U, 0); tick();
    evaluate(modelId, 'expanded-capabilities-1'); evaluate(modelId, 'behavior-cases-1');
  }
  mark('Frontier evaluated');
  const model = state.slices.models.versions[modelId];
  assert.ok(Math.min(...Object.values(model.capabilityBps)) >= 8000, 'The trained frontier must meet every domain requirement.');
  assert.ok(model.reliabilityBps >= 9200, 'The trained frontier must meet its reliability requirement.');
  const behavior = behaviorReport();
  assert.ok(behavior && behavior.confidentErrors <= 5, `The held-out report must qualify; observed ${behavior?.confidentErrors} confident errors.`);
  // Keep the inexpensive compact consumer service. The frontier serves a new API
  // whose executed-token billing proves real use without multiplying every
  // existing consumer's GPU cost by four at the same boundary.
  allocate(0, 0);
  const deployment = queue({ kind: 'deploy_product', productKind: 'developer-api', modelId, priceCents: 6000, allowance: 600 });
  until(() => own(state.slices.products.offers).some(offer => offer.kind === 'developer-api' && offer.status === 'active'), 'frontier API release ' + deployment, 8);
  // Finish project staffing only after the actual release. Operational staff and
  // commercial teams remain employed; research hires do not become free resources.
  for (const member of own(state.slices.company.staff).filter(member => ['research', 'data', 'ml'].includes(member.role))) queue({ kind: 'dismiss_staff', staffId: member.id });
  founder('commercial');
  tick(); mark('Frontier API launched beside compact consumers');
  until(() => !!state.slices.campaign.endings.frontier, 'eight-week frontier proof', 80);
  assert.deepEqual(validateState(state), []);
  assert.ok(getCampaignView(state).routes.find(route => route.id === 'frontier')?.achievedWeek);
  mark('Frontier laboratory earned');
  return { state, receipts, commands, modelId, minimumCashCents };
}
