import { assertFacilityTariffGrant, validatedFacilityRate } from '../modules/facility-tariffs';
import { CHIP_RULES, chipDesignValues } from '../content/wave4-hardware';
import { RELEASE_REHEARSAL_RULES as RULES } from '../content/wave9-rehearsals';
import type { CommandPayload, GameContent, GameState } from '../contracts/types';
import type { ReleaseConfiguration, ReleaseRehearsal, ReleaseRehearsalArm, RehearsalWorkReceipt } from '../contracts/wave9-rehearsals';
import { isCapabilitySuite } from '../modules/evaluation-classification';
import { facilityRetrofitResearchReady } from '../modules/facility-retrofits';
import { inheritedModelRights } from '../modules/model-runtime';
import { eligibleModel, requestMeter } from '../modules/product-models';
import { rehearsalEvidenceKey, rehearsalReceiptKey, releaseModelFingerprint, releaseRehearsalOutcomes, releaseRehearsalWorkId } from '../modules/release-rehearsals';
import { canonicalStateHash } from './canonical';
import { checkedAdd, checkedInteger, mulDiv } from './math';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (a: unknown, b: unknown) => canonicalStateHash(a) === canonicalStateHash(b);
const record = (value: unknown, label: string): void => check(!!value && typeof value === 'object' && !Array.isArray(value), `${label} must be a record.`);
function identifier(value: unknown, label: string): void {
  check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value), `${label} is invalid.`);
}
function hash(value: unknown, label: string): void { check(typeof value === 'string' && /^[a-f0-9]{8}$/.test(value), `${label} is invalid.`); }

export function assertReleaseRehearsalCommand(payload: CommandPayload): void {
  if (payload.kind === 'start_release_rehearsal') {
    identifier(payload.productId, 'Rehearsal product'); identifier(payload.candidateModelId, 'Rehearsal candidate');
  } else if (payload.kind === 'set_release_rehearsal_paused') {
    identifier(payload.rehearsalId, 'Release rehearsal'); check(typeof payload.paused === 'boolean', 'Rehearsal pause choice is invalid.');
  }
}

function assertConfiguration(configuration: ReleaseConfiguration, rehearsal: ReleaseRehearsal, state: GameState): void {
  record(configuration, 'Release configuration');
  if (configuration.routingPolicy !== undefined) check(configuration.routingPolicy === 'economy' || configuration.routingPolicy === 'quality', 'Captured routing policy must be an authored non-default choice.');
  check(['basic-chat', 'developer-api', 'business-docs'].includes(configuration.productKind)
    && configuration.productKind === state.slices.products.offers[rehearsal.productId]?.kind, 'Rehearsal product kind is invalid.');
  record(configuration.features, 'Rehearsal features');
  check(Object.keys(configuration.features).length === 3 && ['memory', 'extendedContext', 'deepReasoning'].every(key => typeof configuration.features[key as keyof typeof configuration.features] === 'boolean'), 'Rehearsal feature settings are invalid.');
  identifier(configuration.contractId, 'Rehearsal contract'); checkedInteger(configuration.allowance, 'Rehearsal allowance');
  check(configuration.allowance >= 1 && state.slices.products.contracts[configuration.contractId]?.productId === rehearsal.productId,
    'Rehearsal contract or allowance is invalid.');
  if (configuration.retrieval !== null) {
    record(configuration.retrieval, 'Captured retrieval'); identifier(configuration.retrieval.id, 'Captured retrieval ID'); identifier(configuration.retrieval.packetId, 'Captured retrieval packet');
    check(configuration.retrieval.id === 'retrieval:' + rehearsal.productId && !!state.slices.data.packets[configuration.retrieval.packetId], 'Captured retrieval identity is invalid.');
    checkedInteger(configuration.retrieval.readyWeek!, 'Captured retrieval availability'); check(configuration.retrieval.readyWeek! <= rehearsal.startedWeek, 'Rehearsal captured an unavailable retrieval installation.');
  }
  check(Array.isArray(configuration.efficiency) && configuration.efficiency.length <= 3, 'Rehearsal efficiency settings are invalid.');
  const kinds = new Set<string>();
  for (const item of configuration.efficiency) {
    record(item, 'Captured efficiency installation'); identifier(item.id, 'Captured efficiency ID');
    if (item.routingProtocol !== undefined) check(item.kind === 'routing' && item.routingProtocol === 2, 'Captured routing protocol is invalid.');
    check(['routing', 'prefix-cache', 'evidence-links'].includes(item.kind) && !kinds.has(item.kind), 'Captured efficiency type is duplicated or unknown.'); kinds.add(item.kind);
    // The collection key is product:kind; the durable installation ID identifies its admitted command.
    // A later rebuild may replace the live collection entry while this historical receipt remains.
    const installationCommand = item.id.startsWith('efficiency:') ? state.commandReceipts[item.id.slice('efficiency:'.length)] : undefined;
    check(installationCommand?.status === 'accepted' && item.modelId === rehearsal.sourceModelId && typeof item.enabled === 'boolean', 'Captured efficiency identity changed.');
    checkedInteger(item.readyWeek!, 'Captured efficiency availability'); check(item.readyWeek! <= rehearsal.startedWeek, 'Rehearsal captured unfinished serving work.');
    check(installationCommand!.week < item.readyWeek!, 'Captured efficiency was available before its installation command.');
    for (const value of [item.secondaryModelId, item.retrievalId, item.evidencePacketId]) if (value !== null) identifier(value, 'Captured efficiency reference');
    if (item.secondaryModelId !== null) check(state.slices.models.versions[item.secondaryModelId]?.companyId === rehearsal.companyId, 'Captured routing model is missing or foreign.');
  }
  check(same(configuration.efficiency, [...configuration.efficiency].sort((a, b) => a.id.localeCompare(b.id))), 'Captured efficiency settings are not canonical.');
  if (configuration.guardrail !== undefined) {
    const captured = configuration.guardrail;
    record(captured, 'Captured runtime guardrail');
    identifier(captured.installationId, 'Captured runtime guardrail ID');
    hash(captured.bindingFingerprint, 'Captured guardrail binding');
    check(['balanced', 'strict'].includes(captured.profile) && typeof captured.enabled === 'boolean', 'Captured runtime guardrail profile or enabled choice is invalid.');
    check(Object.keys(captured).sort().join() === ['installationId', 'profile', 'enabled', 'bindingFingerprint', ...(captured.pendingInstallationId !== undefined ? ['pendingInstallationId'] : [])].sort().join(), 'Captured runtime guardrail contains an unknown field.');
    const installed = state.slices.products.runtimeGuardrails?.[captured.installationId];
    check(installed && installed.productId === rehearsal.productId && installed.companyId === rehearsal.companyId
      && installed.profile === captured.profile && installed.bindingFingerprint === captured.bindingFingerprint
      && installed.startedWeek <= rehearsal.startedWeek, 'Release comparison lost its exact runtime guardrail installation.');
    if (captured.enabled) check(installed?.availableWeek !== null && installed?.availableWeek !== undefined && installed.availableWeek <= rehearsal.startedWeek,
      'Release comparison captured runtime checks before their paid availability boundary.');
    if (captured.pendingInstallationId !== undefined) {
      identifier(captured.pendingInstallationId, 'Captured pending runtime guardrail');
      const pending = state.slices.products.runtimeGuardrails?.[captured.pendingInstallationId];
      check(pending && pending.productId === rehearsal.productId && pending.companyId === rehearsal.companyId
        && pending.startedWeek <= rehearsal.startedWeek && (pending.availableWeek === null || pending.availableWeek > rehearsal.startedWeek),
      'Release comparison changed its pending runtime guardrail work.');
    }
  }
  check(canonicalStateHash(configuration) === rehearsal.configurationFingerprint, 'Rehearsal configuration fingerprint changed.');
}

function assertReceipt(receipt: RehearsalWorkReceipt, key: string, rehearsal: ReleaseRehearsal, state: GameState, content: GameContent): void {
  record(receipt, 'Rehearsal hardware receipt'); identifier(receipt.hardwareId, 'Rehearsal hardware');
  check(['cloud', 'owned'].includes(receipt.ownership) && rehearsalReceiptKey(receipt) === key, 'Rehearsal hardware receipt identity changed.');
  for (const value of [receipt.multiplierBps, receipt.rateCentsPerCUw, receipt.physicalCUw, receipt.effectiveCUw, receipt.conversionRemainder, receipt.grants, receipt.firstWeek, receipt.lastWeek]) checkedInteger(value, 'Rehearsal hardware quantity');
  check(receipt.physicalCUw > 0 && receipt.effectiveCUw > 0 && receipt.grants > 0 && receipt.firstWeek >= rehearsal.startedWeek
    && receipt.lastWeek >= receipt.firstWeek && receipt.lastWeek <= state.week && receipt.grants <= receipt.lastWeek - receipt.firstWeek + 1,
  'Rehearsal hardware work violates its elapsed grant history.');
  if (receipt.ownership === 'cloud') {
    check(receipt.hardwareId === 'general' && receipt.multiplierBps === 10000 && receipt.rateCentsPerCUw === validatedFacilityRate(state, receipt, rehearsal.companyId, content.opening.rentCentsPerCUWeek, receipt.firstWeek, receipt.lastWeek, { category: 'development', workloadKind: 'inference' }),
      'Rehearsal cloud conversion or reservation tariff changed.');
  } else {
    const hardware = content.hardware.find(item => item.id === receipt.hardwareId), design = state.slices.compute.chipDesigns?.[receipt.hardwareId];
    if (hardware) {
      const base = Math.round(hardware.trainingMultiplier * 10000);
      check([base, mulDiv(base, content.infrastructure.crossRackTrainingBps, 10000), mulDiv(base, CHIP_RULES.fabricCrossRackBps, 10000)].includes(receipt.multiplierBps)
        && receipt.rateCentsPerCUw === validatedFacilityRate(state, receipt, rehearsal.companyId, hardware.variableCentsPerCUw, receipt.firstWeek, receipt.lastWeek, { category: 'development', workloadKind: 'inference' }), 'Rehearsal owned GPU conversion or variable tariff is not authored.');
    } else {
      check(design?.companyId === rehearsal.companyId && design.status === 'validated' && design.spec.target === 'inference'
        && design.prototypeRun?.readyWeek !== null && design.prototypeRun?.readyWeek !== undefined && design.prototypeRun.readyWeek <= receipt.firstWeek,
      'Rehearsal custom hardware lacks an available qualified inference design.');
      const values = chipDesignValues(design!);
      check(receipt.multiplierBps === values.servingBps && receipt.rateCentsPerCUw === validatedFacilityRate(state, receipt, rehearsal.companyId, values.variableCentsPerCUw, receipt.firstWeek, receipt.lastWeek, { category: 'development', workloadKind: 'inference' }),
        'Rehearsal custom hardware conversion or variable tariff changed.');
    }
  }
  check(BigInt(receipt.physicalCUw) * BigInt(receipt.multiplierBps) === BigInt(receipt.effectiveCUw) * BigInt(10000) + BigInt(receipt.conversionRemainder)
    && BigInt(receipt.conversionRemainder) < BigInt(Math.max(receipt.multiplierBps, 10000)) * BigInt(receipt.grants),
  'Rehearsal useful work does not reconcile with its actual physical grants and integer conversion.');
}

function assertArm(arm: ReleaseRehearsalArm, name: 'source' | 'candidate', rehearsal: ReleaseRehearsal, state: GameState, content: GameContent): void {
  record(arm, 'Rehearsal model arm'); identifier(arm.modelId, 'Rehearsal arm model'); identifier(arm.capabilityReportId, 'Rehearsal capability report'); hash(arm.modelFingerprint, 'Rehearsal model fingerprint');
  const model = state.slices.models.versions[arm.modelId], report = state.slices.models.reports[arm.capabilityReportId];
  check(model?.companyId === rehearsal.companyId && arm.modelId === (name === 'source' ? rehearsal.sourceModelId : rehearsal.candidateModelId)
    && arm.modelFingerprint === releaseModelFingerprint(model), 'Rehearsal model identity or frozen properties changed.');
  check(report && report.modelId === arm.modelId && report.companyId === rehearsal.companyId && report.heldOut && isCapabilitySuite(report.suiteId)
    && report.week <= rehearsal.startedWeek && same(report.capabilityBps, model!.capabilityBps) && report.reliabilityBps === model!.reliabilityBps,
  'Rehearsal model lacks its exact prior held-out capability report.');
  check(eligibleModel(state, arm.modelId, rehearsal.companyId, rehearsal.configuration.productKind) && inheritedModelRights(state, arm.modelId, content).hosted,
    'Rehearsal candidate cannot bypass product eligibility or hosted-use rights.');
  const meter = requestMeter(model!, rehearsal.configuration.features);
  for (const value of [arm.requiredWork, arm.completedWork, arm.memoryMU, arm.physicalWork]) checkedInteger(value, 'Rehearsal arm quantity');
  check(arm.requiredWork === meter.work * RULES.cases * RULES.exchangesPerCase && arm.memoryMU === model!.residentMU + meter.sessionMemory
    && arm.completedWork <= arm.requiredWork, 'Rehearsal changed its finite workload, progress, or separate resident memory.');
  record(arm.workReceipts, 'Rehearsal work receipts'); const receipts = Object.entries(arm.workReceipts);
  check(receipts.length <= RULES.maximumReceiptBuckets, 'Rehearsal hardware receipt history is excessive.');
  let effective = 0, physical = 0, grants = 0;
  for (const [key, receipt] of receipts) {
    hash(key, 'Rehearsal hardware receipt key'); assertReceipt(receipt, key, rehearsal, state, content);
    effective = checkedAdd(effective, receipt.effectiveCUw); physical = checkedAdd(physical, receipt.physicalCUw); grants = checkedAdd(grants, receipt.grants);
  }
  check(effective === arm.completedWork && physical === arm.physicalWork && grants <= state.week - rehearsal.startedWeek + 1,
    'Rehearsal progress does not equal its bounded physical-work receipts.');
  if (arm.latestGrant === null) check(arm.completedWork === 0 && receipts.length === 0, 'Rehearsal progress has no actual grant receipt.');
  else {
    const latest = arm.latestGrant; record(latest, 'Latest rehearsal grant'); identifier(latest.poolId, 'Latest rehearsal pool'); hash(latest.receiptKey, 'Latest rehearsal tariff key');
    for (const value of [latest.week, latest.remainingBefore, latest.physicalCUw, latest.effectiveCUw, latest.memoryMU]) checkedInteger(value, 'Latest rehearsal grant quantity');
    const receipt = arm.workReceipts[latest.receiptKey];
    if (receipt) assertFacilityTariffGrant(state, receipt, rehearsal.companyId, latest.poolId, latest.week, { category: 'development', workloadKind: 'inference' }, content);
    check(receipt && latest.week === Math.max(...receipts.map(([, item]) => item.lastWeek)) && latest.week === receipt.lastWeek
      && latest.physicalCUw > 0 && latest.physicalCUw <= receipt.physicalCUw && latest.effectiveCUw > 0 && latest.effectiveCUw <= receipt.effectiveCUw
      && latest.effectiveCUw <= latest.remainingBefore && latest.remainingBefore <= arm.requiredWork
      && arm.completedWork === arm.requiredWork - latest.remainingBefore + latest.effectiveCUw && latest.memoryMU === arm.memoryMU,
    'Latest rehearsal grant exceeds its finite remaining work, resident memory, or receipt totals.');
    check(latest.effectiveCUw === Math.min(latest.remainingBefore, mulDiv(latest.physicalCUw, receipt!.multiplierBps, 10000)), 'Latest rehearsal physical grant does not produce its reported useful work.');
    if (latest.week === state.week) {
      const actual = state.slices.compute.fleets[rehearsal.companyId].lastGrants.find(item => item.requestId === releaseRehearsalWorkId(rehearsal.id, name));
      check(actual && actual.requestedWork === latest.remainingBefore && actual.grantedWork === latest.effectiveCUw,
        'Latest rehearsal work differs from the shared allocator grant.');
    }
    const cost = state.slices.compute.costReports?.[rehearsal.companyId]?.find(item => item.week === latest.week);
    if (cost) {
      const requestId = releaseRehearsalWorkId(rehearsal.id, name), request = cost.resources.requests.find(item => item.id === requestId);
      const grant = cost.resources.computeGrants.find(item => item.requestId === requestId), pool = cost.pools.find(item => item.id === latest.poolId);
      check(request && grant && pool && request.taskId === rehearsal.id && request.category === 'development'
        && request.normalizedWorkCUw === latest.remainingBefore && request.memoryMU === arm.memoryMU && request.sharedAdapterMemory === undefined
        && request.workloadKind === 'inference' && grant.hardwareEffectiveCUw === latest.effectiveCUw && grant.physicalCUw === latest.physicalCUw
        && grant.memoryMU === arm.memoryMU && grant.poolId === latest.poolId && pool.hardwareId === receipt!.hardwareId && pool.ownership === receipt!.ownership,
      'Rehearsal work disagrees with the retained settled compute-cost resource frame.');
    }
  }
  if (rehearsal.status === 'complete') {
    record(arm.outcomes, 'Release comparison outcomes');
    check(same(arm.outcomes, releaseRehearsalOutcomes(model!, rehearsal.configuration, rehearsal.evidenceKey)), 'Rehearsal outcomes changed from the reserved case bank or exact frozen model.');
  } else check(arm.outcomes === null, 'Unfinished rehearsal exposes model outcomes before the availability boundary.');
}

/** No fabricated capability, money, customer, or outcome writes are part of this protocol. */
export function assertWave9ReleaseRehearsals(state: GameState, content: GameContent): void {
  const collection = state.slices.products.releaseRehearsals; if (collection === undefined) return;
  record(collection, 'Release rehearsals'); const entries = Object.entries(collection);
  check(entries.length <= RULES.maximumHistory, 'Release rehearsal history exceeds its supported bound.');
  const byProduct = new Map<string, number>(), pairs = new Set<string>(), running = new Set<string>();
  for (const [key, rehearsal] of entries) {
    record(rehearsal, 'Release rehearsal'); identifier(key, 'Rehearsal ID'); identifier(rehearsal.companyId, 'Rehearsal owner'); identifier(rehearsal.productId, 'Rehearsal product');
    identifier(rehearsal.sourceDeploymentId, 'Rehearsal source deployment'); identifier(rehearsal.sourceModelId, 'Rehearsal source model'); identifier(rehearsal.candidateModelId, 'Rehearsal candidate');
    hash(rehearsal.configurationFingerprint, 'Rehearsal configuration fingerprint'); hash(rehearsal.evidenceKey, 'Rehearsal bank key');
    const product = state.slices.products.offers[rehearsal.productId], commandId = key.slice('release-rehearsal:'.length), command = state.commandReceipts[commandId];
    check(rehearsal.id === key && key.startsWith('release-rehearsal:') && rehearsal.protocol === RULES.protocol
      && product?.companyId === rehearsal.companyId && command?.status === 'accepted' && command.week === rehearsal.startedWeek,
    'Release rehearsal identity, ownership, or admitted command is missing.');
    checkedInteger(rehearsal.startedWeek, 'Rehearsal start');
    check(rehearsal.startedWeek >= product!.createdWeek && rehearsal.startedWeek <= state.week && rehearsal.sourceModelId !== rehearsal.candidateModelId
      && facilityRetrofitResearchReady(state, rehearsal.companyId, rehearsal.startedWeek), 'Rehearsal started before its product or researched operations method.');
    check(['running', 'ready', 'complete'].includes(rehearsal.status) && typeof rehearsal.paused === 'boolean', 'Rehearsal status or pause choice is invalid.');
    check(typeof rehearsal.lastBottleneck === 'string' && rehearsal.lastBottleneck.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(rehearsal.lastBottleneck), 'Rehearsal explanation is invalid.');
    assertConfiguration(rehearsal.configuration, rehearsal, state);
    check(rehearsal.evidenceKey === rehearsalEvidenceKey(state, rehearsal.companyId, rehearsal.configuration.productKind), 'Rehearsal rerolled its immutable company and product case bank.');
    const pair = `${rehearsal.productId}:${rehearsal.sourceDeploymentId}:${rehearsal.candidateModelId}:${rehearsal.configurationFingerprint}`;
    check(!pairs.has(pair), 'The same release comparison was rerun.'); pairs.add(pair);
    byProduct.set(rehearsal.productId, (byProduct.get(rehearsal.productId) ?? 0) + 1);
    check(byProduct.get(rehearsal.productId)! <= RULES.maximumPerProduct, 'This product has excessive release rehearsal history.');
    if (rehearsal.status !== 'complete') { check(!running.has(rehearsal.productId), 'A product has multiple unfinished release comparisons.'); running.add(rehearsal.productId); }
    for (const value of [rehearsal.requiredStaff, rehearsal.completedStaff]) checkedInteger(value, 'Rehearsal review work');
    check(rehearsal.requiredStaff === RULES.reviewStaff && rehearsal.completedStaff <= rehearsal.requiredStaff, 'Rehearsal review requirements or progress changed.');
    if (rehearsal.lastStaffWeek === null) check(rehearsal.completedStaff === 0 && rehearsal.latestReview === null, 'Rehearsal review progress has no grant week.');
    else {
      checkedInteger(rehearsal.lastStaffWeek, 'Rehearsal review grant week');
      check(rehearsal.completedStaff > 0 && rehearsal.lastStaffWeek >= rehearsal.startedWeek && rehearsal.lastStaffWeek <= state.week, 'Rehearsal review chronology is invalid.');
      record(rehearsal.latestReview, 'Latest rehearsal review grant'); const review = rehearsal.latestReview!;
      for (const value of [review.week, review.remainingBefore, review.grantedStaff]) checkedInteger(value, 'Latest review quantity');
      check(review.week === rehearsal.lastStaffWeek && review.grantedStaff > 0 && review.grantedStaff <= review.remainingBefore && review.remainingBefore <= rehearsal.requiredStaff
        && rehearsal.completedStaff === rehearsal.requiredStaff - review.remainingBefore + review.grantedStaff, 'Rehearsal review progress differs from its actual grant receipt.');
      const cost = state.slices.compute.costReports?.[rehearsal.companyId]?.find(item => item.week === review.week);
      if (cost) {
        const requestId = releaseRehearsalWorkId(rehearsal.id, 'review'), request = cost.resources.requests.find(item => item.id === requestId);
        const granted = cost.resources.staffGrants.find(item => item.requestId === requestId)?.grants.find(item => item.role === 'ml')?.staffWeeks ?? 0;
        check(request?.taskId === rehearsal.id && request.staffDemand?.find(item => item.role === 'ml')?.staffWeeks === review.remainingBefore
          && granted === review.grantedStaff, 'Rehearsal review disagrees with the retained settled staff grant.');
      }
    }
    record(rehearsal.arms, 'Rehearsal arms'); check(Object.keys(rehearsal.arms).length === 2, 'Rehearsal must have exactly two model arms.');
    assertArm(rehearsal.arms.source, 'source', rehearsal, state, content); assertArm(rehearsal.arms.candidate, 'candidate', rehearsal, state, content);
    const finished = rehearsal.completedStaff === rehearsal.requiredStaff && Object.values(rehearsal.arms).every(arm => arm.completedWork === arm.requiredWork);
    if (rehearsal.status === 'running') check(!finished && rehearsal.completedWeek === null && rehearsal.availableWeek === null, 'Unfinished rehearsal has completion or availability evidence.');
    else {
      checkedInteger(rehearsal.completedWeek!, 'Rehearsal completion'); checkedInteger(rehearsal.availableWeek!, 'Rehearsal availability');
      check(finished && !rehearsal.paused && rehearsal.completedWeek! >= rehearsal.startedWeek && rehearsal.completedWeek! <= state.week
        && rehearsal.completedWeek === Math.max(rehearsal.lastStaffWeek!, rehearsal.arms.source.latestGrant!.week, rehearsal.arms.candidate.latestGrant!.week)
        && rehearsal.availableWeek === rehearsal.completedWeek! + 1, 'Rehearsal completed without both actual model arms and ML review.');
      check(rehearsal.status === 'ready' ? rehearsal.availableWeek === state.week + 1 : rehearsal.availableWeek! <= state.week, 'Rehearsal violates its next-boundary result availability.');
    }
  }
}
