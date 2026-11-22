import { AI_SYSTEMS_CONTENT_VERSION } from '../core/ai-systems-version';
import { SPECIALIST_BRIEF_IDS, type BriefBinding, type CustomerBrief, type SpecialistBriefId } from '../contracts/customer-briefs';
import type { EvaluationReport, GameState, ModelVersion, WorkRequest } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import { SPECIALIST_BRIEF_RULES } from '../content/customer-briefs';
import { DEFAULT_FEATURES } from '../content/wave2-market';
import { CONTENT } from '../content/catalog';
import { canonicalStateHash } from '../core/canonical';
import { formatUnits } from '../core/math';
import { GAMEPLAY_POLISH_CONTENT_VERSION } from '../core/gameplay-polish-version';
import { inheritedModelRights, modelExecutionHints } from './model-runtime';
import { requestMeter } from './product-models';
import { policyReleaseRejection } from './policy-holdouts';
import { BASE_BEHAVIOR } from './lab-planner';

export const isSpecialistBrief = (id: string): id is SpecialistBriefId => (SPECIALIST_BRIEF_IDS as readonly string[]).includes(id);

/** The standard reference keeps architecture comparisons independent of product add-ons. */
export function specialistBriefMeter(model: ModelVersion, id: SpecialistBriefId) {
  const rule = SPECIALIST_BRIEF_RULES[id];
  const standard = requestMeter(model, { ...DEFAULT_FEATURES }).work;
  return { workPerThousandCUw: standard * 1000,
    weeklyWorkCUw: requestMeter(model, { ...DEFAULT_FEATURES, extendedContext: rule.extendedContext }).work * rule.requestsPerWeek,
    memoryMU: model.residentMU + (rule.extendedContext ? U / 2 : U / 4) };
}

export function specialistModelRequirements(model: ModelVersion, id: SpecialistBriefId): string | null {
  const rule = SPECIALIST_BRIEF_RULES[id], scores = { ...model.capabilityBps, ...(model.advancedCapabilities ?? {}) };
  const missing = Object.entries(rule.minimumScores).filter(([domain, minimum]) => (scores[domain as keyof typeof scores] ?? 0) < minimum)
    .map(([domain, minimum]) => `${domain === 'longContext' ? 'long context' : domain} ${minimum / 100}`);
  if (model.reliabilityBps < rule.reliabilityBps) missing.push(`reliability ${rule.reliabilityBps / 100}%`);
  if (model.residentMU > rule.residentMU) missing.push(`resident memory at most ${formatUnits(rule.residentMU)} MU`);
  if (specialistBriefMeter(model, id).workPerThousandCUw > rule.workPerThousandCUw) missing.push(`at most ${formatUnits(rule.workPerThousandCUw)} CUw per 1,000 standard requests`);
  const behavior = model.behavior ?? BASE_BEHAVIOR;
  if (rule.falseRefusalBps !== undefined && behavior.falseRefusalBps > rule.falseRefusalBps) missing.push(`false refusals at most ${rule.falseRefusalBps / 100}%`);
  if (rule.confidentErrorBps !== undefined && behavior.confidentErrorBps > rule.confidentErrorBps) missing.push(`confident errors at most ${rule.confidentErrorBps / 100}%`);
  return missing.length ? 'Needs ' + missing.join(', ') + '.' : null;
}

export function isPaidBriefReport(state: Readonly<GameState>, report: EvaluationReport | undefined, modelId: string, suiteId: string): report is EvaluationReport {
  if (!report || report.scenarioStart || !report.heldOut || report.companyId !== state.playerCompanyId || report.modelId !== modelId || report.suiteId !== suiteId) return false;
  return Object.values(state.slices.models.evaluationRuns).some(run => run.companyId === report.companyId && run.modelId === modelId
    && run.suiteId === suiteId && run.status === 'complete' && run.reportId === report.id && run.completedWork === run.requiredWork
    && run.completedStaff === run.requiredStaff && report.week >= run.startedWeek && report.week <= state.week);
}

export function getSpecialistBriefCandidate(state: Readonly<GameState>, id: SpecialistBriefId): BriefBinding | null {
  const needsAdvanced = Object.keys(SPECIALIST_BRIEF_RULES[id].minimumScores).some(domain => ['reasoning', 'longContext', 'multimodal'].includes(domain));
  const models = Object.values(state.slices.models.versions).filter(model => model.companyId === state.playerCompanyId && !model.scenarioStart
    && !specialistModelRequirements(model, id) && !policyReleaseRejection(state, model.id) && inheritedModelRights(state, model.id, CONTENT).hosted)
    .sort((a, b) => specialistBriefMeter(a, id).weeklyWorkCUw - specialistBriefMeter(b, id).weeklyWorkCUw || a.residentMU - b.residentMU || a.id.localeCompare(b.id));
  for (const model of models) {
    const reports = Object.values(state.slices.models.reports).filter(report => report.modelId === model.id).sort((a, b) => a.week - b.week || a.id.localeCompare(b.id));
    const capability = reports.find(report => isPaidBriefReport(state, report, model.id, 'expanded-capabilities-1'));
    const advanced = needsAdvanced ? reports.find(report => isPaidBriefReport(state, report, model.id, 'advanced-capabilities-1')) : null;
    if (capability && (!needsAdvanced || advanced)) return { targetId: model.id, baselineCostCents: 0, contractGeneration: 0,
      specialist: { version: 1, capabilityReportId: capability.id, advancedReportId: advanced?.id ?? null, deliveryWeeks: [] } };
  }
  return null;
}

export function specialistBriefBinding(state: Readonly<GameState>, id: SpecialistBriefId): BriefBinding | string {
  if (![GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION].includes(state.contentVersion)) return 'Upgrade this saved campaign before accepting a specialist commission.';
  return getSpecialistBriefCandidate(state, id) ?? 'Build an owned model that meets this client’s listed quality and resource limits, then complete its required paid tests. Saved paid reports can be reused.';
}

export function specialistBriefWorkRequest(state: Readonly<GameState>, brief: CustomerBrief): WorkRequest | null {
  if (!isSpecialistBrief(brief.id) || !brief.specialist || !brief.targetId) return null;
  const model = state.slices.models.versions[brief.targetId];
  if (!model) return null;
  const meter = specialistBriefMeter(model, brief.id);
  return { id: specialistBriefRequestId(brief), taskId: 'brief:' + brief.id, companyId: state.playerCompanyId,
    category: 'serving', priority: 90, normalizedWorkCUw: meter.weeklyWorkCUw, memoryMU: meter.memoryMU,
    poolId: 'auto', ...modelExecutionHints(model) };
}

export const specialistBriefRequestId = (brief: CustomerBrief) => `brief:${brief.id}:${brief.startedWeek}:client-work`;
export function specialistBriefProofId(state: Readonly<GameState>, brief: CustomerBrief, week?: number): string {
  const model = state.slices.models.versions[brief.targetId!];
  const identity = canonicalStateHash({ modelId: brief.targetId, capabilityReportId: brief.specialist!.capabilityReportId,
    advancedReportId: brief.specialist!.advancedReportId, ...specialistBriefMeter(model, brief.id as SpecialistBriefId) });
  return `brief-proof:${state.playerCompanyId}:${brief.id}:${brief.startedWeek}:${week === undefined ? 'admission' : week}:${identity}`;
}
