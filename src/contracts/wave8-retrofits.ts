/** Paid physical site extensions. Money uses cents; staff and envelope units use 1e9. */
export type FacilityRetrofitKind = 'power-feed' | 'cooling-loop';

export type FacilityRetrofitCommand =
  | { kind: 'start_facility_retrofit'; facilityId: string; retrofitKind: FacilityRetrofitKind }
  | { kind: 'set_facility_retrofit_paused'; retrofitId: string; paused: boolean };

export interface FacilityRetrofit {
  id: string;
  companyId: string;
  facilityId: string;
  kind: FacilityRetrofitKind;
  status: 'building' | 'ready' | 'active';
  paused: boolean;
  startedWeek: number;
  requiredWeeks: number;
  elapsedWeeks: number;
  requiredStaff: number;
  completedStaff: number;
  completedWeek: number | null;
  readyWeek: number | null;
  purchaseCents: number;
  paymentId: string;
  lastBottleneck: string;
}

export interface FacilityRetrofitSliceFields {
  /** Omitted until the first paid retrofit; existing companies retain their old representation. */
  facilityRetrofits?: Record<string, FacilityRetrofit>;
}

export interface FacilityRetrofitDefinition {
  kind: FacilityRetrofitKind;
  name: string;
  envelopeName: 'Power' | 'Cooling';
  purchaseCents: number;
  requiredWeeks: number;
  requiredStaff: number;
  envelopeUnits: number;
  weeklyCents: number;
  operatingStaff: number;
}
