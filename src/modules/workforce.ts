import { CONNECTED_COMPANY_CONTENT_VERSION } from '../core/connected-company-version';
import { AI_SYSTEMS_CONTENT_VERSION } from '../core/ai-systems-version';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION } from '../core/model-customization-version';
import { GAMEPLAY_POLISH_CONTENT_VERSION } from '../core/gameplay-polish-version';
import { STRATEGY_CONTENT_VERSION } from '../core/strategy-version';
import { MODEL_DESIGN_CONTENT_VERSION } from '../contracts/model-design';
import { RESOURCE_SCALE } from '../contracts/types';
import type { GameContent, GameState, RoleAllocation, StaffRole, WorkRequest } from '../contracts/types';
import { checkedAdd } from '../core/math';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../content/wave29';
import { careerOutput, careerSalary } from './staff-careers';
import { getEmployeeWorkOutput } from './workforce-points';

export const STAFF_ROLES: readonly StaffRole[] = ['research', 'ml', 'data', 'infrastructure', 'commercial', 'hardware'];
export const QUARTER_FTE = RESOURCE_SCALE / 4;

/** Historical replays retain their original one-role staff output and wording. */
export function usesWorkPointProfiles(state: Pick<GameState, 'contentVersion'>): boolean {
  return [WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(state.contentVersion);
}

export function emptyRoleAllocation(): RoleAllocation {
  return { research: 0, ml: 0, data: 0, infrastructure: 0, commercial: 0, hardware: 0 };
}

/** Enable the current player rules when starting or opening a playable campaign.
 * Legacy snapshots can still be validated and replayed under their original rules. */
export function withPassiveWorkforce(state: GameState): GameState {
  if (!usesWorkPointProfiles(state) || state.slices.company.passiveWorkforce) return state;
  const company = state.slices.company;
  const staff = Object.fromEntries(Object.entries(company.staff).map(([id, member]) => [
    id, member.companyId === state.playerCompanyId ? { ...member, assignedFte: RESOURCE_SCALE } : member,
  ]));
  return { ...state, slices: { ...state.slices, company: { ...company, passiveWorkforce: true, staff } } };
}

export function usesPassiveWorkforce(state: Readonly<GameState>, companyId: string): boolean {
  return companyId === state.playerCompanyId && state.slices.company.passiveWorkforce === true;
}

export function getFounderWeeklyOutput(state: Readonly<GameState>, companyId: string): RoleAllocation {
  const company = state.slices.company;
  const output = usesPassiveWorkforce(state, companyId)
    ? company.lastStaff[companyId]?.founderOutput
    : company.founderAssignments[companyId];
  return { ...emptyRoleAllocation(), ...output };
}

function getEmployees(state: Readonly<GameState>, companyId: string, week: number) {
  const capacity = emptyRoleAllocation(), passive = usesPassiveWorkforce(state, companyId);
  let ready = 0, onboarding = 0;
  for (const member of Object.values(state.slices.company.staff)) {
    if (member.companyId !== companyId) continue;
    if (member.readyWeek > week) { onboarding++; continue; }
    ready++;
    if (usesWorkPointProfiles(state)) {
      const output = passive ? careerOutput(member) : getEmployeeWorkOutput(member, week);
      for (const role of STAFF_ROLES) capacity[role] = checkedAdd(capacity[role], output[role]);
    } else capacity[member.role] = checkedAdd(capacity[member.role], member.assignedFte);
  }
  return { capacity, ready, onboarding };
}

/** A role admission check can count the flexible founder once for a single role.
 * It is never a simultaneous grant; that budget is shared at reservation. */
export function getAvailableRoleCapacity(state: Readonly<GameState>, companyId: string, role: StaffRole, week = state.week): number {
  const founder = usesPassiveWorkforce(state, companyId)
    ? (role === 'hardware' ? 0 : state.slices.company.companies[companyId].founderFte)
    : state.slices.company.founderAssignments[companyId][role];
  return checkedAdd(getEmployees(state, companyId, week).capacity[role], founder);
}

export function compareStaffPriority(a: WorkRequest, b: WorkRequest): number {
  return (a.staffPriority ?? a.priority) - (b.staffPriority ?? b.priority) || a.id.localeCompare(b.id);
}

/** Route the founder only into unmet demand after matching specialist output.
 * Use the same reservation order and one shared integer budget for all roles. */
export function getWeeklyStaffSupply(state: Readonly<GameState>, companyId: string, week: number, requests: readonly WorkRequest[]) {
  const { capacity } = getEmployees(state, companyId, week);
  const passive = usesPassiveWorkforce(state, companyId);
  const founderOutput = passive ? emptyRoleAllocation() : getFounderWeeklyOutput(state, companyId);
  if (passive) {
    let budget = state.slices.company.companies[companyId].founderFte;
    const specialists = { ...capacity };
    for (const request of requests.filter(r => r.companyId === companyId && r.staffDemand?.length).sort(compareStaffPriority)) {
      if (!budget) break;
      for (const { role, staffWeeks } of request.staffDemand!) {
        const specialistWork = Math.min(staffWeeks, specialists[role]);
        specialists[role] -= specialistWork;
        if (role === 'hardware') continue;
        const extra = Math.min(budget, staffWeeks - specialistWork);
        founderOutput[role] += extra;
        budget -= extra;
      }
    }
  }
  for (const role of STAFF_ROLES) capacity[role] = checkedAdd(capacity[role], founderOutput[role]);
  return { capacity, founderOutput };
}

export function getWorkforce(state: Readonly<GameState>, companyId: string, week = state.week) {
  const { capacity, ready, onboarding } = getEmployees(state, companyId, week);
  const founder = getFounderWeeklyOutput(state, companyId);
  for (const role of STAFF_ROLES) capacity[role] = checkedAdd(capacity[role], founder[role]);
  return { capacity, granted: { ...emptyRoleAllocation(), ...state.slices.company.lastStaff[companyId]?.granted }, ready, onboarding };
}

/** Salaries do not fall when employees are onboarding or assigned less than 1 FTE. */
export function getPayrollCents(state: Readonly<GameState>, companyId: string, content: GameContent): number {
  return Object.values(state.slices.company.staff).reduce((total, member) => {
    if (member.companyId !== companyId) return total;
    const role = content.staff.find(definition => definition.id === member.role);
    if (!role) throw new Error('A staff member has an unknown salary definition.');
    return checkedAdd(total, careerSalary(member, role.weeklyCents));
  }, 0);
}

export function isQuarterFte(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    && value <= RESOURCE_SCALE && value % QUARTER_FTE === 0;
}
