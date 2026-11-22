import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../../src/content/catalog';
import type { GameState } from '../../src/contracts/types';
import { RESOURCE_SCALE as U } from '../../src/contracts/types';
import { deserializeState } from '../../src/core/snapshot';
import { NaturalBusinessCampaign } from './wave5-business';

interface CustomizationReadyFixture {
  state: GameState;
  packetId: string;
  commands: NaturalBusinessCampaign['commands'];
}
const cache = new Map<string, CustomizationReadyFixture>();

/** Continue the authentic published business through ordinary paid commands.
 * No model scores, cash, research, people, packets or resource grants are injected. */
export function getCustomizationReadyFixture(researchIds: readonly string[] = []): CustomizationReadyFixture {
  const requested = [...new Set(researchIds)].sort(), key = requested.join('-');
  if (!cache.has(key)) {
    const directory = typeof __dirname === 'string' ? __dirname : join(process.cwd(), 'tests', 'fixtures');
    const decoded = deserializeState(readFileSync(join(directory, 'wave26-published.json'), 'utf8'));
    assert.ok(decoded.ok, decoded.ok ? undefined : decoded.error);
    const run = new NaturalBusinessCampaign(decoded.state, 'customization-ready-' + (key || 'base'));
    run.queue({ kind: 'set_cloud_capacity', cu: 128 * U }); run.step();
    run.queue({ kind: 'allocate_compute', serving: 160 * U, development: 16 * U, research: 16 * U });
    run.founder('research'); run.step();
    const packetId = run.prepare('advanced-broad-1', 9500);
    const discover = (id: string) => {
      if (run.research.includes(id)) return;
      const definition = CONTENT.research.find(item => item.id === id); assert.ok(definition, 'Unknown research ' + id);
      for (const prerequisite of definition.requires) discover(prerequisite);
      run.discover(id);
    };
    for (const id of requested) discover(id);
    cache.set(key, { state: run.state, packetId, commands: run.commands });
  }
  return structuredClone(cache.get(key)!);
}
