import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { ModelWorkspaceController, isDevelopmentGoal, parseModelWorkspace } from '../src/persistence/model-workspace';
import type { ModelWorkspacePersistence, DevelopmentGoal, DelegatedTrainingDraft } from '../src/persistence/model-workspace';
import { DEFAULT_MODEL_DESIGN } from '../src/modules/model-design';
import { AI_SYSTEM_DEFAULTS } from '../src/content/ai-systems';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function storage() {
  let primary = 'saved company', metadata: string | null = null;
  const io: ModelWorkspacePersistence = {
    read: () => metadata, write: value => { metadata = value; }, remove: () => { metadata = null; },
    snapshotMatches: bytes => bytes === primary, token: () => '0123456789abcdef0123456789abcdef',
    hash: async bytes => ({ algorithm: 'SHA-256', digest: createHash('sha256').update(bytes).digest('hex'), byteLength: Buffer.byteLength(bytes) }),
  };
  return { io, get primary() { return primary; }, set primary(value) { primary = value; }, get metadata() { return metadata; }, set metadata(value) { metadata = value; } };
}
function delegated(): DelegatedTrainingDraft {
  const design = { ...structuredClone(DEFAULT_MODEL_DESIGN), mode: 'foundation' as const, name: 'Continuity desk', system: structuredClone(AI_SYSTEM_DEFAULTS.stateful) };
  return { name: 'Case continuity', baseId: 'seed-0', selected: ['starter-data', 'case-data'], method: 'custom', profile: 'balanced', teacherId: '', teacherDomain: 'documents',
    design, suiteId: 'advanced-capabilities-1', budget: '6000', reserve: '12000', duration: '40',
    importedTraining: { kind: 'start_training', baseModelId: 'seed-0', packetId: 'starter-data', packetIds: ['starter-data', 'case-data'], recipeId: 'custom-model-foundation', modelDesign: structuredClone(design) } };
}

test('a goal and exact delegated system survive reload without changing the game or existing order', async () => {
  const store = storage(), first = new ModelWorkspaceController(store.io);
  first.open({ playerId: 'player', mode: 'owner', savedBytes: store.primary }); await flush();
  first.setDraft('delegated', delegated());
  const goal: DevelopmentGoal = { kind: 'renewable-brief', id: 'continuity-desk' };
  first.setDevelopmentGoal(goal);
  const reopened = new ModelWorkspaceController(store.io);
  reopened.open({ playerId: 'player', mode: 'owner', savedBytes: store.primary }); await flush();
  assert.deepEqual(reopened.getSnapshot().developmentGoal, goal);
  assert.deepEqual(reopened.getSnapshot().delegated, delegated());
  assert.equal(store.primary, 'saved company');
  reopened.setDevelopmentGoal({ kind: 'system-challenge', id: 'systems-retention-1' });
  assert.deepEqual(reopened.getSnapshot().delegated, delegated(), 'Changing the objective cannot rewrite paid-training choices.');
  assert.ok(parseModelWorkspace(store.metadata));
});

test('old sidecars remain valid and replacement timelines clear their remembered objective', async () => {
  const store = storage(), controller = new ModelWorkspaceController(store.io);
  controller.open({ playerId: 'player', mode: 'owner', savedBytes: store.primary }); await flush();
  controller.setDraft('delegated', delegated()); controller.setDevelopmentGoal({ kind: 'purpose', id: 'analyst' });
  const old = JSON.parse(store.metadata!); delete old.data.developmentGoal;
  store.metadata = JSON.stringify(old);
  const reopened = new ModelWorkspaceController(store.io);
  reopened.open({ playerId: 'player', mode: 'owner', savedBytes: store.primary }); await flush();
  assert.deepEqual(reopened.getSnapshot().delegated, delegated()); assert.equal(reopened.getSnapshot().developmentGoal, undefined);
  reopened.setDevelopmentGoal({ kind: 'purpose', id: 'coding' });
  reopened.replace({ playerId: 'player', mode: 'owner', savedBytes: store.primary }); await flush();
  assert.equal(reopened.getSnapshot().developmentGoal, undefined); assert.equal(reopened.getSnapshot().delegated, null);
});

test('objective metadata cannot escape its owning tab or accept arbitrary targets', async () => {
  const store = storage(), owner = new ModelWorkspaceController(store.io);
  owner.open({ playerId: 'player', mode: 'owner', savedBytes: store.primary }); await flush();
  owner.setDevelopmentGoal({ kind: 'system-challenge', id: 'systems-memory-1' });
  const saved = store.metadata;
  const observer = new ModelWorkspaceController(store.io); observer.open({ playerId: 'player', mode: 'observer', savedBytes: store.primary });
  observer.setDevelopmentGoal({ kind: 'purpose', id: 'visual' }); assert.equal(store.metadata, saved);
  assert.equal(observer.getSnapshot().developmentGoal, undefined);
  for (const value of [{ kind: 'system-challenge', id: 'arbitrary' }, { kind: 'purpose', id: 'coding', unlock: true }, { kind: 'external', id: 'https://elsewhere' }]) assert.equal(isDevelopmentGoal(value), false);
  const corrupt = JSON.parse(saved!); corrupt.data.developmentGoal = { kind: 'system-challenge', id: 'arbitrary' };
  assert.equal(parseModelWorkspace(JSON.stringify(corrupt)), null);
  store.primary = 'another company'; const other = new ModelWorkspaceController(store.io);
  other.open({ playerId: 'player', mode: 'owner', savedBytes: store.primary }); await flush();
  assert.equal(other.getSnapshot().developmentGoal, undefined);
});
