import { FAMILY_SERVING_MULTIPLIER } from '../modules/model-design';
import { isCapabilitySuite } from '../modules/evaluation-classification';
import type { GameContent, GameState, ModelVersion } from '../contracts/types';
import { ASSISTANCE, EFFICIENCY_RULES, SYSTEM_RULES, VARIANT_RULES } from '../content/wave4-research';
import { canonicalStateHash } from './canonical';
import { checkedInteger, mulDiv } from './math';
import { hasCapabilityEvaluation, inheritedModelRights, modelWorkBps } from '../modules/model-runtime';
import { systemApplied, variantModel } from '../modules/applied-research';

const U = 1_000_000_000;
const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (left: unknown, right: unknown) => canonicalStateHash(left) === canonicalStateHash(right);
function record(value: unknown, label: string): void { check(!!value && typeof value === 'object' && !Array.isArray(value), label + ' must be a record.'); }
function id(value: unknown): void { check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !['__proto__', 'prototype', 'constructor'].includes(value), 'Application identifier is invalid.'); }
function note(value: unknown): void { check(typeof value === 'string' && value.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(value), 'Application explanation is invalid.'); }
function meter(done: number, required: number): void { checkedInteger(done); checkedInteger(required); check(required > 0 && done <= required, 'Application progress exceeds its fixed requirement.'); }
function fixedModel(model: ModelVersion) {
  return { id: model.id, name: model.name, companyId: model.companyId, family: model.family, architecture: model.architecture,
    capabilityBps: model.capabilityBps, reliabilityBps: model.reliabilityBps, residentMU: model.residentMU,
    source: model.source, parentModelId: model.parentModelId, createdWeek: model.createdWeek,
    ...(model.behavior ? { behavior: model.behavior } : {}), ...(model.foundationAnchor ? { foundationAnchor: model.foundationAnchor } : {}),
    ...(model.planner ? { planner: model.planner } : {}),
    ...(model.policy ? { policy: model.policy } : {}),
    runtimeVariant: model.runtimeVariant };
}
/** Saved applications reconcile to authored costs, immutable sources, paid rollout work and finite effects. */
export function assertWave4ResearchState(state: GameState, content: GameContent): void {
  const { models, products, research, company } = state.slices;
  record(models.applicationRuns, 'Model applications'); record(products.efficiencyInstalls, 'Product efficiency installations'); record(research.systemRollouts, 'System rollouts'); record(research.assistantsByCompany, 'Research assistants');
  const past = (week: number) => { checkedInteger(week); check(week <= state.week, 'Application activity comes from a future week.'); };
  const owns = (owner: string) => check(Object.hasOwn(company.companies, owner), 'Application has an unknown company.');
  const researched = (owner: string, method: string, startedWeek: number) => {
    check((research.completedByCompany[owner] ?? []).includes(method), 'Application used an unavailable research method.');
    const proof = Object.values(research.projects).find(project => project.companyId === owner && project.researchId === method);
    if (proof) check(proof.status === 'complete' && proof.availableWeek! <= startedWeek, 'Application preceded availability of its researched method.');
  };
  const implementation = (run: { startedWeek: number; requiredWork: number; completedWork: number; requiredStaff: number; completedStaff: number; status: string; readyWeek: number | null; lastBottleneck: string }, requiredWork: number, requiredStaff: number) => {
    past(run.startedWeek); note(run.lastBottleneck); meter(run.completedWork, run.requiredWork); meter(run.completedStaff, run.requiredStaff);
    check(run.requiredWork === requiredWork && run.requiredStaff === requiredStaff, 'Rollout changed its authored work or staff costs.');
    check(['building', 'ready', 'active'].includes(run.status), 'Rollout has an unknown state.');
    if (run.status === 'building') check(run.readyWeek === null && (run.completedWork < requiredWork || run.completedStaff < requiredStaff), 'Unfinished rollout is already fully implemented.');
    else {
      checkedInteger(run.readyWeek!);
      check(run.completedWork === requiredWork && run.completedStaff === requiredStaff && run.readyWeek! >= run.startedWeek + Math.ceil(requiredStaff / U), 'Rollout activated without enough implementation weeks.');
      check(run.status === 'ready' ? run.readyWeek === state.week + 1 : run.readyWeek! <= state.week, 'Rollout activated at an invalid boundary.');
    }
  };
  const variants = new Set<string>(), pairs = new Set<string>(), perCompany: Record<string, number> = {};
  for (const [key, run] of Object.entries(models.applicationRuns)) {
    record(run, 'Model application'); id(run.id); id(run.sourceModelId); id(run.outputModelId); check(run.id === key && run.id.startsWith('application:'), 'Model application identity changed.'); owns(run.companyId); past(run.startedWeek); note(run.lastBottleneck);
    const rule = VARIANT_RULES[run.variant], source = models.versions[run.sourceModelId];
    check(rule && source && source.companyId === run.companyId && !source.runtimeVariant && hasCapabilityEvaluation(state, source.id), 'Deployment variant stacked methods or lost its evaluated source.');
    researched(run.companyId, rule.research, run.startedWeek);
    check(Object.values(models.reports).some(report => report.modelId === source.id && report.companyId === run.companyId && isCapabilitySuite(report.suiteId) && report.week <= run.startedWeek), 'Variant source was evaluated only after admission.');
    meter(run.completedWork, run.requiredWork); meter(run.completedStaff, run.requiredStaff); checkedInteger(run.physicalWork); checkedInteger(run.lastProgress);
    check(run.requiredWork === rule.work && run.requiredStaff === rule.staff && run.lastProgress <= run.completedWork, 'Model application changed its metered costs.');
    check((run.completedWork === 0) === (run.physicalWork === 0), 'Model application has useful work without physical work, or physical work without useful work.');
    check(['running', 'paused', 'complete'].includes(run.status), 'Model application status is invalid.');
    const pair = run.companyId + ':' + source.id + ':' + run.variant; check(!pairs.has(pair), 'The same deployment variant was applied repeatedly.'); pairs.add(pair);
    perCompany[run.companyId] = (perCompany[run.companyId] ?? 0) + 1; check(perCompany[run.companyId] <= 128, 'Deployment variants exceed the company limit.');
    if (run.status === 'complete') {
      past(run.completedWeek!); check(run.completedWeek! >= run.startedWeek && run.completedWork === run.requiredWork && run.completedStaff === run.requiredStaff, 'Finished model application skipped its requirements.');
      const model = models.versions[run.outputModelId], expected = variantModel(state, run, run.completedWeek!);
      check(model && same(fixedModel(model), fixedModel(expected)) && model.trainingRunId === undefined && model.trainingEvidenceId === undefined, 'Deployment variant differs from its immutable source, paid application or saved penalties.');
      variants.add(model.id);
    } else check(run.completedWeek === undefined && !models.versions[run.outputModelId], 'An unfinished model application created its output.');
  }
  for (const model of Object.values(models.versions)) if (model.runtimeVariant) check(variants.has(model.id), 'Deployment variant has no completed application.');

  check(Object.keys(products.efficiencyInstalls).length <= Object.keys(products.offers).length * Object.keys(EFFICIENCY_RULES).length, 'Efficiency installations outnumber their product slots.');
  for (const [key, install] of Object.entries(products.efficiencyInstalls)) {
    record(install, 'Product efficiency installation'); id(install.id); id(install.productId); id(install.modelId); owns(install.companyId);
    const rule = EFFICIENCY_RULES[install.kind], product = products.offers[install.productId], primary = models.versions[install.modelId];
    check(rule && key === install.productId + ':' + install.kind && install.id.startsWith('efficiency:') && product?.companyId === install.companyId && primary?.companyId === install.companyId && hasCapabilityEvaluation(state, primary.id), 'Efficiency installation has missing or foreign inputs.');
    researched(install.companyId, rule.research, install.startedWeek); implementation(install, rule.work, rule.staff); check(typeof install.enabled === 'boolean', 'Efficiency enabled flag is invalid.');
    if (install.kind !== 'evidence-links') check(install.retrievalId === undefined && install.evidencePacketId === undefined, 'An unrelated efficiency method captured an evidence checker.');
    if (install.kind === 'routing') {
      id(install.secondaryModelId); const secondary = models.versions[install.secondaryModelId!];
      check(secondary && secondary.companyId === install.companyId && secondary.id !== primary.id && secondary.architecture === primary.architecture && hasCapabilityEvaluation(state, secondary.id) && inheritedModelRights(state, secondary.id, content).hosted, 'Routing lost its separately evaluated compatible easy-request model.');
      const scale = (model: ModelVersion) => FAMILY_SERVING_MULTIPLIER[model.family] * modelWorkBps(model);
      check(scale(secondary) < scale(primary), 'Routing easy requests does not reduce model work.');
      check(product.kind === 'developer-api' ? secondary.capabilityBps.coding >= 5000 && secondary.reliabilityBps >= 8000 : product.kind === 'business-docs' ? secondary.capabilityBps.documents >= 5500 && secondary.reliabilityBps >= 9000 : secondary.capabilityBps.conversation >= 4500 && secondary.reliabilityBps >= 6500, 'Routing admitted a model below its product quality floor.');
      check(install.cacheKey === undefined && install.warmedWeek === undefined && install.lastServedWeek === undefined, 'Routing created cache storage without a cache installation.');
    } else if (install.kind === 'evidence-links') {
      id(install.retrievalId); id(install.evidencePacketId);
      const packet = state.slices.data.packets[install.evidencePacketId!], retrieval = products.retrievalInstalls[install.productId];
      check(product.kind === 'business-docs' && install.retrievalId === 'retrieval:' + install.productId
        && packet && (packet.companyId ?? state.playerCompanyId) === install.companyId && packet.prepared && packet.rights.hosted,
      'Evidence checks lack their owned prepared document source and product index.');
      check(retrieval && retrieval.companyId === install.companyId && retrieval.id === install.retrievalId && retrieval.startedWeek <= install.startedWeek,
        'Evidence checks were installed before their document index.');
      if (retrieval.evidence.packetId === install.evidencePacketId) check(retrieval.status === 'active' && retrieval.readyWeek! <= install.startedWeek,
        'Evidence checks were installed before the captured index became active.');
      check(install.secondaryModelId === undefined && install.cacheKey === undefined && install.warmedWeek === undefined && install.lastServedWeek === undefined,
        'Evidence checks acquired an unrelated model or cache state.');
    } else {
      check(install.secondaryModelId === undefined, 'Prefix cache selects an unrelated second model.');
      if (install.cacheKey !== undefined) {
        id(install.cacheKey); past(install.warmedWeek!); past(install.lastServedWeek!);
        check(install.cacheKey.startsWith('prefix:') && install.status === 'active' && install.enabled && install.warmedWeek! >= install.readyWeek! && install.warmedWeek! <= install.lastServedWeek!, 'Cache warmed before paid rollout or outside an enabled service window.');
      } else check(install.warmedWeek === undefined && install.lastServedWeek === undefined, 'Cache has warmth without a scoped identity.');
    }
  }
  const systems = new Set<string>();
  check(Object.keys(research.systemRollouts).length <= Object.keys(company.companies).length * Object.keys(SYSTEM_RULES).length, 'System rollouts exceed finite company methods.');
  for (const [key, rollout] of Object.entries(research.systemRollouts)) {
    record(rollout, 'System rollout'); id(rollout.id); owns(rollout.companyId); check(key === rollout.id && rollout.id.startsWith('system-rollout:'), 'System rollout identity changed.');
    const rule = SYSTEM_RULES[rollout.method]; check(rule, 'System rollout method is unknown.'); researched(rollout.companyId, rule.research, rollout.startedWeek); implementation(rollout, rule.work, rule.staff);
    const pair = rollout.companyId + ':' + rollout.method; check(!systems.has(pair), 'System rollout was duplicated.'); systems.add(pair);
  }
  for (const [owner, assistant] of Object.entries(research.assistantsByCompany)) {
    record(assistant, 'Research assistant'); owns(owner); check(owner === assistant.companyId && systemApplied(state, owner, 'research-assistant'), 'Research assistant has no owned active rollout.');
    const model = models.versions[assistant.modelId];
    check(model && model.companyId === owner && hasCapabilityEvaluation(state, model.id) && model.capabilityBps.coding >= 6500 && model.capabilityBps.tools >= 6000, 'Research assistant lacks its evaluated coding/tool model.');
    past(assistant.lastWeek); note(assistant.lastBottleneck); check(typeof assistant.enabled === 'boolean', 'Research assistant enabled flag is invalid.');
    for (const value of [assistant.maxAssistedFte, assistant.requestedWork, assistant.executedWork, assistant.physicalWork, assistant.reviewStaff, assistant.assistedStaff, assistant.bonusStaff]) checkedInteger(value);
    check(assistant.maxAssistedFte >= U / 4 && assistant.maxAssistedFte <= ASSISTANCE.maximumFte && assistant.maxAssistedFte % (U / 4) === 0, 'Research assistance exceeds its configured FTE bounds.');
    const workPerFte = mulDiv(ASSISTANCE.workPerFte, modelWorkBps(model), 10000);
    check(assistant.executedWork <= assistant.requestedWork && assistant.requestedWork <= mulDiv(assistant.maxAssistedFte, workPerFte, U) && assistant.reviewStaff <= mulDiv(assistant.maxAssistedFte, ASSISTANCE.reviewPerFte, U), 'Research assistant exceeded its paid inference/review demand.');
    check((assistant.executedWork === 0) === (assistant.physicalWork === 0), 'Research assistant used free or phantom physical work.');
    check(assistant.assistedStaff <= Math.min(assistant.maxAssistedFte, mulDiv(assistant.executedWork, U, workPerFte), mulDiv(assistant.reviewStaff, U, ASSISTANCE.reviewPerFte)) && assistant.bonusStaff <= mulDiv(assistant.assistedStaff, ASSISTANCE.bonusBps, 10000), 'Research staff bonus exceeds actual inference and reviewed assistance.');
    if (!assistant.enabled) check(assistant.assistedStaff === 0 && assistant.bonusStaff === 0 && assistant.executedWork === 0 && assistant.reviewStaff === 0, 'Disabled assistance created progress.');
  }
  for (const project of Object.values(research.projects)) if ((project.assistanceStaff ?? 0) > 0) check(systemApplied(state, project.companyId, 'research-assistant') && !!research.assistantsByCompany[project.companyId], 'Assisted research has no implemented assistant.');
}
