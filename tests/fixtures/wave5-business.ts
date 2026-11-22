import assert from 'node:assert/strict';
import { CONTENT } from '../../src/content/catalog';
import type { CommandPayload, GameState, RoleAllocation, StaffRole } from '../../src/contracts/types';
import type { EvaluationSuiteId } from '../../src/contracts/wave2-lab';
import { RESOURCE_SCALE as U } from '../../src/contracts/types';
import { advanceWeek, createInitialState, submitCommand } from '../../src/core/engine';
import { productDemand } from '../../src/modules/products';

/** A repeatable player, never a state fixture: every change goes through an ordinary command. */
export class NaturalBusinessCampaign {
  state: GameState;
  minimumCashCents: number;
  readonly commands: { week: number; id: string; payload: CommandPayload }[] = [];
  readonly milestones: { label: string; week: number; cashCents: number; revenueCents: number; expenseCents: number; consumers: number; developers: number; businesses: number; trustBps: number }[] = [];
  readonly contractWeeks: { week: number; contractId: string; termIndex: number; termStartedWeek: number | null; termEndsWeek: number | null; termWeeksServed: number; serviceBps: number; billedCents: number }[] = [];
  autoCapacity = false;
  developmentCU = 0;
  researchCU = 0;
  workshopMemoryMU = 0;
  privateServingCU = 0;
  privateMemoryMU = 0;
  minimumCloudCU = 0;
  private nextCommand = 0;

  constructor(state = createInitialState(), readonly prefix = 'natural-business') {
    this.state = state;
    this.minimumCashCents = this.company.cashCents;
  }
  get company() { return this.state.slices.company.companies[this.state.playerCompanyId]; }
  get fleet() { return this.state.slices.compute.fleets[this.state.playerCompanyId]; }
  get cash() { return this.company.cashCents; }
  get week() { return this.state.week; }
  get research() { return this.state.slices.research.completedByCompany[this.state.playerCompanyId] ?? []; }
  offers() { return Object.values(this.state.slices.products.offers).filter(item => item.companyId === this.state.playerCompanyId); }
  models() { return Object.values(this.state.slices.models.versions).filter(item => item.companyId === this.state.playerCompanyId); }
  packet(catalogId: string) { return Object.values(this.state.slices.data.packets).find(item => (item.companyId ?? this.state.playerCompanyId) === this.state.playerCompanyId && item.catalogId === catalogId); }
  bestPacket(catalogId: string) { return Object.values(this.state.slices.data.packets).filter(item => (item.companyId ?? this.state.playerCompanyId) === this.state.playerCompanyId && item.catalogId === catalogId && item.prepared).sort((a, b) => b.qualityBps - a.qualityBps || a.id.localeCompare(b.id))[0]; }
  staff(role: StaffRole) { return Object.values(this.state.slices.company.staff).filter(item => item.companyId === this.state.playerCompanyId && item.role === role); }

  queue(payload: CommandPayload): string {
    const id = this.prefix + '-command-' + (++this.nextCommand);
    const result = submitCommand(this.state, payload, CONTENT, id);
    assert.equal(result.accepted, true, `Week ${this.week}, ${payload.kind}: ${result.reason?.message}`);
    this.commands.push({ week: this.week, id, payload: structuredClone(payload) }); this.state = result.state;
    return id;
  }

  founder(role: keyof RoleAllocation) {
    this.queue({ kind: 'assign_founder', allocations: { research: 0, ml: 0, data: 0, infrastructure: 0, commercial: 0, hardware: 0, [role]: U } });
  }

  /** Choose whole cloud CU and leave room for one further intake. Allocations change at normal boundaries. */
  manageCapacity() {
    if (!this.autoCapacity) return;
    let work = this.privateServingCU * U, memory = (this.workshopMemoryMU + this.privateMemoryMU) * U;
    for (const offer of this.offers()) {
      const demand = productDemand(this.state, offer, CONTENT, this.week + 1);
      work += Math.ceil((demand.paidWork + demand.trialWork) * 1.1);
      const intake = offer.kind === 'developer-api' ? 10 : offer.kind === 'business-docs' ? 2 : 50;
      if (offer.status === 'active') work += intake * (offer.kind === 'developer-api' ? 150 : offer.kind === 'business-docs' ? 750 : 25) * demand.meter.work;
      memory += demand.memory + (offer.status === 'active' ? Math.min(30, intake) * demand.meter.sessionMemory : 0);
    }
    const serving = Math.ceil(work / U) * U, development = this.developmentCU * U, research = this.researchCU * U;
    const rented = Math.max(this.minimumCloudCU, Math.ceil((serving + development + research) / U), Math.ceil(memory / (2 * U)));
    assert.ok(rented <= 128, `The campaign requested ${rented} cloud CU; add compatible owned capacity.`);
    const current = this.fleet, available = current.cloudCU + current.ownedCU;
    const pending = this.state.queuedCommands.filter(item => item.companyId === this.state.playerCompanyId).map(item => item.payload.kind);
    if (rented * U > current.cloudCU && !pending.includes('set_cloud_capacity')) this.queue({ kind: 'set_cloud_capacity', cu: rented * U });
    const allocation = { serving: Math.min(serving, Math.max(0, available - development - research)), development, research };
    if (development + research <= available && !pending.includes('allocate_compute') && Object.keys(allocation).some(key => allocation[key as keyof typeof allocation] !== current.allocation[key as keyof typeof allocation])) this.queue({ kind: 'allocate_compute', ...allocation });
    if (rented * U < current.cloudCU && current.allocation.serving + current.allocation.development + current.allocation.research <= rented * U + current.ownedCU && !pending.includes('set_cloud_capacity')) this.queue({ kind: 'set_cloud_capacity', cu: rented * U });
  }

  step(count = 1) {
    for (let i = 0; i < count; i++) {
      this.manageCapacity();
      const queued = this.state.queuedCommands.filter(command => command.companyId === this.state.playerCompanyId);
      const result = advanceWeek(this.state);
      assert.equal(result.accepted, true, `Week ${this.week + 1}: ${result.reason?.message}`);
      this.state = result.state;
      for (const command of queued) assert.equal(this.state.commandReceipts[command.id]?.status, 'accepted', `Week ${this.week}, ${command.payload.kind}: ${this.state.commandReceipts[command.id]?.reason?.message}`);
      assert.equal(this.company.arrearsCents, 0, `Natural campaign ran out of cash in Week ${this.week}.`);
      this.minimumCashCents = Math.min(this.minimumCashCents, this.cash);
      for (const contract of Object.values(this.state.slices.products.commercialContracts)) {
        if (contract.companyId !== this.state.playerCompanyId || contract.lastUsage?.week !== this.week) continue;
        this.contractWeeks.push({ week: this.week, contractId: contract.id, termIndex: contract.termIndex,
          termStartedWeek: contract.termStartedWeek, termEndsWeek: contract.termEndsWeek,
          termWeeksServed: contract.termWeeksServed, serviceBps: contract.lastUsage.serviceBps, billedCents: contract.lastUsage.billedCents });
      }
    }
    return this;
  }

  until(predicate: (state: GameState) => boolean, limit = 800, label = 'goal') {
    const start = this.week;
    while (!predicate(this.state) && this.week - start < limit) this.step();
    assert.ok(predicate(this.state), `${label} not reached after ${limit} ordinary weeks.`);
    return this;
  }

  funded(cents: number, limit = 800) { return this.until(() => this.cash >= cents, limit, `cash ${cents / 100}`); }
  hire(role: StaffRole, total = 1) {
    while (this.staff(role).length + this.state.queuedCommands.filter(item => item.companyId === this.state.playerCompanyId && item.payload.kind === 'hire_staff' && item.payload.role === role).length < total) this.queue({ kind: 'hire_staff', role });
    return this.until(() => this.staff(role).filter(item => item.readyWeek <= this.week).length >= total, 10, `${total} ready ${role} staff`);
  }
  budgets(developmentCU: number, researchCU: number, workshopMemoryMU = 0) {
    this.developmentCU = developmentCU; this.researchCU = researchCU; this.workshopMemoryMU = workshopMemoryMU;
    this.step(2); return this;
  }
  discover(researchId: string) {
    if (!this.research.includes(researchId)) {
      this.queue({ kind: 'start_research', researchId });
      this.until(() => this.research.includes(researchId), 100, `research ${researchId}`);
    }
    return this;
  }
  prepare(catalogId: string, qualityBps = 0): string {
    assert.ok(qualityBps >= 0 && qualityBps <= 9500, 'The natural curation ceiling is 95%.');
    if (!this.packet(catalogId)) { this.queue({ kind: 'buy_data', catalogId }); this.step(); }
    const original = this.packet(catalogId)!;
    if (!original.prepared) {
      this.queue({ kind: 'prepare_data', packetId: original.id });
      this.until(() => !!this.state.slices.data.packets[original.id].prepared, 100, `prepare ${catalogId}`);
    }
    while (this.bestPacket(catalogId).qualityBps < qualityBps) {
      const source = this.bestPacket(catalogId), target = Math.min(9500, source.qualityBps + 1000);
      this.queue({ kind: 'curate_data', packetId: source.id });
      this.until(() => this.bestPacket(catalogId).qualityBps >= target, 100, `curate ${catalogId}`);
    }
    return this.bestPacket(catalogId).id;
  }
  train(options: Omit<Extract<CommandPayload, { kind: 'start_training' }>, 'kind'>): string {
    const commandId = this.queue({ kind: 'start_training', ...options }), runId = 'training-' + commandId;
    this.until(state => state.slices.models.trainingRuns[runId]?.status === 'complete', 250, options.recipeId ?? 'training');
    return this.state.slices.models.trainingRuns[runId].outputModelId;
  }
  evaluate(modelId: string, suiteId: EvaluationSuiteId = 'expanded-capabilities-1') {
    this.queue({ kind: 'evaluate_model', modelId, suiteId });
    this.until(state => Object.values(state.slices.models.reports).some(report => report.modelId === modelId && report.suiteId === suiteId), 20, `evaluate ${modelId}`);
    return this;
  }
  mark(label: string) {
    const cohorts = this.state.slices.markets.cohorts.filter(item => item.companyId === this.state.playerCompanyId);
    const count = (kind: string) => cohorts.filter(item => this.state.slices.products.offers[item.productId].kind === kind).reduce((n, item) => n + item.count, 0);
    this.milestones.push({ label, week: this.week, cashCents: this.cash, revenueCents: this.company.lastWeek.revenueCents, expenseCents: this.company.lastWeek.operatingExpenseCents,
      consumers: count('basic-chat'), developers: count('developer-api'), businesses: count('business-docs'), trustBps: this.state.slices.markets.companyTrustBps[this.state.playerCompanyId] ?? 5000 });
    return this;
  }
}

/** An eight-week founder-led launch; recruiting is a later operating decision. */
export function openNaturalBusiness(rules: 'classic' | 'release' = 'classic'): NaturalBusinessCampaign {
  const lab = new NaturalBusinessCampaign(createInitialState(CONTENT, rules));
  lab.queue({ kind: 'prepare_data', packetId: CONTENT.starterData.id });
  lab.queue({ kind: 'allocate_compute', serving: 0, development: 4 * U, research: 0 });
  lab.step(2);
  lab.founder('ml');
  const training = lab.queue({ kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id });
  lab.step(3);
  const modelId = lab.state.slices.models.trainingRuns['training-' + training].outputModelId;
  lab.founder('research'); lab.queue({ kind: 'evaluate_model', modelId }); lab.step();
  lab.founder('ml'); lab.queue({ kind: 'deploy_product', modelId, priceCents: 1200, allowance: 100 });
  lab.queue({ kind: 'allocate_compute', serving: 2 * U, development: 0, research: 0 }); lab.step();
  lab.founder('commercial'); lab.queue({ kind: 'set_cloud_capacity', cu: 2 * U }); lab.step();
  lab.autoCapacity = true;
  lab.mark('Basic Chat launched');
  return lab;
}

export interface NaturalBusinessPlaythrough {
  lab: NaturalBusinessCampaign;
  consumerModelId: string;
  apiModelId: string;
  businessModelId: string;
}

/**
 * Reproducible cloud-first company: revenue funds recruitment, curated licensed
 * data, research, two compact releases, a medium foundation and commercial terms.
 * All state changes are submitted player commands or ordinary weekly settlement.
 */
export function playNaturalBusiness(report?: (milestone: NaturalBusinessCampaign['milestones'][number]) => void, rules: 'classic' | 'release' = 'classic', target?: 'platform' | 'specialist'): NaturalBusinessPlaythrough {
  const lab = openNaturalBusiness(rules).funded(10_000_000);
  const mark = (label: string) => { lab.mark(label); report?.(lab.milestones.at(-1)!); };
  mark('Consumer revenue funds expansion');
  for (const [role, count] of [['ml', 2], ['research', 1], ['data', 1], ['commercial', 1]] as const) lab.hire(role, count);
  lab.budgets(0, 4);
  for (const id of ['R1', 'R2', 'R5', 'R1A', 'R5A']) lab.discover(id);
  mark('Curation, preference tuning and calibration researched');

  const coding = lab.prepare('specialist-coding-1', 9500);
  lab.budgets(8, 0, 4);
  let apiModelId = lab.train({ recipeId: 'coding-tools-adaptation', baseModelId: CONTENT.seedModel.id, packetId: coding, profile: 'ambitious' });
  apiModelId = lab.train({ recipeId: 'behavior-reliability', baseModelId: apiModelId, packetId: coding });
  apiModelId = lab.train({ recipeId: 'calibration-curriculum', baseModelId: apiModelId, packetId: coding });
  lab.evaluate(apiModelId);
  lab.queue({ kind: 'deploy_product', productKind: 'developer-api', modelId: apiModelId, priceCents: 6000, allowance: 600,
    features: { memory: false, extendedContext: true, deepReasoning: true } });
  lab.until(() => lab.offers().some(offer => offer.kind === 'developer-api' && offer.status === 'active'), 10, 'API launch');

  const consumer = lab.offers().find(offer => offer.kind === 'basic-chat')!;
  // Separate evidence is intentional: compact branches share a lineage, and the
  // exact same recipe/evidence cannot be repeated to reroll a saved candidate.
  const consumerModelId = lab.train({ recipeId: 'calibration-curriculum',
    baseModelId: lab.state.slices.products.deployments[consumer.deploymentId].modelId, packetId: CONTENT.starterData.id });
  lab.evaluate(consumerModelId);
  lab.queue({ kind: 'upgrade_product', productId: consumer.id, modelId: consumerModelId });
  lab.step();
  lab.until(() => lab.state.slices.products.offers[consumer.id].status === 'active', 10, 'Calibrated Chat upgrade');
  mark('Calibrated consumer and developer services live');
  if (target === 'platform') {
    lab.budgets(0, 0);
    lab.until(state => !!state.slices.campaign.endings.platform, 180, 'Platform ending without a business product');
    return { lab, consumerModelId, apiModelId, businessModelId: '' };
  }

  lab.budgets(0, 4);
  for (const id of ['R3', 'R6', 'R9', 'R10']) lab.discover(id);
  lab.hire('infrastructure');
  lab.discover('R12');
  mark('Enterprise operations researched');
  const documents = lab.prepare('specialist-documents-1', 9500), broad = lab.prepare('broad-corpus-1', 9500);
  lab.budgets(8, 0, 24);
  let businessModelId = lab.train({ recipeId: 'medium-foundation', baseModelId: CONTENT.seedModel.id, packetId: broad, packetIds: [broad, coding, documents] });
  lab.workshopMemoryMU = 16;
  businessModelId = lab.train({ recipeId: 'behavior-reliability', baseModelId: businessModelId, packetId: documents });
  businessModelId = lab.train({ recipeId: 'calibration-curriculum', baseModelId: businessModelId, packetId: documents });
  lab.evaluate(businessModelId);
  mark('Medium document specialist trained and evaluated');

  lab.queue({ kind: 'deploy_product', productKind: 'business-docs', modelId: businessModelId, priceCents: 30_000, allowance: 3000 });
  lab.until(() => lab.offers().some(offer => offer.kind === 'business-docs' && offer.status === 'active'), 10, 'Business launch');
  lab.queue({ kind: 'sign_business_contract', customerId: 'vector-studio', modelId: apiModelId, contractKind: 'customer-hosted' });
  lab.step();
  lab.queue({ kind: 'set_business_renewal', contractId: 'business:vector-studio', renew: true });
  lab.step();
  lab.budgets(0, 0);
  mark('Business subscriptions and named weight license live');
  lab.until(state => (target === 'specialist' || !!state.slices.campaign.endings.platform) && !!state.slices.campaign.endings.specialist, 160, 'Platform and specialist endings');
  mark('Both business endings earned');
  return { lab, consumerModelId, apiModelId, businessModelId };
}
