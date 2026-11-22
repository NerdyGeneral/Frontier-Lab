import { validatedFacilityRate } from '../modules/facility-tariffs';
import { CONTENT } from '../content/catalog';
import { chipDesignValues } from '../content/wave4-hardware';
import { ASSURANCE_BY_ID, ASSURANCE_RULES as RULES } from '../content/wave13-assurance';
import type { CommandPayload, GameContent, GameState } from '../contracts/types';
import type { AssuranceContract, AssuranceInvoice, AssuranceQualification, AssuranceUsage } from '../contracts/wave13-assurance';
import { assuranceAuditQualifies, assuranceInvoiceAmount, assuranceLive, assuranceMeter, assuranceQualificationMatches, assuranceResearchReady, assuranceServingRequest, assuranceWorkId } from '../modules/assured-api';
import { runtimeGuardrailAudit } from '../modules/runtime-guardrails';
import { poolSupportsWorkload } from '../modules/compute-pools';
import { canonicalStateHash } from './canonical';
import { checkedAdd, checkedInteger, mulDiv } from './math';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (left: unknown, right: unknown): boolean => canonicalStateHash(left) === canonicalStateHash(right);
const record = (value: unknown, label: string): void => check(!!value && typeof value === 'object' && !Array.isArray(value), `${label} must be a record.`);
function identifier(value: unknown, label: string): void {
  check(typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\u0000-\u001f\u007f]/.test(value)
    && !['__proto__', 'constructor', 'prototype'].includes(value), `${label} is invalid.`);
}
function hash(value: unknown, label: string): void { check(typeof value === 'string' && /^[a-f0-9]{8}$/.test(value), `${label} is invalid.`); }
function exactKeys(value: object, keys: readonly string[], label: string): void {
  check(Object.keys(value).sort().join() === [...keys].sort().join(), `${label} contains an unknown or missing field.`);
}
function description(value: unknown, label: string): void { check(typeof value === 'string' && value.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(value), `${label} is invalid.`); }

export function assertAssuranceCommand(payload: CommandPayload): void {
  if (payload.kind === 'sign_assurance_contract') {
    identifier(payload.productId, 'Assured API product');
    check(Object.hasOwn(ASSURANCE_BY_ID, payload.buyerId), 'Assured API buyer is unknown.');
  } else if (payload.kind === 'requalify_assurance_contract' || payload.kind === 'cancel_assurance_contract') identifier(payload.contractId, 'Assured API commitment');
}

function assertQualification(state: GameState, contract: AssuranceContract, qualification: AssuranceQualification, index: number): void {
  record(qualification, 'Assurance qualification');
  exactKeys(qualification, ['version', 'acceptedWeek', 'commandId', 'installationId', 'profile', 'binding', 'bindingFingerprint', 'evidenceKey', 'auditFingerprint', 'usefulAnswers', 'unsafeCompliances', 'meter'], 'Assurance qualification');
  for (const value of [qualification.version, qualification.acceptedWeek, qualification.usefulAnswers, qualification.unsafeCompliances]) checkedInteger(value, 'Assurance qualification quantity');
  identifier(qualification.installationId, 'Assurance paid installation'); identifier(qualification.commandId, 'Assurance acceptance command');
  for (const value of [qualification.bindingFingerprint, qualification.evidenceKey, qualification.auditFingerprint]) hash(value, 'Assurance frozen evidence fingerprint');
  const command = state.commandReceipts[qualification.commandId], installation = state.slices.products.runtimeGuardrails?.[qualification.installationId];
  check(qualification.version === index + 1 && qualification.acceptedWeek >= contract.signedWeek && qualification.acceptedWeek <= state.week
    && command?.status === 'accepted' && command.week === qualification.acceptedWeek,
  'Assurance qualification lacks its explicit accepted command or chronological version.');
  if (index === 0) check(qualification.acceptedWeek === contract.signedWeek && contract.id === `assurance:${qualification.commandId}`, 'The first assurance qualification must belong to the original signing command.');
  else check(qualification.acceptedWeek > contract.qualifications[index - 1].acceptedWeek
    && qualification.commandId !== contract.qualifications[index - 1].commandId
    && qualification.installationId !== contract.qualifications[index - 1].installationId
    && (contract.termEndsWeek === null || qualification.acceptedWeek < contract.termEndsWeek)
    && (contract.endedWeek === null || qualification.acceptedWeek < contract.endedWeek),
  'Requalification duplicated an installation, reversed time, or occurred after the fixed term ended.');
  check(installation?.companyId === contract.companyId && installation.productId === contract.productId && installation.status === 'active'
    && installation.availableWeek !== null && installation.availableWeek <= qualification.acceptedWeek && !!installation.audit,
  'Assurance qualification requires the owned, fully paid audit available at acceptance.');
  const thenCurrent = Object.values(state.slices.products.runtimeGuardrails ?? {}).filter(item => item.productId === contract.productId
    && item.status === 'active' && item.availableWeek !== null && item.availableWeek <= qualification.acceptedWeek)
    .sort((a, b) => b.startedWeek - a.startedWeek || b.id.localeCompare(a.id))[0];
  check(thenCurrent?.id === qualification.installationId, 'Assurance acceptance selected an obsolete checker instead of the then-current paid installation.');
  check(qualification.binding.productKind === 'developer-api' && same(qualification.binding, installation!.binding)
    && qualification.bindingFingerprint === installation!.bindingFingerprint && qualification.profile === installation!.profile
    && qualification.evidenceKey === installation!.evidenceKey && qualification.auditFingerprint === canonicalStateHash(installation!.audit)
    && same(installation!.audit, runtimeGuardrailAudit(state, installation!)),
  'Assurance qualification changed its exact paid model, actual route, runtime profile, features or finite audit.');
  check(assuranceAuditQualifies(installation!, ASSURANCE_BY_ID[contract.buyerId])
    && qualification.usefulAnswers === installation!.audit!.guarded.usefulAnswers
    && qualification.unsafeCompliances === installation!.audit!.guarded.unsafeCompliances,
  'Assurance evidence does not meet this buyer’s authored allowed and restricted-case criteria.');
  record(qualification.meter, 'Assurance tenant meter');
  exactKeys(qualification.meter, ['inputTokensPerRequest', 'outputTokensPerRequest', 'internalTokensPerRequest', 'workPerRequestCUw', 'guardrailWorkPerRequestCUw', 'reservedMemoryMU', 'servingHeadroomBps', 'executionHints'], 'Assurance tenant meter');
  check(same(qualification.meter, assuranceMeter(state, qualification.binding, qualification.profile)),
    'Assurance tenant meter changed routed work, checker overhead, headroom or its separate uncached resident workspace.');
}

function assertOnboarding(state: GameState, contract: AssuranceContract): void {
  for (const value of [contract.requiredOnboardingStaff, contract.completedOnboardingStaff, contract.onboardingGrantCount]) checkedInteger(value, 'Assurance onboarding quantity');
  check(contract.requiredOnboardingStaff === RULES.onboardingStaff && contract.completedOnboardingStaff <= contract.requiredOnboardingStaff,
    'Assurance integration changed its authored commercial effort.');
  if (contract.latestOnboardingGrant === null) {
    check(contract.completedOnboardingStaff === 0 && contract.firstOnboardingWeek === null && contract.onboardingGrantCount === 0,
      'Assurance integration has progress without paid commercial grants.'); return;
  }
  const latest = contract.latestOnboardingGrant;
  record(latest, 'Assurance latest onboarding grant'); exactKeys(latest, ['week', 'remainingBefore', 'grantedStaff'], 'Assurance onboarding receipt');
  checkedInteger(contract.firstOnboardingWeek!, 'Assurance first onboarding week');
  for (const value of [latest.week, latest.remainingBefore, latest.grantedStaff]) checkedInteger(value, 'Assurance onboarding receipt quantity');
  check(contract.firstOnboardingWeek! >= contract.signedWeek && latest.week >= contract.firstOnboardingWeek! && latest.week <= state.week
    && contract.onboardingGrantCount > 0 && contract.onboardingGrantCount <= latest.week - contract.firstOnboardingWeek! + 1
    && contract.completedOnboardingStaff >= contract.onboardingGrantCount && contract.completedOnboardingStaff <= contract.onboardingGrantCount * RULES.maximumWeeklyOnboardingStaff
    && latest.remainingBefore <= contract.requiredOnboardingStaff && latest.grantedStaff > 0 && latest.grantedStaff <= Math.min(RULES.maximumWeeklyOnboardingStaff, latest.remainingBefore)
    && contract.completedOnboardingStaff === contract.requiredOnboardingStaff - latest.remainingBefore + latest.grantedStaff,
  'Assurance integration progress exceeds its actual grants, elapsed weeks or weekly commercial cap.');
  if (contract.status === 'cancelled') check(latest.week < contract.endedWeek!, 'Cancelled assurance integration continued to consume staff.');
  if (contract.onboardingGrantCount === 1) check(contract.firstOnboardingWeek === latest.week && latest.remainingBefore === contract.requiredOnboardingStaff, 'A single assurance onboarding grant has inconsistent initial progress.');
  if (latest.week === state.week) check(state.slices.company.lastStaff[contract.companyId]?.granted.commercial >= latest.grantedStaff,
    'Assurance onboarding claimed more staff than the company actually supplied.');
  const cost = state.slices.compute.costReports?.[contract.companyId]?.find(item => item.week === latest.week);
  if (cost) {
    const id = assuranceWorkId(contract.id, 'onboard'), request = cost.resources.requests.find(item => item.id === id);
    const granted = cost.resources.staffGrants.find(item => item.requestId === id)?.grants.find(item => item.role === 'commercial')?.staffWeeks ?? 0;
    check(request?.companyId === contract.companyId && request.taskId === contract.id && request.category === 'development'
      && request.normalizedWorkCUw === 0 && request.memoryMU === 0 && request.staffDemand?.length === 1
      && request.staffDemand[0].role === 'commercial' && request.staffDemand[0].staffWeeks === Math.min(RULES.maximumWeeklyOnboardingStaff, latest.remainingBefore)
      && granted === latest.grantedStaff, 'Assurance onboarding differs from its retained actual commercial resource grant.');
  }
}

function assertReceipt(state: GameState, contract: AssuranceContract, usage: AssuranceUsage, qualification: AssuranceQualification, content: GameContent): void {
  const receipt = usage.computeReceipt, meter = qualification.meter;
  if (usage.executedWorkCUw === 0) {
    check(usage.physicalWorkCUw === 0 && receipt === null, 'Assurance zero service invented a physical GPU receipt.'); return;
  }
  record(receipt, 'Assurance physical GPU receipt');
  exactKeys(receipt!, ['poolId', 'hardwareId', 'ownership', 'multiplierBps', 'rateCentsPerCUw', 'memoryMU', ...(Object.hasOwn(receipt!, 'facilityTariff') ? ['facilityTariff'] : [])], 'Assurance physical GPU receipt');
  identifier(receipt!.poolId, 'Assurance pool'); identifier(receipt!.hardwareId, 'Assurance hardware');
  for (const value of [receipt!.multiplierBps, receipt!.rateCentsPerCUw, receipt!.memoryMU]) checkedInteger(value, 'Assurance hardware quantity');
  check(usage.qualified && usage.productActive && usage.physicalWorkCUw > 0 && receipt!.memoryMU === meter.reservedMemoryMU,
    'Assurance physical service ran while suspended or without its complete separate workspace.');
  if (receipt!.ownership === 'cloud') check(receipt!.poolId === 'general-cloud' && receipt!.hardwareId === 'general'
    && receipt!.multiplierBps === 10000 && receipt!.rateCentsPerCUw === validatedFacilityRate(state, receipt!, contract.companyId, content.opening.rentCentsPerCUWeek, usage.week, usage.week, { category: 'serving' }, receipt!.poolId)
    && !meter.executionHints.requiresFastFabric && meter.executionHints.modelArchitecture !== 'sparse',
  'Assurance cloud service used unsupported hardware, fabric or a fabricated tariff.');
  else {
    check(receipt!.ownership === 'owned' && receipt!.poolId.startsWith('owned:') && receipt!.poolId.endsWith(`:${receipt!.hardwareId}`), 'Assurance owned GPU identity is invalid.');
    const location = receipt!.poolId.slice('owned:'.length, -(`:${receipt!.hardwareId}`).length);
    check(location === 'colocation' || state.slices.compute.facilities[location]?.companyId === contract.companyId, 'Assurance owned GPUs came from a foreign location.');
    const hardware = content.hardware.find(item => item.id === receipt!.hardwareId), design = state.slices.compute.chipDesigns?.[receipt!.hardwareId];
    if (hardware) check(receipt!.multiplierBps === Math.round(hardware.servingMultiplier * 10000)
      && receipt!.rateCentsPerCUw === validatedFacilityRate(state, receipt!, contract.companyId, hardware.variableCentsPerCUw, usage.week, usage.week, { category: 'serving' }, receipt!.poolId), 'Assurance owned GPU conversion or variable tariff changed.');
    else {
      check(design?.companyId === contract.companyId && design.status === 'validated' && design.spec.target === 'inference'
        && design.spec.architecture === meter.executionHints.modelArchitecture && design.prototypeRun?.readyWeek !== null
        && design.prototypeRun?.readyWeek !== undefined && design.prototypeRun.readyWeek <= usage.week,
      'Assurance custom chip lacks a previously paid compatible inference qualification.');
      const values = chipDesignValues(design!);
      check(receipt!.multiplierBps === values.servingBps && receipt!.rateCentsPerCUw === validatedFacilityRate(state, receipt!, contract.companyId, values.variableCentsPerCUw, usage.week, usage.week, { category: 'serving' }, receipt!.poolId),
        'Assurance custom-chip conversion or variable tariff changed.');
    }
  }
  check(usage.executedWorkCUw === Math.min(usage.requestedWorkCUw, mulDiv(usage.physicalWorkCUw, receipt!.multiplierBps, 10000)),
    'Assurance effective service does not reconcile with actual physical GPU work.');
}

/** Every invoice retains its own accepted version and service receipt; later requalification never rewrites it. */
export function assertAssuranceUsage(state: GameState, contract: AssuranceContract, usage: AssuranceUsage, content: GameContent = CONTENT): void {
  record(usage, 'Assurance service receipt');
  exactKeys(usage, ['week', 'qualificationVersion', 'installationId', 'bindingFingerprint', 'qualified', 'productActive', 'requestedRequests', 'servedRequests',
    'requestedWorkCUw', 'executedWorkCUw', 'physicalWorkCUw', 'computeReceipt', 'inputTokens', 'outputTokens', 'internalTokens', 'guardrailWorkCUw',
    'supportStaffRequired', 'supportStaffGranted', 'fulfillmentBps', 'supportBps', 'qualificationBps', 'serviceBps', 'grossCents', 'creditsCents', 'billedCents', 'explanation'], 'Assurance service receipt');
  for (const value of [usage.week, usage.qualificationVersion, usage.requestedRequests, usage.servedRequests, usage.requestedWorkCUw, usage.executedWorkCUw,
    usage.physicalWorkCUw, usage.inputTokens, usage.outputTokens, usage.internalTokens, usage.guardrailWorkCUw, usage.supportStaffRequired,
    usage.supportStaffGranted, usage.fulfillmentBps, usage.supportBps, usage.qualificationBps, usage.serviceBps, usage.grossCents, usage.creditsCents, usage.billedCents]) checkedInteger(value, 'Assurance service quantity');
  check(typeof usage.qualified === 'boolean' && typeof usage.productActive === 'boolean', 'Assurance service availability is invalid.');
  description(usage.explanation, 'Assurance service explanation'); identifier(usage.installationId, 'Assurance service installation'); hash(usage.bindingFingerprint, 'Assurance service binding');
  const qualification = contract.qualifications.filter(item => item.acceptedWeek <= usage.week).at(-1);
  check(qualification && qualification.version === usage.qualificationVersion && qualification.installationId === usage.installationId
    && qualification.bindingFingerprint === usage.bindingFingerprint && contract.termStartedWeek !== null && contract.termEndsWeek !== null
    && usage.week >= contract.termStartedWeek && usage.week < contract.termEndsWeek && usage.week <= state.week
    && (contract.endedWeek === null || usage.week < contract.endedWeek), 'Assurance usage changed its then-accepted qualification or billed outside its calendar term.');
  const meter = qualification!.meter, served = mulDiv(usage.executedWorkCUw, 1, meter.workPerRequestCUw);
  check(usage.requestedRequests === contract.weeklyRequests && usage.requestedWorkCUw === contract.weeklyRequests * meter.workPerRequestCUw
    && usage.executedWorkCUw <= usage.requestedWorkCUw && usage.servedRequests === served
    && usage.inputTokens === served * meter.inputTokensPerRequest && usage.outputTokens === served * meter.outputTokensPerRequest
    && usage.internalTokens === served * meter.internalTokensPerRequest
    && usage.guardrailWorkCUw === mulDiv(usage.executedWorkCUw, meter.guardrailWorkPerRequestCUw, meter.workPerRequestCUw),
  'Assurance receipt invented requests, billed unfinished tokens, inherited a public cache, or omitted checker work.');
  check(usage.supportStaffRequired === contract.supportStaffPerWeek && usage.supportStaffGranted <= usage.supportStaffRequired
    && usage.fulfillmentBps === mulDiv(served, 10000, contract.weeklyRequests)
    && usage.supportBps === mulDiv(usage.supportStaffGranted, 10000, usage.supportStaffRequired)
    && usage.qualificationBps === (usage.qualified && usage.productActive ? 10000 : 0)
    && usage.serviceBps === Math.min(usage.fulfillmentBps, usage.supportBps, usage.qualificationBps)
    && usage.grossCents === contract.weeklyPriceCents && usage.billedCents === assuranceInvoiceAmount(usage.grossCents, usage.serviceBps)
    && usage.creditsCents === usage.grossCents - usage.billedCents,
  'Assurance retainer differs from independently granted support, completed service and proportional credits.');
  if (!usage.qualified || !usage.productActive) check(usage.executedWorkCUw === 0, 'A suspended assurance contract consumed GPU work.');
  assertReceipt(state, contract, usage, qualification!, content);
  if (usage.week === state.week) {
    check(usage.qualified === assuranceQualificationMatches(state, contract)
      && usage.productActive === (state.slices.products.offers[contract.productId].status === 'active'), 'Current assurance availability differs from the actual product and exact active checker.');
    const actual = state.slices.compute.fleets[contract.companyId].lastGrants.find(item => item.requestId === assuranceWorkId(contract.id, 'serve'));
    check(usage.qualified && usage.productActive ? actual?.requestedWork === usage.requestedWorkCUw && actual.grantedWork === usage.executedWorkCUw : !actual,
      'Assurance service differs from the current shared allocator request or GPU grant.');
    check(state.slices.company.lastStaff[contract.companyId]?.granted.commercial >= usage.supportStaffGranted,
      'Assurance support exceeds the company’s actual commercial staff grants.');
  }
  const cost = state.slices.compute.costReports?.[contract.companyId]?.find(item => item.week === usage.week);
  if (cost) {
    const id = assuranceWorkId(contract.id, 'serve'), request = cost.resources.requests.find(item => item.id === id), grant = cost.resources.computeGrants.find(item => item.requestId === id);
    const expected = assuranceServingRequest({ ...contract, qualifications: [qualification!] });
    if (usage.qualified && usage.productActive) {
      check(request && same(request, expected) && grant?.hardwareEffectiveCUw === usage.executedWorkCUw && grant.physicalCUw === usage.physicalWorkCUw && !grant.sharedMemoryMU,
        'Assurance service differs from the retained actual resource request and physical GPU grant.');
      if (usage.executedWorkCUw) {
        const receipt = usage.computeReceipt!, pool = cost.pools.find(item => item.id === receipt.poolId);
        check(pool && grant!.poolId === receipt.poolId && grant!.memoryMU === meter.reservedMemoryMU && pool.hardwareId === receipt.hardwareId
          && pool.ownership === receipt.ownership && pool.servingBps === receipt.multiplierBps && poolSupportsWorkload(pool, meter.executionHints),
        'Assurance receipt used another pool, incompatible chip or shared workspace.');
      }
    } else check(!request && !grant, 'Suspended assurance GPU service appeared in a paid resource frame.');
    const supportId = assuranceWorkId(contract.id, 'support'), support = cost.resources.requests.find(item => item.id === supportId);
    const granted = cost.resources.staffGrants.find(item => item.requestId === supportId)?.grants.find(item => item.role === 'commercial')?.staffWeeks ?? 0;
    check(support?.taskId === contract.id && support.companyId === contract.companyId && support.normalizedWorkCUw === 0 && support.memoryMU === 0
      && support.staffDemand?.length === 1 && support.staffDemand[0].role === 'commercial' && support.staffDemand[0].staffWeeks === contract.supportStaffPerWeek
      && granted === usage.supportStaffGranted, 'Assurance support differs from its independent actual commercial grant.');
  }
}

function assertInvoice(state: GameState, invoice: AssuranceInvoice, contract: AssuranceContract, content: GameContent): void {
  record(invoice, 'Assurance invoice');
  exactKeys(invoice, ['id', 'contractId', 'buyerId', 'companyId', 'productId', 'week', 'qualificationVersion', 'installationId', 'bindingFingerprint', 'grossCents', 'creditsCents', 'amountCents', 'serviceBps', 'usage'], 'Assurance invoice');
  assertAssuranceUsage(state, contract, invoice.usage, content);
  const usage = invoice.usage;
  check(invoice.id === `assurance-invoice:${contract.id}:${usage.week}` && invoice.contractId === contract.id && invoice.buyerId === contract.buyerId
    && invoice.companyId === contract.companyId && invoice.productId === contract.productId && invoice.week === usage.week
    && invoice.qualificationVersion === usage.qualificationVersion && invoice.installationId === usage.installationId && invoice.bindingFingerprint === usage.bindingFingerprint
    && invoice.grossCents === usage.grossCents && invoice.creditsCents === usage.creditsCents && invoice.amountCents === usage.billedCents && invoice.serviceBps === usage.serviceBps
    && state.slices.company.postedFacts[invoice.id] === true, 'Assurance invoice changed its earned service, then-accepted qualification, owner or once-only ledger posting.');
  const ledger = state.slices.company.ledger.find(item => item.id === invoice.id);
  if (ledger) check(ledger.companyId === contract.companyId && ledger.week === invoice.week && ledger.sourceId === contract.id
    && ledger.category === 'revenue' && ledger.kind === 'receipt' && ledger.amountCents === invoice.amountCents,
  'Assurance invoice differs from its retained revenue ledger fact.');
}

export function assertAssuranceState(state: GameState, content: GameContent = CONTENT): void {
  const { assuranceContracts: collection, assuranceInvoices: invoices } = state.slices.products;
  if (collection === undefined && invoices === undefined) return;
  record(collection, 'Assurance commitments');
  const entries = Object.entries(collection!);
  check(entries.length > 0 && entries.length <= RULES.maximumContracts && Array.isArray(invoices) && invoices.length <= RULES.maximumInvoices,
    'Assurance adoption must retain bounded commitments and their invoices together.');
  const byBuyer = new Map<string, AssuranceContract[]>(), invoiceIds = new Set<string>();
  for (const [key, contract] of entries) {
    record(contract, 'Assurance commitment');
    exactKeys(contract, ['id', 'buyerId', 'companyId', 'productId', 'status', 'signedWeek', 'setupFeeCents', 'setupFactId', 'requiredOnboardingStaff', 'completedOnboardingStaff',
      'onboardingGrantCount', 'firstOnboardingWeek', 'latestOnboardingGrant', 'readyWeek', 'termStartedWeek', 'termEndsWeek', 'endedWeek', 'cancellationCommandId',
      'weeklyRequests', 'weeklyPriceCents', 'supportStaffPerWeek', 'slaBps', 'qualifications', 'termWeeksServed', 'termServiceBpsTotal',
      'lifetimeBilledCents', 'lifetimeCreditsCents', 'lastUsage', 'lastBottleneck'], 'Assurance commitment');
    for (const value of [key, contract.id, contract.companyId, contract.productId, contract.setupFactId]) identifier(value, 'Assurance commitment identity');
    const buyer = ASSURANCE_BY_ID[contract.buyerId], product = state.slices.products.offers[contract.productId];
    const commandId = key.startsWith('assurance:') ? key.slice('assurance:'.length) : '', command = state.commandReceipts[commandId];
    checkedInteger(contract.signedWeek, 'Assurance signing week');
    check(key === contract.id && buyer && state.slices.company.companies[contract.companyId] && product?.companyId === contract.companyId && product.kind === 'developer-api'
      && command?.status === 'accepted' && command.week === contract.signedWeek && contract.signedWeek > product.createdWeek && contract.signedWeek <= state.week
      && assuranceResearchReady(state, contract.companyId, contract.signedWeek - 1), 'Assurance commitment lacks its admitted owned API, prior research or signing command.');
    check(['building', 'ready', 'active', 'expired', 'cancelled'].includes(contract.status), 'Assurance status is invalid.');
    description(contract.lastBottleneck, 'Assurance status explanation');
    for (const value of [contract.setupFeeCents, contract.weeklyRequests, contract.weeklyPriceCents, contract.supportStaffPerWeek, contract.slaBps,
      contract.termWeeksServed, contract.termServiceBpsTotal, contract.lifetimeBilledCents, contract.lifetimeCreditsCents]) checkedInteger(value, 'Assurance contract quantity');
    check(contract.setupFeeCents === RULES.setupFeeCents && contract.setupFactId === `assurance-setup:${commandId}` && state.slices.company.postedFacts[contract.setupFactId] === true
      && contract.weeklyRequests === buyer.weeklyRequests && contract.weeklyPriceCents === buyer.weeklyPriceCents && contract.supportStaffPerWeek === buyer.supportStaffPerWeek
      && contract.slaBps === RULES.slaBps, 'Assurance commitment changed its authored expense, fixed workload, retainer or support requirement.');
    const setup = state.slices.company.ledger.find(item => item.id === contract.setupFactId);
    if (setup) check(setup.companyId === contract.companyId && setup.week === contract.signedWeek && setup.sourceId === contract.id
      && setup.category === 'operating' && setup.kind === 'expense' && setup.amountCents === contract.setupFeeCents, 'Assurance integration expense differs from its posted ledger fact.');
    check(Array.isArray(contract.qualifications) && contract.qualifications.length > 0 && contract.qualifications.length <= RULES.maximumQualifications,
      'Assurance commitment must retain one to four exact accepted qualifications.');
    contract.qualifications.forEach((item, index) => assertQualification(state, contract, item, index));
    assertOnboarding(state, contract);
    const finished = contract.completedOnboardingStaff === contract.requiredOnboardingStaff;
    if (contract.readyWeek === null) check(!finished && contract.termStartedWeek === null && contract.termEndsWeek === null, 'Assurance term started without finished paid integration.');
    else {
      checkedInteger(contract.readyWeek, 'Assurance integration availability');
      check(finished && contract.latestOnboardingGrant && contract.readyWeek === contract.latestOnboardingGrant.week + 1 && contract.readyWeek <= state.week + 1,
        'Assurance integration skipped its paid staff grant or following weekly boundary.');
    }
    if (contract.termStartedWeek === null) {
      check(contract.termEndsWeek === null && ['building', 'ready', 'cancelled'].includes(contract.status), 'Unstarted assurance integration has an active calendar term.');
      if (contract.status === 'ready') check(contract.readyWeek === state.week + 1, 'Ready assurance integration missed its following activation boundary.');
      if (contract.status === 'building') check(!finished, 'Finished assurance integration remained building.');
    } else {
      checkedInteger(contract.termStartedWeek, 'Assurance term start'); checkedInteger(contract.termEndsWeek!, 'Assurance term expiry');
      check(finished && contract.termStartedWeek === contract.readyWeek && contract.termStartedWeek <= state.week
        && contract.termEndsWeek === contract.termStartedWeek + RULES.termWeeks && !['building', 'ready'].includes(contract.status),
      'Assurance calendar term skipped onboarding, changed expiry or renewed automatically.');
    }
    if (assuranceLive(contract)) check(contract.endedWeek === null && contract.cancellationCommandId === null
      && (contract.status !== 'active' || contract.termEndsWeek! > state.week), 'Live assurance commitment is ended or overstayed its fixed term.');
    else {
      checkedInteger(contract.endedWeek!, 'Assurance ended week'); check(contract.endedWeek! >= contract.signedWeek && contract.endedWeek! <= state.week, 'Assurance end precedes signing or is in the future.');
      if (contract.status === 'expired') check(contract.termEndsWeek === contract.endedWeek && contract.cancellationCommandId === null, 'Assurance expiry changed its original calendar term.');
      else {
        identifier(contract.cancellationCommandId, 'Assurance cancellation command'); const cancellation = state.commandReceipts[contract.cancellationCommandId!];
        check(cancellation?.status === 'accepted' && cancellation.week === contract.endedWeek && (contract.termEndsWeek === null || contract.endedWeek! < contract.termEndsWeek),
          'Assurance cancellation lacks its accepted command before calendar expiry.');
      }
    }
    const history = byBuyer.get(contract.buyerId) ?? []; history.push(contract); byBuyer.set(contract.buyerId, history);
  }
  for (const history of byBuyer.values()) {
    history.sort((a, b) => a.signedWeek - b.signedWeek || a.id.localeCompare(b.id));
    check(history.length <= RULES.maximumTermsPerBuyer, 'A buyer exceeds its four retained assurance terms.');
    for (let i = 1; i < history.length; i++) check(!assuranceLive(history[i - 1]) && history[i - 1].endedWeek !== null
      && history[i].signedWeek >= history[i - 1].endedWeek! + RULES.reofferDelayWeeks, 'A finite assurance buyer overlaps commitments or returns before its following boundary.');
  }
  for (const invoice of invoices!) {
    identifier(invoice.id, 'Assurance invoice'); check(!invoiceIds.has(invoice.id), 'Assurance invoice is duplicated.'); invoiceIds.add(invoice.id);
    const contract = collection![invoice.contractId]; check(contract, 'Assurance invoice lacks its retained commitment.');
    assertInvoice(state, invoice, contract, content);
  }
  for (const [, contract] of entries) {
    const own = invoices!.filter(item => item.contractId === contract.id).sort((a, b) => a.week - b.week);
    const lastWeek = contract.termStartedWeek === null ? null : Math.min(state.week, contract.termEndsWeek! - 1, contract.endedWeek === null ? state.week : contract.endedWeek - 1);
    const expectedWeeks = lastWeek === null ? 0 : Math.max(0, lastWeek - contract.termStartedWeek! + 1);
    check(own.length === expectedWeeks && contract.termWeeksServed === expectedWeeks && expectedWeeks <= RULES.termWeeks,
      'Assurance term lost a weekly invoice, billed before activation, or continued beyond expiry.');
    own.forEach((invoice, index) => check(invoice.week === contract.termStartedWeek! + index, 'Assurance invoices skipped or duplicated a calendar service week.'));
    check(contract.termServiceBpsTotal === own.reduce((sum, item) => checkedAdd(sum, item.serviceBps), 0)
      && contract.lifetimeBilledCents === own.reduce((sum, item) => checkedAdd(sum, item.amountCents), 0)
      && contract.lifetimeCreditsCents === own.reduce((sum, item) => checkedAdd(sum, item.creditsCents), 0), 'Assurance lifetime totals differ from retained once-only invoices.');
    check(own.length ? same(contract.lastUsage, own[own.length - 1].usage) : contract.lastUsage === null,
      'Assurance latest service receipt differs from its final retained invoice.');
  }
  for (const companyId of new Set(entries.map(([, contract]) => contract.companyId))) {
    const owned = entries.map(([, contract]) => contract).filter(contract => contract.companyId === companyId);
    const current = owned.flatMap(contract => contract.lastUsage?.week === state.week ? [contract.lastUsage] : []);
    const onboarding = owned.reduce((sum, contract) => checkedAdd(sum, contract.latestOnboardingGrant?.week === state.week ? contract.latestOnboardingGrant.grantedStaff : 0), 0);
    const support = current.reduce((sum, usage) => checkedAdd(sum, usage.supportStaffGranted), 0);
    const physical = current.reduce((sum, usage) => checkedAdd(sum, usage.physicalWorkCUw), 0);
    const memory = current.reduce((sum, usage) => checkedAdd(sum, usage.computeReceipt?.memoryMU ?? 0), 0);
    const fleet = state.slices.compute.fleets[companyId], staff = state.slices.company.lastStaff[companyId];
    check(onboarding + support <= (staff?.granted.commercial ?? 0), 'Assurance commitments collectively claimed the same commercial staff grant more than once.');
    check(physical <= fleet.lastWork.serving && memory <= fleet.lastReservedMemoryMU,
      'Assurance tenants collectively claimed more physical serving work or separate memory than the company actually supplied.');
  }
}
