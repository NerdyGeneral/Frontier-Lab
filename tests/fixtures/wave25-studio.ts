import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../../src/content/catalog';
import type { CommandPayload, GameState, RoleAllocation } from '../../src/contracts/types';
import { RESOURCE_SCALE as U } from '../../src/contracts/types';
import { advanceWeek, submitCommand } from '../../src/core/engine';
import { deserializeState } from '../../src/core/snapshot';
import { emptyRoleAllocation } from '../../src/modules/workforce';

export function fixtureState(file: string): GameState {
  const loaded = deserializeState(readFileSync(join(__dirname, file), 'utf8'));
  if (!loaded.ok) throw new Error(`${file}: ${loaded.error}`);
  return loaded.state;
}
export function queue(state: GameState, payload: CommandPayload, id?: string): GameState {
  const result = submitCommand(state, payload, CONTENT, id);
  assert.equal(result.accepted, true, `${payload.kind}: ${result.reason?.message}`);
  return result.state;
}
export function step(state: GameState, count = 1): GameState {
  for (let i = 0; i < count; i++) {
    const due = state.queuedCommands;
    const result = advanceWeek(state); assert.equal(result.accepted, true, result.reason?.message);
    state = result.state;
    for (const command of due) assert.equal(state.commandReceipts[command.id]?.status, 'accepted', state.commandReceipts[command.id]?.reason?.message);
  }
  return state;
}
export const founder = (role: keyof RoleAllocation): RoleAllocation => ({ ...emptyRoleAllocation(), [role]: U });

let shortage: GameState | undefined;
/** Continuation of the actual Wave 24 browser first sale. No balances, grants,
 * models or readiness dates are injected. Only ordinary paid commands run. */
export function mlShortageScenario(): GameState {
  if (!shortage) {
    let state = fixtureState('wave24-browser.json');
    const owner = state.playerCompanyId;
    const employee = Object.values(state.slices.company.staff).find(member => member.companyId === owner && member.role === 'ml')!;
    state = queue(state, { kind: 'assign_founder', allocations: founder('data') });
    state = queue(state, { kind: 'buy_data', catalogId: 'specialist-conversation-1' }, 'wave25-data');
    state = queue(state, { kind: 'set_cloud_capacity', cu: 8 * U });
    state = queue(state, { kind: 'set_staff_allocation', staffId: employee.id, fte: 0 });
    state = step(state);
    const packet = Object.values(state.slices.data.packets).find(item => item.companyId === owner && item.catalogId === 'specialist-conversation-1')!;
    state = queue(state, { kind: 'prepare_data', packetId: packet.id });
    state = step(state, 2);
    state = queue(state, { kind: 'assign_founder', allocations: founder('research') });
    state = queue(state, { kind: 'allocate_compute', serving: 4 * U, development: 4 * U, research: 0 });
    state = queue(state, { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: packet.id }, 'wave25-training');
    shortage = step(state);
    assert.equal(shortage.slices.models.trainingRuns['training-wave25-training'].completedWork, 0);
    assert.match(shortage.slices.models.trainingRuns['training-wave25-training'].lastBottleneck, /ML/);
  }
  return structuredClone(shortage);
}

let memory: GameState | undefined;
/** Published natural Wave 16 company, followed only by ordinary commands:
 * pause public products, park six site racks, rent eight cloud CU and begin a
 * new medium foundation. The remaining site/colocation/cloud pools each hold
 * 16 MU, so their combined 48 MU cannot supply one 24-MU training workspace. */
export function disconnectedMemoryScenario(): GameState {
  if (!memory) {
    let state = step(fixtureState('wave16-snapshot.json'));
    const owner = state.playerCompanyId;
    for (const product of Object.values(state.slices.products.offers).filter(item => item.companyId === owner && item.status === 'active')) {
      state = queue(state, { kind: 'set_product_paused', productId: product.id, paused: true });
    }
    const siteRacks = Object.values(state.slices.compute.racks).filter(item => item.companyId === owner && item.location !== 'colocation');
    for (const rack of siteRacks.slice(1)) state = queue(state, { kind: 'set_rack_parked', rackId: rack.id, parked: true });
    state = queue(state, { kind: 'allocate_compute', serving: 0, development: 16 * U, research: 0 });
    state = step(state);
    state = queue(state, { kind: 'set_cloud_capacity', cu: 8 * U });
    state = queue(state, { kind: 'assign_founder', allocations: founder('research') });
    state = queue(state, { kind: 'start_training', baseModelId: CONTENT.seedModel.id,
      packetId: 'data-company-player-broad-corpus-1', packetIds: ['data-company-player-broad-corpus-1', CONTENT.starterData.id],
      recipeId: 'medium-foundation', profile: 'ambitious' }, 'wave25-memory-training');
    state = step(state, 5);
    const run = state.slices.models.trainingRuns['training-wave25-memory-training'];
    assert.equal(run.preparationCompleted, run.plan!.preparationRequired);
    assert.equal(run.completedWork, 0);
    assert.match(run.lastBottleneck, /memory|MU/i);
    memory = state;
  }
  return structuredClone(memory);
}
