import { CONNECTED_COMPANY_CONTENT_VERSION } from '../core/connected-company-version';
import type { EvaluationCase, EvaluationReport, GameState, ModelVersion, Rejection } from '../contracts/types';
import type { ModelChallengeAdmission, ModelChallengeReceipt, ModelChallengeTier } from '../contracts/model-challenges';
import { CHALLENGE_SKILLS, CHALLENGE_SKILL_NAMES, MODEL_CHALLENGES, modelChallengeCaseDefinition, modelChallengeDefinition } from '../content/model-challenges';
import { CAMPAIGN_ORIGINS } from '../content/campaign-origins';
import { canonicalStateHash } from '../core/canonical';
import { advancedScores } from './advanced-skills';
import { isCapabilitySuite } from './evaluation-classification';
import { getAISystemMetrics } from './ai-systems';
import { SYSTEMS_CHALLENGE_CASES, type SystemsChallengeCase } from '../content/systems-challenges';
import { formatUnits } from '../core/math';
import { AI_SYSTEMS_CONTENT_VERSION } from '../core/ai-systems-version';

export const isModelChallengeSuite = (id: string | undefined): boolean => !!modelChallengeDefinition(id);
export function modelChallengeFingerprint(model: ModelVersion, suiteId?: string): string {
  const identity = { capabilityBps: model.capabilityBps, advancedCapabilities: advancedScores(model), reliabilityBps: model.reliabilityBps };
  // Never change the identity of a previously paid combined-skill challenge.
  return canonicalStateHash(modelChallengeDefinition(suiteId)?.format ? { ...identity, systems: getSystemsModelMeasures(model) } : identity);
}
export function isPaidChallengeReport(state: Readonly<GameState>, report: EvaluationReport, atWeek: number): boolean {
  if (report.scenarioStart || report.week > atWeek || !report.heldOut) return false;
  return Object.values(state.slices.models.evaluationRuns).some(run => run.companyId === report.companyId && run.modelId === report.modelId && run.reportId === report.id
    && run.status === 'complete' && run.completedWeek === report.week && run.completedWork === run.requiredWork && run.completedStaff === run.requiredStaff
    && run.id.startsWith('evaluation-') && (run.suiteId ?? 'basic-conversation-1') === (report.suiteId ?? 'basic-conversation-1')
    && state.commandReceipts[run.id.slice('evaluation-'.length)]?.status === 'accepted'
    && state.commandReceipts[run.id.slice('evaluation-'.length)]?.week === run.startedWeek);
}
export function getModelChallengeAchievements(state: Readonly<GameState>, companyId: string, atWeek = state.week): { tierId: ModelChallengeTier; title: string; reportId: string; modelId: string; week: number }[] {
  return MODEL_CHALLENGES.flatMap(tier => {
    const report = Object.values(state.slices.models.reports).filter(item => item.companyId === companyId && item.suiteId === tier.id && item.challenge?.passed && isPaidChallengeReport(state, item, atWeek))
      .sort((a, b) => a.week - b.week || a.id.localeCompare(b.id))[0];
    return report ? [{ tierId: tier.tierId, title: tier.title, reportId: report.id, modelId: report.modelId, week: report.week }] : [];
  });
}
export function validateModelChallengeAdmission(state: Readonly<GameState>, companyId: string, modelId: string, suiteId: string | undefined, atWeek = state.week): Rejection | undefined {
  const tier = modelChallengeDefinition(suiteId); if (!tier) return;
  const reject = (message: string): Rejection => ({ code: 'NOT_READY', message });
  if (tier.format && ![AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(state.contentVersion)) return reject('Upgrade this campaign before entering systems workload challenges.');
  const model = state.slices.models.versions[modelId];
  if (!model || model.companyId !== companyId || (model.createdWeek ?? 0) > atWeek) return reject('Choose an owned, available model for this challenge.');
  const foundedWithMethod = companyId === state.playerCompanyId && CAMPAIGN_ORIGINS[state.slices.campaign.origin ?? 'garage'].knowledge.includes(tier.requiredResearch);
  if (!foundedWithMethod && !Object.values(state.slices.research.projects).some(project => project.companyId === companyId && project.researchId === tier.requiredResearch
    && project.status === 'complete' && project.availableWeek !== undefined && project.availableWeek <= atWeek)) return reject('Complete Evaluation suite (R1) before entering research challenges.');
  if (!Object.values(state.slices.models.reports).some(report => report.companyId === companyId && report.modelId === modelId && isCapabilitySuite(report.suiteId) && isPaidChallengeReport(state, report, atWeek)))
    return reject('Finish a paid capability evaluation of this exact model before entering a challenge.');
  if (tier.previousTier && !getModelChallengeAchievements(state, companyId, atWeek).some(achievement => achievement.tierId === tier.previousTier))
    return reject(`Earn ${MODEL_CHALLENGES.find(item => item.tierId === tier.previousTier)!.title} before entering ${tier.name}.`);
}
export function createModelChallengeAdmission(state: Readonly<GameState>, companyId: string, modelId: string, suiteId: string | undefined, atWeek = state.week): ModelChallengeAdmission | undefined {
  const tier = modelChallengeDefinition(suiteId); if (!tier || validateModelChallengeAdmission(state, companyId, modelId, suiteId, atWeek)) return;
  const baseline = Object.values(state.slices.models.reports).filter(report => report.companyId === companyId && report.modelId === modelId && isCapabilitySuite(report.suiteId) && isPaidChallengeReport(state, report, atWeek))
    .sort((a, b) => a.week - b.week || a.id.localeCompare(b.id))[0];
  const previous = tier.previousTier ? getModelChallengeAchievements(state, companyId, atWeek).find(item => item.tierId === tier.previousTier) : undefined;
  return { tierId: tier.tierId, benchmarkVersion: 1, modelFingerprint: modelChallengeFingerprint(state.slices.models.versions[modelId], suiteId), baselineReportId: baseline.id,
    previousAchievementReportId: previous?.reportId ?? null, admittedWeek: atWeek };
}
/** Fixed authored tasks measure a weighted pair of trained skills and execution reliability.
 * No random draw, model rename or fresh evaluation ID can reroll a case. */
export function modelChallengeCases(model: ModelVersion, suiteId: string): EvaluationCase[] {
  const tier = modelChallengeDefinition(suiteId); if (!tier) throw new Error('Unknown model challenge.');
  const scores = { ...model.capabilityBps, ...advancedScores(model) };
  return Array.from({ length: tier.cases }, (_, index) => {
    const task = modelChallengeCaseDefinition(tier, index);
    const combined = Math.floor((scores[task.domain] * 7 + scores[task.support] * 3) / 10);
    return { id: `${suiteId}:case-${String(index + 1).padStart(2, '0')}`, domain: task.domain, difficultyBps: task.difficultyBps,
      passed: combined >= task.difficultyBps && model.reliabilityBps >= task.reliabilityBps
        && (!tier.format || systemsCaseLimitsMet(model, SYSTEMS_CHALLENGE_CASES[tier.format][index])) };
  });
}
export function createModelChallengeReceipt(model: ModelVersion, suiteId: string, admission: ModelChallengeAdmission): ModelChallengeReceipt {
  const tier = modelChallengeDefinition(suiteId); if (!tier || admission.tierId !== tier.tierId || admission.modelFingerprint !== modelChallengeFingerprint(model, suiteId)) throw new Error('Challenge candidate or benchmark changed after admission.');
  const cases = modelChallengeCases(model, suiteId);
  const skills = Object.fromEntries(CHALLENGE_SKILLS.map(domain => [domain, { passed: cases.filter(item => item.domain === domain && item.passed).length, total: cases.filter(item => item.domain === domain).length }])) as ModelChallengeReceipt['skills'];
  const passedCases = cases.filter(item => item.passed).length;
  const passed = passedCases >= tier.requiredPasses && CHALLENGE_SKILLS.every(domain => skills[domain].passed >= tier.minimumPassesPerSkill);
  return { admission: structuredClone(admission), passedCases, totalCases: tier.cases, requiredPasses: tier.requiredPasses, minimumPassesPerSkill: tier.minimumPassesPerSkill,
    skills, passed, earnedTitle: passed ? tier.title : null };
}

/** Fixed reference workload: one model copy with twenty-five simultaneous sessions. */
export function getSystemsModelMeasures(model: ModelVersion) {
  const metrics = getAISystemMetrics(model);
  return { servingCUwPer1000: Math.round(metrics.servingCUwPer1000 * 1_000_000_000),
    residentMU: metrics.residentMU, sessionMemoryMU: metrics.sessionMemoryMU,
    memoryMU: metrics.residentMU + metrics.sessionMemoryMU * 25,
    retentionBps: metrics.retentionBps, verifiedCompletionBps: metrics.verifiedCompletionBps,
    latencyBps: metrics.latencyBps };
}

function systemsCaseLimitsMet(model: ModelVersion, task: SystemsChallengeCase): boolean {
  const metrics = getSystemsModelMeasures(model);
  return (task.maxServingCUwPer1000 === undefined || metrics.servingCUwPer1000 <= Math.round(task.maxServingCUwPer1000 * 1_000_000_000))
    && (task.maxMemoryMU === undefined || metrics.memoryMU <= task.maxMemoryMU)
    && (task.minRetentionBps === undefined || metrics.retentionBps >= task.minRetentionBps)
    && (task.minVerifiedBps === undefined || metrics.verifiedCompletionBps >= task.minVerifiedBps)
    && (task.maxLatencyBps === undefined || metrics.latencyBps <= task.maxLatencyBps);
}

/** UI and goals use the same measurements as the paid benchmark. */
export function getModelChallengeCaseViews(model: ModelVersion, suiteId: string) {
  const tier = modelChallengeDefinition(suiteId); if (!tier) return [];
  const scores = { ...model.capabilityBps, ...advancedScores(model) }, metrics = getSystemsModelMeasures(model);
  return modelChallengeCases(model, suiteId).map((result, index) => {
    const task = modelChallengeCaseDefinition(tier, index);
    const combined = Math.floor((scores[task.domain] * 7 + scores[task.support] * 3) / 10);
    const requirements = [`${CHALLENGE_SKILL_NAMES[task.domain]} + ${CHALLENGE_SKILL_NAMES[task.support]} quality ${task.difficultyBps / 100}`, `reliability ${task.reliabilityBps / 100}%`];
    const measurements = [`quality ${(combined / 100).toFixed(1)}`, `reliability ${(model.reliabilityBps / 100).toFixed(1)}%`];
    if (tier.format) {
      const limits = SYSTEMS_CHALLENGE_CASES[tier.format][index];
      if (limits.maxServingCUwPer1000 !== undefined) { requirements.push(`at most ${limits.maxServingCUwPer1000} CUw per 1,000 requests`); measurements.push(`${formatUnits(metrics.servingCUwPer1000)} CUw per 1,000 requests`); }
      if (limits.maxMemoryMU !== undefined) { requirements.push(`at most ${formatUnits(limits.maxMemoryMU)} MU including 25 sessions`); measurements.push(`${formatUnits(metrics.memoryMU)} MU including 25 sessions`); }
      if (limits.minRetentionBps !== undefined) { requirements.push(`retention ${limits.minRetentionBps / 100}%`); measurements.push(`retention ${(metrics.retentionBps / 100).toFixed(1)}%`); }
      if (limits.minVerifiedBps !== undefined) { requirements.push(`verified completion ${limits.minVerifiedBps / 100}%`); measurements.push(`verified completion ${(metrics.verifiedCompletionBps / 100).toFixed(1)}%`); }
      if (limits.maxLatencyBps !== undefined) { requirements.push(`response time at most ${limits.maxLatencyBps / 10000}×`); measurements.push(`response time ${(metrics.latencyBps / 10000).toFixed(2)}×`); }
    }
    return { title: task.title, requirementText: requirements.join(' · '), measurementText: measurements.join(' · '), passed: result.passed };
  });
}

