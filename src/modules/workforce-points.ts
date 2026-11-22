import { RESOURCE_SCALE } from '../contracts/types';
import type { RoleAllocation, StaffMember, StaffRole } from '../contracts/types';
import { checkedInteger, mulDiv } from '../core/math';

/** Twenty displayed points equal one existing normalized staff-work unit.
 * Stored project requirements, completed work and time assignments do not change. */
export const WORK_POINTS_PER_UNIT = 20;

export const WORK_POINT_LABELS: Readonly<Record<StaffRole, string>> = Object.freeze({
  research: 'Research', ml: 'Design', data: 'Data', infrastructure: 'Operations',
  commercial: 'Business', hardware: 'Hardware',
});

/** Displayed point counts for a ready employee assigned their full week.
 * Use getStaffPointProfile/getEmployeeWorkOutput for normalized resource units. */
export const STAFF_POINT_PROFILES: Readonly<Record<StaffRole, Readonly<RoleAllocation>>> = Object.freeze({
  research: Object.freeze({ research: 30, ml: 10, data: 5, infrastructure: 0, commercial: 0, hardware: 0 }),
  ml: Object.freeze({ research: 10, ml: 30, data: 5, infrastructure: 0, commercial: 0, hardware: 0 }),
  data: Object.freeze({ research: 5, ml: 10, data: 30, infrastructure: 0, commercial: 0, hardware: 0 }),
  infrastructure: Object.freeze({ research: 0, ml: 10, data: 5, infrastructure: 30, commercial: 0, hardware: 0 }),
  commercial: Object.freeze({ research: 5, ml: 10, data: 0, infrastructure: 0, commercial: 30, hardware: 0 }),
  hardware: Object.freeze({ research: 5, ml: 10, data: 0, infrastructure: 0, commercial: 0, hardware: 30 }),
});

const roles = Object.keys(WORK_POINT_LABELS) as StaffRole[];
const emptyOutput = (): RoleAllocation => ({ research: 0, ml: 0, data: 0, infrastructure: 0, commercial: 0, hardware: 0 });

/** Presentation conversion only. Engine grants continue using safe integer units. */
export function workUnitsToPoints(units: number): number {
  return checkedInteger(units, 'Work units', false) / RESOURCE_SCALE * WORK_POINTS_PER_UNIT;
}

/** No unit suffix, so callers can name the point type or weekly period. */
export function formatWorkPoints(units: number): string {
  const points = workUnitsToPoints(units);
  return points.toLocaleString('en-US', { maximumFractionDigits: points !== 0 && Math.abs(points) < 0.01 ? 8 : 2 });
}

/** Potential output in normalized resource units, before the readiness check. */
export function getStaffPotentialOutput(role: StaffRole, assignedFte = RESOURCE_SCALE): RoleAllocation {
  checkedInteger(assignedFte, 'Employee time allocation');
  if (assignedFte > RESOURCE_SCALE) throw new Error('Employee time allocation cannot exceed 100%.');
  const profile = STAFF_POINT_PROFILES[role];
  if (!profile) throw new Error('Employee point output needs a recognized role.');
  return Object.fromEntries(roles.map(pointRole => [pointRole, mulDiv(assignedFte, profile[pointRole], WORK_POINTS_PER_UNIT)])) as RoleAllocation;
}

/** A full-time profile in normalized resource units, suitable for formatWorkPoints. */
export function getStaffPointProfile(role: StaffRole): RoleAllocation {
  return getStaffPotentialOutput(role);
}

/** Each ready employee supplies one shared weekly profile. Nothing is banked. */
export function getEmployeeWorkOutput(member: Pick<StaffMember, 'role' | 'assignedFte' | 'readyWeek'>, week: number): RoleAllocation {
  return member.readyWeek > week ? emptyOutput() : getStaffPotentialOutput(member.role, member.assignedFte);
}

export const getStaffPointOutput = getEmployeeWorkOutput;

/** The founder's existing shared time budget supplies twenty points per full week. */
export function getFounderPointOutput(assignments: Readonly<RoleAllocation>): RoleAllocation {
  return { ...assignments };
}
