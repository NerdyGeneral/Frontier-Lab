import { CONNECTED_COMPANY_CONTENT_VERSION } from '../core/connected-company-version';
import { AI_SYSTEMS_CONTENT_VERSION } from '../core/ai-systems-version';
import type { GameState, MarketSegmentId } from '../contracts/types';
import type { MarketOpportunityWindow } from '../contracts/market-dynamics';
import { MARKET_OPPORTUNITIES, MARKET_OPPORTUNITY_RULES as RULES } from '../content/market-dynamics';
import { canonicalStateHash } from '../core/canonical';
import { GAMEPLAY_POLISH_CONTENT_VERSION } from '../core/gameplay-polish-version';

/** Called only for a new game or a validated upgrade. Historical absent fields stay neutral. */
export function initializeMarketOpportunities(state: GameState): void {
  state.slices.markets.opportunityCalendar ??= { startedWeek: state.week,
    ...([GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(state.contentVersion) ? { sequenceVersion: 2 as const } : {}) };
}

export function marketOpportunityAt(state: Readonly<GameState>, index: number, week = state.week): MarketOpportunityWindow | null {
  const calendar = state.slices.markets.opportunityCalendar;
  if (!calendar || !Number.isSafeInteger(index) || index < 0) return null;
  const cycle = Math.floor(index / MARKET_OPPORTUNITIES.length);
  // A pure local permutation never consumes training/evaluation random streams.
  // Every four-window cycle still contains all authored markets exactly once.
  const opportunities = calendar.sequenceVersion === 2 ? [...MARKET_OPPORTUNITIES].sort((a, b) =>
    canonicalStateHash({ seed: state.seed, epoch: calendar.startedWeek, cycle, opportunity: a.id, protocol: 2 }).localeCompare(
      canonicalStateHash({ seed: state.seed, epoch: calendar.startedWeek, cycle, opportunity: b.id, protocol: 2 })) || a.id.localeCompare(b.id)) : MARKET_OPPORTUNITIES;
  const definition = opportunities[index % opportunities.length];
  const announcedWeek = calendar.startedWeek + index * RULES.intervalWeeks;
  const startsWeek = announcedWeek + RULES.noticeWeeks, endsWeek = startsWeek + RULES.activeWeeks - 1;
  return { ...definition, instanceId: `${definition.id}:${announcedWeek}`, announcedWeek, startsWeek, endsWeek,
    status: week < startsWeek ? 'announced' : week <= endsWeek ? 'active' : 'finished' };
}

/** Public knowledge only: future unannounced windows are never exposed by the view. */
export function getMarketOpportunityView(state: Readonly<GameState>, week = state.week) {
  const calendar = state.slices.markets.opportunityCalendar;
  if (!calendar || week < calendar.startedWeek) return { active: null, upcoming: null, nextAnnouncementWeek: null };
  const index = Math.floor((week - calendar.startedWeek) / RULES.intervalWeeks);
  const current = marketOpportunityAt(state, index, week)!;
  return { active: current.status === 'active' ? current : null,
    upcoming: current.status === 'announced' ? current : null,
    nextAnnouncementWeek: calendar.startedWeek + (index + 1) * RULES.intervalWeeks };
}

/** Apply exactly once to outside-population shopping, never to conversion or total population. */
export function marketOpportunityDemandMultiplierBps(state: Readonly<GameState>, segmentId: MarketSegmentId, week = state.week): number {
  const active = getMarketOpportunityView(state, week).active;
  return active?.segmentIds.includes(segmentId) ? active.demandMultiplierBps : 10000;
}

export function marketOpportunityAnnouncement(state: Readonly<GameState>, week = state.week): string | null {
  const view = getMarketOpportunityView(state, week), window = view.active ?? view.upcoming;
  if (!window) return null;
  if (week === window.announcedWeek) return `${window.name} announced for Weeks ${window.startsWeek}–${window.endsWeek}. More available customers will shop; qualification, capacity and competition still apply.`;
  if (week === window.startsWeek) return `${window.name} is open through Week ${window.endsWeek}. Existing customers and the finite market population are unchanged.`;
  return null;
}
