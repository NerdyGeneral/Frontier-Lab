import type { Deployment } from './wave1';

export type PreparedReleaseCommand =
  | { kind: 'start_prepared_release'; productId: string; candidateModelId: string }
  | { kind: 'set_prepared_release_paused'; releaseId: string; paused: boolean }
  | { kind: 'discard_prepared_release'; releaseId: string }
  | { kind: 'promote_prepared_release'; releaseId: string }
  | { kind: 'start_release_rollback'; releaseId: string };

/** Ordinary development and ML grants paid to assemble one deployment bundle. */
export interface ReleasePreparationWork {
  startCommandId: string;
  startedWeek: number;
  requiredWork: number;
  completedWork: number;
  physicalWork: number;
  requiredStaff: number;
  completedStaff: number;
  requiredMemory: number;
  paused: boolean;
  completedWeek: number | null;
  availableWeek: number | null;
  promotionCommandId: string | null;
  promotionWeek: number | null;
  cutoverWeek: number | null;
  lastProgress: number;
  lastBottleneck: string;
  lastGrant: { week: number; requestedWork: number; grantedWork: number; physicalWork: number; memoryMU: number; poolId: string; staff: number } | null;
}

/** The original rollback deadline is never extended by preparation or pausing. */
export interface ReleaseRollback extends ReleasePreparationWork {
  id: string;
  status: 'preparing' | 'ready' | 'scheduled' | 'complete' | 'discarded';
  sourceDeploymentId: string;
  configurationFingerprint: string;
  restoredDeploymentId: string | null;
  restoredWeek: number | null;
}

export interface PreparedRelease extends ReleasePreparationWork {
  id: string;
  companyId: string;
  productId: string;
  rehearsalId: string;
  sourceDeployment: Deployment;
  sourceModelId: string;
  candidateModelId: string;
  configurationFingerprint: string;
  status: 'preparing' | 'ready' | 'scheduled' | 'released' | 'discarded';
  candidateDeploymentId: string | null;
  releasedWeek: number | null;
  postCutoverFingerprint: string | null;
  rollbackExpiresWeek: number | null;
  rollback?: ReleaseRollback;
}

export interface Wave9ReleaseFields {
  preparedReleases?: Record<string, PreparedRelease>;
}
