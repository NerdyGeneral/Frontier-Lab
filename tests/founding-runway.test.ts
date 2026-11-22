import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { createInitialState, submitCommand } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

test('a university can keep both employees, fund an early design through a fellowship and reach profitable public service', () => {
  const lab = new NaturalBusinessCampaign(createInitialState(CONTENT, 'release', 'university'), 'spinout-runway');
  const packetId = CONTENT.starterData.id;
  lab.queue({ kind: 'prepare_data', packetId });
  lab.queue({ kind: 'allocate_compute', development: 4 * U, research: 0, serving: 0 });
  lab.until(state => state.slices.data.packets[packetId].prepared, 3, 'prepare the starter data');
  const modelId = lab.train({ baseModelId: CONTENT.seedModel.id, packetId });
  lab.evaluate(modelId, 'basic-conversation-1');
  lab.queue({ kind: 'deploy_product', modelId, priceCents: 1200, allowance: 100 });
  lab.queue({ kind: 'allocate_compute', serving: 4 * U, development: 0, research: 0 });
  lab.until(() => lab.company.earnedRevenueCents > 0, 6, 'bill the first paying customer');

  lab.queue({ kind: 'accept_customer_brief', briefId: 'research-sprint' });
  lab.queue({ kind: 'start_research', researchId: 'D1' });
  lab.queue({ kind: 'allocate_compute', serving: 2 * U, research: 2 * U, development: 0 });
  lab.until(state => state.slices.campaign.customerBriefs?.['research-sprint']?.status === 'completed', 6, 'complete the fellowship');
  lab.queue({ kind: 'accept_customer_brief', briefId: 'launch-window' });
  lab.queue({ kind: 'allocate_compute', serving: 4 * U, research: 0, development: 0 });
  lab.step();
  const snapshot = serializeState(lab.state);
  const loaded = deserializeState(snapshot);
  assert.ok(loaded.ok);
  assert.equal(serializeState(loaded.state), snapshot);
  lab.state = loaded.state;
  lab.until(state => state.slices.campaign.customerBriefs?.['launch-window']?.status === 'completed', 4, 'carry a launch surge');

  lab.step(30 - lab.week);
  assert.ok(lab.minimumCashCents > 0);
  assert.ok(lab.company.lastWeek.revenueCents > lab.company.lastWeek.operatingExpenseCents);
  assert.equal(lab.company.activeStaff, 2);
  assert.ok(lab.research.includes('D1'));
  assert.ok(lab.staff('research')[0].career!.experience > 0);
  assert.ok(lab.staff('data')[0].career!.experience > 0);
  assert.equal(submitCommand(lab.state, { kind: 'accept_customer_brief', briefId: 'launch-window' }).accepted, false);
});
