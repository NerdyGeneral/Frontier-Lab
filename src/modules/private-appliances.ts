import { AI_SYSTEMS_CONTENT_VERSION } from '../core/ai-systems-version';
import { GAMEPLAY_POLISH_CONTENT_VERSION } from '../core/gameplay-polish-version';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION } from '../core/model-customization-version';
import { STRATEGY_CONTENT_VERSION } from '../core/strategy-version';
import { FAMILY_SERVING_MULTIPLIER } from './model-design';
import { MODEL_DESIGN_CONTENT_VERSION } from '../contracts/model-design';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../content/wave29';
import { CAMPUS_CONTENT_VERSION } from '../content/wave28';
import { CONTENT } from '../content/catalog';
import { PRIVATE_APPLIANCE_BUYER as BUYER, PRIVATE_APPLIANCE_RULES as RULES } from '../content/wave27-appliance';
import { STUDIO_RELEASE_CONTENT_VERSION } from '../content/wave27';
import { COMMERCE_RULES } from '../content/wave3-commerce';
import { CHIP_FOUNDRIES, chipProductionTerms, isChipFoundry } from '../content/silicon-market';
import { chipDesignValues } from '../content/wave4-hardware';
import type { CommandQuote, DomainResult, GameCommand, GameContent, GameState, LedgerFact, ModuleContext, ProductsSlice, Rejection } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { PrivateApplianceConfiguration, PrivateApplianceOrder, PrivateAppliancePreview, PrivateApplianceView, Wave27ApplianceCommand } from '../contracts/wave27-appliance';
import type { EvaluatedReleaseIdentity } from '../contracts/wave27-canary';
import type { ChipDesign, ChipFoundry } from '../contracts/wave4-hardware';
import { canonicalStateHash } from '../core/canonical';
import { checkedAdd, formatMoney, formatUnits, mulDiv } from '../core/math';
import { reservedCash } from '../core/selectors';
import { applyBusinessCommand, outsideBusinessOrganizations } from './business';
import { availableFoundrySlots } from './hardware-sales';
import { inheritedModelRights, modelWorkBps } from './model-runtime';
import { policyReleaseRejection } from './policy-holdouts';
import { getEvaluatedReleaseIdentity } from './release-identity';

export { PRIVATE_APPLIANCE_COMMANDS } from '../content/wave27-appliance';
export const privateApplianceOrderId = () => 'private-appliance:' + BUYER.id;
export const privateApplianceContractId = () => 'business:' + BUYER.id;
export const privateApplianceFabricationFactId = () => privateApplianceOrderId() + ':fabrication';
export const privateApplianceBundleReceiptId = () => privateApplianceOrderId() + ':bundle-receipt';
const reject = (message: string, code: Rejection['code'] = 'NOT_READY'): Rejection => ({ code, message });
const hasResearch = (state: Readonly<GameState>, companyId: string) => (state.slices.research.completedByCompany[companyId] ?? []).includes(RULES.requiredResearch);
const records = (products: Readonly<ProductsSlice>): PrivateApplianceOrder[] => Object.values(products.privateApplianceOrders ?? {});
type OrderOptions = Pick<Wave27ApplianceCommand, 'modelId' | 'designId' | 'foundry'>;

export function privateApplianceDesignFingerprint(design: ChipDesign): string {
  return canonicalStateHash({ id: design.id, companyId: design.companyId, spec: design.spec,
    qualifiedYieldBps: design.qualifiedYieldBps, prototypeReportId: design.prototypeRun?.reportId ?? null,
    ...(design.successor ? { successor: design.successor } : {}) });
}

function modelReasons(state: Readonly<GameState>, modelId: string, companyId: string, content: GameContent): string[] {
  const model = state.slices.models.versions[modelId];
  if (!model || model.companyId !== companyId) return ['Choose an owned model.'];
  const reasons: string[] = [];
  if (model.architecture !== BUYER.architecture || !(RULES.supportedFamilies as readonly string[]).includes(model.family)) reasons.push('This configuration supports a dense compact or medium model.');
  if (model.capabilityBps.documents < BUYER.minimumScoreBps || model.reliabilityBps < BUYER.minimumReliabilityBps) reasons.push(`Cedar Records requires documents ${BUYER.minimumScoreBps / 100} and reliability ${BUYER.minimumReliabilityBps / 100}.`);
  if (!inheritedModelRights(state, modelId, content).weights) reasons.push('Weight distribution rights are required throughout this model’s training lineage.');
  const policy = policyReleaseRejection(state, modelId);
  if (policy) reasons.push(policy.message);
  else if (!getEvaluatedReleaseIdentity(state, modelId, content)) reasons.push('Complete a paid capability evaluation of this exact model and runtime before offering it.');
  return reasons;
}

function designReasons(state: Readonly<GameState>, designId: string, companyId: string): string[] {
  const design = state.slices.compute.chipDesigns[designId];
  if (!design || design.companyId !== companyId) return ['Choose an owned chip design.'];
  const reasons: string[] = [];
  if (design.status !== 'validated') reasons.push('Complete prototype qualification before fabricating this design.');
  if (design.spec.architecture !== BUYER.architecture || design.spec.target !== BUYER.target || design.spec.memory !== BUYER.memory) reasons.push('The buyer supports one configuration: two dense inference racks with wide memory.');
  return reasons;
}

/** Reusing a captured release keeps a later evaluation from silently changing the sold artifact. */
export function privateApplianceConfiguration(state: Readonly<GameState>, options: OrderOptions, content: GameContent = CONTENT, capturedRelease?: EvaluatedReleaseIdentity): PrivateApplianceConfiguration | null {
  const model = state.slices.models.versions[options.modelId], design = state.slices.compute.chipDesigns[options.designId];
  if (!model || !design || !isChipFoundry(options.foundry)) return null;
  const release = capturedRelease ?? getEvaluatedReleaseIdentity(state, model.id, content);
  if (!release) return null;
  const terms = chipProductionTerms(design, BUYER.racks, content.infrastructure.rackCU, options.foundry);
  const hardware = chipDesignValues(design), family = FAMILY_SERVING_MULTIPLIER[model.family];
  const workPerRequest = mulDiv((BUYER.inputTokensPerRequest * 200 + BUYER.outputTokensPerRequest * 1000) * family, modelWorkBps(model), 10_000);
  return { release: structuredClone(release), designId: design.id, designFingerprint: privateApplianceDesignFingerprint(design), foundry: options.foundry, racks: BUYER.racks,
    attemptedCU: terms.attemptedCU, usableCU: terms.usableCU, memoryMU: mulDiv(terms.usableCU, hardware.memoryMUPerCU, U), yieldBps: terms.yieldBps,
    weeklyWorkCUw: BUYER.weeklyRequests * workPerRequest, weeklyCapacityCUw: mulDiv(terms.usableCU, hardware.servingBps, 10_000),
    requiredMemoryMU: checkedAdd(model.residentMU, RULES.sessionMemoryMU), leadWeeks: terms.leadWeeks, fabricationCostCents: terms.costCents };
}

function configurationReasons(configuration: PrivateApplianceConfiguration): string[] {
  const reasons: string[] = [];
  if (configuration.usableCU < BUYER.minimumUsefulCU) reasons.push(`This foundry yield does not supply the buyer’s ${formatUnits(BUYER.minimumUsefulCU)} useful CU.`);
  if (configuration.memoryMU < Math.max(BUYER.minimumMemoryMU, configuration.requiredMemoryMU)) reasons.push('The fabricated hardware cannot fit this model, session memory and the buyer’s minimum memory requirement.');
  if (configuration.weeklyCapacityCUw < configuration.weeklyWorkCUw) reasons.push('This fixed runtime cannot execute the buyer’s weekly workload on the fabricated hardware.');
  if (configuration.leadWeeks > BUYER.maximumLeadWeeks) reasons.push(`This foundry route misses the buyer’s ${BUYER.maximumLeadWeeks}-week shipment deadline.`);
  return reasons;
}

function orderUnavailableReason(state: Readonly<GameState>, excludeCommandId?: string): string {
  if (state.slices.products.privateApplianceOrders?.[BUYER.id]) return 'Cedar Records’ one-time appliance order is already committed or fulfilled.';
  if (state.queuedCommands.some(command => command.id !== excludeCommandId && command.payload.kind === 'accept_private_appliance_order')) return 'Cedar Records’ appliance order is already queued.';
  if (state.slices.products.commercialContracts[privateApplianceContractId()]) return 'Cedar Records already has a fixed-model agreement.';
  return '';
}

export function validatePrivateApplianceOrder(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): Rejection | undefined {
  const p = command.payload;
  if (![STUDIO_RELEASE_CONTENT_VERSION, CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION].includes(content.version) || p.kind !== 'accept_private_appliance_order' || p.buyerId !== BUYER.id || !isChipFoundry(p.foundry)) return reject('Choose the supported private appliance buyer and foundry.', 'INVALID_COMMAND');
  const validId = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
  if (Object.keys(p).sort().join() !== 'buyerId,designId,foundry,kind,modelId' || !validId(p.modelId) || !validId(p.designId)) return reject('Choose only the supported appliance buyer, model, design and foundry.', 'INVALID_COMMAND');
  if (command.companyId !== state.playerCompanyId) return reject('This private appliance order is offered to the player’s lab.');
  if (!hasResearch(state, command.companyId)) return reject('Complete S4 Private appliance before committing this package.');
  const unavailable = orderUnavailableReason(state, command.id); if (unavailable) return reject(unavailable, 'ALREADY_ACTIVE');
  const modelReason = modelReasons(state, p.modelId, command.companyId, content)[0]; if (modelReason) return reject(modelReason);
  const designReason = designReasons(state, p.designId, command.companyId)[0]; if (designReason) return reject(designReason);
  const configuration = privateApplianceConfiguration(state, p, content)!;
  const reason = configurationReasons(configuration)[0]; if (reason) return reject(reason, 'CAPACITY_EXCEEDED');
  const slots = availableFoundrySlots(state, p.foundry, command.id);
  if (slots !== null && slots < BUYER.racks) return reject('The foundry cannot fit this appliance alongside its internal and external committed orders.', 'CAPACITY_EXCEEDED');
  const queuedOrganizations = state.queuedCommands.filter(other => other.id !== command.id && ['sign_business_contract', 'sign_assurance_contract', 'accept_private_appliance_order'].includes(other.payload.kind)).length;
  if (outsideBusinessOrganizations(state) - queuedOrganizations < 1) return reject('No business organization remains outside customers, trials and existing or queued commitments.', 'CAPACITY_EXCEEDED');
}

export function quotePrivateApplianceOrder(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): CommandQuote {
  if (command.payload.kind !== 'accept_private_appliance_order') throw new Error('Expected a private appliance order.');
  const configuration = privateApplianceConfiguration(state, command.payload, content);
  if (!configuration) throw new Error('The appliance has no evaluated configuration.');
  return { upfrontCostCents: checkedAdd(configuration.fabricationCostCents, BUYER.licenseSetupCents), weeklyCostDeltaCents: 0,
    summary: `Pay ${formatMoney(configuration.fabricationCostCents)} fabrication plus ${formatMoney(BUYER.licenseSetupCents)} license delivery setup. Two racks ship to Cedar Records in ${configuration.leadWeeks} weeks; then deliver 40 Design points for installation. Acceptance pays the ${formatMoney(BUYER.bundlePriceCents)} bundle once and starts the separate ${BUYER.termWeeks}-week license at ${formatMoney(BUYER.licenseWeeklyCents)}/week after support credits, requiring 5 Business points per week. Buyer-operated inference creates no lab token bill.` };
}

export function applyPrivateApplianceOrder(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): DomainResult {
  if (command.payload.kind !== 'accept_private_appliance_order') throw new Error('Expected a private appliance order.');
  const p = command.payload, configuration = privateApplianceConfiguration(state, p, content)!;
  const businessCommand: GameCommand = { ...command, payload: { kind: 'sign_business_contract', customerId: BUYER.id, modelId: p.modelId, contractKind: 'customer-hosted' } };
  const business = applyBusinessCommand(state, businessCommand, content), products = business.updates!.products!;
  const order: PrivateApplianceOrder = { id: privateApplianceOrderId(), buyerId: BUYER.id, companyId: command.companyId, commandId: command.id,
    modelId: p.modelId, contractId: privateApplianceContractId(), configuration,
    orderedWeek: state.week, arrivalWeek: state.week + configuration.leadWeeks, shippedWeek: null, acceptedWeek: null, settledWeek: null,
    fabricationFactId: privateApplianceFabricationFactId(), bundleReceiptId: privateApplianceBundleReceiptId(), bundlePriceCents: BUYER.bundlePriceCents,
    delivery: { completedStaff: 0, grantCount: 0, firstWeek: null, latestGrant: null }, artifact: null };
  (products.privateApplianceOrders ??= {})[BUYER.id] = order;
  products.commercialContracts[order.contractId].lastBottleneck = 'The foundry must ship the customer’s hardware before fixed-model installation can begin.';
  return { updates: { products }, facts: [...(business.facts ?? []), { id: order.fabricationFactId, sourceId: order.id, companyId: command.companyId,
    kind: 'expense', category: 'operating', amountCents: configuration.fabricationCostCents, week: state.week, label: BUYER.name + ': appliance fabrication' }],
    messages: [{ category: 'project', companyId: command.companyId, message: `Cedar Records’ fixed appliance is committed. The foundry ships directly in Week ${order.arrivalWeek}; installation and acceptance follow. Its license is not billing yet.` }] };
}

/** Called inside the existing business commit before delivery activation. */
export function commitPrivateApplianceShipments(products: ProductsSlice, week: number): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const order of records(products)) if (order.shippedWeek === null && order.arrivalWeek === week) {
    order.shippedWeek = week;
    products.commercialContracts[order.contractId].lastBottleneck = 'Hardware delivered to the buyer. Installation of the fixed model and runtime needs Design points.';
    messages.push({ category: 'delivery', companyId: order.companyId, message: 'Cedar Records received its two appliance racks. Fixed-model installation can now use ML staff; bundle payment awaits acceptance.' });
  }
  return messages;
}

export function privateApplianceDeliveryAvailable(products: Readonly<ProductsSlice>, contractId: string): boolean {
  const order = records(products).find(item => item.contractId === contractId);
  return !order || order.shippedWeek !== null;
}

/** Retain the actual shared ML allocator grant; the linked contract remains the delivery meter owner. */
export function recordPrivateApplianceDelivery(products: ProductsSlice, contractId: string, week: number, remainingBefore: number, grantedStaff: number): void {
  const order = records(products).find(item => item.contractId === contractId);
  if (!order || grantedStaff === 0) return;
  order.delivery.completedStaff += grantedStaff; order.delivery.grantCount++;
  order.delivery.firstWeek ??= week;
  order.delivery.latestGrant = { week, remainingBefore, grantedStaff };
}

/** Activation is the ordinary business delivery boundary, so it cannot bill before installation. */
export function acceptPrivateAppliances(products: ProductsSlice, week: number): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const order of records(products)) {
    const contract = products.commercialContracts[order.contractId];
    if (order.acceptedWeek !== null || order.shippedWeek === null || contract.status !== 'active' || contract.readyWeek !== week) continue;
    order.acceptedWeek = week;
    order.artifact = { id: order.id + ':installed', acceptedWeek: week, configuration: structuredClone(order.configuration) };
    messages.push({ category: 'delivery', companyId: order.companyId, message: 'Cedar Records accepted the installed appliance. Its fixed-weight license and support term begin; the one-time bundle payment settles this week.' });
  }
  return messages;
}

/** The ledger uses a deterministic fact ID; ordinary businessSettle remains the sole support invoice owner. */
export function settlePrivateAppliances(state: Readonly<GameState>, products: ProductsSlice, ctx: ModuleContext): LedgerFact[] {
  const facts: LedgerFact[] = [];
  for (const order of records(products)) {
    if (order.acceptedWeek !== ctx.week || order.settledWeek !== null || state.slices.company.postedFacts[order.bundleReceiptId]) continue;
    order.settledWeek = ctx.week;
    facts.push({ id: order.bundleReceiptId, sourceId: order.id, companyId: order.companyId, week: ctx.week,
      kind: 'receipt', category: 'revenue', amountCents: order.bundlePriceCents, label: BUYER.name + ': accepted appliance bundle' });
  }
  return facts;
}

export function getPrivateApplianceView(state: Readonly<GameState>, companyId = state.playerCompanyId, content: GameContent = CONTENT): PrivateApplianceView {
  const unlocked = [STUDIO_RELEASE_CONTENT_VERSION, CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION].includes(content.version) && hasResearch(state, companyId);
  const unavailableReason = orderUnavailableReason(state);
  return { unlocked, gateReason: unlocked ? '' : 'Complete S4 Private appliance to qualify and commit this customer-hosted package.', buyer: structuredClone(BUYER), available: !unavailableReason, unavailableReason,
    models: Object.values(state.slices.models.versions).filter(model => model.companyId === companyId && model.status !== 'checkpoint').map(model => {
      const reasons = modelReasons(state, model.id, companyId, content);
      return { id: model.id, name: model.name, family: model.family, architecture: model.architecture, residentMU: model.residentMU,
        documentsBps: model.capabilityBps.documents, reliabilityBps: model.reliabilityBps, weights: inheritedModelRights(state, model.id, content).weights, eligible: reasons.length === 0, reasons };
    }),
    designs: Object.values(state.slices.compute.chipDesigns).filter(design => design.companyId === companyId).map(design => {
      const reasons = designReasons(state, design.id, companyId); return { id: design.id, name: design.name, status: design.status, eligible: reasons.length === 0, reasons };
    }),
    foundries: (Object.keys(CHIP_FOUNDRIES) as ChipFoundry[]).map(id => ({ id, name: CHIP_FOUNDRIES[id].name, availableRackSlots: availableFoundrySlots(state, id) })),
    orders: records(state.slices.products).filter(order => order.companyId === companyId).map(order => {
      const contract = state.slices.products.commercialContracts[order.contractId];
      return { order: structuredClone(order), phase: order.acceptedWeek !== null ? 'accepted' : order.shippedWeek === null ? 'fabricating' : contract.status === 'ready' ? 'ready' : 'installing',
        contract: structuredClone(contract), invoices: structuredClone(state.slices.products.commercialInvoices.filter(invoice => invoice.contractId === contract.id)),
        fabricationPaid: state.slices.company.postedFacts[order.fabricationFactId] === true, deliverySetupPaid: state.slices.company.postedFacts[contract.setupFactId] === true,
        bundleSettled: state.slices.company.postedFacts[order.bundleReceiptId] === true, installedArtifact: structuredClone(order.artifact) };
    }), supportStaffPerWeek: COMMERCE_RULES.supportStaffPerOrganization, requiredDeliveryStaff: COMMERCE_RULES.licenseDeliveryStaff };
}

export function previewPrivateApplianceOrder(state: Readonly<GameState>, options: OrderOptions, content: GameContent = CONTENT, companyId = state.playerCompanyId): PrivateAppliancePreview {
  const command: GameCommand = { id: 'private-appliance-preview', companyId, issuedForWeek: state.week + 1,
    payload: { kind: 'accept_private_appliance_order', buyerId: BUYER.id, ...options } };
  const reason = validatePrivateApplianceOrder(state, command, content);
  const configuration = privateApplianceConfiguration(state, options, content), fabricationCostCents = configuration?.fabricationCostCents ?? 0;
  const upfrontCostCents = checkedAdd(fabricationCostCents, BUYER.licenseSetupCents), reasons = reason ? [reason.message] : [];
  const company = state.slices.company.companies[companyId];
  if (company?.arrearsCents) reasons.push('Resolve the company’s unpaid bills before committing new paid work.');
  else if (company && company.cashCents - reservedCash(state as GameState, companyId) < upfrontCostCents) reasons.push('There is not enough uncommitted cash for fabrication and delivery setup.');
  return { eligible: reasons.length === 0, reasons, configuration, fabricationCostCents, deliverySetupCents: BUYER.licenseSetupCents, upfrontCostCents,
    bundlePriceCents: BUYER.bundlePriceCents, licenseWeeklyCents: BUYER.licenseWeeklyCents, supportStaffPerWeek: COMMERCE_RULES.supportStaffPerOrganization,
    requiredDeliveryStaff: COMMERCE_RULES.licenseDeliveryStaff, termWeeks: BUYER.termWeeks };
}
