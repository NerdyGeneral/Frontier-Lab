import type { GameState } from '../contracts/types';

/** New systems begin inert. Preserve all historical work, bills, IDs and random streams. */
export function initializeWave4Fields(state: GameState): void {
  state.slices.compute.chipDesigns ??= {};
  state.slices.compute.chipBatches ??= {};
  state.slices.compute.fabricProjects ??= {};
  state.slices.compute.servingHistory ??= {};
  state.slices.models.applicationRuns ??= {};
  state.slices.products.efficiencyInstalls ??= {};
  state.slices.research.systemRollouts ??= {};
  state.slices.research.assistantsByCompany ??= {};
  state.slices.campaign.history ??= [];
  state.slices.campaign.endings ??= {};
}
