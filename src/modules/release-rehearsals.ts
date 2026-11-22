import { facilityTariffBinding, facilityTariffIdentity } from './facility-tariffs';
import { policyReleaseRejection } from './policy-holdouts';
import { CONTENT } from '../content/catalog';
import { DEFAULT_FEATURES } from '../content/wave2-market';
import { RELEASE_REHEARSAL_RULES as RULES } from '../content/wave9-rehearsals';
import type { CommandQuote, DomainResult, EvaluationReport, GameCommand, GameContent, GameState, ModelVersion, ModuleContext, ProductsSlice, Rejection, WorkRequest } from '../contracts/types';
import type { ReleaseConfiguration, ReleaseRehearsal, ReleaseRehearsalArm, ReleaseRehearsalOutcomes, RehearsalWorkReceipt } from '../contracts/wave9-rehearsals';
import { canonicalStateHash, hashText } from '../core/canonical';
import { checkedAdd, checkedInteger, formatUnits } from '../core/math';
import { getCompatibleComputePools, getComputePools, getPoolWorkCostRate, getPoolMultiplierBps, usesCrossRackTraining } from './compute-pools';
import { isCapabilitySuite } from './evaluation-classification';
import { facilityRetrofitResearchReady } from './facility-retrofits';
import { BASE_BEHAVIOR } from './lab-planner';
import { inheritedModelRights, modelExecutionHints, modelWorkBps } from './model-runtime';
import { behaviorMeter, eligibleModel, executionErrorBps, requestMeter, segmentForProduct } from './product-models';
import { releaseGuardrailConfiguration } from './runtime-guardrails';
import { productRoutingPolicy } from './product-strategy';

export const RELEASE_REHEARSAL_COMMANDS = ['start_release_rehearsal', 'set_release_rehearsal_paused'] as const;
const reject = (code: Rejection['code'], message: string): Rejection => ({ code, message });
const records = (products: Readonly<ProductsSlice>): ReleaseRehearsal[] => Object.values(products.releaseRehearsals ?? {});
export const releaseRehearsalWorkId = (id: string, arm: 'source' | 'candidate' | 'review') => `rehearsal:${id}:${arm}`;

export function releaseModelFingerprint(model: ModelVersion): string {
  return canonicalStateHash({ id: model.id, companyId: model.companyId, family: model.family, architecture: model.architecture,
    capabilityBps: model.capabilityBps, reliabilityBps: model.reliabilityBps, residentMU: model.residentMU,
    behavior: model.behavior ?? BASE_BEHAVIOR, workBps: modelWorkBps(model), ...(model.policy ? { policy: model.policy } : {}) });
}

export function releaseConfiguration(state: Readonly<GameState>, productId: string): ReleaseConfiguration {
  const product = state.slices.products.offers[productId];
  if (!product) throw new Error('A release comparison needs an existing product.');
  const retrieval = state.slices.products.retrievalInstalls?.[productId];
  const modelId = state.slices.products.deployments[product.deploymentId]?.modelId;
  const guardrail = releaseGuardrailConfiguration(state, productId);
  return { productKind: product.kind, features: { ...(product.features ?? DEFAULT_FEATURES) }, contractId: product.contractId,
    ...(productRoutingPolicy(product) !== 'balanced' ? { routingPolicy: productRoutingPolicy(product) } : {}),
    ...(guardrail ? { guardrail } : {}),
    allowance: state.slices.products.contracts[product.contractId].allowance,
    retrieval: retrieval?.status === 'active' ? { id: retrieval.id, packetId: retrieval.evidence.packetId, readyWeek: retrieval.readyWeek } : null,
    efficiency: Object.values(state.slices.products.efficiencyInstalls ?? {}).filter(item => item.productId === productId
      && item.status === 'active' && item.modelId === modelId).map(item => ({ id: item.id, kind: item.kind,
      modelId: item.modelId, secondaryModelId: item.secondaryModelId ?? null, retrievalId: item.retrievalId ?? null,
      ...(item.kind === 'routing' && (item.routingProtocol === 2 || product.strategy) ? { routingProtocol: 2 as const } : {}),
      evidencePacketId: item.evidencePacketId ?? null, enabled: item.enabled, readyWeek: item.readyWeek })).sort((a, b) => a.id.localeCompare(b.id)) };
}

export function releaseConfigurationFingerprint(state: Readonly<GameState>, productId: string): string {
  return canonicalStateHash(releaseConfiguration(state, productId));
}

export function rehearsalCapabilityReport(state: Readonly<GameState>, modelId: string, atWeek = state.week): EvaluationReport | undefined {
  const model = state.slices.models.versions[modelId];
  if (!model || model.status === 'checkpoint') return;
  return Object.values(state.slices.models.reports).filter(report => report.modelId === model.id && report.companyId === model.companyId
    && report.heldOut && isCapabilitySuite(report.suiteId) && report.week <= atWeek
    && canonicalStateHash(report.capabilityBps) === canonicalStateHash(model.capabilityBps) && report.reliabilityBps === model.reliabilityBps)
    .sort((a, b) => b.week - a.week || a.id.localeCompare(b.id))[0];
}

/** Normal product gates are repeated for the exact candidate; a rehearsal cannot confer release rights. */
export function releaseCandidateReason(state: Readonly<GameState>, companyId: string, productId: string, candidateId: string, content: GameContent = CONTENT): Rejection | undefined {
  const policyRejection = policyReleaseRejection(state, candidateId); if (policyRejection) return policyRejection;
  const company = state.slices.company.companies[companyId], product = state.slices.products.offers[productId];
  if (!company) return reject('UNKNOWN_COMPANY', 'This company does not exist.');
  if (company.arrearsCents > 0) return reject('ARREARS', 'Resolve unpaid bills before starting release work.');
  if (!facilityRetrofitResearchReady(state, companyId)) return reject('NOT_READY', 'Research Enterprise operations (R12) to compare and prepare model releases.');
  if (!product || product.companyId !== companyId || product.status === 'deploying') return reject('NOT_READY', 'Choose one of your deployed products, active or paused.');
  const deployment = state.slices.products.deployments[product.deploymentId], candidate = state.slices.models.versions[candidateId];
  if (!deployment || deployment.status !== 'active') return reject('NOT_READY', 'Finish the current product deployment first.');
  if (deployment.modelId === candidateId) return reject('NO_IMPROVEMENT', 'This product already uses the selected model.');
  if (!candidate || candidate.companyId !== companyId || !eligibleModel(state, candidateId, companyId, product.kind)
    || !rehearsalCapabilityReport(state, candidateId)) return reject('NOT_READY', 'Evaluate this exact candidate on a held-out capability suite and meet this product’s release thresholds first.');
  if (!inheritedModelRights(state, candidateId, content).hosted) return reject('NOT_READY', 'This candidate’s training evidence does not permit hosted commercial use.');
  const memory = checkedAdd(candidate.residentMU, requestMeter(candidate, product.features ?? DEFAULT_FEATURES).sessionMemory);
  if (!getCompatibleComputePools(state, companyId, modelExecutionHints(candidate), content).some(pool => pool.memoryMU >= memory)) {
    return reject('MISSING_MEMORY', 'Provide an inference-compatible connected pool for the candidate’s full resident model and session workspace. Sparse models require fast fabric.');
  }
}

export function rehearsalEvidenceKey(state: Readonly<GameState>, companyId: string, kind: ReleaseConfiguration['productKind']): string {
  return canonicalStateHash({ protocol: RULES.protocol, seed: state.seed, companyId, productKind: kind });
}

/** Derived reserved cases are identical across commands, weeks, names, and candidates. */
export function releaseRehearsalOutcomes(model: ModelVersion, configuration: ReleaseConfiguration, evidenceKey: string): ReleaseRehearsalOutcomes {
  const segments = segmentForProduct(configuration.productKind);
  const result: ReleaseRehearsalOutcomes = { cases: RULES.cases, useful: 0, confidentError: 0, falseRefusal: 0, clarification: 0, technicalErrorBps: 0 };
  let technicalTotal = 0;
  for (let index = 0; index < RULES.cases; index++) {
    const segment = configuration.productKind === 'basic-chat' ? segments[index % segments.length] : segments[0];
    const technicalError = executionErrorBps(model, segment, configuration.features), behavior = behaviorMeter(model, technicalError);
    const falseRefusal = Math.min(10000 - technicalError, behavior.falseRefusalBps), useful = 10000 - technicalError - falseRefusal;
    const draw = parseInt(hashText(`${evidenceKey}:case:${index + 1}`), 16) % 10000;
    if (draw < useful) result.useful += 1;
    else if (draw < useful + falseRefusal) result.falseRefusal += 1;
    else if (draw < useful + falseRefusal + behavior.confidentErrorBps) result.confidentError += 1;
    else result.clarification += 1;
    technicalTotal += technicalError;
  }
  result.technicalErrorBps = Math.floor(technicalTotal / RULES.cases);
  return result;
}

function currentBinding(state: Readonly<GameState>, rehearsal: ReleaseRehearsal): boolean {
  const product = state.slices.products.offers[rehearsal.productId];
  return !!product && product.companyId === rehearsal.companyId && product.deploymentId === rehearsal.sourceDeploymentId
    && state.slices.products.deployments[product.deploymentId]?.modelId === rehearsal.sourceModelId
    && releaseConfigurationFingerprint(state, product.id) === rehearsal.configurationFingerprint;
}

export function getQualifiedReleaseRehearsal(state: Readonly<GameState>, productId: string, candidateId: string, content: GameContent = CONTENT): ReleaseRehearsal | undefined {
  const product = state.slices.products.offers[productId];
  if (!product || releaseCandidateReason(state, product.companyId, productId, candidateId, content)) return;
  return records(state.slices.products).filter(item => item.productId === productId && item.candidateModelId === candidateId
    && item.status === 'complete' && item.availableWeek !== null && item.availableWeek <= state.week && currentBinding(state, item)
    && item.arms.candidate.modelFingerprint === releaseModelFingerprint(state.slices.models.versions[candidateId]))
    .sort((a, b) => b.startedWeek - a.startedWeek || a.id.localeCompare(b.id))[0];
}

function prunableRehearsals(state: Readonly<GameState>): ReleaseRehearsal[] {
  const references = new Set(Object.values(state.slices.products.preparedReleases ?? {}).map(item => item.rehearsalId));
  return records(state.slices.products).filter(item => item.status === 'complete' && !references.has(item.id) && !currentBinding(state, item))
    .sort((a, b) => a.startedWeek - b.startedWeek || a.id.localeCompare(b.id));
}

function pruneIdsFor(state: Readonly<GameState>, productId: string): string[] | null {
  let total = records(state.slices.products).length, productCount = records(state.slices.products).filter(item => item.productId === productId).length;
  const ids: string[] = [];
  for (const item of prunableRehearsals(state)) {
    if (total < RULES.maximumHistory && productCount < RULES.maximumPerProduct) break;
    if (productCount >= RULES.maximumPerProduct && item.productId !== productId) continue;
    ids.push(item.id); total -= 1; if (item.productId === productId) productCount -= 1;
  }
  return total < RULES.maximumHistory && productCount < RULES.maximumPerProduct ? ids : null;
}

export function validateReleaseRehearsalCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): Rejection | undefined {
  const p = command.payload;
  if (p.kind === 'start_release_rehearsal') {
    const reason = releaseCandidateReason(state, command.companyId, p.productId, p.candidateModelId, content); if (reason) return reason;
    const product = state.slices.products.offers[p.productId], deployment = state.slices.products.deployments[product.deploymentId];
    const source = state.slices.models.versions[deployment.modelId];
    if (!rehearsalCapabilityReport(state, source.id) || !inheritedModelRights(state, source.id, content).hosted) return reject('NOT_READY', 'The current model also needs its own held-out capability report and hosted rights.');
    const sourceMemory = source.residentMU + requestMeter(source, product.features ?? DEFAULT_FEATURES).sessionMemory;
    if (!getCompatibleComputePools(state, command.companyId, modelExecutionHints(source), content).some(pool => pool.memoryMU >= sourceMemory)) return reject('MISSING_MEMORY', 'Provide a connected pool for the current model’s separate rehearsal copy and session workspace.');
    if (records(state.slices.products).some(item => item.productId === product.id && (item.status !== 'complete'
      || (item.candidateModelId === p.candidateModelId && currentBinding(state, item))))
      || state.queuedCommands.some(item => item.id !== command.id && item.payload.kind === 'start_release_rehearsal' && item.payload.productId === product.id)) {
      return reject('ALREADY_ACTIVE', 'This product already has a running comparison or completed evidence for this candidate and configuration. Resume or use that evidence.');
    }
    if (!pruneIdsFor(state, product.id)) return reject('CAPACITY_EXCEEDED', 'The bounded rehearsal history is full. Finish current work or use existing evidence; only stale completed comparisons with no release reference can be replaced.');
    return;
  }
  if (p.kind === 'set_release_rehearsal_paused') {
    const rehearsal = state.slices.products.releaseRehearsals?.[p.rehearsalId];
    if (!rehearsal || rehearsal.companyId !== command.companyId) return reject('NOT_READY', 'Choose one of your release rehearsals.');
    if (rehearsal.status !== 'running') return reject('NO_IMPROVEMENT', 'This comparison has finished its work.');
    if (typeof p.paused !== 'boolean') return reject('INVALID_COMMAND', 'Choose whether rehearsal work is paused.');
    if (rehearsal.paused === p.paused) return reject('ALREADY_ACTIVE', p.paused ? 'This rehearsal is already paused.' : 'This rehearsal is already running.');
    return;
  }
  return reject('INVALID_COMMAND', 'This is not a release rehearsal command.');
}

export function quoteReleaseRehearsalCommand(state: Readonly<GameState>, command: GameCommand, _content: GameContent = CONTENT): CommandQuote {
  const p = command.payload;
  if (p.kind === 'start_release_rehearsal') {
    const product = state.slices.products.offers[p.productId], features = product.features ?? DEFAULT_FEATURES;
    const source = state.slices.models.versions[state.slices.products.deployments[product.deploymentId].modelId], candidate = state.slices.models.versions[p.candidateModelId];
    const work = (model: ModelVersion) => requestMeter(model, features).work * RULES.cases * RULES.exchangesPerCase;
    return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: `Compare 10,000 standard exchanges per model: ${formatUnits(work(source))} source + ${formatUnits(work(candidate))} candidate development CUw and ${usesWorkPointProfiles(state) ? '20 Design points' : '1 ML staff-week'}. Each arm needs its own resident model and session memory. Existing customers continue; actual hardware work uses the ordinary compute bill. Results become available at the following weekly boundary.` };
  }
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: p.kind === 'set_release_rehearsal_paused' && p.paused
    ? 'Pause both comparison arms and review work next week; paid progress remains.' : 'Resume the remaining comparison and review work next week.' };
}

function newArm(state: Readonly<GameState>, modelId: string, configuration: ReleaseConfiguration): ReleaseRehearsalArm {
  const model = state.slices.models.versions[modelId], meter = requestMeter(model, configuration.features);
  return { modelId, modelFingerprint: releaseModelFingerprint(model), capabilityReportId: rehearsalCapabilityReport(state, modelId)!.id,
    requiredWork: checkedInteger(meter.work * RULES.cases * RULES.exchangesPerCase), completedWork: 0,
    memoryMU: checkedAdd(model.residentMU, meter.sessionMemory), physicalWork: 0, workReceipts: {}, latestGrant: null, outcomes: null };
}

export function applyReleaseRehearsalCommand(state: Readonly<GameState>, command: GameCommand, _content: GameContent = CONTENT): DomainResult {
  const products = structuredClone(state.slices.products), p = command.payload;
  let message = '';
  if (p.kind === 'start_release_rehearsal') {
    const product = products.offers[p.productId], configuration = releaseConfiguration(state, product.id);
    const sourceModelId = products.deployments[product.deploymentId].modelId, id = `release-rehearsal:${command.id}`;
    products.releaseRehearsals ??= {};
    for (const expired of pruneIdsFor(state, product.id) ?? []) delete products.releaseRehearsals[expired];
    products.releaseRehearsals[id] = { id, companyId: command.companyId, productId: product.id, protocol: RULES.protocol,
      sourceDeploymentId: product.deploymentId, sourceModelId, candidateModelId: p.candidateModelId,
      configuration, configurationFingerprint: canonicalStateHash(configuration), evidenceKey: rehearsalEvidenceKey(state, command.companyId, product.kind),
      status: 'running', paused: false, startedWeek: state.week, completedWeek: null, availableWeek: null,
      requiredStaff: RULES.reviewStaff, completedStaff: 0, lastStaffWeek: null, latestReview: null,
      arms: { source: newArm(state, sourceModelId, configuration), candidate: newArm(state, p.candidateModelId, configuration) },
      lastBottleneck: 'The review uses development compute and Design points. Ordinary serving has priority.' };
    message = 'Release comparison queued against the same reserved cases. Customer service and billing continue on the current model.';
  } else if (p.kind === 'set_release_rehearsal_paused') {
    const rehearsal = products.releaseRehearsals![p.rehearsalId]; rehearsal.paused = p.paused;
    rehearsal.lastBottleneck = p.paused ? 'Rehearsal paused; all paid progress is retained.' : 'Rehearsal resumed.';
    message = `Release rehearsal ${p.paused ? 'paused' : 'resumed'}.`;
  }
  return { updates: { products }, messages: [{ companyId: command.companyId, category: 'project', message }] };
}

export function releaseRehearsalRequests(state: Readonly<GameState>, _content: GameContent = CONTENT): WorkRequest[] {
  const requests: WorkRequest[] = [];
  for (const rehearsal of records(state.slices.products)) {
    if (rehearsal.status !== 'running' || rehearsal.paused || state.slices.company.companies[rehearsal.companyId].arrearsCents) continue;
    for (const name of ['source', 'candidate'] as const) {
      const arm = rehearsal.arms[name]; if (arm.completedWork === arm.requiredWork) continue;
      requests.push({ id: releaseRehearsalWorkId(rehearsal.id, name), companyId: rehearsal.companyId, taskId: rehearsal.id,
        category: 'development', normalizedWorkCUw: arm.requiredWork - arm.completedWork, memoryMU: arm.memoryMU,
        priority: RULES.requestPriority, poolId: 'auto', ...modelExecutionHints(state.slices.models.versions[arm.modelId]) });
    }
    if (rehearsal.completedStaff < rehearsal.requiredStaff) requests.push({ id: releaseRehearsalWorkId(rehearsal.id, 'review'), companyId: rehearsal.companyId,
      taskId: rehearsal.id, category: 'development', normalizedWorkCUw: 0, memoryMU: 0, priority: RULES.requestPriority,
      poolId: 'auto', staffDemand: [{ role: 'ml', staffWeeks: rehearsal.requiredStaff - rehearsal.completedStaff }] });
  }
  return requests;
}

export function rehearsalReceiptKey(receipt: Pick<RehearsalWorkReceipt, 'hardwareId' | 'ownership' | 'multiplierBps' | 'rateCentsPerCUw' | 'facilityTariff'>): string {
  return canonicalStateHash({ hardwareId: receipt.hardwareId, ownership: receipt.ownership,
    multiplierBps: receipt.multiplierBps, rateCentsPerCUw: receipt.rateCentsPerCUw, ...facilityTariffIdentity(receipt) });
}

export function advanceReleaseRehearsals(state: Readonly<GameState>, context: ModuleContext, products: ProductsSlice): void {
  for (const rehearsal of records(products)) {
    if (rehearsal.status !== 'running' || rehearsal.paused) continue;
    if (state.slices.company.companies[rehearsal.companyId].arrearsCents) { rehearsal.lastBottleneck = 'Unpaid bills; rehearsal work is suspended.'; continue; }
    const pools = getComputePools(state, rehearsal.companyId, context.content, context.resources.staffGrants);
    for (const name of ['source', 'candidate'] as const) {
      const arm = rehearsal.arms[name], requestId = releaseRehearsalWorkId(rehearsal.id, name);
      const grant = context.resources.computeGrants.find(item => item.requestId === requestId);
      if (!grant?.hardwareEffectiveCUw) continue;
      const remaining = arm.requiredWork - arm.completedWork, pool = pools.find(item => item.id === grant.poolId);
      if (!pool || grant.hardwareEffectiveCUw > remaining || grant.memoryMU !== arm.memoryMU || grant.sharedMemoryMU) throw new Error('Release rehearsal grant exceeds remaining work or omits its separate resident workspace.');
      const multiplierBps = getPoolMultiplierBps(pool, 'development', usesCrossRackTraining(pool, 'development', grant.physicalCUw, arm.memoryMU), context.content, 'inference');
      const facilityBinding = facilityTariffBinding(pool, { category: 'development', workloadKind: 'inference' });
      const rateCentsPerCUw = pool.ownership === 'cloud' ? context.content.opening.rentCentsPerCUWeek : getPoolWorkCostRate(pool, { category: 'development', workloadKind: 'inference' });
      const key = rehearsalReceiptKey({ hardwareId: pool.hardwareId, ownership: pool.ownership, multiplierBps, rateCentsPerCUw, ...facilityBinding });
      const receipt = arm.workReceipts[key] ??= { hardwareId: pool.hardwareId, ownership: pool.ownership, multiplierBps, rateCentsPerCUw, ...facilityBinding,
        physicalCUw: 0, effectiveCUw: 0, conversionRemainder: 0, grants: 0, firstWeek: context.week, lastWeek: context.week };
      const conversionRemainder = checkedInteger(Number(BigInt(grant.physicalCUw) * BigInt(multiplierBps) - BigInt(grant.hardwareEffectiveCUw) * BigInt(10000)));
      receipt.physicalCUw = checkedAdd(receipt.physicalCUw, grant.physicalCUw); receipt.effectiveCUw = checkedAdd(receipt.effectiveCUw, grant.hardwareEffectiveCUw);
      receipt.conversionRemainder = checkedAdd(receipt.conversionRemainder, conversionRemainder); receipt.grants += 1; receipt.lastWeek = context.week;
      arm.completedWork = checkedAdd(arm.completedWork, grant.hardwareEffectiveCUw); arm.physicalWork = checkedAdd(arm.physicalWork, grant.physicalCUw);
      arm.latestGrant = { week: context.week, poolId: grant.poolId, receiptKey: key, remainingBefore: remaining,
        physicalCUw: grant.physicalCUw, effectiveCUw: grant.hardwareEffectiveCUw, memoryMU: grant.memoryMU };
    }
    const staff = context.resources.staffGrants.find(item => item.requestId === releaseRehearsalWorkId(rehearsal.id, 'review'))?.grants.find(item => item.role === 'ml')?.staffWeeks ?? 0;
    if (staff > rehearsal.requiredStaff - rehearsal.completedStaff) throw new Error('Release rehearsal review grant exceeds its remaining work.');
    if (staff) {
      rehearsal.latestReview = { week: context.week, remainingBefore: rehearsal.requiredStaff - rehearsal.completedStaff, grantedStaff: staff };
      rehearsal.lastStaffWeek = context.week;
    }
    rehearsal.completedStaff = checkedAdd(rehearsal.completedStaff, staff);
    rehearsal.lastBottleneck = rehearsal.arms.source.completedWork < rehearsal.arms.source.requiredWork || rehearsal.arms.candidate.completedWork < rehearsal.arms.candidate.requiredWork
      ? 'Needs development compute and a full compatible resident workspace for each remaining arm; live serving uses capacity first.'
      : rehearsal.completedStaff < rehearsal.requiredStaff ? 'Model work finished. The paired review needs Design points.' : '';
  }
}

export function resolveReleaseRehearsals(_state: Readonly<GameState>, context: ModuleContext, products: ProductsSlice): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const rehearsal of records(products)) {
    if (rehearsal.status !== 'running' || rehearsal.paused || rehearsal.completedStaff !== rehearsal.requiredStaff
      || rehearsal.arms.source.completedWork !== rehearsal.arms.source.requiredWork || rehearsal.arms.candidate.completedWork !== rehearsal.arms.candidate.requiredWork) continue;
    rehearsal.status = 'ready'; rehearsal.completedWeek = context.week; rehearsal.availableWeek = context.week + 1;
    rehearsal.lastBottleneck = `Comparison finished; the reviewed report becomes available in week ${rehearsal.availableWeek}.`;
    messages.push({ companyId: rehearsal.companyId, category: 'project', message: 'Both release comparison arms and the paid ML review finished. The report becomes available next week.' });
  }
  return messages;
}

export function commitReleaseRehearsals(state: Readonly<GameState>, context: ModuleContext, products: ProductsSlice): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const rehearsal of records(products)) {
    if (rehearsal.status !== 'ready' || rehearsal.availableWeek === null || rehearsal.availableWeek > context.week) continue;
    rehearsal.status = 'complete'; rehearsal.lastBottleneck = '';
    for (const arm of Object.values(rehearsal.arms)) arm.outcomes = releaseRehearsalOutcomes(state.slices.models.versions[arm.modelId], rehearsal.configuration, rehearsal.evidenceKey);
    messages.push({ companyId: rehearsal.companyId, category: 'project', message: 'Release comparison available: inspect useful answers, confident errors, refusals and actual physical work before preparing a handover.' });
  }
  return messages;
}

/** A tariff estimate from actual grants, not a second bill or whole-cent ledger allocation. */
export function rehearsalTariffEstimateCents(arm: ReleaseRehearsalArm): number {
  return Number(Object.values(arm.workReceipts).reduce((sum, receipt) => sum + BigInt(receipt.physicalCUw) * BigInt(receipt.rateCentsPerCUw), BigInt(0)) / BigInt(1_000_000_000));
}
import { usesWorkPointProfiles } from './workforce';
