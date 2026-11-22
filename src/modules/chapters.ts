import type { CommandQuote, DomainResult, GameCommand, GameState, Rejection } from '../contracts/types';
import type { ChapterId, ChapterProof } from '../contracts/strategic-variety';
import { CHAPTERS } from '../content/strategic-variety';
import { isCapabilitySuite } from './evaluation-classification';
import { hasCompletedModelTraining } from './campaign-progress';
import { productRoutingPolicy } from './product-strategy';

export const CHAPTER_COMMANDS = ['select_chapter'] as const;
export interface ChapterAssessment {
  productName: string | null;
  criteria: { label: string; met: boolean }[];
  proof: ChapterProof | null;
}
export function assessChapter(state: Readonly<GameState>, id: ChapterId): ChapterAssessment {
  const owner = state.playerCompanyId, company = state.slices.company.companies[owner];
  const previous = state.slices.campaign.chapters?.active === id ? state.slices.campaign.chapters.progress.at(-1) : undefined;
  const candidates = Object.values(state.slices.products.offers).filter(p => p.companyId === owner).map(product => {
    const model = state.slices.models.versions[state.slices.products.deployments[product.deploymentId]?.modelId];
    const usage = state.slices.products.lastUsage[product.id];
    const paid = usage?.week === state.week ? usage : undefined;
    const reports = Object.values(state.slices.models.reports).filter(r => r.companyId === owner && r.modelId === model?.id && r.heldOut && !r.scenarioStart);
    const capability = reports.find(r => isCapabilitySuite(r.suiteId));
    const advanced = reports.find(r => r.suiteId === 'advanced-capabilities-1');
    const advancedValues = Object.values(model?.advancedCapabilities ?? { reasoning: 0, longContext: 0, multimodal: 0 });
    const route = state.slices.products.efficiencyInstalls?.[product.id + ':routing'];
    const criteria = [
      { label: 'A model trained by your lab', met: !!model && hasCompletedModelTraining(state, model) },
      { label: 'Paid capability evaluation on this version', met: !!capability },
      { label: 'At least one paying account served this week', met: product.status === 'active' && !!paid?.paidAccounts && paid.billedCents > 0 },
      { label: `${id === 'first-product' ? 90 : 95}% of customer requests fulfilled`, met: !!paid && paid.fulfillmentBps >= (id === 'first-product' ? 9000 : 9500) },
    ];
    if (id === 'efficient-portfolio') criteria.push(
      { label: 'Active two-model Economy routing', met: !!route && route.enabled && route.status === 'active' && route.modelId === model?.id && !!route.secondaryModelId && productRoutingPolicy(product) === 'economy' },
      { label: 'Positive company operating surplus', met: company.lastWeek.revenueCents > company.lastWeek.operatingExpenseCents });
    if (id === 'advanced-specialist' || id === 'frontier-lab') criteria.push({ label: 'Advanced evaluation on this version', met: !!advanced });
    if (id === 'advanced-specialist') criteria.push({ label: 'At least one advanced skill at 70+', met: Math.max(...advancedValues) >= 7000 });
    if (id === 'frontier-lab') criteria.push(
      { label: 'Custom Frontier architecture', met: model?.family === 'frontier' && !!model.modelDesign },
      { label: 'All four core skills at 80+', met: !!model && Math.min(...Object.values(model.capabilityBps)) >= 8000 },
      { label: 'All three advanced skills at 60+', met: Math.min(...advancedValues) >= 6000 },
      { label: 'Positive company operating surplus', met: company.lastWeek.revenueCents > company.lastWeek.operatingExpenseCents });
    const proof: ChapterProof | null = model && paid && criteria.every(c => c.met) ? {
      week: state.week, productId: product.id, modelId: model.id,
      reportIds: [capability?.id, advanced?.id].filter((value): value is string => !!value),
      paidAccounts: paid.paidAccounts, billedCents: paid.billedCents, fulfillmentBps: paid.fulfillmentBps,
      revenueCents: company.lastWeek.revenueCents, operatingExpenseCents: company.lastWeek.operatingExpenseCents,
      routingPolicy: productRoutingPolicy(product), strategyCommandId: product.strategy?.commandId ?? null,
      routingInstallationId: route?.status === 'active' && route.enabled && route.modelId === model.id ? route.id : null,
      secondaryModelId: route?.status === 'active' && route.enabled && route.modelId === model.id ? route.secondaryModelId ?? null : null,
    } : null;
    return { productName: product.name, criteria, proof };
  });
  // Keep a qualifying product's streak when another product catches up later.
  const continuing = (candidate: ChapterAssessment) => !!previous && candidate.proof?.productId === previous.productId && candidate.proof.modelId === previous.modelId;
  return candidates.sort((a, b) => Number(!!b.proof) - Number(!!a.proof) || Number(continuing(b)) - Number(continuing(a)) || b.criteria.filter(c => c.met).length - a.criteria.filter(c => c.met).length)[0]
    ?? { productName: null, criteria: CHAPTERS[id].requirements.map(label => ({ label, met: false })), proof: null };
}

export function validateChapterCommand(state: Readonly<GameState>, command: GameCommand): Rejection | undefined {
  const p = command.payload;
  if (p.kind !== 'select_chapter' || !Object.hasOwn(CHAPTERS, p.chapterId)) return { code: 'INVALID_COMMAND', message: 'Choose a listed company chapter.' };
  if (command.companyId !== state.playerCompanyId) return { code: 'NOT_READY', message: 'Choose a chapter for your own lab.' };
  const chapters = state.slices.campaign.chapters;
  if (chapters?.completed[p.chapterId]) return { code: 'NO_IMPROVEMENT', message: 'This chapter is already earned permanently. Choose another goal.' };
  if (chapters?.active === p.chapterId || state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId && other.payload.kind === p.kind)) return { code: 'ALREADY_ACTIVE', message: 'This chapter is already selected or a chapter change is queued.' };
}
export function quoteChapterCommand(command: GameCommand): CommandQuote {
  const p = command.payload;
  if (p.kind !== 'select_chapter') throw new Error('Expected a chapter choice.');
  const chapter = CHAPTERS[p.chapterId];
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: `Focus on “${chapter.title}” from next week. Meet its requirements for ${chapter.weeks} ${chapter.weeks === 1 ? 'week' : 'consecutive weeks'}. Completion is recorded automatically and remains earned after changing goals.` };
}
export function applyChapterCommand(state: Readonly<GameState>, command: GameCommand): DomainResult {
  const p = command.payload;
  if (p.kind !== 'select_chapter') return {};
  const campaign = structuredClone(state.slices.campaign);
  campaign.chapters = { active: p.chapterId, selectedWeek: state.week, selectionCommandId: command.id, streak: 0, progress: [], completed: campaign.chapters?.completed ?? {} };
  return { updates: { campaign }, messages: [{ companyId: command.companyId, category: 'project', message: `Chapter selected: ${CHAPTERS[p.chapterId].title}. Your settled results now track this goal.` }] };
}
export function advanceChapters(campaign: GameState['slices']['campaign'], state: Readonly<GameState>): Array<{ companyId: string; category: 'project'; message: string }> {
  const chapters = campaign.chapters, id = chapters?.active;
  if (!chapters || !id || chapters.completed[id] || state.week < chapters.selectedWeek) return [];
  if (chapters.progress.at(-1)?.week === state.week) return [];
  const assessment = assessChapter(state, id), previous = chapters.progress.at(-1);
  if (!assessment.proof) { chapters.streak = 0; chapters.progress = []; return []; }
  const continued = !!previous && previous.week === state.week - 1 && previous.productId === assessment.proof.productId && previous.modelId === assessment.proof.modelId;
  chapters.progress = [...(continued ? chapters.progress : []), assessment.proof].slice(-CHAPTERS[id].weeks);
  chapters.streak = chapters.progress.length;
  if (chapters.streak < CHAPTERS[id].weeks) return [];
  chapters.completed[id] = { id, selectedWeek: chapters.selectedWeek, selectionCommandId: chapters.selectionCommandId, completedWeek: state.week, proof: structuredClone(chapters.progress) };
  return [{ companyId: state.playerCompanyId, category: 'project', message: `Chapter earned: ${CHAPTERS[id].title}. This achievement is saved permanently; choose your next chapter when ready.` }];
}
