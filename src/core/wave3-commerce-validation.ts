import { CONNECTED_COMPANY_CONTENT_VERSION } from './connected-company-version';
import { AI_SYSTEMS_CONTENT_VERSION } from './ai-systems-version';
import { GAMEPLAY_POLISH_CONTENT_VERSION } from './gameplay-polish-version';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION } from './model-customization-version';
import { STRATEGY_CONTENT_VERSION } from './strategy-version';
import { FAMILY_SERVING_MULTIPLIER } from '../modules/model-design';
import { aiSystemSessionMemory } from '../modules/ai-systems';
import { assertProductWorkloadReceipt, getProductWorkloadMeasure, workloadPrivatePrice, workloadErrorBps } from '../modules/product-workloads';
import { MODEL_DESIGN_CONTENT_VERSION } from '../contracts/model-design';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../content/wave29';
import { CAMPUS_CONTENT_VERSION } from '../content/wave28';
import { modelWorkBps } from '../modules/model-runtime';
import type { CommercialContract, RetrievalEvidence } from '../contracts/wave3-commerce';
import type { GameContent, GameState } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import { BUSINESS_BY_ID, BUSINESS_CUSTOMERS, COMMERCE_RULES as RULES } from '../content/wave3-commerce';
import { PRIVATE_APPLIANCE_BUYER } from '../content/wave27-appliance';
import { STUDIO_RELEASE_CONTENT_VERSION } from '../content/wave27';
import { businessCredits, commercialWorkloadProofId, getModelCommerceRights, modelHasCommercialEvaluation, outsideBusinessOrganizations, retrievalEvidence } from '../modules/business';
import { canonicalStateHash } from './canonical';
import { checkedAdd, checkedInteger, mulDiv } from './math';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (a: unknown, b: unknown) => canonicalStateHash(a) === canonicalStateHash(b);
const live = (contract: CommercialContract) => ['building', 'ready', 'active'].includes(contract.status);
const proportion = (granted: number, required: number) => required ? Math.min(10000, mulDiv(granted, 10000, required)) : 10000;
function record(value: unknown, name: string): void { check(!!value && typeof value === 'object' && !Array.isArray(value), name + ' must be a record.'); }
function id(value: unknown): void { check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !['__proto__', 'prototype', 'constructor'].includes(value), 'Commercial identifier is invalid.'); }
function note(value: unknown): void { check(typeof value === 'string' && value.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(value), 'Commercial explanation is invalid.'); }
function bps(value: number): void { checkedInteger(value); check(value <= 10000, 'Commercial percentage exceeds 100%.'); }

/** Frozen business promises, finite buyers, physical execution, delivery work and posted invoice proofs. */
export function assertWave3CommerceState(state: GameState, content: GameContent): void {
  const { products, company, models } = state.slices;
  record(products.retrievalInstalls, 'Retrieval installations'); record(products.commercialContracts, 'Commercial contracts');
  check(Array.isArray(products.commercialInvoices) && products.commercialInvoices.length <= RULES.invoiceHistoryLimit, 'Commercial invoice history is missing or unbounded.');
  check(Object.keys(products.retrievalInstalls).length <= Object.keys(products.offers).length, 'Retrieval indexes outnumber their products.');
  check(Object.keys(products.commercialContracts).length <= BUSINESS_CUSTOMERS.length + ([STUDIO_RELEASE_CONTENT_VERSION, CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(content.version) ? 1 : 0), 'The finite customer board was expanded.');
  const past = (week: number) => { checkedInteger(week); check(week <= state.week, 'Commercial activity comes from a future week.'); };
  const ownCompany = (companyId: string) => check(Object.hasOwn(company.companies, companyId), 'Commercial record has an unknown company.');
  const evidence = (snapshot: RetrievalEvidence, companyId: string) => {
    record(snapshot, 'Retrieval evidence'); id(snapshot.packetId);
    check(Array.isArray(snapshot.sourceIds) && snapshot.sourceIds.length > 0 && snapshot.sourceIds.length <= 10000, 'Retrieval evidence has no bounded source identities.');
    snapshot.sourceIds.forEach(id); check(new Set(snapshot.sourceIds).size === snapshot.sourceIds.length, 'Retrieval sources are duplicated.');
    bps(snapshot.qualityBps); bps(snapshot.documentCoverageBps); bps(snapshot.documentBonusBps);
    const expected = retrievalEvidence(state, snapshot.packetId, companyId);
    check(expected && same(snapshot, expected), 'Retrieval evidence, rights, quality benefit or lookup costs differ from its immutable prepared packet.');
  };
  for (const [key, installation] of Object.entries(products.retrievalInstalls)) {
    record(installation, 'Retrieval installation');
    check(key === installation.productId && installation.id === 'retrieval:' + key, 'Retrieval identity differs from its product.'); ownCompany(installation.companyId);
    const product = products.offers[key];
    check(product && product.companyId === installation.companyId && product.kind === 'business-docs', 'Retrieval index is attached to a foreign or incompatible product.');
    check((state.slices.research.completedByCompany[installation.companyId] ?? []).includes('R6'), 'Retrieval was installed without R6.');
    evidence(installation.evidence, installation.companyId); past(installation.startedWeek); note(installation.lastBottleneck);
    checkedInteger(installation.completedStaff); checkedInteger(installation.requiredStaff);
    check(installation.requiredStaff === RULES.retrievalInstallStaff && installation.completedStaff <= installation.requiredStaff, 'Retrieval rollout changed or exceeded its two ML staff-weeks.');
    check(['building', 'ready', 'active'].includes(installation.status), 'Unknown retrieval installation status.');
    if (installation.status === 'building') check(installation.readyWeek === null && installation.completedStaff < installation.requiredStaff, 'Unfinished retrieval is already complete or scheduled.');
    else {
      checkedInteger(installation.readyWeek!);
      check(installation.completedStaff === installation.requiredStaff && installation.readyWeek! >= installation.startedWeek + Math.ceil(installation.requiredStaff / U), 'Retrieval activated before its real installation work.');
      check(installation.status === 'ready' ? installation.readyWeek === state.week + 1 : installation.readyWeek! <= state.week, 'Retrieval activation boundary is invalid.');
    }
    for (const number of [installation.lastUpkeepRequired, installation.lastUpkeepGranted]) checkedInteger(number);
    bps(installation.lastFreshnessBps); check(installation.lastUpkeepGranted <= installation.lastUpkeepRequired, 'Retrieval upkeep exceeds its requested staff.');
    if (installation.lastUpkeepWeek === null) check(installation.lastUpkeepRequired === 0 && installation.lastUpkeepGranted === 0 && installation.lastFreshnessBps === 0 && installation.status !== 'active', 'Unserved retrieval created freshness or upkeep.');
    else {
      past(installation.lastUpkeepWeek); check(installation.status === 'active' && installation.lastUpkeepWeek === state.week && installation.lastUpkeepWeek >= installation.readyWeek!, 'Retrieval upkeep occurred outside its active service week.');
      check(installation.lastUpkeepRequired % RULES.retrievalDataStaffPerOrganization === 0 && installation.lastUpkeepRequired <= 80 * RULES.retrievalDataStaffPerOrganization, 'Retrieval upkeep does not correspond to finite organizations.');
      const usage = products.lastUsage[key];
      check(usage && usage.week === state.week, 'An active index has no corresponding product usage.');
      const required = product.status === 'active' ? (usage.paidAccounts + usage.trialAccounts) * RULES.retrievalDataStaffPerOrganization : 0;
      check(installation.lastUpkeepRequired === required && installation.lastFreshnessBps === (product.status === 'active' ? proportion(installation.lastUpkeepGranted, required) : 0), 'Retrieval quality is disconnected from actual organization upkeep.');
    }
  }

  for (const [key, contract] of Object.entries(products.commercialContracts)) {
    record(contract, 'Commercial contract');
    const customer = BUSINESS_BY_ID[contract.customerId];
    if (contract.customerId === PRIVATE_APPLIANCE_BUYER.id) check([STUDIO_RELEASE_CONTENT_VERSION, CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(content.version) && products.privateApplianceOrders?.[PRIVATE_APPLIANCE_BUYER.id]?.contractId === key, 'Cedar Records requires its paid, qualified appliance order.');
    check(customer && key === 'business:' + customer.id && contract.id === key && customer.kinds.includes(contract.contractKind), 'Commercial contract has an unknown, duplicate or incompatible customer.');
    ownCompany(contract.companyId); id(contract.modelId); id(contract.setupFactId); note(contract.lastBottleneck); past(contract.signedWeek);
    const model = models.versions[contract.modelId], hosted = contract.contractKind === 'private-hosted';
    const workloadProofs = Object.keys(company.postedFacts).filter(id => id.startsWith(`business-workload:${contract.companyId}:${contract.id}:${contract.generation}:`));
    check(workloadProofs.length === (contract.workload ? 1 : 0), 'Private workload promise was removed or duplicated after acceptance.');
    if (contract.workload) {
      assertProductWorkloadReceipt(contract.workload, state); check(contract.workload.selectedWeek === contract.signedWeek, 'Private workload changed after its accepted contract.');
      check(getProductWorkloadMeasure(model, contract.workload)?.fitBps === 10000 && company.postedFacts[commercialWorkloadProofId(contract)] === true, 'Private workload or premium fee lost its qualified, fixed acceptance proof.');
    }
    check(model && model.companyId === contract.companyId && modelHasCommercialEvaluation(state, contract.modelId)
      && model.capabilityBps[customer.domain] >= customer.minimumScoreBps && model.reliabilityBps >= customer.minimumReliabilityBps, 'Commercial delivery lost its evaluated fixed model or customer quality gate.');
    check((state.slices.research.completedByCompany[contract.companyId] ?? []).includes('R12'), 'Commercial commitment was signed without R12.');
    record(contract.rights, 'Commercial rights'); check(same(contract.rights, getModelCommerceRights(state, contract.modelId, content)) && (hosted ? contract.rights.hosted : contract.rights.weights), 'Commercial rights do not permit this frozen model’s hosted use or weight distribution.');
    for (const number of [contract.generation, contract.setupFeeCents, contract.requiredDeliveryStaff, contract.completedDeliveryStaff, contract.termIndex,
      contract.termWeeksServed, contract.termServiceBpsTotal, contract.breachWeeks, contract.weeklyPriceCents, contract.weeklyRequests,
      contract.reservedWorkCUw, contract.reservedMemoryMU, contract.servingHeadroomBps, contract.inputTokensPerRequest, contract.outputTokensPerRequest,
      contract.workPerRequestCUw, contract.dataStaffPerWeek, contract.supportStaffPerWeek, contract.lifetimeBilledCents, contract.lifetimeCreditsCents]) checkedInteger(number);
    check(contract.generation > 0 && contract.generation <= state.week + 1, 'Commercial contract generation is invalid.');
    check(contract.setupFactId.startsWith('business-setup:') && company.postedFacts[contract.setupFactId], 'Commercial delivery has no posted setup expense.');
    check(contract.setupFeeCents === (hosted ? customer.hostedSetupCents : customer.licenseSetupCents)
      && contract.weeklyPriceCents === workloadPrivatePrice(hosted ? customer.hostedWeeklyCents : customer.licenseWeeklyCents, contract.workload), 'Commercial setup cost or fixed weekly fee was changed.');
    const setup = company.ledger.find(entry => entry.id === contract.setupFactId);
    if (setup) check(setup.companyId === contract.companyId && setup.sourceId === contract.id && setup.kind === 'expense' && setup.category === 'operating' && setup.amountCents === contract.setupFeeCents && setup.week === contract.signedWeek, 'Commercial setup proof differs from its expense ledger.');
    check(contract.requiredDeliveryStaff === (hosted ? RULES.privateDeploymentStaff : RULES.licenseDeliveryStaff)
      && contract.completedDeliveryStaff <= contract.requiredDeliveryStaff && contract.supportStaffPerWeek === RULES.supportStaffPerOrganization, 'Commercial delivery or support workload was changed.');
    if (hosted) {
      check((state.slices.research.completedByCompany[contract.companyId] ?? []).includes('R6'), 'Private retrieval service has no R6 integration.');
      evidence(contract.evidence!, contract.companyId);
      const input = 500 + contract.evidence!.extraInputTokens, multiplier = FAMILY_SERVING_MULTIPLIER[model.family];
      const work = mulDiv((input * 200 + 100 * 1000) * multiplier, modelWorkBps(model), 10000) + contract.evidence!.lookupWorkCUw * multiplier;
      check(contract.weeklyRequests === customer.weeklyRequests && contract.inputTokensPerRequest === input && contract.outputTokensPerRequest === 100
        && contract.workPerRequestCUw === work && contract.reservedWorkCUw === customer.weeklyRequests * work
        && contract.reservedMemoryMU === model.residentMU + contract.evidence!.indexMemoryMU + RULES.privateSessionMemoryMU + aiSystemSessionMemory(model)
        && contract.servingHeadroomBps === RULES.servingHeadroomBps && contract.dataStaffPerWeek === RULES.retrievalDataStaffPerOrganization, 'Private service invented capacity or omitted its fixed workload, index, memory, upkeep or headroom.');
    } else check(contract.evidence === null && [contract.weeklyRequests, contract.inputTokensPerRequest, contract.outputTokensPerRequest,
      contract.workPerRequestCUw, contract.reservedWorkCUw, contract.reservedMemoryMU, contract.servingHeadroomBps, contract.dataStaffPerWeek].every(value => value === 0), 'A customer-hosted weight license created company inference capacity, work or a retrieval index.');
    check(['building', 'ready', 'active', 'expired', 'terminated'].includes(contract.status) && typeof contract.autoRenew === 'boolean', 'Unknown commercial status or renewal choice.');
    if (contract.status === 'building') check(contract.readyWeek === null && contract.completedDeliveryStaff < contract.requiredDeliveryStaff, 'An unfinished commercial delivery is already available.');
    else {
      checkedInteger(contract.readyWeek!); check(contract.completedDeliveryStaff === contract.requiredDeliveryStaff
        && contract.readyWeek! >= contract.signedWeek + Math.ceil(contract.requiredDeliveryStaff / U), 'Commercial model delivery skipped real ML work.');
      check(contract.status === 'ready' ? contract.readyWeek === state.week + 1 : contract.readyWeek! <= state.week, 'Commercial delivery activates at the wrong boundary.');
    }
    if (contract.status === 'building' || contract.status === 'ready') {
      check(contract.termStartedWeek === null && contract.termEndsWeek === null && contract.termIndex === 0 && contract.termWeeksServed === 0
        && contract.termServiceBpsTotal === 0 && contract.breachWeeks === 0 && contract.lastUsage === null && contract.endedWeek === null, 'Undelivered commercial work created a term, service or invoice.');
    } else {
      checkedInteger(contract.termStartedWeek!); checkedInteger(contract.termEndsWeek!);
      check(contract.termIndex > 0 && contract.termStartedWeek === contract.readyWeek! + (contract.termIndex - 1) * customer.termWeeks
        && contract.termStartedWeek! <= state.week && contract.termEndsWeek === contract.termStartedWeek! + customer.termWeeks, 'Commercial term did not last its fixed twelve-week boundary.');
      check(contract.termWeeksServed > 0 && contract.termWeeksServed <= customer.termWeeks && contract.termServiceBpsTotal <= contract.termWeeksServed * 10000, 'Commercial term service totals are invalid.');
      if (contract.status === 'active') check(contract.endedWeek === null && contract.termEndsWeek! > state.week && contract.breachWeeks < RULES.consecutiveBreaches, 'Active commercial agreement expired or exceeded its breach limit.');
      else {
        past(contract.endedWeek!); check(contract.endedWeek! >= contract.termStartedWeek!, 'Commercial agreement ended before activation.');
        if (contract.status === 'expired') check(contract.endedWeek === contract.termEndsWeek && contract.termWeeksServed === customer.termWeeks, 'A commercial term expired before its twelve delivered weeks.');
        else check(contract.breachWeeks === RULES.consecutiveBreaches && contract.endedWeek! < contract.termEndsWeek!, 'Commercial termination did not follow two real service breaches.');
      }
    }
    if (contract.lastUsage !== null) {
      const usage = contract.lastUsage; record(usage, 'Commercial usage'); past(usage.week); note(usage.explanation);
      const workload = getProductWorkloadMeasure(model, contract.workload);
      check(same(usage.workload ?? null, workload ?? null), 'Private workload outcomes differ from the accepted model and promise.');
      check(contract.termStartedWeek !== null && usage.week >= contract.termStartedWeek && usage.week < contract.termEndsWeek!
        && contract.termWeeksServed === usage.week - contract.termStartedWeek + 1, 'Commercial usage has a missing, extra or out-of-term service week.');
      if (contract.status === 'active') check(usage.week === state.week, 'Active commercial service has no current execution.');
      if (contract.status === 'expired') check(usage.week === contract.endedWeek! - 1, 'Expired service continued beyond its term.');
      if (contract.status === 'terminated') check(usage.week === contract.endedWeek, 'Terminated service continued beyond its breach week.');
      for (const number of [usage.requestedWorkCUw, usage.executedWorkCUw, usage.physicalWorkCUw, usage.inputTokens, usage.outputTokens,
        usage.dataStaffRequired, usage.dataStaffGranted, usage.supportStaffRequired, usage.supportStaffGranted, usage.grossCents, usage.creditsCents, usage.billedCents]) checkedInteger(number);
      for (const number of [usage.freshnessBps, usage.fulfillmentBps, usage.serviceBps]) bps(number);
      check(usage.requestedWorkCUw === contract.reservedWorkCUw && usage.executedWorkCUw <= usage.requestedWorkCUw
        && usage.dataStaffRequired === contract.dataStaffPerWeek && usage.supportStaffRequired === contract.supportStaffPerWeek
        && usage.dataStaffGranted <= usage.dataStaffRequired && usage.supportStaffGranted <= usage.supportStaffRequired, 'Commercial service exceeded actual requested work or staff.');
      check(usage.fulfillmentBps === (hosted ? proportion(usage.executedWorkCUw, usage.requestedWorkCUw) : 10000)
        && usage.freshnessBps === proportion(usage.dataStaffGranted, usage.dataStaffRequired)
        && usage.serviceBps === Math.min(usage.fulfillmentBps, usage.freshnessBps, proportion(usage.supportStaffGranted, usage.supportStaffRequired), workload?.fitBps ?? 10000), 'Commercial SLA service is disconnected from executed work, data, support or its operating promise.');
      check(usage.grossCents === contract.weeklyPriceCents && usage.creditsCents === businessCredits(usage.grossCents, usage.serviceBps, customer.slaBps)
        && usage.billedCents + usage.creditsCents === usage.grossCents, 'Commercial credits or revenue differ from actual delivered service.');
      if (hosted) {
        bps(usage.technicalErrorBps!);
        if (workload) {
          const bonus = mulDiv(contract.evidence!.documentBonusBps, usage.freshnessBps, 10000);
          const score = Math.min(9500, mulDiv(model.capabilityBps.documents, 8000, 10000) + mulDiv(model.capabilityBps.conversation, 2000, 10000) + bonus);
          const probability = (difficulty: number) => mulDiv(Math.max(500, Math.min(9800, 5000 + score - difficulty)), model.reliabilityBps, 10000);
          check(usage.technicalErrorBps === workloadErrorBps(10000 - mulDiv(probability(0), 7000, 10000) - mulDiv(probability(2000), 3000, 10000), workload), 'Private answer outcomes lost their measured customer workload.');
        }
        check(usage.inputTokens === mulDiv(usage.executedWorkCUw, contract.inputTokensPerRequest, contract.workPerRequestCUw)
          && usage.outputTokens === mulDiv(usage.executedWorkCUw, contract.outputTokensPerRequest, contract.workPerRequestCUw)
          && (usage.executedWorkCUw > 0 || usage.physicalWorkCUw === 0), 'Private tokens or GPU costs were created without real execution.');
        if (usage.week === state.week) {
          const grant = state.slices.compute.fleets[contract.companyId].lastGrants.find(grant => grant.requestId === 'business-serve:' + contract.id);
          check(grant && grant.requestedWork === contract.reservedWorkCUw && grant.grantedWork === usage.executedWorkCUw, 'Private usage has no matching shared compute grant.');
        }
      } else check(usage.technicalErrorBps === null && [usage.requestedWorkCUw, usage.executedWorkCUw, usage.physicalWorkCUw, usage.inputTokens, usage.outputTokens].every(value => value === 0), 'Customer-hosted license claimed company inference, tokens or model-answer observations.');
    }
  }

  const invoiceIds = new Set<string>();
  for (const invoice of products.commercialInvoices) {
    record(invoice, 'Commercial invoice'); id(invoice.id); id(invoice.contractId); id(invoice.modelId); ownCompany(invoice.companyId); past(invoice.week);
    const customer = BUSINESS_BY_ID[invoice.customerId], current = products.commercialContracts[invoice.contractId];
    if (invoice.workload) {
      assertProductWorkloadReceipt(invoice.workload, state); check(invoice.workload.selectedWeek <= invoice.week, 'Invoice workload was chosen after delivery.');
      check(company.postedFacts[commercialWorkloadProofId({ id: invoice.contractId, companyId: invoice.companyId, modelId: invoice.modelId,
        generation: invoice.generation, workload: invoice.workload, weeklyPriceCents: invoice.grossCents })] === true, 'Invoice changed its frozen premium-workload agreement.');
    }
    check(Object.keys(company.postedFacts).some(id => id.startsWith(`business-workload:${invoice.companyId}:${invoice.contractId}:${invoice.generation}:`)) === !!invoice.workload, 'Invoice dropped its accepted customer workload.');
    check(customer && invoice.contractId === 'business:' + customer.id && current && customer.kinds.includes(invoice.contractKind)
      && models.versions[invoice.modelId]?.companyId === invoice.companyId, 'Commercial invoice lost its finite buyer, model or company.');
    for (const number of [invoice.generation, invoice.termIndex, invoice.grossCents, invoice.creditsCents, invoice.amountCents]) checkedInteger(number); bps(invoice.serviceBps);
    check(invoice.generation > 0 && invoice.generation <= current.generation && invoice.termIndex > 0
      && invoice.id === `business-invoice:${invoice.contractId}:${invoice.generation}:${invoice.week}`
      && !invoiceIds.has(invoice.id) && company.postedFacts[invoice.id], 'Commercial invoice is duplicated, fabricated or unposted.'); invoiceIds.add(invoice.id);
    check(invoice.grossCents === workloadPrivatePrice(invoice.contractKind === 'private-hosted' ? customer.hostedWeeklyCents : customer.licenseWeeklyCents, invoice.workload)
      && invoice.creditsCents === businessCredits(invoice.grossCents, invoice.serviceBps, customer.slaBps)
      && invoice.creditsCents + invoice.amountCents === invoice.grossCents, 'Commercial invoice does not reconcile its fixed fee and SLA credits.');
    if (invoice.generation === current.generation) {
      check(same(invoice.workload ?? null, current.workload ?? null), 'Invoice changed the accepted customer workload.');
      check(invoice.companyId === current.companyId && invoice.modelId === current.modelId && invoice.contractKind === current.contractKind
        && invoice.termIndex <= current.termIndex && invoice.week >= current.readyWeek! + (invoice.termIndex - 1) * customer.termWeeks
        && invoice.week < current.readyWeek! + invoice.termIndex * customer.termWeeks, 'Invoice changed its fixed model, license mode, owner or term.');
      if (current.lastUsage?.week === invoice.week) check(invoice.amountCents === current.lastUsage.billedCents && invoice.creditsCents === current.lastUsage.creditsCents && invoice.serviceBps === current.lastUsage.serviceBps, 'Commercial invoice differs from its executed service.');
    }
    const entry = company.ledger.find(entry => entry.id === invoice.id);
    if (entry) check(entry.companyId === invoice.companyId && entry.sourceId === invoice.contractId && entry.kind === 'receipt' && entry.category === 'revenue' && entry.amountCents === invoice.amountCents && entry.week === invoice.week, 'Commercial invoice and company financial ledger disagree.');
  }
  for (const contract of Object.values(products.commercialContracts)) {
    const currentInvoices = products.commercialInvoices.filter(invoice => invoice.contractId === contract.id && invoice.generation === contract.generation);
    const billed = currentInvoices.reduce((sum, invoice) => checkedAdd(sum, invoice.amountCents), 0), credits = currentInvoices.reduce((sum, invoice) => checkedAdd(sum, invoice.creditsCents), 0);
    check(contract.lifetimeBilledCents >= billed && contract.lifetimeCreditsCents >= credits, 'Commercial lifetime totals lost posted invoices.');
    if (live(contract) || contract.endedWeek === state.week) {
      const termInvoices = currentInvoices.filter(invoice => invoice.termIndex === contract.termIndex);
      check(termInvoices.length === contract.termWeeksServed && termInvoices.reduce((sum, invoice) => sum + invoice.serviceBps, 0) === contract.termServiceBpsTotal, 'A live commercial term lost or fabricated its bounded invoice proofs.');
    }
  }
  check(outsideBusinessOrganizations(state) >= 0, 'Commercial commitments and existing business cohorts exceed the finite organization pool.');
}
