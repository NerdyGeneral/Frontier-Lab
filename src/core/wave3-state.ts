import type { GameState } from '../contracts/types';

/** Add inert records only. No new income, jobs, customers, research, or random draws. */
export function initializeWave3Fields(state: GameState): void {
  state.slices.agents.jobs ??= {};
  state.slices.agents.actionReceipts ??= {};
  state.slices.agents.invoices ??= [];
  state.slices.agents.claims ??= {};
  state.slices.agents.totalsByCompany ??= {};
  state.slices.products.retrievalInstalls ??= {};
  state.slices.products.commercialContracts ??= {};
  state.slices.products.commercialInvoices ??= [];
}
