import assert from 'node:assert/strict';
import { CONTENT } from '../../src/content/catalog';
import type { CommandPayload, GameState, StaffRole } from '../../src/contracts/types';
import { RESOURCE_SCALE as U } from '../../src/contracts/types';
import { advanceWeek, submitCommand } from '../../src/core/engine';
import { createPlayerOnlyState } from './player-only';

export function queueResearchChoice(state: GameState, payload: CommandPayload, id: string): GameState {
  const queued = submitCommand(state, payload, CONTENT, id);
  assert.equal(queued.accepted, true, queued.reason?.message);
  return queued.state;
}
export function advanceResearchWeek(state: GameState): GameState {
  const next = advanceWeek(state, CONTENT);
  assert.equal(next.accepted, true, next.reason?.message);
  assert.equal(next.state.slices.company.companies[state.playerCompanyId].arrearsCents, 0);
  return next.state;
}
export function assignResearchRole(state: GameState, role: StaffRole, id: string): GameState {
  return queueResearchChoice(state, { kind: 'assign_founder', allocations: {
    research: 0, ml: 0, data: 0, infrastructure: 0, commercial: 0, hardware: 0, [role]: U,
  } }, id);
}

/** Every discovery is paid through ordinary commands; no knowledge or resources are injected. */
export function earnResearch(ids: readonly string[], initial = createPlayerOnlyState()): GameState {
  let state = structuredClone(initial);
  for (const id of ids) {
    const definition = CONTENT.research.find(item => item.id === id)!;
    assert.ok(definition, id);
    state = assignResearchRole(state, definition.role, 'customization-role-' + id);
    state = queueResearchChoice(state, { kind: 'allocate_compute', serving: 0, development: 0, research: 2 * U }, 'customization-compute-' + id);
    state = queueResearchChoice(state, { kind: 'start_research', researchId: id }, 'customization-research-' + id);
    let elapsed = 0;
    while (!(state.slices.research.completedByCompany[state.playerCompanyId] ?? []).includes(id) && elapsed++ < 40) state = advanceResearchWeek(state);
    assert.ok(state.slices.research.completedByCompany[state.playerCompanyId].includes(id), id + ' must finish through real grants');
  }
  return state;
}
