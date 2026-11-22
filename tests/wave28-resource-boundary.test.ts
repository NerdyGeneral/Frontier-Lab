import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import type { GameState, ResourceFrame, ResourceGrant, WorkRequest } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { mulDiv } from '../src/core/math';
import { collectResourceResult } from '../src/core/resources';
import { getComputePools, getInfrastructureOperatingStaff, getPoolMultiplierBps, infrastructureOperationsId, usesCrossRackTraining } from '../src/modules/compute-pools';
import { getFacilityFixture } from './fixtures/wave28-facilities';

interface ProbeJob { physical: number; category?: WorkRequest['category']; workloadKind?: WorkRequest['workloadKind']; headroomBps?: number; memory?: number; poolId?: string }
const owner = { id: 'boundary-probe-compute', owns: ['compute'] as const, handlers: {} };

/** Exercise only the independent resource boundary on real paid profile states.
 * The lifecycle fixture is unchanged; probes are ephemeral requests/grants. */
function probe(state: GameState, jobs: ProbeJob[]) {
  const companyId = state.playerCompanyId, pools = getComputePools(state), selected = pools.find(pool => pool.specialization)!;
  const operatingStaff = getInfrastructureOperatingStaff(state), operationsId = infrastructureOperationsId(companyId);
  const requests: WorkRequest[] = [{ id: operationsId, taskId: operationsId, companyId, category: 'research', poolId: 'auto', priority: 0,
    normalizedWorkCUw: 0, memoryMU: 0, staffDemand: [{ role: 'infrastructure', staffWeeks: operatingStaff }] }];
  const grants: ResourceGrant[] = [];
  for (const [index, job] of jobs.entries()) {
    const pool = pools.find(item => item.id === (job.poolId ?? selected.id))!;
    const category = job.category ?? 'serving', workloadKind = job.workloadKind ?? 'inference', memoryMU = job.memory ?? U;
    const multiplier = getPoolMultiplierBps(pool, category, usesCrossRackTraining(pool, category, job.physical, memoryMU), CONTENT, workloadKind);
    const normalizedWorkCUw = mulDiv(job.physical, multiplier, 10000), id = `boundary-probe-${index}`;
    requests.push({ id, taskId: id, companyId, category, workloadKind, poolId: pool.id, priority: index + 1,
      normalizedWorkCUw, memoryMU, ...(job.headroomBps === undefined ? {} : { headroomBps: job.headroomBps }) });
    grants.push({ requestId: id, poolId: pool.id, physicalCUw: job.physical, hardwareEffectiveCUw: normalizedWorkCUw, memoryMU });
  }
  const frame: ResourceFrame = { requests, computeGrants: [], staffGrants: [{ requestId: operationsId, grants: [{ role: 'infrastructure', staffWeeks: operatingStaff }] }] };
  return { frame, grants, sourceHash: canonicalStateHash(state), collect: (rows = grants) => collectResourceResult(frame, owner, { computeGrants: rows }, 'grant', state, CONTENT) };
}

test('W28-RB01: concurrent serving grants cannot exceed the shared training-profile ceiling, including across collector calls', () => {
  const state = getFacilityFixture().trainingActive, p = probe(state, [{ physical: 26 * U }, { physical: 26 * U }]);
  p.collect([p.grants[0]]); const first = canonicalStateHash(p.frame);
  assert.throws(() => p.collect([p.grants[1]]), /serving workload ceiling/);
  assert.equal(canonicalStateHash(p.frame), first); assert.equal(canonicalStateHash(state), p.sourceHash);
});

test('W28-RB02: explicit inference shares one ceiling across serving, development and research allocations', () => {
  const state = getFacilityFixture().trainingActive, p = probe(state, [{ physical: 36 * U }, { physical: 8 * U, category: 'development' }, { physical: 8 * U, category: 'research' }]);
  const frame = canonicalStateHash(p.frame); assert.throws(() => p.collect(), /serving workload ceiling/);
  assert.equal(canonicalStateHash(p.frame), frame); assert.equal(canonicalStateHash(state), p.sourceHash);
});

test('W28-RB03: the class ceiling counts reserved headroom and admits its exact boundary', () => {
  const state = getFacilityFixture().trainingActive;
  const over = probe(state, [{ physical: 24 * U, headroomBps: 1000 }, { physical: 24 * U, headroomBps: 1000 }]);
  assert.throws(() => over.collect(), /serving workload ceiling/); // 52.8 reserved, although only 48 physical CUw execute.
  const exact = probe(state, [{ physical: 21 * U, headroomBps: 2000 }, { physical: 21 * U, headroomBps: 2000 }]);
  assert.doesNotThrow(() => exact.collect()); assert.equal(exact.frame.computeGrants.length, 2); // 50.4 reserved.
  assert.equal(canonicalStateHash(state), exact.sourceHash);
});

test('W28-RB04: explicit training retains its shared serving-profile tradeoff across allocation categories', () => {
  const state = getFacilityFixture().servingActive;
  const p = probe(state, [{ physical: 40 * U, workloadKind: 'training' }, { physical: 8 * U, category: 'development', workloadKind: 'training' }, { physical: 4 * U, category: 'research', workloadKind: 'training' }]);
  assert.throws(() => p.collect(), /training workload ceiling/); assert.equal(canonicalStateHash(state), p.sourceHash);
});

test('W28-RB05: general work can use the remaining physical pool and a separate unprofiled pool keeps its own capacity', () => {
  const state = getFacilityFixture().trainingActive;
  const shared = probe(state, [{ physical: 50.4 * U }, { physical: 5.6 * U, category: 'research', workloadKind: 'general' }]);
  assert.doesNotThrow(() => shared.collect());
  const other = getComputePools(state).find(pool => pool.ownership === 'owned' && pool.location === 'colocation')!;
  const separate = probe(state, [{ physical: 50.4 * U }, { physical: 8 * U, poolId: other.id }]);
  assert.doesNotThrow(() => separate.collect()); assert.equal(canonicalStateHash(state), separate.sourceHash);
});

test('W28-RB06: existing physical and connected-memory conservation remain independently enforced', () => {
  const state = getFacilityFixture().trainingActive;
  const physical = probe(state, [{ physical: 50.4 * U }, { physical: 5.6 * U, category: 'research', workloadKind: 'general' }, { physical: U }]);
  assert.throws(() => physical.collect(), /physical capacity/);
  const memory = probe(state, [{ physical: U, memory: 60 * U }, { physical: U, memory: 60 * U }]);
  assert.throws(() => memory.collect(), /pool memory capacity/); assert.equal(canonicalStateHash(state), memory.sourceHash);
});
