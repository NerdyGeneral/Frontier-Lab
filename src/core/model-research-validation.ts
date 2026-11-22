import type { GameState } from '../contracts/types';
import { CAMPAIGN_ORIGINS } from '../content/campaign-origins';
import { checkedInteger } from './math';
import { modelResearchQuoteForLevel, MODEL_RESEARCH_FOCUSES, MODEL_RESEARCH_PREREQUISITE } from '../modules/model-research';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160 && !['__proto__', 'constructor', 'prototype'].includes(value);

export function assertModelResearchState(state: GameState): void {
  const projects = state.slices.research.modelResearch;
  if (projects === undefined) return;
  check(!!projects && typeof projects === 'object' && !Array.isArray(projects), 'Architecture research must be a record.');
  const entries = Object.entries(projects);
  check(entries.length <= 100_000, 'Too many saved architecture research projects.');
  const byCompany = new Map<string, typeof entries>();
  for (const [key, project] of entries) {
    check(project && typeof project === 'object' && !Array.isArray(project), 'Architecture project is invalid.');
    check(identifier(key) && key === project.id && key.startsWith('model-research-'), 'Architecture project identity is invalid.');
    check(identifier(project.companyId) && Object.hasOwn(state.slices.company.companies, project.companyId), 'Architecture research has no company owner.');
    checkedInteger(project.level); check(project.level > 0 && project.level <= 100_000, 'Architecture level is invalid.');
    checkedInteger(project.startedWeek); check(project.startedWeek <= state.week, 'Architecture research starts in the future.');
    if (project.focus !== undefined) {
      check(Object.hasOwn(MODEL_RESEARCH_FOCUSES, project.focus), 'Architecture research focus is invalid.');
      check(project.focusFactId === `${key}:focus:${project.focus}` && state.slices.company.postedFacts[project.focusFactId] === true, 'Architecture focus changed after its paid admission.');
      for (const focus of Object.keys(MODEL_RESEARCH_FOCUSES)) if (focus !== project.focus) check(!state.slices.company.postedFacts[`${key}:focus:${focus}`], 'Architecture research has multiple focus receipts.');
      const focusFact = state.slices.company.ledger.find(fact => fact.id === project.focusFactId);
      if (focusFact) check(focusFact.companyId === project.companyId && focusFact.sourceId === project.id && focusFact.week === project.startedWeek
        && focusFact.amountCents === 0 && focusFact.kind === 'expense' && focusFact.category === 'operating', 'Research focus receipt changed its owner, boundary or price.');
    } else {
      check(project.focusFactId === undefined && Object.keys(MODEL_RESEARCH_FOCUSES).every(focus => !state.slices.company.postedFacts[`${key}:focus:${focus}`]), 'Historical architecture research invented or removed a focus receipt.');
    }
    const quote = modelResearchQuoteForLevel(project.level);
    check(project.feeCents === quote.feeCents && project.requiredWork === quote.requiredWork && project.requiredStaff === quote.requiredStaff, 'Architecture research changed its frozen price or work requirements.');
    checkedInteger(project.completedWork); checkedInteger(project.completedStaff); checkedInteger(project.physicalWork); checkedInteger(project.lastProgress);
    check(project.completedWork <= project.requiredWork && project.completedStaff <= project.requiredStaff && project.lastProgress <= project.completedWork,
      'Architecture research progress exceeds its requirements.');
    check(project.completedWork === 0 ? project.physicalWork === 0 : project.physicalWork > 0, 'Architecture research has no paid physical compute.');
    check(['running', 'paused', 'complete'].includes(project.status), 'Architecture research status is invalid.');
    check(typeof project.lastBottleneck === 'string' && project.lastBottleneck.length <= 2000, 'Architecture research explanation is invalid.');
    const receipt = state.commandReceipts[key.slice('model-research-'.length)];
    check(receipt?.status === 'accepted' && receipt.week === project.startedWeek, 'Architecture research has no accepted admission at its saved boundary.');
    check(state.slices.company.postedFacts[key + ':fee'] === true, 'Architecture research has no posted entry fee.');
    const fee = state.slices.company.ledger.find(fact => fact.id === key + ':fee');
    if (fee) check(fee.amountCents === project.feeCents && fee.companyId === project.companyId && fee.sourceId === project.id
      && fee.week === project.startedWeek && fee.kind === 'expense' && fee.category === 'operating', 'Architecture entry fee does not match the saved project.');
    const known = state.slices.research.completedByCompany[project.companyId] ?? [];
    check(known.includes(MODEL_RESEARCH_PREREQUISITE), 'Architecture research began without evaluation methods.');
    if (project.companyId === state.playerCompanyId) {
      const founding = CAMPAIGN_ORIGINS[state.slices.campaign.origin ?? 'garage'].knowledge.includes(MODEL_RESEARCH_PREREQUISITE);
      check(founding || Object.values(state.slices.research.projects).some(prerequisite => prerequisite.companyId === project.companyId
        && prerequisite.researchId === MODEL_RESEARCH_PREREQUISITE && prerequisite.status === 'complete'
        && prerequisite.availableWeek !== undefined && prerequisite.availableWeek <= project.startedWeek), 'Architecture research began before its prerequisite became available.');
    }
    if (project.status === 'complete') {
      checkedInteger(project.completedWeek!); checkedInteger(project.availableWeek!);
      check(project.completedWeek! >= project.startedWeek && project.completedWeek! <= state.week && project.availableWeek === project.completedWeek! + 1
        && project.completedWork === project.requiredWork && project.completedStaff === project.requiredStaff, 'Architecture knowledge was awarded before paid work finished.');
    } else {
      check(project.completedWeek === undefined && project.availableWeek === undefined, 'Unfinished architecture research invented an availability week.');
      check(project.completedWork < project.requiredWork || project.completedStaff < project.requiredStaff, 'Completed architecture work was not resolved.');
      if (project.status === 'paused') check(project.lastProgress === 0, 'Paused architecture research is still progressing.');
    }
    const companyEntries = byCompany.get(project.companyId) ?? [];
    companyEntries.push([key, project]); byCompany.set(project.companyId, companyEntries);
  }
  for (const companyEntries of byCompany.values()) {
    companyEntries.sort((a, b) => a[1].level - b[1].level);
    for (let index = 0; index < companyEntries.length; index++) {
      const project = companyEntries[index][1], previous = companyEntries[index - 1]?.[1];
      check(project.level === index + 1, 'Architecture research skipped or duplicated a level.');
      if (previous) check(previous.status === 'complete' && previous.availableWeek !== undefined && previous.availableWeek <= project.startedWeek,
        'Architecture iterations overlapped or used knowledge before it was available.');
    }
  }
}
