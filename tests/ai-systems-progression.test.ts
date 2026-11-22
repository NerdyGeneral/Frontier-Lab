import test from 'node:test';
import assert from 'node:assert/strict';
import { playAISystemsCampaign } from './fixtures/ai-systems-playthrough';
import { AI_SYSTEM_RESEARCH_IDS } from '../src/content/ai-systems';
import { getModelChallengeAchievements } from '../src/modules/model-challenges';
import { getSystemsBriefOrders, systemsBriefPaymentId } from '../src/modules/systems-briefs';
import { getAISystemMetrics } from '../src/modules/ai-systems';
import { validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';

test('a published business funds all three system paths and earns all four new challenge and client outcomes', () => {
  const { lab, models } = playAISystemsCampaign();
  assert.ok(AI_SYSTEM_RESEARCH_IDS.every(id => lab.research.includes(id)));
  assert.ok(lab.minimumCashCents > 0); assert.equal(lab.company.arrearsCents, 0);
  assert.equal(models.length, 4);
  const receipts = getModelChallengeAchievements(lab.state, lab.state.playerCompanyId);
  assert.ok(models.every(model => receipts.some(receipt => receipt.modelId === model.modelId && receipt.tierId === model.suiteId.replace('-1', ''))));
  const orders = getSystemsBriefOrders(lab.state);
  assert.equal(orders.length, 4); assert.ok(orders.every(order => order.status === 'completed' && order.deliveryWeeks.length === 2));
  for (const order of orders) assert.equal(lab.state.slices.company.postedFacts[systemsBriefPaymentId(lab.state.playerCompanyId, order.id)], true);
  const systems = models.map(model => getAISystemMetrics(lab.state.slices.models.versions[model.modelId]));
  assert.ok(systems[0].servingCUwPer1000 < systems[3].servingCUwPer1000, 'Expert routing and verified reasoning have different serving costs.');
  assert.ok(systems[1].residentMU + 25 * systems[1].sessionMemoryMU < systems[2].residentMU + 25 * systems[2].sessionMemoryMU, 'Local and continuity systems trade footprint for retention.');
  assert.ok(systems[2].retentionBps > systems[1].retentionBps);
  assert.deepEqual(validateState(lab.state), []);
  const restored = deserializeState(serializeState(lab.state)); assert.ok(restored.ok, restored.ok ? undefined : restored.error);
  assert.deepEqual(restored.state, lab.state);
});
