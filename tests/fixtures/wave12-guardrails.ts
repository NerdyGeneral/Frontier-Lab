import assert from 'node:assert/strict';
import { CONTENT } from '../../src/content/catalog';
import { POLICY_HOLDOUT_RULES } from '../../src/content/wave11-policy';
import { RESOURCE_SCALE as U } from '../../src/contracts/types';
import type { GameState } from '../../src/contracts/types';
import { validateState } from '../../src/core/engine';
import { activeEfficiency } from '../../src/modules/product-efficiency';
import { activeRuntimeGuardrail } from '../../src/modules/runtime-guardrails';
import { NaturalBusinessCampaign } from './wave5-business';
import { policyCandidate } from './wave11-policy';

type PublicKind = 'basic-chat' | 'developer-api';
type Profile = 'balanced' | 'strict';
export interface GuardrailFixture { state: GameState; productId: string; modelId: string; installationId: string }
const deployed = new Map<PublicKind, Omit<GuardrailFixture, 'installationId'>>();
const installed = new Map<string, GuardrailFixture>();

/** Policy training, exact evaluations, acquisition and every rollout use ordinary paid commands. */
export function deployedGuardrailScenario(kind: PublicKind = 'developer-api') {
  const cached = deployed.get(kind); if (cached) return structuredClone(cached);
  const candidate = policyCandidate({ reported: true });
  const run = new NaturalBusinessCampaign(candidate.state, 'guardrail-fixture-' + kind);
  run.queue({ kind: 'start_system_rollout', method: 'cost-accounting' });
  const productId = 'product:' + run.queue({ kind: 'deploy_product', modelId: candidate.modelId,
    productKind: kind, priceCents: 400, allowance: kind === 'developer-api' ? 600 : 100 });
  run.until(state => state.slices.products.offers[productId]?.status === 'active', 8, 'paid public deployment');
  run.until(state => (state.slices.products.lastUsage[productId]?.paidAccounts ?? 0) >= 100, 60, 'one hundred real paying accounts');
  assert.deepEqual(validateState(run.state), []);
  const result = { state: run.state, productId, modelId: candidate.modelId };
  deployed.set(kind, structuredClone(result)); return structuredClone(result);
}

export function installGuardrail(run: NaturalBusinessCampaign, productId: string, profile: Profile): string {
  const id = 'guardrail:' + run.queue({ kind: 'install_runtime_guardrail', productId, profile });
  run.until(state => activeRuntimeGuardrail(state, productId)?.id === id, 8, 'paid runtime guardrail rollout');
  return id;
}

export function activeGuardrailScenario(profile: Profile = 'balanced', kind: PublicKind = 'developer-api'): GuardrailFixture {
  const key = kind + ':' + profile, cached = installed.get(key); if (cached) return structuredClone(cached);
  const base = deployedGuardrailScenario(kind), run = new NaturalBusinessCampaign(base.state, 'guardrail-installed-' + key);
  const installationId = installGuardrail(run, base.productId, profile);
  const result = { ...base, state: run.state, installationId };
  installed.set(key, structuredClone(result)); return structuredClone(result);
}

export function createGuardrailCandidate(run: NaturalBusinessCampaign, modelId: string): string {
  const id = 'variant:' + run.queue({ kind: 'create_model_variant', modelId, variant: 'compression' });
  run.until(state => !!state.slices.models.versions[id], 8, 'paid compression variant');
  run.evaluate(id, 'expanded-capabilities-1'); run.evaluate(id, POLICY_HOLDOUT_RULES.suiteId);
  return id;
}

export function installGuardrailRouteAndCache(run: NaturalBusinessCampaign, productId: string, modelId: string): string {
  const secondaryId = createGuardrailCandidate(run, modelId);
  run.queue({ kind: 'install_product_efficiency', productId, method: 'routing', secondaryModelId: secondaryId });
  run.queue({ kind: 'install_product_efficiency', productId, method: 'prefix-cache' });
  run.until(state => !!activeEfficiency(state, productId, 'routing') && !!activeEfficiency(state, productId, 'prefix-cache'), 8, 'routing and prefix cache');
  run.step();
  return secondaryId;
}

export function installGuardrailOwnedGpu(run: NaturalBusinessCampaign): string {
  const rackId = 'rack-' + run.queue({ kind: 'order_rack', hardwareId: 'training', location: 'colocation' });
  run.until(state => state.slices.compute.racks[rackId]?.status === 'inventory', 8, 'owned GPU delivery');
  run.queue({ kind: 'install_rack', rackId });
  run.until(state => state.slices.compute.racks[rackId]?.status === 'installed', 5, 'paid infrastructure installation');
  assert.equal(run.state.slices.compute.racks[rackId].purchaseCents, 8 * CONTENT.hardware.find(item => item.id === 'training')!.purchaseCentsPerCU);
  assert.ok(run.state.slices.company.ledger.some(row => row.id === 'capital:' + rackId.slice('rack-'.length) && row.amountCents > 0));
  assert.equal(run.fleet.ownedCU, 8 * U);
  return rackId;
}
