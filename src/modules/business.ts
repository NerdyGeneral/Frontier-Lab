import { FAMILY_SERVING_MULTIPLIER } from './model-design';
import { aiSystemSessionMemory } from './ai-systems';
import { canonicalStateHash } from '../core/canonical';
import { hasConnectedCompanyRules } from '../core/connected-company-version';
import { createProductWorkloadReceipt, getProductWorkloadMeasure, isProductWorkloadId, productWorkloadExplanation, workloadErrorBps, workloadPrivatePrice } from './product-workloads';
import { CONTENT } from '../content/catalog';
import { assuranceCapacityRequests, assuranceQueuedCapacityRequests, assuranceOrganizationCount } from './assured-api';
import { isCapabilitySuite } from './evaluation-classification';
import { inheritedModelRights, modelExecutionHints, modelWorkBps } from './model-runtime';
import type { BusinessAdmissionContext, BusinessView, CommercialContract, CommercialInvoice, CommercialUsage, RetrievalEvidence } from '../contracts/wave3-commerce';
import type { CommandPayload, CommandQuote, DomainResult, GameCommand, GameContent, GameState, ModuleContext, ProductsSlice, Rejection, WorkRequest } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import { policyReleaseRejection } from './policy-holdouts';
import { BUSINESS_BY_ID, BUSINESS_CUSTOMERS, COMMERCE_COMMANDS, COMMERCE_RULES as RULES } from '../content/wave3-commerce';
import { SEGMENT_BY_ID } from '../content/wave2-market';
import { checkedAdd, formatMoney, formatUnits, mulDiv } from '../core/math';
import { createComputeModule } from './compute';
import { createCompanyModule } from './company';
import { infrastructureRequests } from './infrastructure';
import { PRIVATE_APPLIANCE_BUYER } from '../content/wave27-appliance';
import { acceptPrivateAppliances, applyPrivateApplianceOrder, commitPrivateApplianceShipments, privateApplianceDeliveryAvailable, quotePrivateApplianceOrder, recordPrivateApplianceDelivery, settlePrivateAppliances, validatePrivateApplianceOrder } from './private-appliances';

export { COMMERCE_COMMANDS };
const live = (contract: CommercialContract): boolean => ['building', 'ready', 'active'].includes(contract.status);
export function commercialWorkloadProofId(contract: Pick<CommercialContract, 'id' | 'companyId' | 'modelId' | 'generation' | 'workload' | 'weeklyPriceCents'>): string {
  return `business-workload:${contract.companyId}:${contract.id}:${contract.generation}:${canonicalStateHash({ modelId: contract.modelId, workload: contract.workload, weeklyPriceCents: contract.weeklyPriceCents })}`;
}
const family = (model: GameState['slices']['models']['versions'][string]): number => FAMILY_SERVING_MULTIPLIER[model.family];
const rejection = (code: Rejection['code'], message: string): Rejection => ({ code, message });
const proportion = (granted: number, required: number): number => required ? Math.min(10000, mulDiv(granted, 10000, required)) : 10000;
const ownPacket = (state: Readonly<GameState>, packetId: string, companyId: string) => {
  const packet = state.slices.data.packets[packetId];
  return packet && (packet.companyId ?? state.playerCompanyId) === companyId && packet.prepared && packet.readyUnits > 0 && packet.rights.hosted ? packet : null;
};

/** The seed and authored scenario models have commercial rights. Derived models inherit every ancestor's restrictions. */
export function getModelCommerceRights(state: Readonly<GameState>, modelId: string, content: GameContent): { hosted: boolean; weights: boolean } {
  return inheritedModelRights(state, modelId, content);
}

export function modelHasCommercialEvaluation(state: Readonly<GameState>, modelId: string): boolean {
  const model = state.slices.models.versions[modelId];
  return !!model && (model.status === 'evaluated' || model.status === 'released') && Object.values(state.slices.models.reports).some(report => report.modelId === modelId && report.companyId === model.companyId && report.heldOut && isCapabilitySuite(report.suiteId));
}

export function retrievalEvidence(state: Readonly<GameState>, packetId: string, companyId: string): RetrievalEvidence | null {
  const packet = ownPacket(state, packetId, companyId);
  if (!packet) return null;
  return { packetId, sourceIds: [...new Set(packet.sourceIds ?? [packet.id])].sort(), qualityBps: packet.qualityBps,
    documentCoverageBps: packet.coverageBps.documents,
    documentBonusBps: mulDiv(mulDiv(RULES.retrievalMaximumDocumentBonusBps, packet.qualityBps, 10000), packet.coverageBps.documents, 10000),
    extraInputTokens: RULES.retrievalInputTokens, lookupWorkCUw: RULES.retrievalLookupWorkCUw, indexMemoryMU: RULES.retrievalIndexMemoryMU };
}

/** A cancelled customer returns to the outside market at the next boundary, once only. */
export function commercialOrganizationCount(state: Readonly<GameState>, week = state.week): number {
  return Object.values(state.slices.products.commercialContracts ?? {}).filter(contract => live(contract) || contract.endedWeek === week).length + assuranceOrganizationCount(state, week);
}
export function outsideBusinessOrganizations(state: Readonly<GameState>, week = state.week): number {
  const customers = state.slices.markets.cohorts.filter(c => c.segmentId === 'business').reduce((n, c) => n + c.count, 0);
  const trials = state.slices.markets.trials.filter(c => c.segmentId === 'business').reduce((n, c) => n + c.count, 0);
  return SEGMENT_BY_ID.business.population - customers - trials - (state.slices.markets.returnedNextWeek.business ?? 0) - commercialOrganizationCount(state, week);
}
export function retrievalOrganizationCount(state: Readonly<GameState>, productId: string, week: number): number {
  return state.slices.markets.cohorts.filter(c => c.productId === productId && c.activeWeek <= week).reduce((n, c) => n + c.count, 0)
    + state.slices.markets.trials.filter(c => c.productId === productId && c.activeWeek <= week && c.expiresWeek >= week).reduce((n, c) => n + c.count, 0);
}
export function getProductRetrieval(state: Readonly<GameState>, productId: string) {
  const installation = state.slices.products.retrievalInstalls?.[productId];
  return installation?.status === 'active' ? installation : null;
}
export function retrievalDocumentBonus(state: Readonly<GameState>, productId: string, optimistic = false): number {
  const installation = getProductRetrieval(state, productId);
  return installation ? mulDiv(installation.evidence.documentBonusBps, optimistic ? 10000 : installation.lastFreshnessBps, 10000) : 0;
}

export function getBusinessView(state: Readonly<GameState>, content: GameContent, companyId = state.playerCompanyId): BusinessView {
  const contracts = Object.values(state.slices.products.commercialContracts ?? {}).filter(c => c.companyId === companyId);
  const installations = Object.values(state.slices.products.retrievalInstalls ?? {}).filter(c => c.companyId === companyId);
  const active = contracts.filter(live), completed = state.slices.research.completedByCompany[companyId] ?? [];
  const outsideOrganizations = outsideBusinessOrganizations(state);
  return {
    research: { retrieval: completed.includes('R6'), enterprise: completed.includes('R12') },
    board: BUSINESS_CUSTOMERS.map(customer => {
      const contract = state.slices.products.commercialContracts?.['business:' + customer.id] ?? null;
      const unavailableReason = contract && live(contract) ? 'Committed to ' + state.slices.company.companies[contract.companyId].name + '.'
        : contract?.endedWeek !== null && contract?.endedWeek !== undefined && state.week < contract.endedWeek + RULES.reofferDelayWeeks ? `Returns to the board in week ${contract.endedWeek + RULES.reofferDelayWeeks}.`
          : outsideOrganizations < 1 ? 'All business organizations are already customers, trials, or commitments.' : '';
      return { ...customer, contract: contract?.companyId === companyId ? contract : null, available: !unavailableReason, unavailableReason };
    }),
    models: Object.values(state.slices.models.versions).filter(model => model.companyId === companyId).map(model => ({ id: model.id, name: model.name, family: model.family,
      documentsBps: model.capabilityBps.documents, codingBps: model.capabilityBps.coding, reliabilityBps: model.reliabilityBps,
      ...getModelCommerceRights(state, model.id, content), evaluated: modelHasCommercialEvaluation(state, model.id) })),
    packets: Object.values(state.slices.data.packets).flatMap(packet => {
      const evidence = retrievalEvidence(state, packet.id, companyId);
      return evidence ? [{ id: packet.id, name: packet.name, qualityBps: evidence.qualityBps, documentCoverageBps: evidence.documentCoverageBps, documentBonusBps: evidence.documentBonusBps }] : [];
    }),
    products: Object.values(state.slices.products.offers).filter(product => product.companyId === companyId && product.kind === 'business-docs').map(product => ({ id: product.id, name: product.name,
      modelId: state.slices.products.deployments[product.deploymentId].modelId, status: product.status, installation: state.slices.products.retrievalInstalls?.[product.id] ?? null })),
    installations, contracts, invoices: (state.slices.products.commercialInvoices ?? []).filter(invoice => invoice.companyId === companyId),
    committedOrganizations: active.length, outsideOrganizations,
    reservedWorkCUw: active.reduce((n, c) => checkedAdd(n, c.reservedWorkCUw), 0),
    reservedMemoryMU: active.reduce((n, c) => checkedAdd(n, c.reservedMemoryMU), 0),
    requiredDataStaff: active.reduce((n, c) => n + c.dataStaffPerWeek, 0) + installations.filter(i => i.status === 'active').reduce((n, i) => n + retrievalOrganizationCount(state, i.productId, state.week + 1) * RULES.retrievalDataStaffPerOrganization, 0),
    requiredSupportStaff: active.reduce((n, c) => n + c.supportStaffPerWeek, 0),
  };
}

function newContract(state: Readonly<GameState>, command: GameCommand, content: GameContent): CommercialContract {
  if (command.payload.kind !== 'sign_business_contract') throw new Error('Expected a business contract command.');
  const p = command.payload, customer = BUSINESS_BY_ID[p.customerId], model = state.slices.models.versions[p.modelId];
  const id = 'business:' + customer.id, previous = state.slices.products.commercialContracts?.[id];
  const hosted = p.contractKind === 'private-hosted', evidence = hosted ? retrievalEvidence(state, p.packetId!, command.companyId) : null;
  if (hosted && !evidence) throw new Error('A private contract needs its prepared document evidence.');
  const input = hosted ? 500 + evidence!.extraInputTokens : 0, output = hosted ? 100 : 0;
  const work = hosted ? mulDiv((input * 200 + output * 1000) * family(model), modelWorkBps(model), 10000) + evidence!.lookupWorkCUw * family(model) : 0;
  return { id, customerId: customer.id, companyId: command.companyId, modelId: model.id, contractKind: p.contractKind,
    generation: (previous?.generation ?? 0) + 1, signedWeek: state.week,
    setupFeeCents: hosted ? customer.hostedSetupCents : customer.licenseSetupCents, setupFactId: 'business-setup:' + command.id,
    status: 'building', requiredDeliveryStaff: hosted ? RULES.privateDeploymentStaff : RULES.licenseDeliveryStaff,
    completedDeliveryStaff: 0, readyWeek: null, termStartedWeek: null, termEndsWeek: null, termIndex: 0, autoRenew: false,
    termWeeksServed: 0, termServiceBpsTotal: 0, breachWeeks: 0, endedWeek: null, lastBottleneck: 'Delivery of the fixed model and its integration needs Design points.',
    evidence, rights: getModelCommerceRights(state, model.id, content), weeklyPriceCents: workloadPrivatePrice(hosted ? customer.hostedWeeklyCents : customer.licenseWeeklyCents,
      p.workload ? createProductWorkloadReceipt(p.workload, state.week) : undefined),
    ...(p.workload ? { workload: createProductWorkloadReceipt(p.workload, state.week) } : {}),
    weeklyRequests: hosted ? customer.weeklyRequests : 0, reservedWorkCUw: hosted ? customer.weeklyRequests * work : 0,
    reservedMemoryMU: hosted ? checkedAdd(model.residentMU, checkedAdd(evidence!.indexMemoryMU, checkedAdd(RULES.privateSessionMemoryMU, aiSystemSessionMemory(model)))) : 0,
    servingHeadroomBps: hosted ? RULES.servingHeadroomBps : 0, inputTokensPerRequest: input, outputTokensPerRequest: output, workPerRequestCUw: work,
    dataStaffPerWeek: hosted ? RULES.retrievalDataStaffPerOrganization : 0, supportStaffPerWeek: RULES.supportStaffPerOrganization,
    lifetimeBilledCents: previous?.companyId === command.companyId ? previous.lifetimeBilledCents : 0,
    lifetimeCreditsCents: previous?.companyId === command.companyId ? previous.lifetimeCreditsCents : 0, lastUsage: null };
}

export function commercialServingRequest(contract: CommercialContract, state?: Readonly<GameState>): WorkRequest {
  return { id: 'business-serve:' + contract.id, companyId: contract.companyId, taskId: contract.id, category: 'serving',
    normalizedWorkCUw: contract.reservedWorkCUw, memoryMU: contract.reservedMemoryMU, priority: 0, poolId: 'auto',
    ...(state ? modelExecutionHints(state.slices.models.versions[contract.modelId]) : {}), headroomBps: contract.servingHeadroomBps, staffDemand: [{ role: 'data', staffWeeks: contract.dataStaffPerWeek }, { role: 'commercial', staffWeeks: contract.supportStaffPerWeek }] };
}
/** Forecast includes delivery projects: they have already promised this fixed weekly workload. */
export function commercialCapacityRequests(state: Readonly<GameState>, companyId?: string): WorkRequest[] {
  return [...Object.values(state.slices.products.commercialContracts ?? {}).filter(c => live(c) && c.contractKind === 'private-hosted' && (!companyId || c.companyId === companyId)).map(contract => commercialServingRequest(contract, state)), ...assuranceCapacityRequests(state, companyId)];
}

/** Reservations for private deliveries queued alongside another contract command. */
export function queuedBusinessCapacityRequests(state: Readonly<GameState>, companyId?: string, excludeCommandId?: string, content: GameContent = CONTENT): WorkRequest[] {
  return state.queuedCommands.filter(command => command.id !== excludeCommandId && (!companyId || command.companyId === companyId)
    && command.payload.kind === 'sign_business_contract' && command.payload.contractKind === 'private-hosted')
    .map(command => commercialServingRequest(newContract(state, command, content), state));
}

export function validateBusinessCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent, admission: BusinessAdmissionContext): Rejection | undefined {
  const p = command.payload, completed = state.slices.research.completedByCompany[command.companyId] ?? [];
  if (p.kind === 'accept_private_appliance_order') return validatePrivateApplianceOrder(state, command, content);
  if (p.kind === 'install_retrieval') {
    const product = state.slices.products.offers[p.productId];
    if (!product || product.companyId !== command.companyId || product.kind !== 'business-docs') return rejection('INVALID_COMMAND', 'Choose an owned Business Documents product.');
    if (!completed.includes('R6')) return rejection('NOT_READY', 'Complete R6 Retrieval Systems before installing an index.');
    if (state.slices.products.retrievalInstalls?.[p.productId] || state.queuedCommands.some(c => c.id !== command.id && c.payload.kind === 'install_retrieval' && c.payload.productId === p.productId)) return rejection('ALREADY_ACTIVE', 'This product already has an index installation or one queued.');
    if (!retrievalEvidence(state, p.packetId, command.companyId)) return rejection('NOT_READY', 'Choose your prepared data with hosted-use rights for the retrieval index.');
    return;
  }
  if (p.kind === 'set_business_renewal') {
    const contract = state.slices.products.commercialContracts?.[p.contractId];
    if (!contract || contract.companyId !== command.companyId || !live(contract) || typeof p.renew !== 'boolean') return rejection('NOT_READY', 'Choose an existing live business commitment.');
    return;
  }
  if (p.kind !== 'sign_business_contract') return rejection('INVALID_COMMAND', 'This is not a business commitment action.');
  if (p.workload !== undefined && (!hasConnectedCompanyRules(state.contentVersion) || !isProductWorkloadId(p.workload))) return rejection('INVALID_COMMAND', 'Choose an available customer workload for this campaign.');
  if (p.customerId === PRIVATE_APPLIANCE_BUYER.id) return rejection('INVALID_COMMAND', 'Cedar Records requires its qualified private appliance order; a standalone license cannot replace the hardware package.');
  if (!completed.includes('R12')) return rejection('NOT_READY', 'Complete R12 Enterprise Commitments before signing a private deployment or a weight license.');
  const customer = BUSINESS_BY_ID[p.customerId];
  if (!customer || !customer.kinds.includes(p.contractKind)) return rejection('INVALID_COMMAND', 'Choose an available customer and a contract type it accepts.');
  const existing = state.slices.products.commercialContracts?.['business:' + customer.id];
  if (existing && (live(existing) || existing.endedWeek === null || state.week < existing.endedWeek + RULES.reofferDelayWeeks)) return rejection('ALREADY_ACTIVE', 'This customer is already committed or is still in its four-week return period.');
  const queued = state.queuedCommands.filter(c => c.id !== command.id && c.payload.kind === 'sign_business_contract');
  if (queued.some(c => c.payload.kind === 'sign_business_contract' && c.payload.customerId === p.customerId)) return rejection('ALREADY_ACTIVE', 'A contract for this customer is already queued.');
  if (outsideBusinessOrganizations(state) - queued.length - state.queuedCommands.filter(item => item.id !== command.id && ['sign_assurance_contract', 'accept_private_appliance_order'].includes(item.payload.kind)).length < 1) return rejection('CAPACITY_EXCEEDED', 'No business organization remains outside existing cohorts, trials, and commitments.');
  const model = state.slices.models.versions[p.modelId];
  if (!model || model.companyId !== command.companyId || !modelHasCommercialEvaluation(state, model.id)
    || model.capabilityBps[customer.domain] < customer.minimumScoreBps || model.reliabilityBps < customer.minimumReliabilityBps) return rejection('NOT_READY', `${customer.name} needs an owned evaluated ${customer.domain} score of ${customer.minimumScoreBps / 100} and reliability of ${customer.minimumReliabilityBps / 100}.`);
  const policyRejection = policyReleaseRejection(state, model.id); if (policyRejection) return policyRejection;
  if (p.workload) {
    const measured = getProductWorkloadMeasure(model, createProductWorkloadReceipt(p.workload, command.issuedForWeek))!;
    if (measured.fitBps < 10000) return rejection('NOT_READY', productWorkloadExplanation(measured) + ' Meet the operating promise before signing its premium contract.');
  }
  const rights = getModelCommerceRights(state, model.id, content);
  if (p.contractKind === 'customer-hosted' && !rights.weights) return rejection('NOT_READY', 'Customer-hosted delivery requires weight distribution rights throughout this model’s training lineage.');
  if (p.contractKind === 'private-hosted' && (!rights.hosted || !completed.includes('R6') || !p.packetId || !retrievalEvidence(state, p.packetId, command.companyId))) return rejection('NOT_READY', 'Private hosting requires R6, hosted model rights, and your prepared hosted-use retrieval data.');
  if (p.contractKind === 'customer-hosted' && p.packetId !== undefined) return rejection('INVALID_COMMAND', 'Customer-hosted licenses deliver the fixed weights; no company retrieval index is included.');
  if (p.contractKind === 'private-hosted') {
    const contract = newContract(state, command, content);
    const proposedRequests = [...admission.standardRequests.filter(request => request.companyId === command.companyId), ...commercialCapacityRequests(state, command.companyId), ...assuranceQueuedCapacityRequests(state, command.companyId, command.id)];
    for (const earlier of queued.filter(c => c.companyId === command.companyId && c.payload.kind === 'sign_business_contract' && c.payload.contractKind === 'private-hosted')) {
      try { proposedRequests.push(commercialServingRequest(newContract(state, earlier, content), state)); } catch { return rejection('NOT_READY', 'Apply the existing commercial queue before admitting another reservation.'); }
    }
    proposedRequests.push(commercialServingRequest(contract, state));
    // Explicit queued requalification replaces the tenant's accepted meter with the
    // same serving ID; count its new promise once alongside this new contract.
    const requests = [...new Map(proposedRequests.map(request => [request.id, request])).values()];
    const staffingRequests = [...requests, ...infrastructureRequests(state, content).filter(request => request.companyId === command.companyId)];
    const context: ModuleContext = { week: state.week + 1, phase: 'reserve', content, facts: [],
      resources: { requests: staffingRequests, computeGrants: [], staffGrants: [] }, random: { draw: () => 0 } };
    const staffing = createCompanyModule(content).grantResources!(state, context).staffGrants ?? [];
    const forecast = createComputeModule(content).grantResources!(state, { ...context, resources: { requests, computeGrants: [], staffGrants: staffing } });
    const grants = new Map((forecast.computeGrants ?? []).map(grant => [grant.requestId, grant]));
    if (requests.some(request => { const grant = grants.get(request.id); return !grant || grant.hardwareEffectiveCUw < request.normalizedWorkCUw || grant.memoryMU < request.memoryMU; })) return rejection('CAPACITY_EXCEEDED', 'The connected serving fleet cannot fit this promised weekly workload, its 10% headroom and memory, alongside paid products and other queued or installing private commitments.');
  }
}

export function quoteBusinessCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): CommandQuote {
  const p = command.payload;
  if (p.kind === 'accept_private_appliance_order') return quotePrivateApplianceOrder(state, command, content);
  if (p.kind === 'install_retrieval') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
    summary: 'Install a frozen document index with 40 Design points. Each served organization then needs 2 Data points per week; retrieval adds 500 input tokens and lookup work per request, plus 1 MU. Model weights stay fixed.' };
  if (p.kind === 'set_business_renewal') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: p.renew ? 'Enable renewal after a full twelve-week term if delivered service meets this customer’s SLA.' : 'End this agreement at its twelve-week term boundary.' };
  const contract = newContract(state, command, content), hosted = contract.contractKind === 'private-hosted';
  return { upfrontCostCents: contract.setupFeeCents, weeklyCostDeltaCents: 0,
    summary: hosted ? `Pay ${formatMoney(contract.setupFeeCents)} setup and deliver 80 Design points. Reserve ${formatUnits(contract.reservedWorkCUw)} CUw/week plus 10% headroom and ${formatUnits(contract.reservedMemoryMU)} MU. A twelve-week term bills ${formatMoney(contract.weeklyPriceCents)}/week after service credits; 2 Data and 5 Business points per week are required.`
      : `Pay ${formatMoney(contract.setupFeeCents)} delivery setup and deliver 40 Design points. License these evaluated weights for twelve weeks at ${formatMoney(contract.weeklyPriceCents)}/week with 5 Business points per week. The buyer supplies runtime compute; no company inference capacity or token bill is created.` };
}

export function applyBusinessCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): DomainResult {
  if (command.payload.kind === 'accept_private_appliance_order') return applyPrivateApplianceOrder(state, command, content);
  const products = structuredClone(state.slices.products), p = command.payload;
  if (p.kind === 'install_retrieval') {
    products.retrievalInstalls[p.productId] = { id: 'retrieval:' + p.productId, companyId: command.companyId, productId: p.productId,
      evidence: retrievalEvidence(state, p.packetId, command.companyId)!, startedWeek: state.week, requiredStaff: RULES.retrievalInstallStaff, completedStaff: 0,
      status: 'building', readyWeek: null, lastUpkeepWeek: null, lastUpkeepRequired: 0, lastUpkeepGranted: 0, lastFreshnessBps: 0, lastBottleneck: 'Waiting for ML staff to build the document index.' };
    return { updates: { products }, messages: [{ category: 'project', companyId: command.companyId, message: 'Retrieval installation started. Its prepared evidence is frozen; future upkeep and inference costs belong to this product.' }] };
  }
  if (p.kind === 'set_business_renewal') {
    products.commercialContracts[p.contractId].autoRenew = p.renew;
    return { updates: { products }, messages: [{ category: 'command', companyId: command.companyId, message: p.renew ? 'Business renewal enabled, subject to delivered service at the term boundary.' : 'Business renewal disabled; this term will expire at its boundary.' }] };
  }
  const contract = newContract(state, command, content); products.commercialContracts[contract.id] = contract;
  const facts: NonNullable<DomainResult['facts']> = [{ id: contract.setupFactId, companyId: command.companyId, week: state.week, sourceId: contract.id, category: 'operating', amountCents: contract.setupFeeCents,
    label: BUSINESS_BY_ID[contract.customerId].name + (contract.contractKind === 'private-hosted' ? ': private deployment setup' : ': weight delivery setup'), kind: 'expense' }];
  if (contract.workload) facts.push({ id: commercialWorkloadProofId(contract), companyId: command.companyId, week: state.week, sourceId: contract.id,
    category: 'operating', kind: 'expense', amountCents: 0, label: 'Accepted fixed customer workload and premium fee' });
  return { updates: { products }, facts,
    messages: [{ category: 'project', companyId: command.companyId, message: `${BUSINESS_BY_ID[contract.customerId].name} signed. Delivery must finish before the twelve-week term and weekly billing begin.` }] };
}

export function businessCommit(state: Readonly<GameState>, ctx: ModuleContext): DomainResult {
  const products = structuredClone(state.slices.products), messages: NonNullable<DomainResult['messages']> = [];
  messages.push(...commitPrivateApplianceShipments(products, ctx.week));
  for (const installation of Object.values(products.retrievalInstalls)) if (installation.status === 'ready' && installation.readyWeek! <= ctx.week) {
    installation.status = 'active'; installation.lastBottleneck = 'The index is ready. Each served organization now needs Data points.';
    messages.push({ category: 'delivery', companyId: installation.companyId, message: 'Document retrieval is live. Its benefit now depends on weekly data upkeep.' });
  }
  for (const contract of Object.values(products.commercialContracts)) {
    const customer = BUSINESS_BY_ID[contract.customerId];
    if (contract.status === 'ready' && contract.readyWeek! <= ctx.week) {
      contract.status = 'active'; contract.termStartedWeek = ctx.week; contract.termEndsWeek = ctx.week + customer.termWeeks; contract.termIndex = 1;
      contract.lastBottleneck = ''; messages.push({ category: 'delivery', companyId: contract.companyId, message: `${customer.name}: delivery accepted. The twelve-week ${contract.contractKind === 'private-hosted' ? 'private service' : 'customer-hosted license'} term begins.` });
    }
  }
  messages.push(...acceptPrivateAppliances(products, ctx.week));
  return { updates: { products }, messages };
}

/** Commands commit before reserve, so a renewal choice made during the final service week is timely. */
export function businessTermBoundary(state: Readonly<GameState>, ctx: ModuleContext): DomainResult {
  const products = structuredClone(state.slices.products), messages: NonNullable<DomainResult['messages']> = [];
  for (const contract of Object.values(products.commercialContracts)) {
    const customer = BUSINESS_BY_ID[contract.customerId];
    if (contract.status === 'active' && contract.termEndsWeek! <= ctx.week) {
      const average = contract.termWeeksServed ? Math.floor(contract.termServiceBpsTotal / contract.termWeeksServed) : 0;
      if (contract.autoRenew && contract.termWeeksServed === customer.termWeeks && average >= customer.slaBps && contract.breachWeeks === 0) {
        contract.termIndex++; contract.termStartedWeek = ctx.week; contract.termEndsWeek = ctx.week + customer.termWeeks; contract.termWeeksServed = 0; contract.termServiceBpsTotal = 0;
        messages.push({ category: 'market', companyId: contract.companyId, message: `${customer.name} renewed for twelve weeks after meeting its service commitment.` });
      } else {
        contract.status = 'expired'; contract.endedWeek = ctx.week; contract.lastBottleneck = contract.autoRenew ? 'Renewal declined: the completed term missed its service commitment.' : 'The fixed term ended with renewal disabled.';
        messages.push({ category: 'market', companyId: contract.companyId, message: customer.name + ': ' + contract.lastBottleneck });
      }
    }
  }
  return { updates: { products }, messages };
}

export function businessRequests(state: Readonly<GameState>, week: number): WorkRequest[] {
  const requests: WorkRequest[] = [];
  for (const installation of Object.values(state.slices.products.retrievalInstalls)) {
    if (installation.status === 'building') requests.push({ id: 'retrieval-build:' + installation.id, companyId: installation.companyId, taskId: installation.id, category: 'development', normalizedWorkCUw: 0, memoryMU: 0, priority: 10, poolId: 'auto', staffDemand: [{ role: 'ml', staffWeeks: Math.min(U, installation.requiredStaff - installation.completedStaff) }] });
    else if (installation.status === 'active' && state.slices.products.offers[installation.productId].status === 'active') requests.push({ id: 'retrieval-upkeep:' + installation.id, companyId: installation.companyId, taskId: installation.id, category: 'development', normalizedWorkCUw: 0, memoryMU: 0, priority: 5, poolId: 'auto', staffDemand: [{ role: 'data', staffWeeks: retrievalOrganizationCount(state, installation.productId, week) * RULES.retrievalDataStaffPerOrganization }] });
  }
  for (const contract of Object.values(state.slices.products.commercialContracts)) {
    if (contract.status === 'building' && privateApplianceDeliveryAvailable(state.slices.products, contract.id)) requests.push({ id: 'business-delivery:' + contract.id, companyId: contract.companyId, taskId: contract.id, category: 'development', normalizedWorkCUw: 0, memoryMU: 0, priority: 10, poolId: 'auto', staffDemand: [{ role: 'ml', staffWeeks: Math.min(U, contract.requiredDeliveryStaff - contract.completedDeliveryStaff) }] });
    if (contract.status === 'active') requests.push(contract.contractKind === 'private-hosted' ? commercialServingRequest(contract, state) : { id: 'business-support:' + contract.id, companyId: contract.companyId, taskId: contract.id, category: 'development', normalizedWorkCUw: 0, memoryMU: 0, priority: 0, poolId: 'auto', staffDemand: [{ role: 'commercial', staffWeeks: contract.supportStaffPerWeek }] });
  }
  return requests;
}

export function businessCredits(gross: number, serviceBps: number, slaBps: number): number {
  return Math.min(gross, mulDiv(gross, 10000 - serviceBps, 10000, 'nearest') + (serviceBps < slaBps ? mulDiv(gross, RULES.slaPenaltyBps, 10000, 'nearest') : 0));
}
export function businessExecute(state: Readonly<GameState>, ctx: ModuleContext): DomainResult {
  const products = structuredClone(state.slices.products);
  const staff = (id: string, role: 'ml' | 'data' | 'commercial') => ctx.resources.staffGrants.find(grant => grant.requestId === id)?.grants.find(grant => grant.role === role)?.staffWeeks ?? 0;
  for (const installation of Object.values(products.retrievalInstalls)) {
    if (installation.status === 'building') {
      const granted = staff('retrieval-build:' + installation.id, 'ml'); installation.completedStaff = Math.min(installation.requiredStaff, installation.completedStaff + granted);
      installation.lastBottleneck = granted ? '' : 'Building the index needs Design points.';
    } else if (installation.status === 'active') {
      const active = products.offers[installation.productId].status === 'active';
      installation.lastUpkeepWeek = ctx.week; installation.lastUpkeepRequired = active ? retrievalOrganizationCount(state, installation.productId, ctx.week) * RULES.retrievalDataStaffPerOrganization : 0;
      installation.lastUpkeepGranted = staff('retrieval-upkeep:' + installation.id, 'data'); installation.lastFreshnessBps = active ? proportion(installation.lastUpkeepGranted, installation.lastUpkeepRequired) : 0;
      installation.lastBottleneck = !active ? 'Product service is paused.' : installation.lastFreshnessBps < 10000 ? 'Data upkeep is short; the document-quality benefit scales down with fresh evidence.' : '';
    }
  }
  for (const contract of Object.values(products.commercialContracts)) {
    if (contract.status === 'building') {
      if (!privateApplianceDeliveryAvailable(products, contract.id)) continue;
      const granted = staff('business-delivery:' + contract.id, 'ml');
      recordPrivateApplianceDelivery(products, contract.id, ctx.week, contract.requiredDeliveryStaff - contract.completedDeliveryStaff, granted);
      contract.completedDeliveryStaff = Math.min(contract.requiredDeliveryStaff, contract.completedDeliveryStaff + granted);
      contract.lastBottleneck = granted ? '' : 'Delivery is waiting for Design points.'; continue;
    }
    if (contract.status !== 'active') continue;
    const hosted = contract.contractKind === 'private-hosted', requestId = (hosted ? 'business-serve:' : 'business-support:') + contract.id;
    const grant = hosted ? ctx.resources.computeGrants.find(grant => grant.requestId === requestId) : undefined;
    const executed = grant?.hardwareEffectiveCUw ?? 0, dataGranted = staff(requestId, 'data'), supportGranted = staff(requestId, 'commercial');
    const fulfillment = hosted ? proportion(executed, contract.reservedWorkCUw) : 10000, freshness = proportion(dataGranted, contract.dataStaffPerWeek);
    const workload = getProductWorkloadMeasure(state.slices.models.versions[contract.modelId], contract.workload);
    const service = Math.min(fulfillment, freshness, proportion(supportGranted, contract.supportStaffPerWeek), workload?.fitBps ?? 10000);
    const model = state.slices.models.versions[contract.modelId], bonus = hosted ? mulDiv(contract.evidence!.documentBonusBps, freshness, 10000) : 0;
    const score = Math.min(9500, mulDiv(model.capabilityBps.documents, 8000, 10000) + mulDiv(model.capabilityBps.conversation, 2000, 10000) + bonus);
    const probability = (difficulty: number) => mulDiv(Math.max(500, Math.min(9800, 5000 + score - difficulty)), model.reliabilityBps, 10000);
    const error = hosted ? workloadErrorBps(10000 - mulDiv(probability(0), 7000, 10000) - mulDiv(probability(2000), 3000, 10000), workload) : null;
    const gross = contract.weeklyPriceCents, credits = businessCredits(gross, service, BUSINESS_BY_ID[contract.customerId].slaBps);
    const shortages = [fulfillment < 10000 ? 'serving capacity' : '', freshness < 10000 ? 'data upkeep' : '', supportGranted < contract.supportStaffPerWeek ? 'support staff' : ''].filter(Boolean);
    const usage: CommercialUsage = { week: ctx.week, requestedWorkCUw: contract.reservedWorkCUw, executedWorkCUw: executed, physicalWorkCUw: grant?.physicalCUw ?? 0,
      inputTokens: hosted ? mulDiv(executed, contract.inputTokensPerRequest, contract.workPerRequestCUw) : 0, outputTokens: hosted ? mulDiv(executed, contract.outputTokensPerRequest, contract.workPerRequestCUw) : 0,
      dataStaffRequired: contract.dataStaffPerWeek, dataStaffGranted: dataGranted, supportStaffRequired: contract.supportStaffPerWeek, supportStaffGranted: supportGranted,
      freshnessBps: freshness, fulfillmentBps: fulfillment, serviceBps: service, technicalErrorBps: error, grossCents: gross, creditsCents: credits, billedCents: gross - credits,
      ...(workload ? { workload } : {}),
      explanation: (shortages.length ? `Service shortfall: ${shortages.join(', ')}. Unmet service receives credits and SLA penalties.` : hosted ? 'Fixed private workload served with current evidence and support.' : 'Fixed weights delivered; support available. The customer pays for and operates its own inference compute.')
        + (workload ? ' ' + productWorkloadExplanation(workload) : '') };
    contract.lastUsage = usage; contract.termWeeksServed++; contract.termServiceBpsTotal = checkedAdd(contract.termServiceBpsTotal, service);
    contract.breachWeeks = service < RULES.breachServiceBps ? contract.breachWeeks + 1 : 0; contract.lastBottleneck = shortages.length ? usage.explanation : '';
  }
  return { updates: { products } };
}

export function businessResolve(state: Readonly<GameState>, ctx: ModuleContext): DomainResult {
  const products = structuredClone(state.slices.products), messages: NonNullable<DomainResult['messages']> = [];
  for (const installation of Object.values(products.retrievalInstalls)) if (installation.status === 'building' && installation.completedStaff === installation.requiredStaff) {
    installation.status = 'ready'; installation.readyWeek = ctx.week + 1; installation.lastBottleneck = '';
    messages.push({ category: 'project', companyId: installation.companyId, message: 'Retrieval installation completed. The index starts serving at the next weekly boundary.' });
  }
  for (const contract of Object.values(products.commercialContracts)) {
    if (contract.status === 'building' && contract.completedDeliveryStaff === contract.requiredDeliveryStaff) {
      contract.status = 'ready'; contract.readyWeek = ctx.week + 1; contract.lastBottleneck = '';
      messages.push({ category: 'project', companyId: contract.companyId, message: `${BUSINESS_BY_ID[contract.customerId].name}: fixed-model delivery completed. Its term begins next week.` });
    } else if (contract.status === 'active' && contract.breachWeeks >= RULES.consecutiveBreaches) {
      contract.status = 'terminated'; contract.endedWeek = ctx.week; contract.lastBottleneck = 'Customer terminated after two consecutive weeks below 90% service.';
      messages.push({ category: 'market', companyId: contract.companyId, message: BUSINESS_BY_ID[contract.customerId].name + ': ' + contract.lastBottleneck });
    }
  }
  return { updates: { products }, messages };
}

export function businessSettle(state: Readonly<GameState>, ctx: ModuleContext): DomainResult {
  const products: ProductsSlice = structuredClone(state.slices.products), facts: NonNullable<DomainResult['facts']> = [];
  facts.push(...settlePrivateAppliances(state, products, ctx));
  for (const contract of Object.values(products.commercialContracts)) {
    const usage = contract.lastUsage; if (!usage || usage.week !== ctx.week) continue;
    const id = `business-invoice:${contract.id}:${contract.generation}:${ctx.week}`;
    if (products.commercialInvoices.some(invoice => invoice.id === id) || state.slices.company.postedFacts[id]) continue;
    const invoice: CommercialInvoice = { id, contractId: contract.id, customerId: contract.customerId, companyId: contract.companyId, modelId: contract.modelId,
      contractKind: contract.contractKind, generation: contract.generation, termIndex: contract.termIndex, week: ctx.week,
      grossCents: usage.grossCents, creditsCents: usage.creditsCents, amountCents: usage.billedCents, serviceBps: usage.serviceBps,
      ...(contract.workload ? { workload: structuredClone(contract.workload) } : {}) };
    products.commercialInvoices.push(invoice); contract.lifetimeBilledCents = checkedAdd(contract.lifetimeBilledCents, invoice.amountCents); contract.lifetimeCreditsCents = checkedAdd(contract.lifetimeCreditsCents, invoice.creditsCents);
    facts.push({ id, companyId: contract.companyId, week: ctx.week, sourceId: contract.id, category: 'revenue', amountCents: invoice.amountCents,
      label: BUSINESS_BY_ID[contract.customerId].name + (contract.contractKind === 'private-hosted' ? ': private service after SLA credits' : ': fixed-model license and support after credits'), kind: 'receipt' });
  }
  products.commercialInvoices = products.commercialInvoices.slice(-RULES.invoiceHistoryLimit);
  return { updates: { products }, facts };
}

export function isCommerceCommand(payload: CommandPayload): boolean { return (COMMERCE_COMMANDS as readonly string[]).includes(payload.kind); }
