import type { CommandQuote, DomainResult, GameCommand, GameContent, GameState, ModuleContext, ProductsSlice, Rejection, WorkRequest } from '../contracts/types';
import type { PreparedRelease, PreparedReleaseCommand, ReleasePreparationWork, ReleaseRollback } from '../contracts/wave9-releases';
import { CONTENT } from '../content/catalog';
import { PREPARED_RELEASE_RULES as RULES } from '../content/wave9-releases';
import { checkedAdd } from '../core/math';
import { modelExecutionHints } from './model-runtime';
import { getQualifiedReleaseRehearsal, releaseCandidateReason, releaseConfigurationFingerprint } from './release-rehearsals';

export const PREPARED_RELEASE_COMMANDS = ['start_prepared_release', 'set_prepared_release_paused', 'discard_prepared_release', 'promote_prepared_release', 'start_release_rollback'] as const;
const pendingStatuses = ['preparing', 'ready', 'scheduled'];
const configCommands = ['upgrade_product', 'set_product_features', 'set_product_strategy', 'set_consumer_sessions', 'set_product_terms', 'install_retrieval', 'install_product_efficiency', 'set_product_efficiency_enabled', 'install_runtime_guardrail', 'set_runtime_guardrail_enabled'];
const failure = (message: string, code: Rejection['code'] = 'NOT_READY'): Rejection => ({ code, message });
const isReleaseCommand = (command: GameCommand): command is GameCommand & { payload: PreparedReleaseCommand } => (PREPARED_RELEASE_COMMANDS as readonly string[]).includes(command.payload.kind);
const workFor = (release: PreparedRelease): ReleasePreparationWork & { status: string } => release.rollback && pendingStatuses.includes(release.rollback.status) ? release.rollback : release;
const isPending = (release: PreparedRelease): boolean => pendingStatuses.includes(release.status) || !!release.rollback && pendingStatuses.includes(release.rollback.status);

export function activePreparedRelease(state: Readonly<GameState>, productId: string): PreparedRelease | undefined {
  return Object.values(state.slices.products.preparedReleases ?? {}).find(release => release.productId === productId && isPending(release));
}

function commandProductId(state: Readonly<GameState>, command: GameCommand): string | undefined {
  const payload = command.payload;
  if ('productId' in payload) return payload.productId;
  if ('releaseId' in payload) return state.slices.products.preparedReleases?.[payload.releaseId]?.productId;
}

/** Product commands remain unchanged until a preparation is explicitly started or queued. */
export function preparedReleaseMutationReason(state: Readonly<GameState>, command: GameCommand): Rejection | undefined {
  if (!configCommands.includes(command.payload.kind)) return;
  const productId = commandProductId(state, command);
  if (!productId) return;
  const queued = state.queuedCommands.some(item => item.id !== command.id && item.companyId === command.companyId
    && ['start_prepared_release', 'start_release_rollback', 'promote_prepared_release'].includes(item.payload.kind)
    && commandProductId(state, item) === productId);
  if (activePreparedRelease(state, productId) || queued) return failure('Finish or discard this product’s prepared release before changing its model, terms, features, session history, retrieval, efficiency, or runtime guardrail settings.');
}

function queuedConflict(state: Readonly<GameState>, command: GameCommand, productId: string): boolean {
  return state.queuedCommands.some(item => item.id !== command.id && item.companyId === command.companyId
    && [...configCommands, ...PREPARED_RELEASE_COMMANDS].includes(item.payload.kind)
    && commandProductId(state, item) === productId);
}

function pendingInstallation(state: Readonly<GameState>, productId: string): boolean {
  return Object.values(state.slices.products.retrievalInstalls).some(item => item.productId === productId && item.status !== 'active')
    || Object.values(state.slices.products.efficiencyInstalls).some(item => item.productId === productId && item.status !== 'active')
    || Object.values(state.slices.products.runtimeGuardrails ?? {}).some(item => item.productId === productId && item.status !== 'active');
}

export function releasePreparationMemory(state: Readonly<GameState>, productId: string, modelId: string): number {
  const product = state.slices.products.offers[productId], model = state.slices.models.versions[modelId];
  return checkedAdd(model.residentMU, product.features?.extendedContext ? RULES.longSessionMemory : RULES.normalSessionMemory);
}

function sourceReason(state: Readonly<GameState>, release: PreparedRelease, rollback: boolean, content: GameContent): Rejection | undefined {
  const product = state.slices.products.offers[release.productId], deployment = product && state.slices.products.deployments[product.deploymentId];
  const expectedDeployment = rollback ? release.candidateDeploymentId : release.sourceDeployment.id;
  const expectedModel = rollback ? release.candidateModelId : release.sourceModelId;
  const expectedFingerprint = rollback ? release.postCutoverFingerprint : release.configurationFingerprint;
  if (!product || product.companyId !== release.companyId || product.status === 'deploying' || !deployment
    || deployment.id !== expectedDeployment || deployment.modelId !== expectedModel) return failure('The live source deployment changed. Discard this preparation and rehearse the new source.');
  if (releaseConfigurationFingerprint(state, product.id) !== expectedFingerprint) return failure('The product configuration changed. This stored release proof is stale.');
  return releaseCandidateReason(state, release.companyId, release.productId, rollback ? release.sourceModelId : release.candidateModelId, content);
}

export function preparedReleaseReadinessReason(state: Readonly<GameState>, release: PreparedRelease, content: GameContent = CONTENT): Rejection | undefined {
  const rollback = !!release.rollback && pendingStatuses.includes(release.rollback.status), work = workFor(release);
  if (work.status !== 'ready' || work.availableWeek === null || work.availableWeek > state.week) return failure('Finish the paid preparation and wait for its availability boundary before choosing a handover.');
  return sourceReason(state, release, rollback, content);
}

export function releaseRollbackReason(state: Readonly<GameState>, release: PreparedRelease, content: GameContent = CONTENT, startWeek = state.week + 1): Rejection | undefined {
  if (release.status !== 'released' || release.releasedWeek === null || release.rollbackExpiresWeek === null) return failure('Complete the forward release before preparing its rollback.');
  if (release.rollback) return failure('This release has already used its one rollback preparation.', 'ALREADY_ACTIVE');
  if (startWeek + 3 > release.rollbackExpiresWeek) return failure('The retained source expires before another paid rollback can be prepared and handed over.');
  return sourceReason(state, release, true, content);
}

export function validatePreparedRelease(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): Rejection | undefined {
  if (!isReleaseCommand(command)) return failure('Choose a release operation.', 'INVALID_COMMAND');
  const payload = command.payload;
  if (!(state.slices.research.completedByCompany[command.companyId] ?? []).includes(RULES.requiredResearch)) return failure('Research Enterprise operations (R12) before preparing a staged release.');
  if (payload.kind === 'start_prepared_release') {
    const product = state.slices.products.offers[payload.productId];
    if (!product || product.companyId !== command.companyId) return failure('Choose this company’s public product.', 'INVALID_COMMAND');
    if (activePreparedRelease(state, product.id) || queuedConflict(state, command, product.id)) return failure('This product already has pending release work or a conflicting queued change.', 'ALREADY_ACTIVE');
    if (Object.values(state.slices.products.preparedReleases ?? {}).filter(item => item.productId === product.id).length >= RULES.maximumRecordsPerProduct) return failure('This product has reached its saved prepared-release limit. Direct model replacement remains available.', 'CAPACITY_EXCEEDED');
    if (pendingInstallation(state, product.id)) return failure('Finish the product’s retrieval, efficiency, and runtime guardrail installations before freezing a release configuration.');
    const candidateReason = releaseCandidateReason(state, command.companyId, product.id, payload.candidateModelId, content);
    if (candidateReason) return candidateReason;
    if (!getQualifiedReleaseRehearsal(state, product.id, payload.candidateModelId, content)) return failure('Complete a matching paid rehearsal of this live source, candidate, and product configuration first.');
    return;
  }
  const release = state.slices.products.preparedReleases?.[payload.releaseId];
  if (!release || release.companyId !== command.companyId) return failure('Choose this company’s saved prepared release.', 'INVALID_COMMAND');
  if (queuedConflict(state, command, release.productId)) return failure('Apply this product’s pending release command before queuing another.', 'ALREADY_ACTIVE');
  const work = workFor(release);
  if (payload.kind === 'set_prepared_release_paused') {
    if (typeof payload.paused !== 'boolean') return failure('Choose whether to pause preparation.', 'INVALID_COMMAND');
    if (work.status !== 'preparing') return failure('Only unfinished paid preparation can be paused.');
  } else if (payload.kind === 'discard_prepared_release') {
    if (!['preparing', 'ready'].includes(work.status)) return failure('Only an unfinished or ready preparation can be discarded. A scheduled handover is already committed.');
  } else if (payload.kind === 'promote_prepared_release') {
    const reason = preparedReleaseReadinessReason(state, release, content); if (reason) return reason;
    if (release.rollback && pendingStatuses.includes(release.rollback.status)
      && Math.max(state.week, command.issuedForWeek) + 1 > release.rollbackExpiresWeek!) return failure('The queued handover would occur after the retained rollback source expires.');
  } else if (payload.kind === 'start_release_rollback') {
    if (activePreparedRelease(state, release.productId)) return failure('Finish or discard the current preparation before using retained rollback.', 'ALREADY_ACTIVE');
    if (pendingInstallation(state, release.productId)) return failure('Finish product installations before freezing a rollback configuration.');
    const reason = releaseRollbackReason(state, release, content, Math.max(state.week, command.issuedForWeek)); if (reason) return reason;
  }
}

export function quotePreparedRelease(state: Readonly<GameState>, command: GameCommand): CommandQuote {
  const payload = command.payload;
  const summary = payload.kind === 'start_prepared_release' ? `Prepare a release bundle with 2 development CUw and ${usesWorkPointProfiles(state) ? '40 Design points' : '2 ML staff-weeks'} while the current product keeps serving. This reserves no future serving capacity.`
    : payload.kind === 'start_release_rollback' ? `Prepare the retained source with 1 development CUw and ${usesWorkPointProfiles(state) ? '20 Design points' : '1 ML staff-week'}. Its original six-week rollback deadline stays fixed.`
      : payload.kind === 'promote_prepared_release' ? `Queue handover for Week ${Math.max(state.week, command.issuedForWeek) + 1}. The current model keeps serving until that boundary; normal serving capacity and billing still apply.`
        : payload.kind === 'discard_prepared_release' ? 'Discard this preparation and unlock product changes. Already spent staff and compute are retained in its history.'
          : payload.kind === 'set_prepared_release_paused' && payload.paused ? 'Pause paid preparation; keep the current serving model and all completed work.' : 'Resume paid preparation using the next available ML and development grants.';
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary };
}

function newWork(state: Readonly<GameState>, productId: string, modelId: string, rollback: boolean, commandId: string): ReleasePreparationWork {
  return { startCommandId: commandId, startedWeek: state.week, requiredWork: rollback ? RULES.rollbackWork : RULES.forwardWork, completedWork: 0, physicalWork: 0,
    requiredStaff: rollback ? RULES.rollbackStaff : RULES.forwardStaff, completedStaff: 0, requiredMemory: releasePreparationMemory(state, productId, modelId),
    paused: false, completedWeek: null, availableWeek: null, promotionCommandId: null, promotionWeek: null, cutoverWeek: null,
    lastProgress: 0, lastBottleneck: 'Waiting for ML staff and connected development compute.', lastGrant: null };
}

export function applyPreparedRelease(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): DomainResult {
  if (!isReleaseCommand(command)) return {};
  const products = structuredClone(state.slices.products), payload = command.payload, schedule: NonNullable<DomainResult['schedule']> = [];
  products.preparedReleases ??= {};
  if (payload.kind === 'start_prepared_release') {
    const product = products.offers[payload.productId], rehearsal = getQualifiedReleaseRehearsal(state, product.id, payload.candidateModelId, content)!;
    const sourceDeployment = structuredClone(products.deployments[product.deploymentId]), id = 'prepared-release:' + command.id;
    products.preparedReleases[id] = { ...newWork(state, product.id, payload.candidateModelId, false, command.id), id, companyId: command.companyId,
      productId: product.id, rehearsalId: rehearsal.id, sourceDeployment, sourceModelId: sourceDeployment.modelId,
      candidateModelId: payload.candidateModelId, configurationFingerprint: releaseConfigurationFingerprint(state, product.id), status: 'preparing',
      candidateDeploymentId: null, releasedWeek: null, postCutoverFingerprint: null, rollbackExpiresWeek: null };
  } else {
    const release = products.preparedReleases[payload.releaseId];
    if (payload.kind === 'start_release_rollback') release.rollback = { ...newWork(state, release.productId, release.sourceModelId, true, command.id),
      id: 'rollback:' + release.id, status: 'preparing', sourceDeploymentId: release.candidateDeploymentId!,
      configurationFingerprint: releaseConfigurationFingerprint(state, release.productId), restoredDeploymentId: null, restoredWeek: null };
    else {
      const work = workFor(release), rollback = work !== release;
      if (payload.kind === 'set_prepared_release_paused') { work.paused = payload.paused; work.lastProgress = 0; work.lastBottleneck = payload.paused ? 'Preparation paused; live service continues.' : 'Waiting for ML staff and connected development compute.'; }
      else if (payload.kind === 'discard_prepared_release') { work.status = 'discarded'; work.paused = false; work.lastProgress = 0; work.lastBottleneck = 'Discarded; previous work was spent and the live product was unchanged.'; }
      else if (payload.kind === 'promote_prepared_release') {
        work.status = 'scheduled'; work.promotionCommandId = command.id; work.promotionWeek = state.week; work.cutoverWeek = state.week + 1; work.lastBottleneck = '';
        schedule.push({ id: (rollback ? 'release-rollback:' : 'release-prepared:') + release.id, companyId: release.companyId,
          kind: 'model_release', targetId: rollback ? release.sourceModelId : release.candidateModelId, dueWeek: work.cutoverWeek });
      }
    }
  }
  return { updates: { products }, ...(schedule.length ? { schedule } : {}), messages: [{ category: 'project', companyId: command.companyId, message: quotePreparedRelease(state, command).summary }] };
}

export function preparedReleaseRequests(state: Readonly<GameState>, _content: GameContent = CONTENT): WorkRequest[] {
  const requests: WorkRequest[] = [];
  for (const release of Object.values(state.slices.products.preparedReleases ?? {})) {
    const work = workFor(release); if (work.status !== 'preparing' || work.paused || state.slices.company.companies[release.companyId].arrearsCents) continue;
    const rollback = work !== release, model = state.slices.models.versions[rollback ? release.sourceModelId : release.candidateModelId];
    const remainingWork = work.requiredWork - work.completedWork;
    requests.push({ id: (rollback ? 'rollback-work:' : 'release-work:') + release.id, companyId: release.companyId, taskId: release.id,
      category: 'development', normalizedWorkCUw: Math.min(RULES.weeklyWork, remainingWork), memoryMU: remainingWork > 0 ? work.requiredMemory : 0,
      ...modelExecutionHints(model), priority: RULES.requestPriority, poolId: 'auto',
      staffDemand: [{ role: 'ml', staffWeeks: Math.min(RULES.weeklyStaff, work.requiredStaff - work.completedStaff) }] });
  }
  return requests;
}

export function advancePreparedReleases(products: ProductsSlice, ctx: ModuleContext): void {
  for (const release of Object.values(products.preparedReleases ?? {})) {
    const work = workFor(release); if (work.status !== 'preparing' || work.paused) continue;
    const requestId = (work !== release ? 'rollback-work:' : 'release-work:') + release.id;
    if (!ctx.resources.requests.some(item => item.id === requestId)) {
      work.lastProgress = 0; work.lastBottleneck = 'No preparation request was admitted this week; completed work is preserved.'; continue;
    }
    const grant = ctx.resources.computeGrants.find(item => item.requestId === requestId);
    const staff = ctx.resources.staffGrants.find(item => item.requestId === requestId)?.grants.find(item => item.role === 'ml')?.staffWeeks ?? 0;
    const performed = Math.min(work.requiredWork - work.completedWork, grant?.hardwareEffectiveCUw ?? 0);
    work.lastGrant = { week: ctx.week, requestedWork: Math.min(RULES.weeklyWork, work.requiredWork - work.completedWork),
      grantedWork: performed, physicalWork: grant?.physicalCUw ?? 0, memoryMU: grant?.memoryMU ?? 0, poolId: grant?.poolId ?? 'general-cloud', staff };
    work.completedWork = checkedAdd(work.completedWork, performed); work.physicalWork = checkedAdd(work.physicalWork, grant?.physicalCUw ?? 0);
    work.completedStaff = Math.min(work.requiredStaff, checkedAdd(work.completedStaff, staff)); work.lastProgress = performed;
    work.lastBottleneck = work.completedStaff < work.requiredStaff && staff === 0 ? 'The release bundle is waiting for Design points.'
      : work.completedWork < work.requiredWork && performed === 0 ? 'Allocate development compute with enough connected, compatible memory. Live serving keeps its normal priority.' : '';
  }
}

export function resolvePreparedReleases(products: ProductsSlice, ctx: ModuleContext): void {
  for (const release of Object.values(products.preparedReleases ?? {})) {
    const work = workFor(release);
    if (work.status === 'preparing' && work.completedWork === work.requiredWork && work.completedStaff === work.requiredStaff) {
      work.status = 'ready'; work.paused = false; work.completedWeek = ctx.week; work.availableWeek = ctx.week + 1; work.lastBottleneck = '';
    }
  }
}

function clearProductCache(products: ProductsSlice, productId: string): void {
  for (const install of Object.values(products.efficiencyInstalls)) if (install.productId === productId && install.kind === 'prefix-cache') {
    delete install.cacheKey; delete install.warmedWeek; delete install.lastServedWeek;
  }
}

/** Called after model-owner commit, before this week's customer work is requested. */
export function commitPreparedReleases(state: Readonly<GameState>, products: ProductsSlice, ctx: ModuleContext): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const release of Object.values(products.preparedReleases ?? {})) {
    const work = workFor(release), rollback = work !== release;
    if (rollback && ['preparing', 'ready'].includes(work.status) && release.rollbackExpiresWeek! < ctx.week) {
      work.status = 'discarded'; work.paused = false; work.lastProgress = 0; work.lastBottleneck = 'The retained rollback source expired; spent preparation remains recorded.';
      messages.push({ category: 'project', companyId: release.companyId, message: 'Rollback window expired. The current product keeps its serving model.' });
      continue;
    }
    if (work.status !== 'scheduled' || work.cutoverWeek !== ctx.week) continue;
    const committing = { ...state, slices: { ...state.slices, products } }, reason = sourceReason(committing, release, rollback, ctx.content);
    if (reason) {
      work.status = 'discarded'; work.lastBottleneck = reason.message;
      messages.push({ category: 'project', companyId: release.companyId, message: 'Prepared handover stopped: ' + reason.message }); continue;
    }
    const product = products.offers[release.productId], modelId = rollback ? release.sourceModelId : release.candidateModelId;
    const deploymentId = (rollback ? 'rollback-deployment:' : 'prepared-deployment:') + release.id;
    delete products.deployments[product.deploymentId];
    products.deployments[deploymentId] = { id: deploymentId, companyId: release.companyId, productId: product.id, modelId, status: 'active',
      startedWeek: work.startedWeek, requiredStaff: ctx.content.firstSale.deploymentStaff, completedStaff: ctx.content.firstSale.deploymentStaff,
      readyWeek: ctx.week, lastBottleneck: '' };
    product.deploymentId = deploymentId; product.publicModelId = modelId; clearProductCache(products, product.id);
    if (rollback) {
      const rollbackWork = work as ReleaseRollback; rollbackWork.status = 'complete'; rollbackWork.restoredDeploymentId = deploymentId; rollbackWork.restoredWeek = ctx.week;
    } else {
      release.status = 'released'; release.candidateDeploymentId = deploymentId; release.releasedWeek = ctx.week;
      release.rollbackExpiresWeek = ctx.week + RULES.rollbackWeeks;
      release.postCutoverFingerprint = releaseConfigurationFingerprint({ ...state, slices: { ...state.slices, products } }, product.id);
    }
    messages.push({ category: 'delivery', companyId: release.companyId, message: `${product.name} ${rollback ? 'returned to its retained source' : 'handed over to its prepared model'}. Existing accounts and billing continue; normal resource limits apply.` });
  }
  return messages;
}

export function getPreparedReleaseView(state: GameState, productId: string, content: GameContent = CONTENT) {
  const releases = Object.values(state.slices.products.preparedReleases ?? {}).filter(item => item.productId === productId).sort((a, b) => b.startedWeek - a.startedWeek || b.id.localeCompare(a.id));
  const current = activePreparedRelease(state, productId);
  const candidates = Object.values(state.slices.models.versions).filter(model => !!getQualifiedReleaseRehearsal(state, productId, model.id, content));
  const retained = releases.find(item => item.status === 'released' && !releaseRollbackReason(state, item, content));
  return { releases, current, work: current ? workFor(current) : null, candidates, retained,
    researched: (state.slices.research.completedByCompany[state.playerCompanyId] ?? []).includes(RULES.requiredResearch) };
}
import { usesWorkPointProfiles } from './workforce';
