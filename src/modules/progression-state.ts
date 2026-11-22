import type { CompanyWorldId } from '../contracts/company-progression';
import type { ChapterId } from '../contracts/strategic-variety';
import type { GameState } from '../contracts/types';
import { COMPANY_WORLDS, COMPANY_WORLD_IDS } from '../content/company-progression';
import { canonicalStateHash } from '../core/canonical';
import { hasConnectedCompanyRules } from '../core/connected-company-version';

export function companyWorldId(seed: string): CompanyWorldId {
  return COMPANY_WORLD_IDS[Number.parseInt(canonicalStateHash({ seed, protocol: 'company-world-1' }).slice(0, 8), 16) % COMPANY_WORLD_IDS.length];
}
export function initializeCompanyProgression(state: GameState): void {
  if (!hasConnectedCompanyRules(state.contentVersion) || state.slices.campaign.progression) return;
  state.slices.campaign.progression = { version: 1, activatedWeek: state.week, worldId: companyWorldId(state.seed), chapters: {}, experiments: {}, ambitionHistory: [], ambitions: {} };
}
export function getCompanyWorld(state: Readonly<GameState>) {
  const progression = state.slices.campaign.progression;
  return hasConnectedCompanyRules(state.contentVersion) && progression ? COMPANY_WORLDS[progression.worldId] : null;
}
export function companyChapterEarnedWeek(state: Readonly<GameState>, id: ChapterId): number | null {
  return state.slices.campaign.progression?.chapters[id]?.achievement?.earnedWeek ?? state.slices.campaign.chapters?.completed[id]?.completedWeek ?? null;
}
export function earnedCompanyChapters(state: Readonly<GameState>, atWeek = state.week): ChapterId[] {
  return (['first-product', 'efficient-portfolio', 'advanced-specialist', 'frontier-lab'] as ChapterId[])
    .filter(id => { const week = companyChapterEarnedWeek(state, id); return week !== null && week <= atWeek; });
}
