import { FAMILY_DESIGNS } from '../content/wave2-lab';
import { SYNTHETIC_RULES as RULES } from '../content/wave26-synthetic';
import type { GameState, ModelVersion, Rejection } from '../contracts/types';
import type { SyntheticTrainingReceipt } from '../contracts/wave26-synthetic';
import type { TrainingOptions } from './lab-planner';
import { syntheticModelAncestry } from './synthetic-evidence';

export function createSyntheticTrainingReceipt(state: Readonly<GameState>, base: ModelVersion, packetId: string): SyntheticTrainingReceipt | undefined {
  const packet = state.slices.data.packets[packetId], provenance = packet?.synthetic;
  const job = provenance ? state.slices.data.syntheticJobs?.[provenance.jobId] : undefined;
  if (!job || !job.audit || job.phase !== 'complete') return undefined;
  const rootId = syntheticModelAncestry(state, base.id).find(id => !state.slices.models.versions[id]?.parentModelId);
  const anchor = base.foundationAnchor ?? state.slices.models.versions[rootId ?? base.id]?.capabilityBps ?? base.capabilityBps;
  const targetBps = Math.max(0, Math.min(FAMILY_DESIGNS[base.family].ceilings[job.domain], job.teacherScoreBps - RULES.teacherMarginBps,
    anchor[job.domain] + RULES.maximumTargetGainBps));
  return { packetId: packet.id, jobId: job.id, teacherModelId: job.teacherModelId, domain: job.domain,
    teacherScoreBps: job.teacherScoreBps, targetBps, acceptedUnits: job.audit.acceptedUnits, sourceKey: job.sourceKey, auditFingerprint: job.audit.fingerprint };
}
export function validateSyntheticTraining(state: Readonly<GameState>, companyId: string, options: TrainingOptions): Rejection | undefined {
  const ids = Array.isArray(options.packetIds) && options.packetIds.length ? options.packetIds : [options.packetId];
  // Public previews may contain unfinished form values. The ordinary replay and
  // curriculum validators report their shape errors after this provenance guard.
  const replayIds = Array.isArray(options.replay?.packetIds) ? options.replay.packetIds : [];
  const tracks = Array.isArray(options.curriculum?.tracks) ? options.curriculum.tracks : [];
  const allIds = [...ids, ...replayIds, ...tracks.flatMap(track => Array.isArray(track?.packetIds) ? track.packetIds : [])];
  const synthetic = allIds.some(id => !!state.slices.data.packets[id]?.synthetic
    || state.slices.data.packets[id]?.sourceIds?.some(source => source.startsWith('synthetic-')));
  const reject = (message: string): Rejection => ({ code: 'NOT_READY', message });
  if (options.recipeId !== RULES.recipeId) return synthetic ? reject('Audited synthetic evidence belongs to the targeted synthetic curriculum. It cannot bypass its teacher or audit rules through ordinary, replay or mixed-corpus training.') : undefined;
  const base = state.slices.models.versions[options.baseModelId], packet = state.slices.data.packets[options.packetId];
  const job = packet?.synthetic ? state.slices.data.syntheticJobs?.[packet.synthetic.jobId] : undefined;
  if (!base || !job || job.companyId !== companyId || job.phase !== 'complete' || !job.audit || job.availableWeek === null || job.availableWeek > state.week
    || packet!.id !== job.outputPacketId || !packet!.prepared || job.audit.acceptedUnits < RULES.trainingEvidence) return reject('Choose one accepted, audited synthetic packet with at least 40 unique units. Generation and audit do not train the student.');
  if (new Set(ids).size !== 1 || ids[0] !== packet!.id || options.replay || options.curriculum || options.asAdapter || options.profile || options.automatedCheckpoints) return reject('Use exactly one accepted synthetic packet with the fixed targeted curriculum; replay, adapters, profile rerolls and extra checkpoints are separate methods.');
  if (syntheticModelAncestry(state, base.id).includes(job.teacherModelId)) return reject('Choose a separate student. The teacher and its descendants cannot train on their own generated answers.');
  const receipt = createSyntheticTrainingReceipt(state, base, packet!.id)!;
  if (receipt.targetBps <= base.capabilityBps[receipt.domain]) return { code: 'NO_IMPROVEMENT', message: 'This student already reaches the fixed synthetic target below the teacher. Repeated packets or descendants cannot compound the gain.' };
}
