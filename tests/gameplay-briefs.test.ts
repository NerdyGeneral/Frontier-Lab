import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { DEFAULT_MODEL_CUSTOMIZATION } from '../src/content/model-customization';
import { CUSTOMER_BRIEFS } from '../src/content/customer-briefs';
import { SPECIALIST_BRIEF_IDS, type SpecialistBriefId } from '../src/contracts/customer-briefs';
import type { ModelDesignSpec } from '../src/contracts/model-design';
import type { ModelCustomization } from '../src/contracts/model-customization';
import { RESOURCE_SCALE as U, type GameState } from '../src/contracts/types';
import { previewCommand, validateState } from '../src/core/engine';
import { serializeState, deserializeState } from '../src/core/snapshot';
import { DEFAULT_MODEL_DESIGN } from '../src/modules/model-design';
import { briefPaymentId } from '../src/modules/customer-briefs';
import { getSpecialistBriefCandidate, specialistBriefMeter, specialistBriefProofId, specialistModelRequirements } from '../src/modules/specialist-briefs';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { getCustomizationReadyFixture } from './fixtures/model-customization';

let fixture: { state: GameState; modelIds: Record<SpecialistBriefId, string> } | undefined;
function ready() {
  if (!fixture) {
    const prepared = getCustomizationReadyFixture(['M4', 'M11', 'M13']);
    const run = new NaturalBusinessCampaign(prepared.state, 'specialist-client');
    const train = (name: string, size: number, budget: number, customization?: ModelCustomization, conversationWeight = 1) => {
      const modelDesign: ModelDesignSpec = { ...structuredClone(DEFAULT_MODEL_DESIGN), name, mode: 'foundation', family: 'compact', parameterMillions: size,
        computeBudgetCUw: budget * U, dataMix: { conversation: conversationWeight, documents: 1, coding: 1, tools: 1, reasoning: 1, longContext: 1, multimodal: 1 },
        ...(customization ? { customization } : {}) };
      const id = run.train({ baseModelId: CONTENT.seedModel.id, packetId: prepared.packetId,
        packetIds: [prepared.packetId], recipeId: 'custom-model-foundation', modelDesign });
      run.evaluate(id, 'expanded-capabilities-1');
      return id;
    };
    const compact = train('Pocket assistant', 2000, 150);
    const documents = train('Visual case reader', 8000, 600, { ...DEFAULT_MODEL_CUSTOMIZATION, contextWindow: 'extended', objective: 'multimodal' });
    run.evaluate(documents, 'advanced-capabilities-1');
    const support = train('Helpful support', 3200, 250, { ...DEFAULT_MODEL_CUSTOMIZATION, behavior: 'expressive' }, 10);
    fixture = { state: run.state, modelIds: { 'compact-efficiency': compact, 'visual-documents': documents, 'long-context-review': documents, 'support-at-scale': support } };
    for (const id of SPECIALIST_BRIEF_IDS) {
      assert.equal(specialistModelRequirements(run.state.slices.models.versions[fixture.modelIds[id]], id), null, id + ' must be achievable through paid training.');
      assert.ok(getSpecialistBriefCandidate(run.state, id), id + ' must have paid evidence.');
    }
  }
  return structuredClone(fixture);
}
function reload(state: GameState) {
  const decoded = deserializeState(serializeState(state)); assert.ok(decoded.ok, decoded.ok ? undefined : decoded.error); return decoded.state;
}

test('four specialist commissions accept genuinely trained models and retained paid reports, require client work, and pay exactly once', () => {
  const earned = ready(), run = new NaturalBusinessCampaign(earned.state, 'specialist-deliveries');
  for (const id of SPECIALIST_BRIEF_IDS) {
    const candidate = getSpecialistBriefCandidate(run.state, id)!;
    assert.ok(run.state.slices.models.versions[candidate.targetId!].modelDesign, 'A paid custom specialist supplies the client.');
    assert.equal(previewCommand(run.state, { kind: 'evaluate_model', modelId: candidate.targetId!, suiteId: 'expanded-capabilities-1' }).accepted, false,
      'The existing test cannot reroll; its retained report is sufficient for admission.');
    run.queue({ kind: 'accept_customer_brief', briefId: id }); run.step();
    const first = run.state.slices.campaign.customerBriefs![id]!;
    assert.equal(first.status, 'active'); assert.equal(first.qualifyingWeeks, 1);
    assert.equal(first.targetId, candidate.targetId);
    assert.equal(run.state.slices.company.postedFacts[specialistBriefProofId(run.state, first, run.week)], true);
    const before = serializeState(run.state); run.state = reload(run.state); assert.equal(serializeState(run.state), before);
    run.step();
    const complete = run.state.slices.campaign.customerBriefs![id]!;
    assert.equal(complete.status, 'completed'); assert.deepEqual(complete.specialist!.deliveryWeeks, [run.week - 1, run.week]);
    const facts = run.state.slices.company.ledger.filter(fact => fact.id === briefPaymentId(run.state.playerCompanyId, id));
    assert.equal(facts.length, 1); assert.equal(facts[0].amountCents, CUSTOMER_BRIEFS[id].feeCents);
    assert.equal(previewCommand(run.state, { kind: 'accept_customer_brief', briefId: id }).accepted, false);
    run.step();
    assert.equal(run.state.slices.company.ledger.filter(fact => fact.id === briefPaymentId(run.state.playerCompanyId, id)).length, 1);
  }
  assert.deepEqual(reload(run.state), run.state);
  assert.equal(run.company.arrearsCents, 0);
});

test('a specialist brief cannot deliver without actual serving allocation and frozen proof resists corruption', () => {
  const run = new NaturalBusinessCampaign(ready().state, 'specialist-constrained');
  run.queue({ kind: 'allocate_compute', serving: 0, development: 16 * U, research: 16 * U });
  run.queue({ kind: 'accept_customer_brief', briefId: 'visual-documents' }); run.step();
  let brief = run.state.slices.campaign.customerBriefs!['visual-documents']!;
  assert.equal(brief.qualifyingWeeks, 0); assert.deepEqual(brief.specialist!.deliveryWeeks, []);
  assert.equal(run.state.slices.company.postedFacts[specialistBriefProofId(run.state, brief, run.week)], undefined);
  assert.match(brief.feedback, /Client work 0\//);
  run.queue({ kind: 'allocate_compute', serving: 160 * U, development: 16 * U, research: 16 * U }); run.step(2);
  brief = run.state.slices.campaign.customerBriefs!['visual-documents']!; assert.equal(brief.status, 'completed');
  for (const mutate of [
    (state: GameState) => { delete state.slices.company.postedFacts[specialistBriefProofId(state, state.slices.campaign.customerBriefs!['visual-documents']!)]; },
    (state: GameState) => { const b = state.slices.campaign.customerBriefs!['visual-documents']!; delete state.slices.company.postedFacts[specialistBriefProofId(state, b, b.specialist!.deliveryWeeks[0])]; },
    (state: GameState) => { state.slices.campaign.customerBriefs!['visual-documents']!.specialist!.advancedReportId = null; },
    (state: GameState) => { const b = state.slices.campaign.customerBriefs!['visual-documents']!; b.specialist!.deliveryWeeks[1] = b.specialist!.deliveryWeeks[0]; },
    (state: GameState) => { state.slices.campaign.customerBriefs!['visual-documents']!.targetId = CONTENT.seedModel.id; },
  ]) { const forged = structuredClone(run.state); mutate(forged); assert.ok(validateState(forged).length, 'Forged commission receipt must fail validation.'); }
  assert.deepEqual(reload(run.state), run.state);
});

test('specialist limits distinguish memory, serving work, advanced evidence and behavior rather than rewarding a label', () => {
  const earned = ready();
  const compact = earned.state.slices.models.versions[earned.modelIds['compact-efficiency']];
  assert.ok(specialistBriefMeter(compact, 'compact-efficiency').workPerThousandCUw <= 0.15 * U);
  assert.match(specialistModelRequirements({ ...compact, residentMU: 2 * U }, 'compact-efficiency')!, /memory/);
  assert.match(specialistModelRequirements({ ...compact, modelDesign: { ...compact.modelDesign!, servingWorkBps: 100000 } }, 'compact-efficiency')!, /CUw/);
  const documents = earned.state.slices.models.versions[earned.modelIds['visual-documents']];
  assert.match(specialistModelRequirements({ ...documents, advancedCapabilities: { ...documents.advancedCapabilities!, multimodal: 0 } }, 'visual-documents')!, /multimodal/);
  assert.match(specialistModelRequirements({ ...documents, advancedCapabilities: { ...documents.advancedCapabilities!, longContext: 0 } }, 'long-context-review')!, /long context/);
  const support = earned.state.slices.models.versions[earned.modelIds['support-at-scale']];
  assert.match(specialistModelRequirements({ ...support, behavior: { ...support.behavior!, falseRefusalBps: 701 } }, 'support-at-scale')!, /false refusals/);
  const noEvidence = structuredClone(earned.state);
  for (const [id, report] of Object.entries(noEvidence.slices.models.reports)) if (report.suiteId === 'advanced-capabilities-1') delete noEvidence.slices.models.reports[id];
  assert.equal(getSpecialistBriefCandidate(noEvidence, 'visual-documents'), null);
  assert.equal(getSpecialistBriefCandidate(noEvidence, 'long-context-review'), null);
});
