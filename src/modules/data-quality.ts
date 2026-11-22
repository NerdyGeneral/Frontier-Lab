import type { DataPacket, GameState } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { DataDeduplicationReceipt, TrainingDeduplicationReceipt } from '../contracts/wave6-data';
import { DATA_DEDUPLICATION, DATA_REPEAT_PROFILES } from '../content/wave6-data';
import { checkedAdd, mulDiv } from '../core/math';

export function dataProcessingProfile(packet: DataPacket) {
  const profile = packet.catalogId ? DATA_REPEAT_PROFILES[packet.catalogId] : undefined;
  const duplicateProcessingUnits = profile ? mulDiv(packet.rawUnits, profile.repeatBps, 10000, 'ceil') : 0;
  const processedUnits = checkedAdd(packet.rawUnits, duplicateProcessingUnits);
  return {
    sourceUnits: packet.rawUnits,
    duplicateProcessingUnits,
    processedUnits,
    reductionBps: processedUnits ? Math.min(DATA_DEDUPLICATION.maximumWorkReductionBps, mulDiv(duplicateProcessingUnits, 10000, processedUnits)) : 0,
    explanation: profile?.explanation ?? 'No repeated-processing profile is authored for this source.',
    requiredStaff: Math.max(DATA_DEDUPLICATION.minimumDataStaffWeeks, Math.ceil(packet.rawUnits / DATA_DEDUPLICATION.unitsPerDataStaffWeek)) * U,
  };
}

export function deduplicationRollout(state: Readonly<GameState>, companyId: string) {
  return Object.values(state.slices.research.systemRollouts ?? {}).find(rollout => rollout.companyId === companyId && rollout.method === 'deduplication');
}

export function createDeduplicationReceipt(packet: DataPacket, rolloutId: string): DataDeduplicationReceipt {
  const { sourceUnits, duplicateProcessingUnits, processedUnits, reductionBps } = dataProcessingProfile(packet);
  return { sourcePacketId: packet.id, rolloutId, sourceUnits, duplicateProcessingUnits, processedUnits, reductionBps };
}

/**
 * The ordinary corpus still chooses the best quality for each distinct source.
 * An equivalent cleaned selection supplies only its processing saving. Selecting
 * an older, lower-quality cleaned packet cannot discount a newer dirty revision.
 */
export function trainingDeduplicationReceipt(packets: readonly DataPacket[], originalWorkCUw: number): TrainingDeduplicationReceipt | undefined {
  if (!packets.some(packet => packet.prepared && packet.deduplication)) return;
  const sources = new Map<string, DataPacket>();
  for (const packet of [...packets].sort((a, b) => b.qualityBps - a.qualityBps || a.id.localeCompare(b.id))) {
    for (const sourceId of packet.sourceIds ?? [packet.id]) if (!sources.has(sourceId)) sources.set(sourceId, packet);
  }
  let totalUnits = 0, removedProcessing = 0;
  const sourceIds: string[] = [];
  for (const [sourceId, selected] of [...sources.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const units = mulDiv(selected.prepared ? selected.readyUnits : 0, U, selected.sourceIds?.length ?? 1);
    totalUnits = checkedAdd(totalUnits, units);
    const cleaned = packets.find(packet => packet.prepared && packet.deduplication && packet.qualityBps === selected.qualityBps
      && packet.readyUnits === selected.readyUnits && (packet.sourceIds ?? [packet.id]).includes(sourceId));
    if (cleaned?.deduplication && units) {
      sourceIds.push(sourceId);
      removedProcessing = checkedAdd(removedProcessing, mulDiv(units, cleaned.deduplication.reductionBps, 10000));
    }
  }
  if (!totalUnits || !removedProcessing) return;
  const reductionBps = Math.min(DATA_DEDUPLICATION.maximumWorkReductionBps, mulDiv(removedProcessing, 10000, totalUnits));
  const savedWorkCUw = mulDiv(originalWorkCUw, reductionBps, 10000);
  return savedWorkCUw ? { sourceIds, reductionBps, originalWorkCUw, savedWorkCUw } : undefined;
}

export function getDataQualityView(state: Readonly<GameState>, packet: DataPacket) {
  const companyId = packet.companyId ?? state.playerCompanyId;
  const rollout = deduplicationRollout(state, companyId);
  const profile = dataProcessingProfile(packet);
  const job = Object.values(state.slices.data.preparationJobs).find(item => item.packetId === packet.id);
  return {
    ...profile, rollout,
    researched: (state.slices.research.completedByCompany[companyId] ?? []).includes('R2A'),
    cleaned: packet.prepared && !!packet.deduplication,
    pending: !!packet.deduplication && !packet.prepared,
    job: job ?? null,
    receipt: packet.deduplication ?? null,
  };
}
