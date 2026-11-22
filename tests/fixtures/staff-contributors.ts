import type { GameState, StaffRole } from '../../src/contracts/types';
import { getStaffPotentialOutput } from '../../src/modules/workforce-points';

/** A starvation fixture must remove secondary output as well as the named specialist.
 * Callers still use ordinary allocation commands; this never changes a saved state. */
export function staffContributors(state: GameState, role: StaffRole) {
  return Object.values(state.slices.company.staff).filter(member =>
    member.companyId === state.playerCompanyId && getStaffPotentialOutput(member.role)[role] > 0);
}
