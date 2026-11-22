import { usesWorkPointProfiles } from './workforce';
import { formatWorkPoints } from './workforce-points';
import { facilityTariffBinding } from './facility-tariffs';
import { CONTENT } from '../content/catalog';
import { SEGMENT_BY_ID } from '../content/wave2-market';
import { ROUTING } from '../content/wave4-research';
import { RUNTIME_GUARDRAIL_PROFILES } from '../content/wave12-guardrails';
import { ASSURANCE_BY_ID, ASSURANCE_BUYERS, ASSURANCE_COMMANDS, ASSURANCE_RULES as RULES } from '../content/wave13-assurance';
import type { AssuranceBuyerDefinition, AssuranceContract, AssuranceInvoice, AssuranceMeter, AssuranceQualification, AssuranceUsage, AssuranceView } from '../contracts/wave13-assurance';
import type { RuntimeGuardrailBinding, RuntimeGuardrailInstallation, RuntimeGuardrailProfile } from '../contracts/wave12-guardrails';
import type { BusinessAdmissionContext } from '../contracts/wave3-commerce';
import type { CommandQuote, DomainResult, GameCommand, GameContent, GameState, LedgerFact, ModuleContext, ProductsSlice, Rejection, WorkRequest } from '../contracts/types';
import { canonicalStateHash } from '../core/canonical';
import { checkedAdd, formatMoney, formatUnits, mulDiv } from '../core/math';
import { createCompanyModule } from './company';
import { createComputeModule } from './compute';
import { getComputePools, getPoolWorkCostRate, getPoolMultiplierBps, poolSupportsWorkload } from './compute-pools';
import { infrastructureRequests } from './infrastructure';
import { inheritedModelRights, modelExecutionHints } from './model-runtime';
import { requestMeter } from './product-models';
import { aiSystemSessionMemory } from './ai-systems';
import { policyReleaseRejection } from './policy-holdouts';
import { activeRuntimeGuardrail, runtimeGuardrailAudit, runtimeGuardrailResearchReady } from './runtime-guardrails';

export { ASSURANCE_COMMANDS };
const records = (products: Readonly<ProductsSlice>): AssuranceContract[] => Object.values(products.assuranceContracts ?? {});
export const assuranceLive = (contract: AssuranceContract): boolean => ['building', 'ready', 'active'].includes(contract.status);
const reject = (code: Rejection['code'], message: string): Rejection => ({ code, message });
const proportion = (granted: number, required: number) => required ? Math.min(10000, mulDiv(granted, 10000, required)) : 10000;
export const assuranceWorkId = (id: string, kind: 'serve' | 'support' | 'onboard'): string => `assurance-${kind}:${id}`;
export const currentAssuranceQualification = (contract: AssuranceContract): AssuranceQualification => contract.qualifications[contract.qualifications.length - 1];

export function assuranceResearchReady(state: Readonly<GameState>, companyId: string, atWeek = state.week): boolean {
  const project = Object.values(state.slices.research.projects).find(item => item.companyId === companyId && item.researchId === RULES.researchId);
  return !!project && project.status === 'complete' && project.availableWeek !== undefined && project.availableWeek <= atWeek
    && (state.slices.research.completedByCompany[companyId] ?? []).includes(RULES.researchId)
    && runtimeGuardrailResearchReady(state, companyId, atWeek);
}

/** Separate company-hosted tenant: no public cache warmth, adapter memory sharing, or customer token bill. */
export function assuranceMeter(state: Readonly<GameState>, binding: RuntimeGuardrailBinding, profile: RuntimeGuardrailProfile): AssuranceMeter {
  const primary = state.slices.models.versions[binding.primary.modelId], primaryMeter = requestMeter(primary, binding.features);
  const secondary = binding.secondary ? state.slices.models.versions[binding.secondary.modelId] : null;
  if (secondary && secondary.architecture !== primary.architecture) throw new Error('Assured API routes require compatible model architectures.');
  const secondaryWork = secondary ? requestMeter(secondary, binding.features).work : 0;
  const baseWork = secondary ? checkedAdd(mulDiv(primaryMeter.work, 10000 - binding.secondaryShareBps, 10000), mulDiv(secondaryWork, binding.secondaryShareBps, 10000)) + ROUTING.overheadPerRequest : primaryMeter.work;
  const checker = RUNTIME_GUARDRAIL_PROFILES[profile];
  return { inputTokensPerRequest: primaryMeter.inputTokens, outputTokensPerRequest: primaryMeter.outputTokens,
    internalTokensPerRequest: primaryMeter.internalTokens, workPerRequestCUw: checkedAdd(baseWork, checker.workPerRequestCUw),
    guardrailWorkPerRequestCUw: checker.workPerRequestCUw,
    reservedMemoryMU: checkedAdd(checkedAdd(primary.residentMU, secondary?.residentMU ?? 0), checkedAdd(primaryMeter.sessionMemory,
      checkedAdd(checker.memoryMU, secondary && secondary.id !== primary.id ? aiSystemSessionMemory(secondary) : 0))),
    servingHeadroomBps: RULES.servingHeadroomBps, executionHints: { ...modelExecutionHints(primary),
      ...(secondary && ['edge', 'compact', 'medium', 'large', 'frontier'].indexOf(secondary.family) > ['edge', 'compact', 'medium', 'large', 'frontier'].indexOf(primary.family) ? { modelFamily: secondary.family } : {}),
      ...(secondary?.architecture === 'sparse' ? { requiresFastFabric: true } : {}) } };
}

export function assuranceAuditQualifies(installation: RuntimeGuardrailInstallation | null, buyer: AssuranceBuyerDefinition): boolean {
  const totals = installation?.audit?.guarded;
  return !!totals && totals.allowedCases === 50 && totals.restrictedCases === 50
    && totals.usefulAnswers >= buyer.minimumUsefulAnswers && totals.unsafeCompliances <= buyer.maximumUnsafeCompliances;
}

function qualificationFor(state: Readonly<GameState>, productId: string, version: number, commandId: string): AssuranceQualification {
  const installation = activeRuntimeGuardrail(state, productId)!;
  return { version, acceptedWeek: state.week, commandId, installationId: installation.id, profile: installation.profile,
    binding: structuredClone(installation.binding), bindingFingerprint: installation.bindingFingerprint,
    evidenceKey: installation.evidenceKey, auditFingerprint: canonicalStateHash(installation.audit),
    usefulAnswers: installation.audit!.guarded.usefulAnswers, unsafeCompliances: installation.audit!.guarded.unsafeCompliances,
    meter: assuranceMeter(state, installation.binding, installation.profile) };
}

export function assuranceQualificationMatches(state: Readonly<GameState>, contract: AssuranceContract): boolean {
  const qualification = currentAssuranceQualification(contract), current = activeRuntimeGuardrail(state, contract.productId);
  return !!current && current.id === qualification.installationId && current.profile === qualification.profile
    && current.bindingFingerprint === qualification.bindingFingerprint && canonicalStateHash(current.audit) === qualification.auditFingerprint;
}

/** An ended organization becomes available at the following boundary, just like existing commitments. */
export function assuranceOrganizationCount(state: Readonly<GameState>, week = state.week): number {
  return records(state.slices.products).filter(item => assuranceLive(item) || item.endedWeek === week).length;
}

export function assuranceOutsideOrganizations(state: Readonly<GameState>, week = state.week): number {
  const cohorts = state.slices.markets.cohorts.filter(item => item.segmentId === 'business').reduce((sum, item) => sum + item.count, 0);
  const trials = state.slices.markets.trials.filter(item => item.segmentId === 'business').reduce((sum, item) => sum + item.count, 0);
  const ordinary = Object.values(state.slices.products.commercialContracts ?? {}).filter(item => ['building', 'ready', 'active'].includes(item.status) || item.endedWeek === week).length;
  return SEGMENT_BY_ID.business.population - cohorts - trials - (state.slices.markets.returnedNextWeek.business ?? 0) - ordinary - assuranceOrganizationCount(state, week);
}

function newContract(state: Readonly<GameState>, command: GameCommand): AssuranceContract {
  if (command.payload.kind !== 'sign_assurance_contract') throw new Error('Expected an assured API contract command.');
  const p = command.payload, buyer = ASSURANCE_BY_ID[p.buyerId];
  return { id: `assurance:${command.id}`, buyerId: buyer.id, companyId: command.companyId, productId: p.productId,
    status: 'building', signedWeek: state.week, setupFeeCents: RULES.setupFeeCents, setupFactId: `assurance-setup:${command.id}`,
    requiredOnboardingStaff: RULES.onboardingStaff, completedOnboardingStaff: 0, onboardingGrantCount: 0,
    firstOnboardingWeek: null, latestOnboardingGrant: null, readyWeek: null, termStartedWeek: null, termEndsWeek: null, endedWeek: null, cancellationCommandId: null,
    weeklyRequests: buyer.weeklyRequests, weeklyPriceCents: buyer.weeklyPriceCents, supportStaffPerWeek: buyer.supportStaffPerWeek, slaBps: RULES.slaBps,
    qualifications: [qualificationFor(state, p.productId, 1, command.id)], termWeeksServed: 0, termServiceBpsTotal: 0,
    lifetimeBilledCents: 0, lifetimeCreditsCents: 0, lastUsage: null,
    lastBottleneck: usesWorkPointProfiles(state) ? 'The paid integration needs Business points. The eight-week term begins after onboarding finishes.' : 'Assign commercial staff to the paid integration; the eight-week term begins at the boundary after onboarding finishes.' };
}

export function assuranceServingRequest(contract: AssuranceContract): WorkRequest {
  const meter = currentAssuranceQualification(contract).meter;
  return { id: assuranceWorkId(contract.id, 'serve'), companyId: contract.companyId, taskId: contract.id, category: 'serving',
    normalizedWorkCUw: contract.weeklyRequests * meter.workPerRequestCUw, memoryMU: meter.reservedMemoryMU,
    headroomBps: meter.servingHeadroomBps, priority: 0, poolId: 'auto', ...meter.executionHints };
}

/** Even suspended and onboarding commitments reserve their currently accepted fixed promise in forecasts. */
export function assuranceCapacityRequests(state: Readonly<GameState>, companyId?: string): WorkRequest[] {
  return records(state.slices.products).filter(item => assuranceLive(item) && (item.termEndsWeek === null || item.termEndsWeek > state.week) && (!companyId || item.companyId === companyId)).map(assuranceServingRequest);
}

export function assuranceQueuedCapacityRequests(state: Readonly<GameState>, companyId?: string, excludeCommandId?: string): WorkRequest[] {
  return state.queuedCommands.filter(command => command.id !== excludeCommandId && (command.payload.kind === 'sign_assurance_contract' || command.payload.kind === 'requalify_assurance_contract')
    && (!companyId || command.companyId === companyId)).flatMap(command => {
    if (command.payload.kind === 'sign_assurance_contract') {
      if (!ASSURANCE_BY_ID[command.payload.buyerId] || !activeRuntimeGuardrail(state, command.payload.productId)?.audit) return [];
      return [assuranceServingRequest(newContract(state, command))];
    }
    if (command.payload.kind !== 'requalify_assurance_contract') return [];
    const contract = state.slices.products.assuranceContracts?.[command.payload.contractId];
    if (!contract || !assuranceLive(contract) || contract.companyId !== command.companyId || contract.termEndsWeek !== null && contract.termEndsWeek <= state.week
      || !activeRuntimeGuardrail(state, contract.productId)?.audit) return [];
    const candidate = structuredClone(contract); candidate.qualifications.push(qualificationFor(state, contract.productId, contract.qualifications.length + 1, command.id));
    return [assuranceServingRequest(candidate)];
  });
}

function productQualificationRejection(state: Readonly<GameState>, productId: string, companyId: string, buyer: AssuranceBuyerDefinition, content: GameContent): Rejection | undefined {
  const product = state.slices.products.offers[productId];
  if (!product || product.companyId !== companyId || product.kind !== 'developer-api' || product.status !== 'active') return reject('NOT_READY', 'Choose one of your active developer API products.');
  const installation = activeRuntimeGuardrail(state, productId);
  if (!installation?.audit || installation.availableWeek === null || installation.availableWeek > state.week
    || canonicalStateHash(installation.audit) !== canonicalStateHash(runtimeGuardrailAudit(state, installation))) return reject('NOT_READY', 'This API needs its exact active paid runtime guardrail audit.');
  if (!assuranceAuditQualifies(installation, buyer)) return reject('NOT_READY', `${buyer.name} requires at least ${buyer.minimumUsefulAnswers}/50 useful allowed answers and at most ${buyer.maximumUnsafeCompliances}/50 restricted compliances in the paid audit.`);
  for (const binding of [installation.binding.primary, ...(installation.binding.secondary ? [installation.binding.secondary] : [])]) {
    const policy = policyReleaseRejection(state, binding.modelId); if (policy) return policy;
    if (!inheritedModelRights(state, binding.modelId, content).hosted) return reject('NOT_READY', 'Every accepted route needs inherited company-hosted use rights.');
  }
}

function capacityRejection(state: Readonly<GameState>, command: GameCommand, content: GameContent, admission: BusinessAdmissionContext | undefined, contract: AssuranceContract, replaceId?: string): Rejection | undefined {
  const existing = [...(admission?.standardRequests ?? []).filter(item => item.companyId === command.companyId),
    ...assuranceCapacityRequests(state, command.companyId), ...assuranceQueuedCapacityRequests(state, command.companyId, command.id)];
  const requests = [...existing.filter(item => item.id !== assuranceWorkId(replaceId ?? '', 'serve')), assuranceServingRequest(contract)];
  const unique = [...new Map(requests.map(item => [item.id, item])).values()];
  const context: ModuleContext = { week: state.week + 1, phase: 'reserve', content, facts: [], random: { draw: () => 0 },
    resources: { requests: [...unique, ...infrastructureRequests(state, content).filter(item => item.companyId === command.companyId)], computeGrants: [], staffGrants: [] } };
  const staffing = createCompanyModule(content).grantResources!(state, context).staffGrants ?? [];
  const forecast = createComputeModule(content).grantResources!(state, { ...context, resources: { requests: unique, computeGrants: [], staffGrants: staffing } });
  const grants = new Map((forecast.computeGrants ?? []).map(item => [item.requestId, item]));
  if (unique.some(item => item.normalizedWorkCUw > 0 && ((grants.get(item.id)?.hardwareEffectiveCUw ?? 0) < item.normalizedWorkCUw || (grants.get(item.id)?.memoryMU ?? 0) < item.memoryMU))) return reject('CAPACITY_EXCEEDED', 'The connected inference fleet cannot fit this tenant’s weekly workload, 10% headroom and separate resident memory alongside current and queued commitments.');
}

export function validateAssuranceCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT, admission?: BusinessAdmissionContext): Rejection | undefined {
  const p = command.payload, company = state.slices.company.companies[command.companyId];
  if (!company) return reject('UNKNOWN_COMPANY', 'This company does not exist.');
  if (p.kind !== 'sign_assurance_contract' && p.kind !== 'requalify_assurance_contract' && p.kind !== 'cancel_assurance_contract') return reject('INVALID_COMMAND', 'Choose an implemented assured API action.');
  if (p.kind !== 'sign_assurance_contract') {
    const contract = state.slices.products.assuranceContracts?.[p.contractId];
    if (!contract || contract.companyId !== command.companyId || !assuranceLive(contract) || contract.termEndsWeek !== null && contract.termEndsWeek <= state.week) return reject('NOT_READY', 'Choose one of your live assured API commitments before its calendar expiry.');
    if (state.queuedCommands.some(other => other.id !== command.id && (other.payload.kind === 'requalify_assurance_contract' || other.payload.kind === 'cancel_assurance_contract') && other.payload.contractId === contract.id)) return reject('ALREADY_ACTIVE', 'This commitment already has a queued qualification or cancellation choice.');
    if (p.kind === 'cancel_assurance_contract') return;
    if (company.arrearsCents) return reject('ARREARS', 'Resolve unpaid expenses before accepting a new qualification.');
    if (contract.qualifications.length >= RULES.maximumQualifications) return reject('CAPACITY_EXCEEDED', 'This term retains at most four exact qualification versions.');
    const reason = productQualificationRejection(state, contract.productId, command.companyId, ASSURANCE_BY_ID[contract.buyerId], content); if (reason) return reason;
    const current = activeRuntimeGuardrail(state, contract.productId)!;
    if (current.id === currentAssuranceQualification(contract).installationId) return reject('ALREADY_ACTIVE', 'This term already accepts the current paid installation. Restoring the same checker needs no new qualification.');
    const candidate = structuredClone(contract); candidate.qualifications.push(qualificationFor(state, contract.productId, contract.qualifications.length + 1, command.id));
    return capacityRejection(state, command, content, admission, candidate, contract.id);
  }
  if (company.arrearsCents) return reject('ARREARS', 'Resolve unpaid expenses before signing another service commitment.');
  if (!assuranceResearchReady(state, command.companyId)) return reject('NOT_READY', 'Complete R12 Enterprise Commitments and runtime guardrail research before signing assured API work.');
  const buyer = ASSURANCE_BY_ID[p.buyerId]; if (!buyer) return reject('INVALID_COMMAND', 'Choose one of the two authored assurance buyers.');
  const history = records(state.slices.products), previous = history.filter(item => item.buyerId === buyer.id);
  if (history.length >= RULES.maximumContracts || previous.length >= RULES.maximumTermsPerBuyer) return reject('CAPACITY_EXCEEDED', 'Assurance history retains four terms per buyer and eight terms overall.');
  if (previous.some(item => assuranceLive(item) || item.endedWeek === null || state.week < item.endedWeek + RULES.reofferDelayWeeks)) return reject('ALREADY_ACTIVE', 'This buyer is already committed or returns at the next weekly boundary.');
  const queued = state.queuedCommands.filter(other => other.id !== command.id && (other.payload.kind === 'sign_business_contract' || other.payload.kind === 'sign_assurance_contract' || other.payload.kind === 'accept_private_appliance_order'));
  if (queued.some(other => other.payload.kind === 'sign_assurance_contract' && other.payload.buyerId === p.buyerId)) return reject('ALREADY_ACTIVE', 'A commitment for this buyer is already queued.');
  if (assuranceOutsideOrganizations(state) - queued.length < 1) return reject('CAPACITY_EXCEEDED', 'No business organization remains outside customers, trials and existing or queued commitments.');
  if (history.length + queued.filter(other => other.payload.kind === 'sign_assurance_contract').length >= RULES.maximumContracts) return reject('CAPACITY_EXCEEDED', 'The retained assurance term history is full.');
  const qualification = productQualificationRejection(state, p.productId, command.companyId, buyer, content); if (qualification) return qualification;
  return capacityRejection(state, command, content, admission, newContract(state, command));
}

export function quoteAssuranceCommand(state: Readonly<GameState>, command: GameCommand): CommandQuote {
  const p = command.payload;
  if (p.kind === 'requalify_assurance_contract') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
    summary: 'Explicitly accept the current already-paid qualifying runtime audit next week. This records a new exact source, route, features, checker and tenant meter; it does not reroll evidence, charge a second audit fee, or restart the eight-week term.' };
  if (p.kind === 'cancel_assurance_contract') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
    summary: 'Cancel this commitment next week. Its integration expense is not refunded; future serving, support and retainers stop. The buyer returns at the following weekly boundary, with all earned invoices retained.' };
  const contract = newContract(state, command), buyer = ASSURANCE_BY_ID[contract.buyerId], meter = currentAssuranceQualification(contract).meter;
  return { upfrontCostCents: RULES.setupFeeCents, weeklyCostDeltaCents: 0,
    summary: `${buyer.name}: pay ${formatMoney(RULES.setupFeeCents)} integration and deliver ${usesWorkPointProfiles(state) ? '20 Business points, at most 20 per week' : '1 commercial staff-week, at most 1 per week'}. The following boundary begins eight weeks of ${contract.weeklyRequests.toLocaleString('en-US')} benign requests and ${formatMoney(contract.weeklyPriceCents)}/week, with ${usesWorkPointProfiles(state) ? `${formatWorkPoints(contract.supportStaffPerWeek)} Business points per week` : `${formatUnits(contract.supportStaffPerWeek)} commercial FTE`}. Each week reserves ${formatUnits(contract.weeklyRequests * meter.workPerRequestCUw)} CUw plus 10% headroom and ${formatUnits(meter.reservedMemoryMU)} separate MU. Bill the delivered fraction after proportional credits; no extra SLA fine. The exact paid audit must remain accepted and the API active. Source or checker changes suspend this tenant until explicit requalification; the calendar continues. This finite audit is not a general safety guarantee.` };
}

export function applyAssuranceCommand(state: Readonly<GameState>, command: GameCommand): DomainResult {
  const products = structuredClone(state.slices.products), p = command.payload;
  if (p.kind === 'sign_assurance_contract') {
    const contract = newContract(state, command); products.assuranceContracts ??= {}; products.assuranceInvoices ??= [];
    products.assuranceContracts[contract.id] = contract;
    return { updates: { products }, facts: [{ id: contract.setupFactId, companyId: contract.companyId, week: state.week,
      sourceId: contract.id, category: 'operating', amountCents: contract.setupFeeCents, label: `${ASSURANCE_BY_ID[contract.buyerId].name}: assured API integration`, kind: 'expense' }],
    messages: [{ category: 'project', companyId: contract.companyId, message: `${ASSURANCE_BY_ID[contract.buyerId].name} signed. Paid commercial onboarding must finish before its eight-week retainer begins.` }] };
  }
  if (p.kind !== 'requalify_assurance_contract' && p.kind !== 'cancel_assurance_contract') return {};
  const contract = products.assuranceContracts![p.contractId];
  if (p.kind === 'cancel_assurance_contract') {
    contract.status = 'cancelled'; contract.endedWeek = state.week; contract.cancellationCommandId = command.id; contract.lastBottleneck = 'Cancelled by the company; no future service or retainer is due.';
    return { updates: { products }, messages: [{ category: 'market', companyId: contract.companyId, message: `${ASSURANCE_BY_ID[contract.buyerId].name}: the commitment is cancelled. Earned invoices and its integration expense remain recorded.` }] };
  }
  contract.qualifications.push(qualificationFor(state, contract.productId, contract.qualifications.length + 1, command.id)); contract.lastBottleneck = '';
  return { updates: { products }, messages: [{ category: 'project', companyId: contract.companyId, message: `${ASSURANCE_BY_ID[contract.buyerId].name}: the latest paid qualifying audit is accepted for this term. The original expiry is unchanged.` }] };
}

export function assuranceCommit(_state: Readonly<GameState>, products: ProductsSlice, ctx: ModuleContext): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const contract of records(products)) if (contract.status === 'ready' && contract.readyWeek !== null && contract.readyWeek <= ctx.week) {
    contract.status = 'active'; contract.termStartedWeek = ctx.week; contract.termEndsWeek = ctx.week + RULES.termWeeks; contract.lastBottleneck = '';
    messages.push({ category: 'delivery', companyId: contract.companyId, message: `${ASSURANCE_BY_ID[contract.buyerId].name}: commercial onboarding finished. The eight-week assured API term begins.` });
  }
  return messages;
}

export function assuranceTermBoundary(_state: Readonly<GameState>, products: ProductsSlice, ctx: ModuleContext): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const contract of records(products)) if (contract.status === 'active' && contract.termEndsWeek !== null && contract.termEndsWeek <= ctx.week) {
    contract.status = 'expired'; contract.endedWeek = ctx.week; contract.lastBottleneck = 'The eight-week calendar term ended; there is no automatic renewal.';
    messages.push({ category: 'market', companyId: contract.companyId, message: `${ASSURANCE_BY_ID[contract.buyerId].name}: the fixed eight-week term expired. Invoices and exact qualification history are retained.` });
  }
  return messages;
}

export function assuranceRequests(state: Readonly<GameState>, week = state.week): WorkRequest[] {
  const requests: WorkRequest[] = [];
  for (const contract of records(state.slices.products)) {
    if (contract.status === 'building' && !state.slices.company.companies[contract.companyId].arrearsCents) requests.push({ id: assuranceWorkId(contract.id, 'onboard'),
      companyId: contract.companyId, taskId: contract.id, category: 'development', normalizedWorkCUw: 0, memoryMU: 0, priority: 10, poolId: 'auto',
      staffDemand: [{ role: 'commercial', staffWeeks: Math.min(RULES.maximumWeeklyOnboardingStaff, contract.requiredOnboardingStaff - contract.completedOnboardingStaff) }] });
    if (contract.status !== 'active' || contract.termEndsWeek === null || contract.termEndsWeek <= week) continue;
    requests.push({ id: assuranceWorkId(contract.id, 'support'), companyId: contract.companyId, taskId: contract.id, category: 'development',
      normalizedWorkCUw: 0, memoryMU: 0, priority: 0, poolId: 'auto', staffDemand: [{ role: 'commercial', staffWeeks: contract.supportStaffPerWeek }] });
    if (state.slices.products.offers[contract.productId]?.status === 'active' && assuranceQualificationMatches(state, contract)) requests.push(assuranceServingRequest(contract));
  }
  return requests;
}

export function assuranceInvoiceAmount(grossCents: number, serviceBps: number): number { return mulDiv(grossCents, serviceBps, 10000); }

export function advanceAssurance(state: Readonly<GameState>, products: ProductsSlice, ctx: ModuleContext): void {
  const staff = (id: string) => ctx.resources.staffGrants.find(item => item.requestId === id)?.grants.find(item => item.role === 'commercial')?.staffWeeks ?? 0;
  for (const contract of records(products)) {
    if (contract.status === 'building') {
      const remaining = contract.requiredOnboardingStaff - contract.completedOnboardingStaff;
      const granted = staff(assuranceWorkId(contract.id, 'onboard'));
      if (granted > Math.min(RULES.maximumWeeklyOnboardingStaff, remaining) || granted < 0) throw new Error('Assurance onboarding exceeded its actual bounded commercial allocation.');
      if (granted > 0) {
        contract.firstOnboardingWeek ??= ctx.week; contract.onboardingGrantCount++;
        contract.latestOnboardingGrant = { week: ctx.week, remainingBefore: remaining, grantedStaff: granted };
        contract.completedOnboardingStaff = checkedAdd(contract.completedOnboardingStaff, granted);
      }
      contract.lastBottleneck = contract.completedOnboardingStaff === contract.requiredOnboardingStaff ? '' : usesWorkPointProfiles(state) ? 'Generate Business points for the integration, up to 20 each week.' : 'Assign productive commercial staff to the integration, up to one staff-week per week.';
      continue;
    }
    if (contract.status !== 'active' || contract.termEndsWeek === null || contract.termEndsWeek <= ctx.week || contract.lastUsage?.week === ctx.week) continue;
    const qualification = currentAssuranceQualification(contract), meter = qualification.meter;
    const qualified = assuranceQualificationMatches(state, contract), productActive = state.slices.products.offers[contract.productId]?.status === 'active';
    const grant = ctx.resources.computeGrants.find(item => item.requestId === assuranceWorkId(contract.id, 'serve'));
    const requestedWorkCUw = contract.weeklyRequests * meter.workPerRequestCUw, executedWorkCUw = grant?.hardwareEffectiveCUw ?? 0;
    let computeReceipt: AssuranceUsage['computeReceipt'] = null;
    if (executedWorkCUw > 0) {
      const pool = getComputePools(state, contract.companyId, ctx.content, ctx.resources.staffGrants).find(item => item.id === grant!.poolId);
      if (!qualified || !productActive || !pool || !poolSupportsWorkload(pool, meter.executionHints) || grant!.memoryMU !== meter.reservedMemoryMU || grant!.sharedMemoryMU || executedWorkCUw > requestedWorkCUw) throw new Error('Assured API work lost its accepted qualification or separate compatible resident workspace.');
      const multiplierBps = getPoolMultiplierBps(pool, 'serving', false, ctx.content, 'inference');
      if (grant!.physicalCUw <= 0 || executedWorkCUw !== Math.min(requestedWorkCUw, mulDiv(grant!.physicalCUw, multiplierBps, 10000))) throw new Error('Assured API service has no corresponding physical GPU grant.');
      computeReceipt = { poolId: pool.id, hardwareId: pool.hardwareId, ownership: pool.ownership, multiplierBps,
        rateCentsPerCUw: pool.ownership === 'cloud' ? ctx.content.opening.rentCentsPerCUWeek : getPoolWorkCostRate(pool, { category: 'serving' }), memoryMU: grant!.memoryMU, ...facilityTariffBinding(pool, { category: 'serving' }) };
    }
    const servedRequests = mulDiv(executedWorkCUw, 1, meter.workPerRequestCUw), supportStaffGranted = staff(assuranceWorkId(contract.id, 'support'));
    if (supportStaffGranted < 0 || supportStaffGranted > contract.supportStaffPerWeek) throw new Error('Assurance support exceeds its separate commercial allocation.');
    const fulfillmentBps = proportion(servedRequests, contract.weeklyRequests), supportBps = proportion(supportStaffGranted, contract.supportStaffPerWeek);
    const qualificationBps = qualified && productActive ? 10000 : 0, serviceBps = Math.min(fulfillmentBps, supportBps, qualificationBps);
    const grossCents = contract.weeklyPriceCents, billedCents = assuranceInvoiceAmount(grossCents, serviceBps);
    const shortages = [!qualified ? 'accepted audit no longer matches the active checker' : '', !productActive ? 'API service paused' : '',
      qualificationBps && fulfillmentBps < 10000 ? 'GPU capacity' : '', supportBps < 10000 ? 'commercial support' : ''].filter(Boolean);
    contract.lastUsage = { week: ctx.week, qualificationVersion: qualification.version, installationId: qualification.installationId,
      bindingFingerprint: qualification.bindingFingerprint, qualified, productActive, requestedRequests: contract.weeklyRequests, servedRequests,
      requestedWorkCUw, executedWorkCUw, physicalWorkCUw: grant?.physicalCUw ?? 0, computeReceipt,
      inputTokens: servedRequests * meter.inputTokensPerRequest, outputTokens: servedRequests * meter.outputTokensPerRequest,
      internalTokens: servedRequests * meter.internalTokensPerRequest, guardrailWorkCUw: mulDiv(executedWorkCUw, meter.guardrailWorkPerRequestCUw, meter.workPerRequestCUw),
      supportStaffRequired: contract.supportStaffPerWeek, supportStaffGranted, fulfillmentBps, supportBps, qualificationBps, serviceBps,
      grossCents, creditsCents: grossCents - billedCents, billedCents,
      explanation: shortages.length ? `Proportional service credit: ${shortages.join('; ')}. The original calendar expiry continues.` : 'The separate benign tenant workload and commercial support were delivered under its accepted finite audit.' };
    contract.termWeeksServed++; contract.termServiceBpsTotal = checkedAdd(contract.termServiceBpsTotal, serviceBps);
    contract.lastBottleneck = shortages.length ? contract.lastUsage.explanation : '';
  }
}

export function resolveAssurance(_state: Readonly<GameState>, products: ProductsSlice, ctx: ModuleContext): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const contract of records(products)) if (contract.status === 'building' && contract.completedOnboardingStaff === contract.requiredOnboardingStaff) {
    contract.status = 'ready'; contract.readyWeek = ctx.week + 1; contract.lastBottleneck = 'Integration accepted; the eight-week term begins at the following weekly boundary.';
    messages.push({ category: 'project', companyId: contract.companyId, message: `${ASSURANCE_BY_ID[contract.buyerId].name}: commercial onboarding finished. Serving and retainer billing start next week.` });
  }
  return messages;
}

export function settleAssurance(state: Readonly<GameState>, products: ProductsSlice, ctx: ModuleContext): LedgerFact[] {
  const facts: LedgerFact[] = [];
  for (const contract of records(products)) {
    const usage = contract.lastUsage; if (!usage || usage.week !== ctx.week) continue;
    const id = `assurance-invoice:${contract.id}:${ctx.week}`;
    if (products.assuranceInvoices?.some(item => item.id === id) || state.slices.company.postedFacts[id]) continue;
    const invoice: AssuranceInvoice = { id, contractId: contract.id, buyerId: contract.buyerId, companyId: contract.companyId, productId: contract.productId,
      week: usage.week, qualificationVersion: usage.qualificationVersion, installationId: usage.installationId, bindingFingerprint: usage.bindingFingerprint,
      grossCents: usage.grossCents, creditsCents: usage.creditsCents, amountCents: usage.billedCents, serviceBps: usage.serviceBps, usage: structuredClone(usage) };
    products.assuranceInvoices ??= []; products.assuranceInvoices.push(invoice);
    contract.lifetimeBilledCents = checkedAdd(contract.lifetimeBilledCents, invoice.amountCents); contract.lifetimeCreditsCents = checkedAdd(contract.lifetimeCreditsCents, invoice.creditsCents);
    facts.push({ id, companyId: contract.companyId, week: ctx.week, sourceId: contract.id, category: 'revenue', amountCents: invoice.amountCents,
      label: `${ASSURANCE_BY_ID[contract.buyerId].name}: assured API retainer after proportional service credits`, kind: 'receipt' });
  }
  return facts;
}

export function getAssuranceView(state: Readonly<GameState>, companyId = state.playerCompanyId): AssuranceView {
  const all = records(state.slices.products), owned = all.filter(item => item.companyId === companyId), live = owned.filter(assuranceLive);
  const outsideOrganizations = assuranceOutsideOrganizations(state);
  return { researched: assuranceResearchReady(state, companyId), committedOrganizations: live.length, outsideOrganizations,
    board: ASSURANCE_BUYERS.map(buyer => {
      const history = all.filter(item => item.buyerId === buyer.id).sort((a, b) => b.signedWeek - a.signedWeek || b.id.localeCompare(a.id));
      const current = history[0] ?? null;
      const unavailableReason = history.length >= RULES.maximumTermsPerBuyer || all.length >= RULES.maximumContracts ? 'The retained term history is full.'
        : current && assuranceLive(current) ? 'This buyer already has a live commitment.'
          : current?.endedWeek !== null && current?.endedWeek !== undefined && state.week < current.endedWeek + RULES.reofferDelayWeeks ? 'The buyer returns at the next weekly boundary.'
            : outsideOrganizations < 1 ? 'No outside business organization remains.' : '';
      return { ...buyer, available: !unavailableReason, unavailableReason, retainedTerms: history.length, contract: current?.companyId === companyId ? current : null };
    }),
    products: Object.values(state.slices.products.offers).filter(item => item.companyId === companyId && item.kind === 'developer-api').map(product => {
      const installation = activeRuntimeGuardrail(state, product.id);
      return { id: product.id, name: product.name, status: product.status, installationId: installation?.id ?? null, profile: installation?.profile ?? null,
        usefulAnswers: installation?.audit?.guarded.usefulAnswers ?? null, unsafeCompliances: installation?.audit?.guarded.unsafeCompliances ?? null,
        qualifyingBuyers: product.status === 'active' ? ASSURANCE_BUYERS.filter(buyer => assuranceAuditQualifies(installation, buyer)).map(buyer => buyer.id) : [] };
    }),
    contracts: owned.map(contract => { const qualified = assuranceQualificationMatches(state, contract), productActive = state.slices.products.offers[contract.productId]?.status === 'active';
      return { contract, qualified, productActive, currentQualification: currentAssuranceQualification(contract),
        status: !assuranceLive(contract) ? contract.lastBottleneck : contract.status === 'building' || contract.status === 'ready' ? contract.lastBottleneck
          : !qualified ? 'Suspended: restore the accepted checker or explicitly accept a qualifying current audit. The original term continues.'
            : !productActive ? 'Suspended: the API is paused. The original term continues.' : contract.lastBottleneck || 'Accepted audit, benign workload and support are active.' }; }),
    invoices: (state.slices.products.assuranceInvoices ?? []).filter(item => item.companyId === companyId),
    reservedWorkCUw: live.reduce((sum, item) => checkedAdd(sum, item.weeklyRequests * currentAssuranceQualification(item).meter.workPerRequestCUw), 0),
    reservedMemoryMU: live.reduce((sum, item) => checkedAdd(sum, currentAssuranceQualification(item).meter.reservedMemoryMU), 0),
    requiredSupportStaff: live.reduce((sum, item) => checkedAdd(sum, item.supportStaffPerWeek), 0) };
}
