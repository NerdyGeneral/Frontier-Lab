import type { GameContent, GameState } from '../contracts/types';
import type { PreparedRelease, ReleasePreparationWork, ReleaseRollback } from '../contracts/wave9-releases';
import { PREPARED_RELEASE_RULES as RULES } from '../content/wave9-releases';
import { inheritedModelRights } from '../modules/model-runtime';
import { facilityRetrofitResearchReady } from '../modules/facility-retrofits';
import { checkedInteger } from './math';

const check = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
const pending = (status: string): boolean => ['preparing', 'ready', 'scheduled'].includes(status);
function record(value: unknown, label: string): void { check(!!value && typeof value === 'object' && !Array.isArray(value), `${label} must be a record.`); }
function identifier(value: unknown, label: string): void {
  check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value), `${label} is invalid.`);
}
function note(value: unknown): void { check(typeof value === 'string' && value.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(value), 'Prepared-release explanation is invalid.'); }

/** Optional records never alter the representation or rules of unadopted old saves. */
export function assertWave9PreparedReleases(state: GameState, content: GameContent): void {
  const { products, models, company } = state.slices;
  const projects = products.preparedReleases ?? {};
  if (products.preparedReleases !== undefined) record(products.preparedReleases, 'Prepared releases');
  const past = (week: number, label: string) => { checkedInteger(week, label); check(week <= state.week, `${label} is in the future.`); };
  const pendingProducts = new Set<string>(), countByProduct: Record<string, number> = {};
  const assertWork = (work: ReleasePreparationWork & { status: string }, release: PreparedRelease, rollback: boolean) => {
    record(work, 'Release preparation work'); identifier(work.startCommandId, 'Preparation command');
    const startReceipt = state.commandReceipts[work.startCommandId];
    check(startReceipt?.status === 'accepted' && startReceipt.week === work.startedWeek, 'Release preparation is missing its accepted start command.');
    past(work.startedWeek, 'Release preparation start');
    for (const value of [work.requiredWork, work.completedWork, work.physicalWork, work.requiredStaff, work.completedStaff, work.requiredMemory, work.lastProgress]) checkedInteger(value);
    check(work.requiredWork === (rollback ? RULES.rollbackWork : RULES.forwardWork)
      && work.requiredStaff === (rollback ? RULES.rollbackStaff : RULES.forwardStaff), 'Release preparation changed its paid work or staff requirement.');
    check(work.completedWork <= work.requiredWork && work.completedStaff <= work.requiredStaff && work.lastProgress <= RULES.weeklyWork,
      'Release preparation exceeds its paid work or staff requirement.');
    check((work.completedWork === 0) === (work.physicalWork === 0), 'Release preparation has effective work without physical GPU execution.');
    const rehearsal = products.releaseRehearsals![release.rehearsalId], model = models.versions[rollback ? release.sourceModelId : release.candidateModelId];
    check(work.requiredMemory === model.residentMU + (rehearsal.configuration.features.extendedContext ? RULES.longSessionMemory : RULES.normalSessionMemory),
      'Release preparation omitted the independent model weights or session workspace.');
    check(typeof work.paused === 'boolean' && (!work.paused || work.status === 'preparing'), 'Only unfinished preparation may be paused.'); note(work.lastBottleneck);
    const throughWeek = work.completedWeek ?? state.week, elapsed = throughWeek - work.startedWeek + 1;
    check(work.completedWork <= elapsed * RULES.weeklyWork && work.completedStaff <= elapsed * RULES.weeklyStaff, 'Release preparation finished before its weekly work caps permit.');
    if (work.completedWeek !== null) {
      past(work.completedWeek, 'Release preparation completion');
      check(work.completedWeek >= work.startedWeek && work.availableWeek === work.completedWeek + 1
        && work.completedWork === work.requiredWork && work.completedStaff === work.requiredStaff, 'A prepared bundle skipped paid compute, staff, or its availability boundary.');
    } else check(work.availableWeek === null && !['ready', 'scheduled', 'released', 'complete'].includes(work.status), 'Unfinished preparation became usable.');
    if (work.status === 'preparing') check(work.completedWeek === null && work.promotionCommandId === null && work.cutoverWeek === null, 'Unfinished preparation has a completed or scheduled handover.');
    if (work.lastGrant !== null) {
      const grant = work.lastGrant; record(grant, 'Preparation last grant'); past(grant.week, 'Preparation grant week'); identifier(grant.poolId, 'Preparation pool');
      for (const value of [grant.requestedWork, grant.grantedWork, grant.physicalWork, grant.memoryMU, grant.staff]) checkedInteger(value);
      check(grant.week >= work.startedWeek && grant.requestedWork <= RULES.weeklyWork && grant.grantedWork <= grant.requestedWork
        && grant.grantedWork <= work.completedWork && grant.physicalWork <= work.physicalWork && grant.staff <= RULES.weeklyStaff
        && grant.staff <= work.completedStaff, 'Preparation grant exceeds its actual work history.');
      check((grant.grantedWork === 0) === (grant.physicalWork === 0)
        && (grant.grantedWork === 0 || grant.memoryMU === work.requiredMemory), 'Preparation grant did not place its full independent workspace.');
      if (grant.week === state.week) {
        const actual = state.slices.compute.fleets[release.companyId].lastGrants.find(item => item.requestId === (rollback ? 'rollback-work:' : 'release-work:') + release.id);
        check(actual && actual.requestedWork === grant.requestedWork && actual.grantedWork === grant.grantedWork, 'Latest preparation work differs from the shared allocator grant.');
      }
      const cost = state.slices.compute.costReports?.[release.companyId]?.find(item => item.week === grant.week);
      if (cost) {
        const requestId = (rollback ? 'rollback-work:' : 'release-work:') + release.id;
        const request = cost.resources.requests.find(item => item.id === requestId), actual = cost.resources.computeGrants.find(item => item.requestId === requestId);
        const staff = cost.resources.staffGrants.find(item => item.requestId === requestId)?.grants.find(item => item.role === 'ml')?.staffWeeks ?? 0;
        check(request && actual && request.taskId === release.id && request.category === 'development' && request.workloadKind === 'inference'
          && request.normalizedWorkCUw === grant.requestedWork && request.sharedAdapterMemory === undefined
          && actual.hardwareEffectiveCUw === grant.grantedWork && actual.physicalCUw === grant.physicalWork
          && actual.memoryMU === grant.memoryMU && actual.poolId === grant.poolId && staff === grant.staff,
        'Preparation work disagrees with its retained settled cost-accounting resource frame.');
      }
    } else check(work.completedWork === 0 && work.completedStaff === 0, 'Preparation progressed without an actual resource grant.');
    if (work.promotionCommandId !== null) {
      identifier(work.promotionCommandId, 'Promotion command');
      const receipt = state.commandReceipts[work.promotionCommandId];
      check(receipt?.status === 'accepted' && receipt.week === work.promotionWeek, 'Prepared handover has no accepted promotion command.');
      check(work.promotionWeek !== null && work.availableWeek !== null && work.promotionWeek >= work.availableWeek
        && work.cutoverWeek === work.promotionWeek + 1, 'Prepared handover skipped availability or its next cutover boundary.');
      past(work.promotionWeek!, 'Promotion week');
      if (work.status === 'scheduled') check(work.cutoverWeek === state.week + 1
        && state.scheduled.some(item => item.id === (rollback ? 'release-rollback:' : 'release-prepared:') + release.id
          && item.kind === 'model_release' && item.companyId === release.companyId
          && item.targetId === (rollback ? release.sourceModelId : release.candidateModelId) && item.dueWeek === work.cutoverWeek),
      'Scheduled prepared handover has no matching future model release.');
      else check(['released', 'complete', 'discarded'].includes(work.status) && work.cutoverWeek! <= state.week, 'A promotion receipt has no completed or cancelled boundary.');
      if (rollback) check(work.cutoverWeek! <= release.rollbackExpiresWeek!, 'Rollback handover exceeded the original retained-source deadline.');
    } else check(work.promotionWeek === null && work.cutoverWeek === null && !['scheduled', 'released', 'complete'].includes(work.status), 'Release switched without an explicit promotion.');
  };

  for (const [id, release] of Object.entries(projects)) {
    record(release, 'Prepared release'); identifier(id, 'Prepared release ID');
    check(id === release.id && id === 'prepared-release:' + release.startCommandId && !!company.companies[release.companyId], 'Prepared release identity or company is invalid.');
    const product = products.offers[release.productId];
    check(product && product.companyId === release.companyId, 'Prepared release refers to a missing or foreign public product.');
    countByProduct[release.productId] = (countByProduct[release.productId] ?? 0) + 1;
    check(countByProduct[release.productId] <= RULES.maximumRecordsPerProduct, 'Prepared release history exceeds its bound.');
    check(['preparing', 'ready', 'scheduled', 'released', 'discarded'].includes(release.status), 'Prepared release status is invalid.');
    identifier(release.rehearsalId, 'Prepared release rehearsal');
    const rehearsal = products.releaseRehearsals?.[release.rehearsalId];
    check(rehearsal && rehearsal.status === 'complete' && rehearsal.availableWeek !== null && rehearsal.availableWeek <= release.startedWeek
      && rehearsal.companyId === release.companyId && rehearsal.productId === release.productId && rehearsal.sourceDeploymentId === release.sourceDeployment.id
      && rehearsal.sourceModelId === release.sourceModelId && rehearsal.candidateModelId === release.candidateModelId
      && rehearsal.configurationFingerprint === release.configurationFingerprint, 'Prepared release lacks its matching completed and available rehearsal.');
    check(facilityRetrofitResearchReady(state, release.companyId, release.startedWeek), 'Prepared release predates Enterprise operations.');
    const source = release.sourceDeployment; record(source, 'Retained source deployment'); identifier(source.id, 'Retained source deployment ID');
    past(source.startedWeek, 'Retained source deployment start');
    for (const value of [source.requiredStaff, source.completedStaff, source.readyWeek]) checkedInteger(value!);
    note(source.lastBottleneck);
    check(source.scenarioStart === undefined || typeof source.scenarioStart === 'boolean', 'Retained source scenario provenance is invalid.');
    if (source.scenarioStart) check(source.companyId !== state.playerCompanyId && !!state.slices.markets.rivals[source.companyId]
      && source.startedWeek === 0 && source.readyWeek === 0 && source.requiredStaff === 0, 'Retained source invents an unpaid scenario deployment.');
    check(source.productId === release.productId && source.companyId === release.companyId && source.modelId === release.sourceModelId
      && source.status === 'active' && source.readyWeek !== null && source.readyWeek >= source.startedWeek && source.readyWeek <= release.startedWeek
      && source.completedStaff === source.requiredStaff && (source.scenarioStart || source.requiredStaff === content.firstSale.deploymentStaff),
    'Prepared release changed or invented the completed source deployment.');
    for (const modelId of [release.sourceModelId, release.candidateModelId]) {
      identifier(modelId, 'Prepared release model'); check(models.versions[modelId]?.companyId === release.companyId
        && inheritedModelRights(state, modelId, content).hosted, 'Prepared release refers to a foreign model or lacks hosted rights.');
    }
    check(release.sourceModelId !== release.candidateModelId && models.versions[release.sourceModelId].status === 'released', 'Prepared release requires distinct owned source and candidate models.');
    assertWork(release, release, false);
    if (release.status === 'released') {
      check(release.releasedWeek === release.cutoverWeek && release.releasedWeek !== null && release.candidateDeploymentId === 'prepared-deployment:' + id
        && release.rollbackExpiresWeek === release.releasedWeek + RULES.rollbackWeeks && typeof release.postCutoverFingerprint === 'string',
      'Released bundle changed its cutover, retained-source deadline, or candidate deployment identity.');
      past(release.releasedWeek!, 'Prepared release live week'); identifier(release.postCutoverFingerprint, 'Post-cutover configuration');
      check(models.versions[release.candidateModelId].status === 'released', 'Prepared handover exposes an unreleased candidate.');
    } else check(release.releasedWeek === null && release.candidateDeploymentId === null && release.rollbackExpiresWeek === null
      && release.postCutoverFingerprint === null && release.rollback === undefined, 'Unreleased preparation acquired a live deployment or rollback entitlement.');
    if (release.rollback !== undefined) {
      const rollback: ReleaseRollback = release.rollback; record(rollback, 'Release rollback');
      check(rollback.id === 'rollback:' + release.id && ['preparing', 'ready', 'scheduled', 'complete', 'discarded'].includes(rollback.status)
        && rollback.sourceDeploymentId === release.candidateDeploymentId && rollback.configurationFingerprint === release.postCutoverFingerprint,
      'Rollback changed its retained release identity or configuration.');
      check(rollback.startedWeek > release.releasedWeek! && rollback.startedWeek + 3 <= release.rollbackExpiresWeek!, 'Rollback started outside its original usable retention window.');
      assertWork(rollback, release, true);
      if (rollback.status === 'complete') check(rollback.restoredWeek === rollback.cutoverWeek && rollback.restoredDeploymentId === 'rollback-deployment:' + id,
        'Rollback completion has no matching restored deployment.');
      else check(rollback.restoredWeek === null && rollback.restoredDeploymentId === null, 'Unfinished rollback already changed the public product.');
      if (pending(rollback.status)) check(state.week <= release.rollbackExpiresWeek!, 'An expired rollback preparation remains active.');
    }
    if (pending(release.status) || release.rollback && pending(release.rollback.status)) {
      check(!pendingProducts.has(release.productId), 'A product has overlapping prepared releases.'); pendingProducts.add(release.productId);
      const sourceId = release.rollback && pending(release.rollback.status) ? release.candidateDeploymentId : source.id;
      check(product.deploymentId === sourceId && product.status !== 'deploying', 'Preparation replaced its live source before explicit cutover.');
    }
  }
  for (const deployment of Object.values(products.deployments)) if (deployment.id.startsWith('prepared-deployment:') || deployment.id.startsWith('rollback-deployment:')) {
    const rollback = deployment.id.startsWith('rollback-deployment:'), releaseId = deployment.id.slice((rollback ? 'rollback-deployment:' : 'prepared-deployment:').length), release = projects[releaseId];
    check(release && release.status === 'released' && (!rollback || release.rollback?.status === 'complete'), 'A prepared deployment has no completed paid release proof.');
    const work = rollback ? release.rollback! : release;
    check(deployment.productId === release.productId && deployment.companyId === release.companyId
      && deployment.modelId === (rollback ? release.sourceModelId : release.candidateModelId)
      && deployment.startedWeek === work.startedWeek && deployment.readyWeek === work.cutoverWeek
      && deployment.status === 'active' && deployment.requiredStaff === content.firstSale.deploymentStaff
      && deployment.completedStaff === content.firstSale.deploymentStaff, 'Prepared public deployment differs from its paid handover proof.');
  }
}
