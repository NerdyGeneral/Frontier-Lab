import { formatWorkPoints } from './workforce-points';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { CommandQuote, DataPacket, DomainResult, GameCommand, GameContent, GameState, PreparationJob, Rejection } from '../contracts/types';
import { DATA_CATALOG } from '../content/wave2-lab';
import { canonicalStateHash } from '../core/canonical';
import { formatUnits, toUnits } from '../core/math';
import { hasResearch } from './research';
import { packetOwnedBy, packetSources } from './lab-planner';
import { createDeduplicationReceipt, dataProcessingProfile, deduplicationRollout } from './data-quality';
import { policyDataProvenance } from './policy-training';
export const DATA_COMMANDS = ['buy_data', 'prepare_data', 'curate_data', 'deduplicate_data'] as const;
function sourceKey(packet: DataPacket): string { return canonicalStateHash(packetSources(packet)); }
export function preparationTerms(packet: DataPacket, content: GameContent): { feeCents: number; staff: number } {
  const catalog = DATA_CATALOG.find(item => item.id === packet.catalogId);
  return catalog ? { feeCents: 0, staff: catalog.preparationStaff } : { feeCents: content.preparation.feeCents, staff: toUnits(content.preparation.staffWeeks) };
}
export function validateDataCommand(state: Readonly<GameState>, command: GameCommand): Rejection | undefined {
  const p = command.payload;
  const queued = (predicate: (other: GameCommand) => boolean) => state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId && predicate(other));
  if (p.kind === 'buy_data') {
    const catalog = DATA_CATALOG.find(item => item.id === p.catalogId);
    if (!catalog) return { code: 'NOT_READY', message: 'Choose an available specialist pack or general training dataset.' };
    if (Object.values(state.slices.data.packets).some(packet => packetOwnedBy(packet, command.companyId, state.playerCompanyId) && packet.catalogId === catalog.id)) return { code: 'NO_IMPROVEMENT', message: 'You already own this data. You can reuse it; buying it again would not add new examples.' };
    if (queued(other => other.payload.kind === 'buy_data' && other.payload.catalogId === p.catalogId)) return { code: 'ALREADY_ACTIVE', message: 'This data edition is already queued for purchase.' };
    return;
  }
  if (p.kind !== 'prepare_data' && p.kind !== 'curate_data' && p.kind !== 'deduplicate_data') return { code: 'INVALID_COMMAND', message: 'This is not a data command.' };
  const packet = state.slices.data.packets[p.packetId];
  if (packet?.synthetic) return { code: 'NO_IMPROVEMENT', message: 'Reviewed synthetic data cannot be changed. Use its accepted cases for targeted training; curation or cleanup will not change the audit result.' };
  if (!packet || !packetOwnedBy(packet, command.companyId, state.playerCompanyId) || !packet.rawUnits) return { code: 'NOT_READY', message: 'Choose a dataset your company owns.' };
  if (p.kind === 'prepare_data') {
    if (packet.prepared) return { code: 'NO_IMPROVEMENT', message: 'This data is ready. You can reuse it for training.' };
    if (Object.values(state.slices.data.preparationJobs).some(job => job.packetId === packet.id && job.status !== 'complete')
      || queued(other => other.payload.kind === 'prepare_data' && other.payload.packetId === packet.id)) return { code: 'ALREADY_ACTIVE', message: 'This data is already being prepared. Resume the job if it is paused.' };
    return;
  }
  if (p.kind === 'deduplicate_data') {
    if (!hasResearch(state, command.companyId, 'R2A') || deduplicationRollout(state, command.companyId)?.status !== 'active') return { code: 'NOT_READY', message: 'Research Deduplication (R2A), then finish installing the system before cleaning data.' };
    if (!packet.prepared || packet.readyUnits !== packet.rawUnits) return { code: 'NOT_READY', message: 'Finish preparing this data before removing repeated processing.' };
    if (packet.deduplication) return { code: 'NO_IMPROVEMENT', message: 'This data has already been cleaned. Cleaning it again will not increase the saving.' };
    if (!dataProcessingProfile(packet).reductionBps) return { code: 'NO_IMPROVEMENT', message: 'This source has no repeated processing to remove.' };
    const existing = Object.values(state.slices.data.packets).find(other => packetOwnedBy(other, command.companyId, state.playerCompanyId)
      && !!other.deduplication && sourceKey(other) === sourceKey(packet) && other.qualityBps >= packet.qualityBps);
    if (existing) return { code: existing.prepared ? 'NO_IMPROVEMENT' : 'ALREADY_ACTIVE', message: existing.prepared ? 'You already have a cleaned version of this source with equal or better quality.' : 'This source is already being cleaned. Resume the job if it is paused.' };
    if (queued(other => other.payload.kind === 'deduplicate_data' && sourceKey(state.slices.data.packets[other.payload.packetId] ?? packet) === sourceKey(packet))) return { code: 'ALREADY_ACTIVE', message: 'Cleanup is already queued for this source.' };
    return;
  }
  if (!hasResearch(state, command.companyId, 'R2')) return { code: 'NOT_READY', message: 'Research Data curation (R2) before curating this data.' };
  if (!packet.prepared) return { code: 'NOT_READY', message: 'Prepare this data before improving its quality.' };
  if (packet.qualityBps >= 9500) return { code: 'NO_IMPROVEMENT', message: 'Curation can raise quality to 95. It does not add data, expand skill coverage, or change licenses.' };
  const target = Math.min(9500, packet.qualityBps + 1000);
  const existing = Object.values(state.slices.data.packets).find(other => packetOwnedBy(other, command.companyId, state.playerCompanyId)
    && sourceKey(other) === sourceKey(packet) && other.qualityBps >= target);
  if (existing) return { code: existing.prepared ? 'NO_IMPROVEMENT' : 'ALREADY_ACTIVE', message: existing.prepared ? 'You already have a version of this source at the target quality.' : 'A better-quality version of this source is already being prepared.' };
  if (queued(other => other.payload.kind === 'curate_data' && sourceKey(state.slices.data.packets[other.payload.packetId] ?? packet) === sourceKey(packet))) return { code: 'ALREADY_ACTIVE', message: 'Curation is already queued for this source.' };
  return;
}
export function quoteDataCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): CommandQuote {
  const p = command.payload;
  if (p.kind === 'buy_data') {
    const item = DATA_CATALOG.find(catalog => catalog.id === p.catalogId)!;
    return { upfrontCostCents: item.feeCents, weeklyCostDeltaCents: 0, summary: `Buy ${item.rawUnits} raw data units at quality ${item.qualityBps / 100}. Preparation then takes ${formatWorkPoints(item.preparationStaff)} Data points. You pay the purchase fee once.` };
  }
  if (p.kind === 'curate_data') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: 'Spend 60 Data points to create a new version with 10 more quality points, up to 95. It uses the same sources, skill coverage, and licenses.' };
  if (p.kind === 'deduplicate_data') {
    const terms = dataProcessingProfile(state.slices.data.packets[p.packetId]);
    return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: `Remove ${terms.duplicateProcessingUnits} repeated processing units with ${formatWorkPoints(terms.requiredStaff)} Data points. Keep ${terms.sourceUnits} data units with the same quality and licenses. Future training with this source can save ${terms.reductionBps / 100}% of update work. Runs already started keep their original budgets.` };
  }
  if (p.kind !== 'prepare_data') throw new Error('Expected a data action.');
  const terms = preparationTerms(state.slices.data.packets[p.packetId], content);
  return { upfrontCostCents: terms.feeCents, weeklyCostDeltaCents: 0, summary: `Prepare this dataset with ${formatWorkPoints(terms.staff)} Data points. Pay the fee once, then reuse the prepared data for training.` };
}
export function applyDataCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): DomainResult {
  const p = command.payload, data = structuredClone(state.slices.data);
  if (p.kind === 'buy_data') {
    const item = DATA_CATALOG.find(catalog => catalog.id === p.catalogId)!;
    const packet: DataPacket = { id: `data-${command.companyId}-${item.id}`, name: item.name, companyId: command.companyId, catalogId: item.id,
      sourceIds: [item.id], purchaseFactId: 'data-purchase-' + command.id, purchasedWeek: state.week, revision: 0, rawUnits: item.rawUnits, readyUnits: 0, qualityBps: item.qualityBps,
      coverageBps: structuredClone(item.coverageBps), ...(item.advancedCoverageBps ? { advancedCoverageBps: structuredClone(item.advancedCoverageBps) } : {}), rights: structuredClone(item.rights), behaviorUnits: item.behaviorUnits, broadUnits: item.broadUnits, prepared: false,
      ...(policyDataProvenance(item.id) ? { policy: policyDataProvenance(item.id)! } : {}) };
    data.packets[packet.id] = packet;
    return { updates: { data }, facts: [{ id: 'data-purchase-' + command.id, companyId: command.companyId, week: state.week, sourceId: packet.id,
      category: 'operating', amountCents: item.feeCents, label: item.name + ' purchase', kind: 'expense' }],
      messages: [{ companyId: command.companyId, category: 'project', message: `${item.name} acquired. Its ${item.rawUnits} units need data-staff preparation before training.` }] };
  }
  if (p.kind !== 'prepare_data' && p.kind !== 'curate_data' && p.kind !== 'deduplicate_data') return {};
  const source = data.packets[p.packetId], isCuration = p.kind === 'curate_data', isDeduplication = p.kind === 'deduplicate_data';
  const derived = isCuration || isDeduplication;
  const packet: DataPacket = derived ? { ...structuredClone(source), id: (isCuration ? 'curated-' : 'deduplicated-') + command.id, companyId: command.companyId,
    sourceIds: packetSources(source), parentPacketId: source.id, revision: (source.revision ?? 0) + 1,
    name: source.name.replace(/ · (?:curated|deduplicated) r\d+$/, '') + ` · ${isCuration ? 'curated' : 'deduplicated'} r${(source.revision ?? 0) + 1}`,
    qualityBps: isCuration ? Math.min(9500, source.qualityBps + 1000) : source.qualityBps, readyUnits: 0, prepared: false,
    ...(isDeduplication ? { deduplication: createDeduplicationReceipt(source, deduplicationRollout(state, command.companyId)!.id) } : {}) } : source;
  if (derived) data.packets[packet.id] = packet;
  const terms = isCuration ? { feeCents: 0, staff: 3 * U } : isDeduplication ? { feeCents: 0, staff: dataProcessingProfile(source).requiredStaff } : preparationTerms(packet, content);
  const job: PreparationJob = { id: 'preparation-' + command.id, companyId: command.companyId, packetId: packet.id,
    kind: isCuration ? 'curate' : isDeduplication ? 'deduplicate' : 'prepare', ...(derived ? { sourcePacketId: source.id } : {}), startedWeek: state.week,
    requiredStaff: terms.staff, completedStaff: 0, status: 'running', lastProgress: 0, lastBottleneck: 'Waiting for data staff.' };
  data.preparationJobs[job.id] = job;
  return { updates: { data }, facts: terms.feeCents ? [{ id: job.id + ':fee', companyId: command.companyId, week: state.week, sourceId: job.id,
    category: 'operating', amountCents: terms.feeCents, label: 'Data preparation', kind: 'expense' }] : [],
    messages: [{ companyId: command.companyId, category: 'project', message: `${packet.name} ${isCuration ? 'curation' : isDeduplication ? 'cleanup' : 'preparation'} started. Only finished work becomes ready data.` }] };
}
