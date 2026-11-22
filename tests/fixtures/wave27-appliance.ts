import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRIVATE_APPLIANCE_BUYER } from '../../src/content/wave27-appliance';
import type { GameState } from '../../src/contracts/types';
import { RESOURCE_SCALE as U } from '../../src/contracts/types';
import type { Wave27ApplianceCommand } from '../../src/contracts/wave27-appliance';
import type { ChipFoundry } from '../../src/contracts/wave4-hardware';
import { deserializeState } from '../../src/core/snapshot';
import { getPrivateApplianceView, previewPrivateApplianceOrder, privateApplianceContractId } from '../../src/modules/private-appliances';
import { chipDesignId } from '../../src/modules/chips';
import { NaturalBusinessCampaign } from './wave5-business';

export interface PrivateApplianceReadyFixture {
  state: GameState; modelId: string; designId: string; foundry: ChipFoundry;
  payload: Wave27ApplianceCommand;
  commands: NaturalBusinessCampaign['commands']; milestones: NaturalBusinessCampaign['milestones'];
  inheritedQueuedCommands: GameState['queuedCommands']; originalWeek: number; originalChecksum: string; minimumCashCents: number;
}
export type PrivateApplianceStage = 'beforeOrder' | 'ordered' | 'shipped' | 'ready' | 'accepted' | 'served';
export interface PrivateApplianceFixture extends Omit<PrivateApplianceReadyFixture, 'state'> {
  beforeOrder: GameState; ordered: GameState; shipped: GameState; ready: GameState; accepted: GameState; served: GameState;
  commandId: string;
}
let readyCache: PrivateApplianceReadyFixture | undefined;
let flowCache: PrivateApplianceFixture | undefined;

/** Continue the published company through paid research and hardware work. No resources or readiness are injected. */
export function getPrivateApplianceReadyFixture(): PrivateApplianceReadyFixture {
  if (!readyCache) {
    const directory = typeof __dirname === 'string' ? __dirname : join(process.cwd(), 'tests', 'fixtures');
    const raw = readFileSync(join(directory, 'wave16-snapshot.json'), 'utf8'), loaded = deserializeState(raw);
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
    const inheritedQueuedCommands = structuredClone(loaded.state.queuedCommands), originalWeek = loaded.state.week;
    const run = new NaturalBusinessCampaign(loaded.state, 'wave27-appliance-ready');
    run.mark('Published company'); run.step(); run.mark('Inherited batch queue settled');
    const serving = run.fleet.allocation.serving;
    const cloud = Math.max(run.fleet.cloudCU, serving + 16 * U - run.fleet.ownedCU);
    if (cloud > run.fleet.cloudCU) { run.queue({ kind: 'set_cloud_capacity', cu: cloud }); run.step(); }
    run.queue({ kind: 'allocate_compute', serving, development: 8 * U, research: 8 * U }); run.founder('research'); run.step();
    run.discover('R7A'); run.mark('Memory format research available');
    run.discover('S3'); run.mark('Release telemetry available');
    run.discover('S4'); run.mark('Private appliance qualification available');
    if (!run.research.includes('R16')) {
      run.queue({ kind: 'start_research', researchId: 'R16' }); run.step();
      run.hire('hardware', 2);
      run.until(() => run.research.includes('R16'), 40, 'Paid chip feasibility');
    }
    run.mark('Chip feasibility available');
    const view = getPrivateApplianceView(run.state), model = view.models.filter(item => item.eligible)
      .sort((a, b) => b.documentsBps - a.documentsBps || b.reliabilityBps - a.reliabilityBps || a.id.localeCompare(b.id))[0];
    assert.ok(model, 'The published company has no owned evaluated, licensed appliance candidate.');
    const spec = { architecture: 'dense', target: 'inference', memory: 'wide' } as const;
    const designId = chipDesignId(run.state.playerCompanyId, spec);
    run.queue({ kind: 'start_chip_design', name: 'Cedar document appliance', spec });
    run.until(state => state.slices.compute.chipDesigns[designId]?.status === 'design-ready', 30, 'Appliance chip specification');
    run.queue({ kind: 'start_chip_prototype', designId, modelId: model.id });
    run.until(state => state.slices.compute.chipDesigns[designId]?.status === 'validated', 30, 'Appliance prototype qualification');
    run.mark('Paid design and prototype qualified');
    const foundry = (['standard', 'express', 'high-yield'] as const).find(route => previewPrivateApplianceOrder(run.state, { modelId: model.id, designId, foundry: route }).eligible);
    assert.ok(foundry, 'No ordinary foundry route can meet Cedar Records’ fixed configuration.');
    const payload: Wave27ApplianceCommand = { kind: 'accept_private_appliance_order', buyerId: PRIVATE_APPLIANCE_BUYER.id, modelId: model.id, designId, foundry };
    readyCache = { state: run.state, modelId: model.id, designId, foundry, payload, commands: run.commands, milestones: run.milestones,
      inheritedQueuedCommands, originalWeek, originalChecksum: JSON.parse(raw).checksum, minimumCashCents: run.minimumCashCents };
  }
  return structuredClone(readyCache);
}

/** Cached command-derived stages support focused mutation tests without replaying the whole historical campaign. */
export function getPrivateApplianceFixture(onStage?: (stage: PrivateApplianceStage, state: GameState) => void): PrivateApplianceFixture {
  if (!flowCache) {
    const seed = getPrivateApplianceReadyFixture(), run = new NaturalBusinessCampaign(seed.state, 'wave27-appliance-flow');
    const stages = {} as Pick<PrivateApplianceFixture, PrivateApplianceStage>;
    const save = (stage: PrivateApplianceStage) => { stages[stage] = structuredClone(run.state); onStage?.(stage, structuredClone(run.state)); };
    save('beforeOrder'); const commandId = run.queue(seed.payload); run.step(); save('ordered');
    run.until(state => state.slices.products.privateApplianceOrders?.[PRIVATE_APPLIANCE_BUYER.id]?.shippedWeek !== null, 12, 'Appliance hardware shipment'); save('shipped');
    run.until(state => state.slices.products.commercialContracts[privateApplianceContractId()]?.status === 'ready', 12, 'Fixed appliance model installation'); save('ready');
    run.step(); save('accepted'); run.step(); save('served');
    const { state: _state, ...metadata } = seed; void _state;
    flowCache = { ...metadata, ...stages, commandId, commands: [...seed.commands, ...run.commands], milestones: [...seed.milestones, ...run.milestones], minimumCashCents: Math.min(seed.minimumCashCents, run.minimumCashCents) };
  } else if (onStage) for (const stage of ['beforeOrder', 'ordered', 'shipped', 'ready', 'accepted', 'served'] as const) onStage(stage, structuredClone(flowCache[stage]));
  return structuredClone(flowCache);
}
