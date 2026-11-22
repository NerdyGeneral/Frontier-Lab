import assert from 'node:assert/strict';
import type { GameState } from '../../src/contracts/types';
import type { BatchOrderId } from '../../src/contracts/wave14-batch';
import { RESOURCE_SCALE as U } from '../../src/contracts/types';
import { validateState } from '../../src/core/engine';
import { NaturalBusinessCampaign } from './wave5-business';
import { createGuardrailCandidate, deployedGuardrailScenario, installGuardrailOwnedGpu } from './wave12-guardrails';
import { assuranceScenario } from './wave13-assurance';

export interface BatchFixture {
  state: GameState; productId: string; modelId: string; schedulerId: string;
  compressedModelId?: string; rackId?: string;
}
interface Options { owned?: boolean; protectedApi?: boolean; compressed?: boolean }
const scenarios = new Map<string, BatchFixture>();

/** The API, exact candidate reports, scheduler and optional hardware are paid through ordinary commands. */
export function batchScenario(options: Options = {}): BatchFixture {
  const key = [!!options.owned, !!options.protectedApi, !!options.compressed].join(':');
  const cached = scenarios.get(key); if (cached) return structuredClone(cached);
  const protectedBase = options.protectedApi ? assuranceScenario({ routed: true }) : null;
  const base = protectedBase ?? deployedGuardrailScenario();
  const run = new NaturalBusinessCampaign(base.state, 'batch-fixture-' + key);
  run.queue({ kind: 'set_product_terms', productId: base.productId, priceCents: 400, allowance: 25 }); run.step();
  const existingVariant = protectedBase?.secondaryModelId;
  const compressedModelId = existingVariant ?? (options.compressed ? createGuardrailCandidate(run, base.modelId) : undefined);
  const rackId = options.owned ? installGuardrailOwnedGpu(run) : undefined;
  const schedulerId = 'batch-scheduler:' + run.queue({ kind: 'install_batch_scheduler' });
  run.until(state => state.slices.products.batchSchedulers?.[state.playerCompanyId]?.status === 'active', 8, 'paid batch scheduler activation');
  const scheduler = run.state.slices.products.batchSchedulers![run.state.playerCompanyId];
  assert.equal(scheduler.id, schedulerId); assert.equal(scheduler.completedWork, 2 * U); assert.equal(scheduler.completedStaff, 2 * U);
  assert.ok(scheduler.physicalWork > 0); assert.deepEqual(validateState(run.state), []);
  const result: BatchFixture = { state: run.state, productId: base.productId, modelId: base.modelId, schedulerId,
    ...(compressedModelId ? { compressedModelId } : {}), ...(rackId ? { rackId } : {}) };
  scenarios.set(key, structuredClone(result)); return structuredClone(result);
}

export function acceptBatch(run: NaturalBusinessCampaign, productId: string, modelId: string,
  orderId: BatchOrderId = 'archive-tagging', weeklyWorkCapCUw = 4 * U): string {
  return 'batch:' + run.queue({ kind: 'accept_batch_job', productId, orderId, modelId, weeklyWorkCapCUw });
}
