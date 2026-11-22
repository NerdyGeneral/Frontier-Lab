import type { AdvancedCorpusEvidence, AdvancedScores, AdvancedTrainingReceipt } from '../contracts/advanced-skills';
import type { DataPacket, GameState, ModelVersion, TrainingRun } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import { ADVANCED_DOMAINS } from '../content/advanced-skills';
import { canonicalStateHash } from '../core/canonical';
import { checkedAdd, checkedInteger, mulDiv } from '../core/math';
import { finiteOutcome } from './lab-math';

export const emptyAdvancedScores = (): AdvancedScores => ({ reasoning: 0, longContext: 0, multimodal: 0 });
export const advancedScores = (model: Pick<ModelVersion, 'advancedCapabilities'>): AdvancedScores => ({ ...emptyAdvancedScores(), ...model.advancedCapabilities });

/** Match historical source identities without importing the training planner back into itself. */
function sources(packet: DataPacket): string[] {
  return packet.sourceIds?.length ? [...new Set(packet.sourceIds)].sort()
    : ['legacy-' + canonicalStateHash({ rawUnits: packet.rawUnits, coverageBps: packet.coverageBps, rights: packet.rights })];
}

/** Reusing or renaming a source does not multiply its evidence; its best selected revision wins. */
export function getAdvancedCorpusEvidence(state: Readonly<GameState>, companyId: string, packetIds: readonly string[]): AdvancedCorpusEvidence {
  const packets = [...new Set(packetIds)].map(id => state.slices.data.packets[id])
    .filter(packet => packet && (packet.companyId ?? state.playerCompanyId) === companyId);
  const sourceMap = new Map<string, DataPacket>();
  for (const packet of [...packets].sort((a, b) => b.qualityBps - a.qualityBps || a.id.localeCompare(b.id)))
    for (const sourceId of sources(packet)) if (!sourceMap.has(sourceId)) sourceMap.set(sourceId, packet);
  const relevantUnits = emptyAdvancedScores(), qualityNumerator = emptyAdvancedScores(), fingerprints: unknown[] = [];
  for (const [sourceId, packet] of [...sourceMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const units = mulDiv(packet.prepared ? packet.readyUnits : 0, U, sources(packet).length);
    const coverage = packet.advancedCoverageBps ?? emptyAdvancedScores();
    for (const domain of ADVANCED_DOMAINS) {
      const relevant = mulDiv(units, coverage[domain], 10000);
      relevantUnits[domain] = checkedAdd(relevantUnits[domain], relevant);
      qualityNumerator[domain] = checkedAdd(qualityNumerator[domain], mulDiv(relevant, packet.qualityBps, 10000));
    }
    fingerprints.push({ sourceId, units, qualityBps: packet.qualityBps, advancedCoverageBps: coverage });
  }
  const qualityBps = emptyAdvancedScores();
  for (const domain of ADVANCED_DOMAINS) qualityBps[domain] = relevantUnits[domain]
    ? mulDiv(qualityNumerator[domain], 10000, relevantUnits[domain], 'nearest') : 0;
  return { packetIds: packets.map(packet => packet.id).sort(), sourceIds: [...sourceMap.keys()].sort(), relevantUnits, qualityBps,
    fingerprint: 'advanced-corpus-' + canonicalStateHash(fingerprints) };
}

export function createAdvancedTrainingReceipt(state: Readonly<GameState>, baseModelId: string, packetIds: readonly string[],
  targets: AdvancedScores, ceilings: AdvancedScores, requiredEvidence: number, foundation: boolean): AdvancedTrainingReceipt {
  const base = state.slices.models.versions[baseModelId];
  if (!base) throw new Error('Choose a saved reference model for advanced training.');
  checkedInteger(requiredEvidence);
  if (requiredEvidence <= 0) throw new Error('Advanced training needs a positive evidence requirement.');
  const receipt = { foundation, anchors: foundation ? emptyAdvancedScores() : advancedScores(base),
    targets: { ...targets }, ceilings: { ...ceilings },
    corpus: getAdvancedCorpusEvidence(state, base.companyId, packetIds), requiredEvidence };
  for (const vector of [receipt.anchors, receipt.targets, receipt.ceilings]) for (const domain of ADVANCED_DOMAINS) {
    checkedInteger(vector[domain]); if (vector[domain] > 10000) throw new Error('Advanced skill scores must be between zero and 100.');
  }
  return receipt;
}

/** A receipt-free historical run has no newly earned advanced scores. Its model can inherit its parent. */
export function advancedTrainingOutcome(run: TrainingRun, work: number): AdvancedScores | undefined {
  const receipt = run.plan?.advanced;
  if (!receipt) return undefined;
  const scores = emptyAdvancedScores();
  for (const domain of ADVANCED_DOMAINS) scores[domain] = finiteOutcome({
    anchorBps: receipt.anchors[domain], targetBps: receipt.targets[domain], ceilingBps: receipt.ceilings[domain],
    completedWork: work, requiredWork: run.requiredWork,
    relevantEvidence: receipt.corpus.relevantUnits[domain], requiredEvidence: receipt.requiredEvidence,
    qualityBps: receipt.corpus.qualityBps[domain],
  });
  return scores;
}
