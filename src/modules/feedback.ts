import { CONTENT } from '../content/catalog';
import { FEEDBACK_CONSENTS, FEEDBACK_ROW_LABELS, FEEDBACK_RULES as RULES, FEEDBACK_SAMPLING } from '../content/wave10-feedback';
import type { CommandQuote, DataSlice, DomainResult, GameCommand, GameContent, GameState, ModuleContext, Rejection, WeeklyUsage } from '../contracts/types';
import type { FeedbackOutcomes, FeedbackPaidUsage, FeedbackStudy, FeedbackWeekReceipt } from '../contracts/wave10-feedback';
import { canonicalStateHash } from '../core/canonical';
import { checkedAdd, mulDiv } from '../core/math';
import { RIVAL_STARTS } from '../core/wave2-state';
import { inheritedModelRights } from './model-runtime';
import { activeEfficiency } from './product-efficiency';
import { releaseModelFingerprint } from './release-rehearsals';

export const FEEDBACK_COMMANDS = ['start_feedback_study', 'cancel_feedback_study'] as const;
const reject = (code: Rejection['code'], message: string): Rejection => ({ code, message });
const records = (data: Readonly<DataSlice>): FeedbackStudy[] => Object.values(data.feedbackStudies ?? {});

export function feedbackResearchReady(state: Readonly<GameState>, companyId: string, atWeek = state.week): boolean {
  const known = state.slices.research.completedByCompany[companyId]
    ?? (companyId === state.playerCompanyId ? state.slices.research.completed : []);
  if (!known.includes(RULES.requiredResearch)) return false;
  const project = Object.values(state.slices.research.projects).find(item => item.companyId === companyId && item.researchId === RULES.requiredResearch);
  if (project) return project.status === 'complete' && project.availableWeek !== undefined && project.availableWeek <= atWeek;
  return companyId !== state.playerCompanyId && RIVAL_STARTS.some(item => `rival-${item.id}` === companyId && item.research.includes(RULES.requiredResearch));
}

/** A new study or later curation cannot make the same product-week into new evidence. */
export function feedbackWeekSourceId(companyId: string, productId: string, week: number): string {
  return `feedback-source:${canonicalStateHash({ companyId, productId })}:${week}`;
}

export function feedbackStudySourceIds(study: FeedbackStudy): string[] {
  return study.weeks.filter(row => row.outcomes.cases > 0).map(row => row.sourceId).sort();
}

/** The explanation is presentation only; every source, receipt, choice and close boundary is frozen. */
export function feedbackStudyFingerprint(study: FeedbackStudy): string {
  return canonicalStateHash(Object.fromEntries(Object.entries(study).filter(([key]) => key !== 'lastBottleneck')));
}

export function getReviewableFeedbackStudy(state: Readonly<GameState>, companyId: string, studyId: string): FeedbackStudy | undefined {
  const study = state.slices.data.feedbackStudies?.[studyId];
  return study?.companyId === companyId && study.status === 'closed' && study.totalCases > 0
    && study.reviewableWeek !== null && study.reviewableWeek <= state.week ? study : undefined;
}

/** Read only the paid meter; usage.exchanges also includes trials and is deliberately excluded. */
export function feedbackPaidUsage(usage: WeeklyUsage | undefined, productId: string, week: number): FeedbackPaidUsage {
  const current = usage?.week === week && usage.productId === productId ? usage : undefined;
  const paidRequestedExchanges = (current?.segments ?? []).reduce((sum, segment) => checkedAdd(sum, segment.requestedExchanges), 0);
  const paidRequestedWork = current?.paidRequestedWork ?? 0, paidExecutedWork = current?.paidExecutedWork ?? 0;
  const guardrail = current?.guardrail;
  return { ...(guardrail ? { guardrail: { installationId: guardrail.installationId, profile: guardrail.profile,
    bindingFingerprint: guardrail.bindingFingerprint, checkingApplied: guardrail.checkedRequests > 0,
    baselineFalseRefusalBps: guardrail.baselineFalseRefusalBps, addedFalseRefusalBps: guardrail.addedFalseRefusalBps } } : {}),
    paidAccounts: current?.paidAccounts ?? 0, paidRequestedExchanges, paidRequestedWork, paidExecutedWork,
    paidCompletedExchanges: paidRequestedWork > 0 ? mulDiv(paidExecutedWork, paidRequestedExchanges, paidRequestedWork) : 0,
    errorBps: current?.errorBps ?? 0, confidentErrorBps: current?.behavior?.confidentErrorBps ?? 0,
    falseRefusalBps: current?.behavior?.falseRefusalBps ?? 0, billedCents: current?.billedCents ?? 0,
    invoiceId: (current?.paidAccounts ?? 0) > 0 ? `invoice:${productId}:${week}` : null };
}

const outcomeKeys = ['useful', 'confidentError', 'falseRefusal', 'clarification'] as const;

/** Finite authored aggregate estimates, apportioned deterministically without a random draw. */
export function feedbackOutcomes(cases: number, usage: FeedbackPaidUsage, sampling: FeedbackStudy['sampling']): FeedbackOutcomes {
  const error = usage.errorBps, refusal = Math.min(10000 - error, usage.falseRefusalBps), confident = Math.min(error, usage.confidentErrorBps);
  const weights = { useful: sampling === 'representative' ? 10000 - error - refusal : 0,
    confidentError: confident, falseRefusal: refusal, clarification: error - confident };
  const denominator = outcomeKeys.reduce((sum, key) => sum + weights[key], 0);
  const outcomes: FeedbackOutcomes = { cases, useful: 0, confidentError: 0, falseRefusal: 0, clarification: 0 };
  if (cases === 0 || denominator === 0) return outcomes;
  const remainder = outcomeKeys.map((key, index) => {
    outcomes[key] = mulDiv(cases, weights[key], denominator);
    return { key, index, remainder: cases * weights[key] % denominator };
  }).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let missing = cases - outcomeKeys.reduce((sum, key) => sum + outcomes[key], 0);
  for (const entry of remainder) if (missing > 0) { outcomes[entry.key] += 1; missing -= 1; }
  return outcomes;
}

export function feedbackRowCounts(study: Pick<FeedbackStudy, 'sampling' | 'consent'>, usage: FeedbackPaidUsage, sourceMatches: boolean): Pick<FeedbackWeekReceipt, 'servedAccounts' | 'consentAccounts' | 'negativeCandidates' | 'reason' | 'outcomes'> {
  const consentBps = RULES.consentBps[study.consent];
  const servedAccounts = usage.paidRequestedWork > 0 ? mulDiv(usage.paidAccounts, usage.paidExecutedWork, usage.paidRequestedWork) : 0;
  const consentAccounts = mulDiv(servedAccounts, consentBps, 10000);
  const negativeBps = usage.errorBps + Math.min(10000 - usage.errorBps, usage.falseRefusalBps);
  const negativeCandidates = mulDiv(mulDiv(usage.paidCompletedExchanges, consentBps, 10000), negativeBps, 10000);
  let cases = sourceMatches ? Math.min(RULES.casesPerWeek, consentAccounts, usage.paidCompletedExchanges) : 0;
  if (study.sampling === 'failure-focused') cases = Math.min(cases, negativeCandidates);
  const reason = !sourceMatches ? 'source-changed' : usage.paidExecutedWork === 0 || usage.paidCompletedExchanges === 0 || usage.paidAccounts === 0
    ? 'no-paid-service' : consentAccounts === 0 ? 'no-consent-cases' : cases === 0 ? 'no-negative-cases' : 'sampled';
  return { servedAccounts, consentAccounts, negativeCandidates, reason, outcomes: feedbackOutcomes(cases, usage, study.sampling) };
}

export function feedbackProductReason(state: Readonly<GameState>, companyId: string, productId: string, content: GameContent = CONTENT): Rejection | undefined {
  const company = state.slices.company.companies[companyId], product = state.slices.products.offers[productId];
  if (!company) return reject('UNKNOWN_COMPANY', 'This company does not exist.');
  if (company.arrearsCents > 0) return reject('ARREARS', 'Resolve unpaid bills before starting customer feedback work.');
  if (!feedbackResearchReady(state, companyId)) return reject('NOT_READY', 'Research Preference tuning (R5) before collecting consented customer feedback.');
  if (!product || product.companyId !== companyId || !['basic-chat', 'developer-api'].includes(product.kind)) {
    return reject('NOT_READY', 'Choose one of your paid Chat or developer API products. Business documents, private contracts and license traffic are outside this consent protocol.');
  }
  const deployment = state.slices.products.deployments[product.deploymentId];
  if (product.status === 'deploying' || !deployment || deployment.status !== 'active') return reject('NOT_READY', 'Finish this product deployment before opening a prospective feedback study.');
  if (!inheritedModelRights(state, deployment.modelId, content).hosted) return reject('NOT_READY', 'The deployed source model must retain hosted-use rights.');
}

export function validateFeedbackCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): Rejection | undefined {
  const p = command.payload;
  if (p.kind === 'start_feedback_study') {
    if (!FEEDBACK_SAMPLING.some(item => item.id === p.sampling) || !FEEDBACK_CONSENTS.some(item => item.id === p.consent)) return reject('INVALID_COMMAND', 'Choose a supported sampling method and consent scope.');
    const reason = feedbackProductReason(state, command.companyId, p.productId, content); if (reason) return reason;
    const history = records(state.slices.data);
    if (history.some(study => study.productId === p.productId && study.status === 'collecting')
      || state.queuedCommands.some(other => other.id !== command.id && other.payload.kind === 'start_feedback_study' && other.payload.productId === p.productId)) {
      return reject('ALREADY_ACTIVE', 'This product already has an open or queued feedback study. Finish or end that study first.');
    }
    if (history.length >= RULES.maximumHistory || history.filter(study => study.productId === p.productId).length >= RULES.maximumPerProduct) {
      return reject('CAPACITY_EXCEEDED', 'The retained feedback study history is full. Review and reuse existing evidence; each product retains at most eight studies and the company retains sixteen.');
    }
    return;
  }
  if (p.kind === 'cancel_feedback_study') {
    const study = state.slices.data.feedbackStudies?.[p.studyId];
    if (!study || study.companyId !== command.companyId) return reject('NOT_READY', 'Choose one of your feedback studies.');
    if (study.status !== 'collecting') return reject('NO_IMPROVEMENT', 'This study has already closed. Its captured evidence remains available for review.');
    return;
  }
  return reject('INVALID_COMMAND', 'This is not a customer feedback command.');
}

export function quoteFeedbackCommand(_state: Readonly<GameState>, command: GameCommand, _content: GameContent = CONTENT): CommandQuote {
  if (command.payload.kind === 'start_feedback_study') {
    const p = command.payload;
    return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: `Open four prospective calendar weeks of ${p.sampling === 'representative' ? 'representative' : 'failure-focused'} feedback. ${RULES.consentBps[p.consent] / 100}% of served paying accounts opt in, at most 25 cases per week and 100 total. Actual paid serving still uses your GPUs and ordinary bills. A source deployment change stops new captures. Separate paid review is required before this evidence becomes training data.` };
  }
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: 'End the study at the next command boundary, preserving cases already collected. No cases are collected in the ending week. The preserved report can enter paid review one boundary later; an empty study produces no dataset.' };
}

export function applyFeedbackCommand(state: Readonly<GameState>, command: GameCommand, _content: GameContent = CONTENT): DomainResult {
  const data = structuredClone(state.slices.data), p = command.payload;
  if (p.kind === 'start_feedback_study') {
    const product = state.slices.products.offers[p.productId], deployment = state.slices.products.deployments[product.deploymentId];
    const id = `feedback-study:${command.id}`;
    data.feedbackStudies ??= {};
    data.feedbackStudies[id] = { id, companyId: command.companyId, productId: product.id, productKind: product.kind as FeedbackStudy['productKind'],
      protocol: RULES.protocol, sourceDeploymentId: deployment.id, sourceModelId: deployment.modelId, sourceDeployment: structuredClone(deployment),
      sourceModelFingerprint: releaseModelFingerprint(state.slices.models.versions[deployment.modelId]), sampling: p.sampling, consent: p.consent,
      status: 'collecting', startedWeek: state.week, endsWeek: state.week + RULES.weeks - 1,
      endedEarly: false, closedWeek: null, reviewableWeek: null, endCommandId: null, weeks: [], totalCases: 0, totalNegativeCases: 0,
      lastBottleneck: 'Waiting for this week’s actual paid service and opted-in accounts.' };
    return { updates: { data }, messages: [{ companyId: command.companyId, category: 'project', message: `${product.name}: customer feedback study opened for Weeks ${state.week}–${state.week + RULES.weeks - 1}. Only prospective, consented paid service contributes.` }] };
  }
  if (p.kind === 'cancel_feedback_study') {
    const study = data.feedbackStudies![p.studyId];
    study.status = 'closed'; study.endedEarly = true; study.closedWeek = state.week; study.reviewableWeek = state.week + 1; study.endCommandId = command.id;
    study.lastBottleneck = study.totalCases > 0 ? `Study ended early. ${study.totalCases} preserved cases can enter paid review in Week ${study.reviewableWeek}.` : 'Study ended with no cases. No training dataset can be created.';
    return { updates: { data }, messages: [{ companyId: command.companyId, category: 'project', message: `Customer feedback study ended early with ${study.totalCases} preserved cases. ${study.totalCases > 0 ? `Paid review becomes available in Week ${study.reviewableWeek}.` : 'An empty study produces no training data.'}` }] };
  }
  return {};
}

/** Lab owns data; products.execute has already published this week's actual paid usage. */
export function resolveFeedback(state: Readonly<GameState>, context: ModuleContext, data: DataSlice): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const study of records(data).sort((a, b) => a.id.localeCompare(b.id))) {
    if (study.status !== 'collecting' || context.week < study.startedWeek || context.week > study.endsWeek || study.weeks.some(row => row.week === context.week)) continue;
    const product = state.slices.products.offers[study.productId], deployment = state.slices.products.deployments[product.deploymentId];
    const paidUsage = feedbackPaidUsage(state.slices.products.lastUsage[study.productId], study.productId, context.week);
    const sourceMatches = deployment.id === study.sourceDeploymentId && deployment.modelId === study.sourceModelId
      && !study.weeks.some(row => row.reason === 'source-changed');
    const counts = feedbackRowCounts(study, paidUsage, sourceMatches);
    study.weeks.push({ week: context.week, sourceId: feedbackWeekSourceId(study.companyId, study.productId, context.week),
      observedDeploymentId: deployment.id, observedModelId: deployment.modelId, observedDeployment: structuredClone(deployment),
      routingModelId: activeEfficiency(state, product.id, 'routing')?.secondaryModelId ?? null, paidUsage, ...counts });
    study.totalCases = checkedAdd(study.totalCases, counts.outcomes.cases);
    study.totalNegativeCases = checkedAdd(study.totalNegativeCases, counts.outcomes.cases - counts.outcomes.useful);
    study.lastBottleneck = counts.reason === 'sampled' ? `${counts.outcomes.cases} cases collected this week; ${study.totalCases} total. The study closes after Week ${study.endsWeek}.`
      : `${FEEDBACK_ROW_LABELS[counts.reason]}. The calendar window still ends after Week ${study.endsWeek}.`;
    if (context.week === study.endsWeek) {
      study.status = 'closed'; study.closedWeek = context.week; study.reviewableWeek = context.week + 1;
      study.lastBottleneck = study.totalCases > 0 ? `${study.totalCases} cases captured. Paid human review can begin in Week ${study.reviewableWeek}.` : 'The four-week window closed without consented paid cases. No training dataset can be created.';
      messages.push({ companyId: study.companyId, category: 'project', message: `${product.name}: feedback collection closed with ${study.totalCases} cases. ${study.totalCases > 0 ? `Paid review becomes available in Week ${study.reviewableWeek}; collecting alone changes no model.` : 'No dataset was created.'}` });
    }
  }
  return messages;
}
