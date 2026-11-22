/** Paid movement preserves the purchased asset and its original installation. */
export type RackRelocationCommand =
  | { kind: 'start_rack_relocation'; rackId: string; destination: string }
  | { kind: 'set_rack_relocation_paused'; relocationId: string; paused: boolean };

export interface RackRelocationStage {
  startedWeek: number | null;
  elapsedWeeks: number;
  completedStaff: number;
  completedWeek: number | null;
}

export interface RackRelocation {
  id: string;
  companyId: string;
  rackId: string;
  sourceLocation: string;
  destination: string;
  restoreStatus: 'installed' | 'parked';
  status: 'moving' | 'ready' | 'complete';
  paused: boolean;
  startedWeek: number;
  readyWeek: number | null;
  completedWeek: number | null;
  stageIndex: number;
  stages: RackRelocationStage[];
  paidCents: number;
  paymentId: string;
  hardwareId: string;
  usableCU: number;
  purchaseCents: number;
  originalInstalledWeek: number;
  lastBottleneck: string;
}

export interface RackRelocationSliceFields {
  rackRelocations?: Record<string, RackRelocation>;
}
