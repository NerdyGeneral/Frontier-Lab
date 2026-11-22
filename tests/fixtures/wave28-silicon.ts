import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../../src/content/catalog';
import type { CommandPayload, GameState } from '../../src/contracts/types';
import type { ChipSuccessorImprovement } from '../../src/contracts/wave4-hardware';
import { submitCommand } from '../../src/core/engine';
import { deserializeState } from '../../src/core/snapshot';
import { chipSuccessorId, getChipView, hasShippedChipBuyerOrder } from '../../src/modules/chips';
import { NaturalBusinessCampaign } from './wave5-business';

export interface Gen2SiliconReadyFixture {
  state: GameState; parentDesignId: string; modelId: string; originalWeek: number; originalChecksum: string;
  commands: NaturalBusinessCampaign['commands']; milestones: NaturalBusinessCampaign['milestones']; minimumCashCents: number;
}
export type Gen2SiliconStage = 'beforeSuccessor' | 'designing' | 'designReady' | 'prototyping' | 'qualified' | 'ordered' | 'delivered' | 'installing' | 'installed';
export interface Gen2SiliconFixture extends Omit<Gen2SiliconReadyFixture, 'state'> {
  improvement: ChipSuccessorImprovement; designId: string; batchId: string; rackId: string;
  beforeSuccessor: GameState; designing: GameState; designReady: GameState; prototyping: GameState; qualified: GameState;
  ordered: GameState; delivered: GameState; installing: GameState; installed: GameState;
}

let readyCache: Gen2SiliconReadyFixture | undefined;
const flowCache = new Map<ChipSuccessorImprovement, Gen2SiliconFixture>();

/** Same command IDs as the application: browser actions never provide an explicit ID. */
class ApplicationCampaign extends NaturalBusinessCampaign {
  override queue(payload: CommandPayload): string {
    const result = submitCommand(this.state, payload, CONTENT);
    assert.equal(result.accepted, true, `Week ${this.week}, ${payload.kind}: ${result.reason?.message}`);
    const id = result.commandId!;
    this.commands.push({ week: this.week, id, payload: structuredClone(payload) }); this.state = result.state;
    return id;
  }
}

/** Published W579 -> actual buyer shipment -> separately paid S5/S6. No state grants or readiness injections. */
export function getGen2SiliconReadyFixture(): Gen2SiliconReadyFixture {
  if (!readyCache) {
    const directory = typeof __dirname === 'string' ? __dirname : join(process.cwd(), 'tests', 'fixtures');
    const raw = readFileSync(join(directory, 'wave27-appliance-published.json'), 'utf8'), loaded = deserializeState(raw);
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
    const run = new ApplicationCampaign(loaded.state, 'wave28-silicon-ready'); run.mark('Published W579 company');
    assert.equal(run.state.queuedCommands.length, 0, 'Published seed should not contain an unreviewed queue.');
    const parent = Object.values(run.state.slices.compute.chipDesigns).find(design => design.companyId === run.state.playerCompanyId
      && design.status === 'validated' && !design.successor && design.spec.architecture === 'dense' && design.spec.target === 'inference' && design.spec.memory === 'wide');
    assert.ok(parent?.prototypeRun, 'Published company needs its real qualified Gen1 appliance design.');
    run.queue({ kind: 'accept_hardware_order', buyerId: 'vesper-systems', designId: parent.id, foundry: 'standard' });
    run.founder('infrastructure');
    run.until(state => hasShippedChipBuyerOrder(state), 12, 'Paid accelerator buyer shipment'); run.mark('Vesper shipment and single buyer settlement');
    run.discover('S5'); run.mark('Paid facility specialization research available');
    run.discover('S6'); run.mark('Paid Gen2 silicon research available');
    const parentChoice = getChipView(run.state).successor.parents.find(item => item.id === parent.id);
    assert.ok(parentChoice?.eligible, parentChoice?.reasons.join(' ') ?? 'Parent is missing from the Gen2 selector.');
    readyCache = { state: run.state, parentDesignId: parent.id, modelId: parent.prototypeRun.modelId,
      originalWeek: loaded.state.week, originalChecksum: JSON.parse(raw).checksum,
      commands: run.commands, milestones: run.milestones, minimumCashCents: run.minimumCashCents };
  }
  return structuredClone(readyCache);
}

/** Paid browser-equivalent successor flow, with cloned checkpoints for focused validation tests. */
export function getGen2SiliconFixture(improvement: ChipSuccessorImprovement = 'memory', onStage?: (stage: Gen2SiliconStage, state: GameState) => void): Gen2SiliconFixture {
  if (!flowCache.has(improvement)) {
    const seed = getGen2SiliconReadyFixture(), run = new ApplicationCampaign(seed.state, 'wave28-silicon-flow');
    const designId = chipSuccessorId(run.state.playerCompanyId, seed.parentDesignId, improvement);
    const stages = {} as Pick<Gen2SiliconFixture, Gen2SiliconStage>;
    const save = (stage: Gen2SiliconStage) => { stages[stage] = structuredClone(run.state); onStage?.(stage, structuredClone(run.state)); };
    save('beforeSuccessor');
    run.queue({ kind: 'start_chip_successor', parentDesignId: seed.parentDesignId, name: improvement === 'memory' ? 'Cedar Gen2 Memory' : 'Cedar Gen2 Throughput', improvement });
    run.step(); save('designing');
    run.until(state => state.slices.compute.chipDesigns[designId]?.status === 'design-ready', 20, 'Separately paid Gen2 specification'); save('designReady');
    run.queue({ kind: 'start_chip_prototype', designId, modelId: seed.modelId }); run.step(); save('prototyping');
    run.until(state => state.slices.compute.chipDesigns[designId]?.status === 'validated', 20, 'Independent Gen2 prototype qualification'); save('qualified');
    const batchCommandId = run.queue({ kind: 'order_chip_batch', designId, racks: 1, location: 'colocation', foundry: 'standard' });
    const batchId = `chip-batch-${batchCommandId}`, rackId = `rack-${batchCommandId}-1`;
    run.step(); save('ordered');
    run.until(state => state.slices.compute.chipBatches[batchId]?.status === 'delivered', 12, 'Paid Gen2 production'); save('delivered');
    run.queue({ kind: 'install_rack', rackId }); run.step(); save('installing');
    run.until(state => state.slices.compute.racks[rackId]?.status === 'installed', 10, 'Actual Gen2 rack installation'); save('installed');
    const { state: _state, ...metadata } = seed; void _state;
    flowCache.set(improvement, { ...metadata, ...stages, improvement, designId, batchId, rackId,
      commands: [...seed.commands, ...run.commands], milestones: [...seed.milestones, ...run.milestones], minimumCashCents: Math.min(seed.minimumCashCents, run.minimumCashCents) });
  } else if (onStage) {
    const cached = flowCache.get(improvement)!;
    for (const stage of ['beforeSuccessor', 'designing', 'designReady', 'prototyping', 'qualified', 'ordered', 'delivered', 'installing', 'installed'] as const) onStage(stage, structuredClone(cached[stage]));
  }
  return structuredClone(flowCache.get(improvement)!);
}
