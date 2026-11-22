import { assertFacilityTariffGrant, validatedFacilityRate } from '../modules/facility-tariffs';
import { CONTENT } from '../content/catalog';
import { CHIP_RULES, chipDesignValues } from '../content/wave4-hardware';
import { ROUTING_POLICIES } from '../content/strategic-variety';
import { RUNTIME_GUARDRAIL_PROFILES as PROFILES, RUNTIME_GUARDRAIL_RULES as RULES } from '../content/wave12-guardrails';
import type { CommandPayload, GameContent, GameState, WeeklyUsage } from '../contracts/types';
import type { RuntimeGuardrailBinding, RuntimeGuardrailInstallation, RuntimeGuardrailModelBinding, RuntimeGuardrailWorkReceipt } from '../contracts/wave12-guardrails';
import { inheritedModelRights } from '../modules/model-runtime';
import { paidPolicyCapabilityBaseline, policyHoldoutReport, policyModelFingerprint, policyReleaseRejection } from '../modules/policy-holdouts';
import { routedModel } from '../modules/product-efficiency';
import { behaviorMeter } from '../modules/product-models';
import { activeRuntimeGuardrail, currentRuntimeGuardrail, measuredRuntimeGuardrailUsage, runtimeGuardrailAudit, runtimeGuardrailBaselineUnsafeBps, runtimeGuardrailBindingFingerprint, runtimeGuardrailEvidenceKey, runtimeGuardrailInputsMatch, runtimeGuardrailReceiptKey, runtimeGuardrailResearchReady, runtimeGuardrailRolloutMemory, runtimeGuardrailWorkId } from '../modules/runtime-guardrails';
import { canonicalStateHash } from './canonical';
import { checkedAdd, checkedInteger, mulDiv } from './math';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (left: unknown, right: unknown): boolean => canonicalStateHash(left) === canonicalStateHash(right);
const record = (value: unknown, label: string): void => check(!!value && typeof value === 'object' && !Array.isArray(value), `${label} must be a record.`);
function identifier(value: unknown, label: string): void {
  check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
    && !['__proto__', 'constructor', 'prototype'].includes(value), `${label} is invalid.`);
}
function hash(value: unknown, label: string): void { check(typeof value === 'string' && /^[a-f0-9]{8}$/.test(value), `${label} is invalid.`); }
function exactKeys(value: object, keys: readonly string[], label: string): void {
  check(Object.keys(value).sort().join() === [...keys].sort().join(), `${label} contains an unknown or missing field.`);
}

export function assertRuntimeGuardrailCommand(payload: CommandPayload): void {
  if (payload.kind !== 'install_runtime_guardrail' && payload.kind !== 'set_runtime_guardrail_enabled') return;
  identifier(payload.productId, 'Runtime guardrail product');
  if (payload.kind === 'install_runtime_guardrail') check(payload.profile === 'balanced' || payload.profile === 'strict', 'Runtime guardrail profile is invalid.');
  else check(typeof payload.enabled === 'boolean', 'Runtime guardrail operating choice is invalid.');
}

function assertModel(binding: RuntimeGuardrailModelBinding, installation: RuntimeGuardrailInstallation, state: GameState, content: GameContent): void {
  record(binding, 'Runtime guardrail model binding');
  exactKeys(binding, ['modelId', 'modelFingerprint', 'capabilityReportId', 'policyReportId'], 'Runtime guardrail model binding');
  identifier(binding.modelId, 'Runtime guardrail model'); identifier(binding.capabilityReportId, 'Runtime guardrail capability report');
  identifier(binding.policyReportId, 'Runtime guardrail policy report'); hash(binding.modelFingerprint, 'Runtime guardrail model fingerprint');
  const model = state.slices.models.versions[binding.modelId], report = policyHoldoutReport(state, binding.modelId);
  check(model?.companyId === installation.companyId && model.status !== 'checkpoint' && binding.modelFingerprint === policyModelFingerprint(model),
    'Runtime guardrail changed its exact owned model or frozen model properties.');
  check(report?.id === binding.policyReportId && report.week < installation.startedWeek && report.policy?.baselineReportId === binding.capabilityReportId
    && paidPolicyCapabilityBaseline(state, model, binding.capabilityReportId, installation.startedWeek - 1),
  'Runtime guardrail requires each route’s exact paid capability and policy reports before rollout admission.');
  check(!policyReleaseRejection(state, binding.modelId) && inheritedModelRights(state, binding.modelId, content).hosted,
    'A runtime checker cannot bypass the model’s commercial policy admission or inherited hosted-use rights.');
}

function assertBinding(binding: RuntimeGuardrailBinding, installation: RuntimeGuardrailInstallation, state: GameState, content: GameContent): void {
  record(binding, 'Runtime guardrail binding');
  exactKeys(binding, ['productKind', 'primary', 'secondary', 'secondaryShareBps', 'features'], 'Runtime guardrail binding');
  check(['basic-chat', 'developer-api'].includes(binding.productKind)
    && state.slices.products.offers[installation.productId]?.kind === binding.productKind, 'Runtime guardrails are limited to the captured Chat or API product.');
  record(binding.features, 'Runtime guardrail features'); exactKeys(binding.features, ['memory', 'extendedContext', 'deepReasoning'], 'Runtime guardrail features');
  check(Object.values(binding.features).every(value => typeof value === 'boolean'), 'Runtime guardrail feature choices are invalid.');
  assertModel(binding.primary, installation, state, content);
  if (binding.secondary !== null) {
    assertModel(binding.secondary, installation, state, content);
    const primary = state.slices.models.versions[binding.primary.modelId], secondary = state.slices.models.versions[binding.secondary.modelId];
    check(binding.secondary.modelId !== binding.primary.modelId && primary.architecture === secondary.architecture,
      'Runtime guardrail routing must preserve two different models with compatible architectures.');
  }
  check((binding.secondary ? Object.values(ROUTING_POLICIES).some(policy => policy.secondaryShareBps === binding.secondaryShareBps) : binding.secondaryShareBps === 0)
    && runtimeGuardrailBindingFingerprint(binding) === installation.bindingFingerprint, 'Runtime guardrail route share or exact input fingerprint changed.');
}

function assertReceipt(receipt: RuntimeGuardrailWorkReceipt, key: string, installation: RuntimeGuardrailInstallation, state: GameState, content: GameContent): void {
  record(receipt, 'Runtime guardrail hardware receipt'); identifier(receipt.hardwareId, 'Runtime guardrail hardware');
  exactKeys(receipt, ['hardwareId', 'ownership', 'multiplierBps', 'rateCentsPerCUw', 'physicalCUw', 'effectiveCUw', 'conversionRemainder', 'grants', 'firstWeek', 'lastWeek', ...(Object.hasOwn(receipt, 'facilityTariff') ? ['facilityTariff'] : [])], 'Runtime guardrail hardware receipt');
  check(['cloud', 'owned'].includes(receipt.ownership) && runtimeGuardrailReceiptKey(receipt) === key, 'Runtime guardrail hardware receipt identity changed.');
  for (const value of [receipt.multiplierBps, receipt.rateCentsPerCUw, receipt.physicalCUw, receipt.effectiveCUw, receipt.conversionRemainder,
    receipt.grants, receipt.firstWeek, receipt.lastWeek]) checkedInteger(value, 'Runtime guardrail hardware quantity');
  check(receipt.physicalCUw > 0 && receipt.effectiveCUw > 0 && receipt.grants > 0 && receipt.firstWeek >= installation.startedWeek
    && receipt.lastWeek >= receipt.firstWeek && receipt.lastWeek <= state.week && receipt.grants <= receipt.lastWeek - receipt.firstWeek + 1
    && receipt.effectiveCUw <= receipt.grants * RULES.maximumWeeklyWork, 'Runtime guardrail GPU progress exceeds its elapsed grants or weekly cap.');
  if (receipt.ownership === 'cloud') {
    check(receipt.hardwareId === 'general' && receipt.multiplierBps === 10000 && receipt.rateCentsPerCUw === validatedFacilityRate(state, receipt, installation.companyId, content.opening.rentCentsPerCUWeek, receipt.firstWeek, receipt.lastWeek, { category: 'development', workloadKind: 'inference' }),
      'Runtime guardrail cloud conversion or reservation tariff changed.');
  } else {
    const hardware = content.hardware.find(item => item.id === receipt.hardwareId), design = state.slices.compute.chipDesigns?.[receipt.hardwareId];
    if (hardware) {
      const base = Math.round(hardware.trainingMultiplier * 10000);
      check([base, mulDiv(base, content.infrastructure.crossRackTrainingBps, 10000), mulDiv(base, CHIP_RULES.fabricCrossRackBps, 10000)].includes(receipt.multiplierBps)
        && receipt.rateCentsPerCUw === validatedFacilityRate(state, receipt, installation.companyId, hardware.variableCentsPerCUw, receipt.firstWeek, receipt.lastWeek, { category: 'development', workloadKind: 'inference' }), 'Runtime guardrail owned GPU conversion or variable tariff is not authored.');
    } else {
      check(design?.companyId === installation.companyId && design.status === 'validated' && design.spec.target === 'inference'
        && design.spec.architecture === state.slices.models.versions[installation.binding.primary.modelId].architecture
        && design.prototypeRun?.readyWeek !== null && design.prototypeRun?.readyWeek !== undefined && design.prototypeRun.readyWeek <= receipt.firstWeek,
      'Runtime guardrail custom hardware lacks a previously qualified compatible inference design.');
      const values = chipDesignValues(design!);
      check(receipt.multiplierBps === values.servingBps && receipt.rateCentsPerCUw === validatedFacilityRate(state, receipt, installation.companyId, values.variableCentsPerCUw, receipt.firstWeek, receipt.lastWeek, { category: 'development', workloadKind: 'inference' }),
        'Runtime guardrail custom hardware conversion or variable tariff changed.');
    }
  }
  check(BigInt(receipt.physicalCUw) * BigInt(receipt.multiplierBps) === BigInt(receipt.effectiveCUw) * BigInt(10000) + BigInt(receipt.conversionRemainder)
    && BigInt(receipt.conversionRemainder) < BigInt(Math.max(receipt.multiplierBps, 10000)) * BigInt(receipt.grants),
  'Runtime guardrail useful work does not reconcile with physical GPU grants and integer conversion.');
}

function assertWork(installation: RuntimeGuardrailInstallation, state: GameState, content: GameContent): void {
  record(installation.workReceipts, 'Runtime guardrail work receipts'); const receipts = Object.entries(installation.workReceipts);
  check(receipts.length <= RULES.maximumReceiptBuckets, 'Runtime guardrail hardware receipt history is excessive.');
  let effective = 0, physical = 0, grants = 0;
  for (const [key, receipt] of receipts) {
    hash(key, 'Runtime guardrail tariff key'); assertReceipt(receipt, key, installation, state, content);
    effective = checkedAdd(effective, receipt.effectiveCUw); physical = checkedAdd(physical, receipt.physicalCUw); grants = checkedAdd(grants, receipt.grants);
  }
  check(effective === installation.completedWork && physical === installation.physicalWork && grants <= state.week - installation.startedWeek + 1,
    'Runtime guardrail progress differs from its bounded actual-work receipts.');
  if (installation.latestGrant === null) { check(effective === 0 && receipts.length === 0, 'Runtime guardrail work has no actual GPU grant.'); return; }
  const latest = installation.latestGrant; record(latest, 'Latest runtime guardrail GPU grant');
  exactKeys(latest, ['week', 'poolId', 'receiptKey', 'remainingBefore', 'requestedWork', 'effectiveCUw', 'physicalCUw', 'memoryMU'], 'Latest runtime guardrail GPU grant');
  identifier(latest.poolId, 'Runtime guardrail pool'); hash(latest.receiptKey, 'Runtime guardrail tariff key');
  for (const value of [latest.week, latest.remainingBefore, latest.requestedWork, latest.effectiveCUw, latest.physicalCUw, latest.memoryMU]) checkedInteger(value, 'Runtime guardrail GPU grant quantity');
  const receipt = installation.workReceipts[latest.receiptKey];
  if (receipt) assertFacilityTariffGrant(state, receipt, installation.companyId, latest.poolId, latest.week, { category: 'development', workloadKind: 'inference' }, content);
  check(receipt && latest.week === Math.max(...receipts.map(([, item]) => item.lastWeek)) && latest.week === receipt.lastWeek
    && latest.physicalCUw > 0 && latest.physicalCUw <= receipt.physicalCUw && latest.effectiveCUw > 0 && latest.effectiveCUw <= receipt.effectiveCUw
    && latest.remainingBefore <= installation.requiredWork && latest.requestedWork === Math.min(RULES.maximumWeeklyWork, latest.remainingBefore)
    && latest.effectiveCUw <= latest.requestedWork && installation.completedWork === installation.requiredWork - latest.remainingBefore + latest.effectiveCUw
    && latest.memoryMU === installation.memoryMU, 'Latest runtime guardrail GPU grant exceeds its actual work or separate resident workspace.');
  check(latest.effectiveCUw === Math.min(latest.requestedWork, mulDiv(latest.physicalCUw, receipt!.multiplierBps, 10000)),
    'Runtime guardrail physical work does not produce its reported effective progress.');
  if (latest.week === state.week) {
    const actual = state.slices.compute.fleets[installation.companyId].lastGrants.find(item => item.requestId === runtimeGuardrailWorkId(installation.id, 'compute'));
    check(actual && actual.requestedWork === latest.requestedWork && actual.grantedWork === latest.effectiveCUw,
      'Runtime guardrail GPU progress differs from the actual shared allocator grant.');
  }
  const cost = state.slices.compute.costReports?.[installation.companyId]?.find(item => item.week === latest.week);
  if (cost) {
    const id = runtimeGuardrailWorkId(installation.id, 'compute'), request = cost.resources.requests.find(item => item.id === id);
    const grant = cost.resources.computeGrants.find(item => item.requestId === id), pool = cost.pools.find(item => item.id === latest.poolId);
    const model = state.slices.models.versions[installation.binding.primary.modelId];
    check(request && grant && pool && request.taskId === installation.id && request.companyId === installation.companyId && request.category === 'development'
      && request.workloadKind === 'inference' && request.modelArchitecture === model.architecture && request.modelFamily === model.family
      && (model.architecture !== 'sparse' || request.requiresFastFabric === true)
      && request.normalizedWorkCUw === latest.requestedWork && request.memoryMU === installation.memoryMU && request.sharedAdapterMemory === undefined
      && grant.hardwareEffectiveCUw === latest.effectiveCUw && grant.physicalCUw === latest.physicalCUw && grant.memoryMU === installation.memoryMU
      && !grant.sharedMemoryMU && grant.poolId === latest.poolId && pool.hardwareId === receipt!.hardwareId && pool.ownership === receipt!.ownership,
    'Runtime guardrail GPU receipt differs from the retained settled cost resource frame.');
  }
}

function assertStaff(installation: RuntimeGuardrailInstallation, state: GameState): void {
  checkedInteger(installation.staffGrantCount, 'Runtime guardrail staff grant count');
  if (installation.latestStaffGrant === null) {
    check(installation.completedStaff === 0 && installation.firstStaffWeek === null && installation.staffGrantCount === 0,
      'Runtime guardrail ML progress has no actual staff grant.'); return;
  }
  const latest = installation.latestStaffGrant; record(latest, 'Latest runtime guardrail ML grant');
  exactKeys(latest, ['week', 'remainingBefore', 'grantedStaff'], 'Latest runtime guardrail ML grant');
  checkedInteger(installation.firstStaffWeek!, 'First runtime guardrail ML grant');
  for (const value of [latest.week, latest.remainingBefore, latest.grantedStaff]) checkedInteger(value, 'Runtime guardrail ML quantity');
  check(installation.firstStaffWeek! >= installation.startedWeek && latest.week >= installation.firstStaffWeek! && latest.week <= state.week
    && installation.staffGrantCount > 0 && installation.staffGrantCount <= latest.week - installation.firstStaffWeek! + 1
    && installation.completedStaff >= installation.staffGrantCount && installation.completedStaff <= installation.staffGrantCount * RULES.maximumWeeklyStaff
    && latest.grantedStaff > 0 && latest.grantedStaff <= Math.min(RULES.maximumWeeklyStaff, latest.remainingBefore)
    && latest.remainingBefore <= installation.requiredStaff && installation.completedStaff === installation.requiredStaff - latest.remainingBefore + latest.grantedStaff,
  'Runtime guardrail ML progress exceeds actual review grants or the weekly staff cap.');
  const cost = state.slices.compute.costReports?.[installation.companyId]?.find(item => item.week === latest.week);
  if (cost) {
    const id = runtimeGuardrailWorkId(installation.id, 'ml'), request = cost.resources.requests.find(item => item.id === id);
    const granted = cost.resources.staffGrants.find(item => item.requestId === id)?.grants.find(item => item.role === 'ml')?.staffWeeks ?? 0;
    check(request?.taskId === installation.id && request.companyId === installation.companyId && request.normalizedWorkCUw === 0 && request.memoryMU === 0
      && request.staffDemand?.find(item => item.role === 'ml')?.staffWeeks === Math.min(RULES.maximumWeeklyStaff, latest.remainingBefore)
      && granted === latest.grantedStaff, 'Runtime guardrail ML progress differs from its retained settled staff grant.');
  }
}

/** Frozen paid provenance and audit evidence survive replacements; only the latest active rollout can run. */
export function assertRuntimeGuardrails(state: GameState, content: GameContent = CONTENT): void {
  const collection = state.slices.products.runtimeGuardrails; if (collection === undefined) return;
  record(collection, 'Runtime guardrail installations'); const entries = Object.entries(collection);
  check(entries.length > 0 && entries.length <= RULES.maximumHistory, 'Runtime guardrail history is empty or exceeds its supported bound.');
  const byProduct = new Map<string, number>(), pendingProducts = new Set<string>();
  for (const [key, installation] of entries) {
    record(installation, 'Runtime guardrail installation');
    exactKeys(installation, ['id', 'companyId', 'productId', 'protocol', 'profile', 'binding', 'bindingFingerprint', 'evidenceKey', 'status', 'enabled',
      'startedWeek', 'completedWeek', 'availableWeek', 'requiredWork', 'completedWork', 'physicalWork', 'memoryMU', 'requiredStaff', 'completedStaff',
      'workReceipts', 'latestGrant', 'staffGrantCount', 'firstStaffWeek', 'latestStaffGrant', 'audit', 'lastBottleneck'], 'Runtime guardrail installation');
    for (const value of [key, installation.id, installation.companyId, installation.productId]) identifier(value, 'Runtime guardrail identity');
    hash(installation.bindingFingerprint, 'Runtime guardrail input fingerprint'); hash(installation.evidenceKey, 'Runtime guardrail audit key');
    const command = key.startsWith('guardrail:') ? state.commandReceipts[key.slice('guardrail:'.length)] : undefined;
    const product = state.slices.products.offers[installation.productId];
    checkedInteger(installation.startedWeek, 'Runtime guardrail start week');
    check(key === installation.id && installation.protocol === RULES.protocol && product?.companyId === installation.companyId
      && state.slices.company.companies[installation.companyId] && command?.status === 'accepted' && command.week === installation.startedWeek
      && installation.startedWeek > product.createdWeek && installation.startedWeek <= state.week
      && runtimeGuardrailResearchReady(state, installation.companyId, installation.startedWeek - 1),
    'Runtime guardrail lacks its admitted command, prior research or owned deployed product.');
    check(installation.profile === 'balanced' || installation.profile === 'strict', 'Runtime guardrail profile is invalid.');
    check(['building', 'ready', 'active'].includes(installation.status) && typeof installation.enabled === 'boolean', 'Runtime guardrail state is invalid.');
    check(typeof installation.lastBottleneck === 'string' && installation.lastBottleneck.length <= 2000
      && !/[\u0000-\u001f\u007f]/.test(installation.lastBottleneck), 'Runtime guardrail explanation is invalid.');
    assertBinding(installation.binding, installation, state, content);
    check(installation.evidenceKey === runtimeGuardrailEvidenceKey(state, installation.companyId), 'Runtime guardrail rerolled its fixed audit cohort.');
    for (const value of [installation.requiredWork, installation.completedWork, installation.physicalWork, installation.memoryMU,
      installation.requiredStaff, installation.completedStaff]) checkedInteger(value, 'Runtime guardrail quantity');
    check(installation.requiredWork === RULES.requiredWork && installation.requiredStaff === RULES.requiredStaff
      && installation.memoryMU === runtimeGuardrailRolloutMemory(state, installation.binding, installation.profile)
      && installation.completedWork <= installation.requiredWork && installation.completedStaff <= installation.requiredStaff,
    'Runtime guardrail changed its authored rollout cost, resident workspace or progress.');
    assertWork(installation, state, content); assertStaff(installation, state);
    const finished = installation.completedWork === installation.requiredWork && installation.completedStaff === installation.requiredStaff;
    if (installation.status === 'building') check(!finished && installation.completedWeek === null && installation.availableWeek === null,
      'Unfinished runtime guardrail work acquired completion evidence.');
    else {
      checkedInteger(installation.completedWeek!, 'Runtime guardrail completion'); checkedInteger(installation.availableWeek!, 'Runtime guardrail availability');
      check(finished && installation.completedWeek! >= installation.startedWeek + 1 && installation.completedWeek! <= state.week
        && installation.completedWeek === Math.max(installation.latestGrant!.week, installation.latestStaffGrant!.week)
        && installation.availableWeek === installation.completedWeek! + 1, 'Runtime guardrail completed before both paid meters or their following boundary.');
      check(installation.status === 'ready' ? installation.availableWeek === state.week + 1 : installation.availableWeek! <= state.week,
        'Runtime guardrail report availability violates its weekly boundary.');
    }
    if (installation.status === 'active') {
      record(installation.audit, 'Runtime guardrail paid audit');
      check(same(installation.audit, runtimeGuardrailAudit(state, installation)), 'Runtime guardrail report differs from the fixed paired cases, exact route or authored profile.');
      const current = currentRuntimeGuardrail(state, installation.productId);
      if (current?.id !== installation.id) check(!installation.enabled, 'An obsolete runtime checker was enabled alongside its replacement.');
    } else {
      check(installation.audit === null && installation.enabled, 'A pending runtime checker exposed audit results early or changed its activation choice.');
      check(!pendingProducts.has(installation.productId), 'A product has overlapping runtime guardrail rollouts.'); pendingProducts.add(installation.productId);
    }
    byProduct.set(installation.productId, (byProduct.get(installation.productId) ?? 0) + 1);
    check(byProduct.get(installation.productId)! <= RULES.maximumPerProduct, 'A product exceeds its retained runtime guardrail history limit.');
  }
}

/** Actual benign serving counts and cost attribution; unsafe live requests are never invented. */
export function assertRuntimeGuardrailUsage(state: GameState, usage: WeeklyUsage, currentRequestWorkCUw?: number): void {
  const product = state.slices.products.offers[usage.productId], meter = usage.guardrail, active = activeRuntimeGuardrail(state, usage.productId);
  if (!meter) { check(usage.week !== state.week || !active, 'An active runtime checker lost its settled usage receipt.'); return; }
  record(meter, 'Runtime guardrail usage');
  exactKeys(meter, ['installationId', 'profile', 'bindingFingerprint', 'requestWorkCUw', 'checkWorkCUw', 'requestedRequests', 'checkedRequests', 'uncheckedRequests',
    'baselineFalseRefusalBps', 'technicalErrorBps', 'addedFalseRefusalBps', 'additionalFalseRefusals', 'baselineUnsafeComplianceBps', 'guardedUnsafeComplianceBps'], 'Runtime guardrail usage');
  identifier(meter.installationId, 'Runtime guardrail usage installation'); hash(meter.bindingFingerprint, 'Runtime guardrail usage binding');
  check(meter.profile === 'balanced' || meter.profile === 'strict', 'Runtime guardrail usage profile is invalid.');
  const installation = state.slices.products.runtimeGuardrails?.[meter.installationId];
  check(installation?.companyId === product.companyId && installation.productId === product.id && installation.status === 'active'
    && installation.availableWeek !== null && installation.availableWeek <= usage.week && installation.profile === meter.profile
    && installation.bindingFingerprint === meter.bindingFingerprint, 'Runtime guardrail usage lacks its exact paid available installation.');
  check(['basic-chat', 'developer-api'].includes(product.kind), 'Only Chat and developer API traffic supports this runtime policy protocol.');
  for (const value of [meter.requestWorkCUw, meter.checkWorkCUw, meter.requestedRequests, meter.checkedRequests, meter.uncheckedRequests,
    meter.baselineFalseRefusalBps, meter.technicalErrorBps, meter.addedFalseRefusalBps, meter.additionalFalseRefusals, meter.baselineUnsafeComplianceBps, meter.guardedUnsafeComplianceBps]) checkedInteger(value, 'Runtime guardrail usage quantity');
  for (const value of [meter.baselineFalseRefusalBps, meter.technicalErrorBps, meter.addedFalseRefusalBps, meter.baselineUnsafeComplianceBps, meter.guardedUnsafeComplianceBps]) check(value <= 10000, 'Runtime guardrail usage rate exceeds 100%.');
  const rule = PROFILES[meter.profile];
  check(meter.requestWorkCUw > rule.workPerRequestCUw && meter.technicalErrorBps === usage.errorBps
    && meter.baselineUnsafeComplianceBps === runtimeGuardrailBaselineUnsafeBps(state, installation!.binding),
  'Runtime guardrail usage erased inference cost or changed its frozen model-policy tendency.');
  const expected = measuredRuntimeGuardrailUsage({ installationId: meter.installationId, profile: meter.profile, bindingFingerprint: meter.bindingFingerprint,
    requestWorkCUw: meter.requestWorkCUw, baselineFalseRefusalBps: meter.baselineFalseRefusalBps, technicalErrorBps: meter.technicalErrorBps,
    baselineUnsafeComplianceBps: meter.baselineUnsafeComplianceBps }, usage.requestedWork, usage.executedWork, usage);
  check(same(meter, expected), 'Runtime guardrail counts, false refusals or checking work do not reconcile with actual executed requests.');
  check(meter.checkWorkCUw <= usage.executedWork && meter.checkWorkCUw >= meter.checkedRequests * rule.workPerRequestCUw,
    'Runtime guardrail completed checks have no corresponding executed checking work.');
  const binding = installation!.binding, primaryBehavior = behaviorMeter(state.slices.models.versions[binding.primary.modelId], meter.technicalErrorBps);
  const secondaryBehavior = binding.secondary && behaviorMeter(state.slices.models.versions[binding.secondary.modelId], meter.technicalErrorBps);
  const expectedFalse = secondaryBehavior ? mulDiv(primaryBehavior.falseRefusalBps, 10000 - binding.secondaryShareBps, 10000)
    + mulDiv(secondaryBehavior.falseRefusalBps, binding.secondaryShareBps, 10000) : primaryBehavior.falseRefusalBps;
  check(meter.baselineFalseRefusalBps === expectedFalse, 'Runtime guardrail false-refusal baseline differs from its exact frozen models.');
  if (usage.week === state.week) {
    const model = state.slices.models.versions[state.slices.products.deployments[product.deploymentId].modelId];
    check(active?.id === meter.installationId && runtimeGuardrailInputsMatch(state, installation!)
      && meter.baselineFalseRefusalBps === behaviorMeter(routedModel(state, product, model), usage.errorBps).falseRefusalBps,
    'Current runtime guardrail usage has no enabled matching source and route.');
    if (currentRequestWorkCUw !== undefined) check(meter.requestWorkCUw === currentRequestWorkCUw, 'Runtime guardrail request work differs from actual inference plus checking cost.');
  }
  const cost = state.slices.compute.costReports?.[product.companyId]?.find(item => item.week === usage.week);
  if (cost) {
    const request = cost.resources.requests.find(item => item.id === `serve:${product.id}`), grant = cost.resources.computeGrants.find(item => item.requestId === `serve:${product.id}`);
    check(usage.executedWork === (grant?.hardwareEffectiveCUw ?? 0)
      && (usage.executedWork === 0 || request?.companyId === product.companyId && request.taskId === product.id
        && request.category === 'serving' && request.normalizedWorkCUw === usage.requestedWork),
    'Runtime guardrail usage differs from its one actual serving grant.');
  }
}
