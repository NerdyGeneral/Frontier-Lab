import assert from 'node:assert/strict';
import { CONTENT } from '../../src/content/catalog';
import type { GameState } from '../../src/contracts/types';
import { deserializeState, serializeState } from '../../src/core/snapshot';

/** Published oracles describe their original rules, not today's upgraded economy. */
export function historicalContent(state: Pick<GameState, 'contentVersion' | 'buildVersion'>) {
  return { ...CONTENT, version: state.contentVersion, buildVersion: state.buildVersion };
}

export function loadHistoricalSnapshot(text: string, targetVersion?: string) {
  const original = JSON.parse(text) as { state: GameState };
  const content = targetVersion ? { ...CONTENT, version: targetVersion, buildVersion: targetVersion } : historicalContent(original.state);
  const loaded = deserializeState(text, content);
  assert.ok(loaded.ok, loaded.ok ? undefined : loaded.error);
  return loaded;
}

/** Finish the exact published setup first, then upgrade before testing new features. */
export function upgradeHistoricalState(state: GameState): GameState {
  const saved = serializeState(state, historicalContent(state));
  const upgraded = deserializeState(saved);
  assert.ok(upgraded.ok, upgraded.ok ? undefined : upgraded.error);
  return upgraded.state;
}
