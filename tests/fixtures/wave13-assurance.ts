import assert from 'node:assert/strict';
import { ASSURANCE_BY_ID } from '../../src/content/wave13-assurance';
import type { GameState } from '../../src/contracts/types';
import type { AssuranceBuyerId } from '../../src/contracts/wave13-assurance';
import type { RuntimeGuardrailProfile } from '../../src/contracts/wave12-guardrails';
import { validateState } from '../../src/core/engine';
import { assuranceAuditQualifies } from '../../src/modules/assured-api';
import { activeRuntimeGuardrail } from '../../src/modules/runtime-guardrails';
import { NaturalBusinessCampaign } from './wave5-business';
import { deployedGuardrailScenario, installGuardrail, installGuardrailOwnedGpu, installGuardrailRouteAndCache } from './wave12-guardrails';

export interface AssuranceFixture {
  state: GameState; productId: string; modelId: string; installationId: string;
  secondaryModelId?: string; rackId?: string;
}
interface Options { profile?: RuntimeGuardrailProfile; routed?: boolean; owned?: boolean }
const ready = new Map<string, AssuranceFixture>();
const active = new Map<string, AssuranceFixture & { contractId: string }>();

/** Exact reports, feature changes, routing, checker rollout and hardware all use paid ordinary commands. */
export function assuranceScenario(options: Options = {}): AssuranceFixture {
  const profile = options.profile ?? 'balanced', key = [profile, !!options.routed, !!options.owned].join(':');
  const cached = ready.get(key); if (cached) return structuredClone(cached);
  const base = deployedGuardrailScenario(), run = new NaturalBusinessCampaign(base.state, 'assurance-fixture-' + key);
  run.queue({ kind: 'set_product_terms', productId: base.productId, priceCents: 400, allowance: 100 });
  run.queue({ kind: 'set_product_features', productId: base.productId, features: { memory: false, extendedContext: true, deepReasoning: true } });
  run.step();
  const secondaryModelId = options.routed ? installGuardrailRouteAndCache(run, base.productId, base.modelId) : undefined;
  const installationId = installGuardrail(run, base.productId, profile);
  const rackId = options.owned ? installGuardrailOwnedGpu(run) : undefined;
  const result: AssuranceFixture = { ...base, state: run.state, installationId, ...(secondaryModelId ? { secondaryModelId } : {}), ...(rackId ? { rackId } : {}) };
  assert.deepEqual(validateState(run.state), []); ready.set(key, structuredClone(result)); return structuredClone(result);
}

export function signAssurance(run: NaturalBusinessCampaign, productId: string, buyerId: AssuranceBuyerId = 'continuity-systems'): string {
  const installation = activeRuntimeGuardrail(run.state, productId);
  assert.ok(assuranceAuditQualifies(installation, ASSURANCE_BY_ID[buyerId]), JSON.stringify({ buyerId, totals: installation?.audit?.guarded }));
  const id = 'assurance:' + run.queue({ kind: 'sign_assurance_contract', buyerId, productId });
  run.until(state => state.slices.products.assuranceContracts?.[id]?.status === 'active', 8, 'paid assurance onboarding and next-boundary activation');
  return id;
}

export function activeAssuranceScenario(buyerId: AssuranceBuyerId = 'continuity-systems', options: Options = {}): AssuranceFixture & { contractId: string } {
  const selected = { profile: buyerId === 'sentinel-services' ? 'strict' as const : 'balanced' as const, ...options };
  const key = [buyerId, selected.profile, !!selected.routed, !!selected.owned].join(':');
  const cached = active.get(key); if (cached) return structuredClone(cached);
  const base = assuranceScenario(selected), run = new NaturalBusinessCampaign(base.state, 'assurance-active-' + key);
  const contractId = signAssurance(run, base.productId, buyerId), result = { ...base, state: run.state, contractId };
  assert.deepEqual(validateState(run.state), []); active.set(key, structuredClone(result)); return structuredClone(result);
}
