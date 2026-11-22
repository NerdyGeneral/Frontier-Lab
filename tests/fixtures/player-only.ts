import type { GameContent, GameState } from '../../src/contracts/types';
import { CONTENT } from '../../src/content/catalog';
import { createInitialState } from '../../src/core/engine';

/** Isolated module fixtures only. Production new games always include live rivals. */
export function createPlayerOnlyState(content: GameContent = CONTENT): GameState {
  const state = createInitialState(content), id = state.playerCompanyId;
  const owned = <T extends { companyId: string }>(records: Record<string, T>) => Object.fromEntries(Object.entries(records).filter(([, value]) => value.companyId === id));
  state.slices.company.companies = { [id]: state.slices.company.companies[id] };
  state.slices.company.staff = owned(state.slices.company.staff);
  state.slices.company.founderAssignments = { [id]: state.slices.company.founderAssignments[id] };
  state.slices.compute.fleets = owned(state.slices.compute.fleets);
  state.slices.models.versions = owned(state.slices.models.versions);
  state.slices.models.reports = owned(state.slices.models.reports);
  state.slices.data.packets = Object.fromEntries(Object.entries(state.slices.data.packets).filter(([, p]) => p.companyId === id));
  state.slices.research.completedByCompany = { [id]: [] };
  state.slices.products.offers = owned(state.slices.products.offers);
  state.slices.products.deployments = owned(state.slices.products.deployments);
  state.slices.products.contracts = owned(state.slices.products.contracts);
  state.slices.products.activeIds = [];
  state.slices.markets.cohorts = [];
  state.slices.markets.trials = [];
  state.slices.markets.rivals = {}; state.slices.markets.activeRivalIds = [];
  state.slices.markets.companyTrustBps = { [id]: 5000 };
  return state;
}
