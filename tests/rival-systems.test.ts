import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { ADVANCED_DATA_CATALOG } from '../src/content/advanced-skills';
import type { ModelVersion } from '../src/contracts/types';
import { createInitialState, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { rivalSystemsDesign, rivalSystemModelFits } from '../src/modules/rival-systems';
import { buildTrainingPlan, getTrainingPreview } from '../src/modules/lab-planner';
import { getModelDesignForecast } from '../src/modules/model-design';
import { getProductWorkloadMeasure } from '../src/modules/product-workloads';
import { isPaidChallengeReport } from '../src/modules/model-challenges';
import { openNaturalBusiness } from './fixtures/wave5-business';

test('a rival funds real state research, finishes and tests a model, and serves its advertised local workload', () => {
  const lab = openNaturalBusiness('release');
  lab.until(state => {
    const rival = state.slices.markets.rivals['rival-swift'], product = Object.values(state.slices.products.offers).find(offer => offer.companyId === rival.companyId && offer.workload?.id === 'local');
    if (!product) return false;
    const model = state.slices.models.versions[state.slices.products.deployments[product.deploymentId].modelId];
    return !!rival.campaign && rivalSystemModelFits(state, rival.campaign, model) && (state.slices.products.lastUsage[product.id]?.billedCents ?? 0) > 0;
  }, 180, 'paid rival operating-system release');
  const state = lab.state, rival = state.slices.markets.rivals['rival-swift'];
  const product = Object.values(state.slices.products.offers).find(offer => offer.companyId === rival.companyId && offer.workload?.id === 'local')!;
  const model = state.slices.models.versions[state.slices.products.deployments[product.deploymentId].modelId];
  const run = state.slices.models.trainingRuns[model.trainingRunId!];
  assert.ok(run && run.status === 'complete' && run.completedWork === run.requiredWork && run.physicalWork > 0);
  assert.equal(run.plan?.modelDesign?.system?.spec.kind, 'stateful');
  const discovery = Object.values(state.slices.research.projects).find(project => project.companyId === rival.companyId && project.researchId === 'A5')!;
  assert.ok(discovery && discovery.status === 'complete' && state.slices.company.postedFacts[discovery.id + ':fee']);
  assert.ok(Object.values(state.slices.models.reports).some(report => report.modelId === model.id && isPaidChallengeReport(state, report, state.week)));
  assert.equal(getProductWorkloadMeasure(model, product.workload)!.fitBps, 10000);
  assert.deepEqual(validateState(state), []);
  const restored = deserializeState(serializeState(state)); assert.ok(restored.ok, restored.ok ? undefined : restored.error);
  assert.deepEqual(restored.state.slices.markets.rivals['rival-swift'].campaign, rival.campaign);
});

test('verified and continuity rival recipes can earn their full customer promise from obtainable curated evidence', () => {
  // A numerical reachability test, separate from the fully paid rival playthrough above.
  // Only authored corpus sizes and attainable curation levels are supplied; no capability scores are invented.
  for (const focus of ['verified', 'continuity'] as const) {
    const state = createInitialState(CONTENT, 'release'), owner = focus === 'verified' ? 'rival-atlas' : 'rival-harbor';
    const base = state.slices.models.versions[owner + '-model-1'], starter = state.slices.data.packets[owner + '-starter-data'];
    if (focus === 'continuity') starter.qualityBps = 9000;
    const ids = [starter.id], datasets = focus === 'verified' ? ['advanced-reasoning-1', 'advanced-broad-1', 'advanced-broad-2'] : ['advanced-longContext-1'];
    for (const catalogId of datasets) {
      const item = ADVANCED_DATA_CATALOG.find(entry => entry.id === catalogId)!;
      const id = owner + '-curated-' + catalogId;
      state.slices.data.packets[id] = { ...structuredClone(item), id, companyId: owner, catalogId, sourceIds: [id],
        readyUnits: item.rawUnits, prepared: true, qualityBps: 9500 };
      ids.push(id);
    }
    const spec = rivalSystemsDesign(focus), options = { baseModelId: base.id, packetId: ids[0], packetIds: ids, recipeId: 'custom-model-foundation', modelDesign: spec };
    const preview = getTrainingPreview(state, owner, options), forecast = getModelDesignForecast(state, owner, base.id, ids, spec), planned = buildTrainingPlan(state, owner, options);
    const earned: ModelVersion = { ...base, scenarioStart: false, family: spec.family, residentMU: forecast.residentMU,
      modelDesign: planned.plan.modelDesign, capabilityBps: preview.capabilityRange.minimum, advancedCapabilities: preview.advancedCapabilityRange!.minimum, reliabilityBps: preview.reliabilityRange.minimum };
    const measure = getProductWorkloadMeasure(earned, { version: 1, id: focus, selectedWeek: 0 })!;
    assert.equal(measure.fitBps, 10000, JSON.stringify({ focus, scores: earned.capabilityBps, advanced: earned.advancedCapabilities, measure }));
  }
});
