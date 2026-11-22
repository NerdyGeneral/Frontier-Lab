import type { Allocation, ComputePool, RoleAllocation, StaffRole, WorkCategory } from './types';

export type StudioPlanCommand =
  | { kind: 'assign_founder'; allocations: RoleAllocation }
  | { kind: 'set_staff_allocation'; staffId: string; fte: number }
  | { kind: 'hire_staff'; role: StaffRole }
  | { kind: 'set_cloud_capacity'; cu: number }
  | { kind: 'allocate_compute'; serving: number; development: number; research: number };
export interface ApplyStudioPlanCommand { kind: 'apply_studio_plan'; commands: StudioPlanCommand[] }
export interface StudioPlanDraft {
  founder: RoleAllocation; staff: Record<string, number>; hires: Record<StaffRole, number>;
  cloudCU: number; allocation: Allocation;
}
export interface StudioRequestView {
  id: string; taskId: string; label: string; category: WorkCategory;
  requestedWork: number; grantedWork: number; physicalWork: number;
  requestedMemory: number; grantedMemory: number; poolId: string | null; poolName: string | null;
  largestCompatibleMemory: number; staff: { role: StaffRole; requested: number; granted: number }[];
  reason: string; liveServing: boolean;
}
export interface StudioBoundaryView {
  week: number; cashCents: number; arrearsCents: number; revenueCents: number; operatingExpenseCents: number;
  upfrontCostCents: number; weeklyBaseCostCents: number; payrollCents: number; cloudRentCents: number;
  workforce: { capacity: RoleAllocation; granted: RoleAllocation; ready: number; onboarding: number };
  compute: { cloudCU: number; ownedCU: number; allocation: Allocation; lastWork: Allocation; reservedCU: number; memoryMU: number; occupiedMemoryMU: number };
  pools: ComputePool[]; requests: StudioRequestView[];
  commitments: { privateHosted: number; customerHosted: number; assured: number; reservedWorkCUw: number; supportFte: number };
}
export interface StudioPlanPreview {
  sourceHash: string; sourceRevision: number; sourceWeek: number; effectiveWeek: number;
  valid: boolean; reason: string | null; upfrontCostCents: number; weeklyCostDeltaCents: number;
  baseline: StudioBoundaryView | null; proposed: StudioBoundaryView | null;
  changes: string[]; warnings: string[];
}

export const STUDIO_PLAN_MAX_COMMANDS = 64;
export const STUDIO_PLAN_MAX_HIRES_PER_ROLE = 8;
export const STUDIO_PLAN_MAX_HIRES = 16;
export const STUDIO_PLAN_KINDS = ['assign_founder', 'set_staff_allocation', 'hire_staff', 'set_cloud_capacity', 'allocate_compute'] as const;
export const STUDIO_PLAN_CONFLICT_KINDS: readonly string[] = [...STUDIO_PLAN_KINDS, 'dismiss_staff', 'set_batch_capacity', 'apply_studio_plan'];
