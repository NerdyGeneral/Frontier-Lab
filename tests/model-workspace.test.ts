import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ModelWorkspaceController, isTrainingBlueprintOrder, parseModelWorkspace } from '../src/persistence/model-workspace';
import type { ManualTrainingDraft, DelegatedTrainingDraft, ModelWorkspacePersistence } from '../src/persistence/model-workspace';
import type { SavedByteBinding } from '../src/persistence/studio-results';
import { hashSavedSnapshotSync } from '../src/persistence/saved-snapshot-hash';
import { DEFAULT_MODEL_DESIGN } from '../src/modules/model-design';
import { AI_SYSTEM_DEFAULTS } from '../src/content/ai-systems';
import { recommendedDesignEvaluation } from '../src/core/model-evaluation-goal';
import type { DevelopmentTrainingOrder } from '../src/contracts/development-plans';

const hash = (bytes: string): SavedByteBinding => ({ algorithm: 'SHA-256', digest: createHash('sha256').update(bytes).digest('hex'), byteLength: Buffer.byteLength(bytes) });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function storage() {
  let primary = 'original campaign', metadata: string | null = null, tokens = 0, writes = 0;
  const io: ModelWorkspacePersistence = {
    read: () => metadata, write: text => { metadata = text; writes++; }, remove: () => { metadata = null; },
    snapshotMatches: bytes => bytes === primary, hash: async bytes => hash(bytes), token: () => (++tokens).toString(16).padStart(32,'0'),
  };
  return { io, get primary() { return primary; }, set primary(value) { primary = value; }, get metadata() { return metadata; }, get writes() { return writes; } };
}
const manual = (): ManualTrainingDraft => ({
  recipeId: 'compact-conversation-adaptation', designRoute: 'custom', designDraft: { ...structuredClone(DEFAULT_MODEL_DESIGN), name: '' },
  baseId: 'seed-0', packetId: 'starter-data', explicitPacket: true, extraPackets: [], profile: 'reference', workspace: '',
  automated: false, asAdapter: false, retentionMode: 'replay', replayChoice: { domain: 'coding', shareBps: 5000, packetIds: [] },
  curriculumChoice: { shareBps: 5000, tracks: [{ domain: 'documents', packetIds: [] }, { domain: 'coding', packetIds: [] }] },
  architecture: 'dense', teacherId: '', teacherDomain: 'conversation', trainingView: 'advanced', designOpen: true,
});
const order: DevelopmentTrainingOrder = {
  kind: 'start_training', baseModelId: 'trained-parent', packetId: 'main-data', packetIds: ['main-data','second-data'],
  recipeId: 'compact-conversation-adaptation', profile: 'ambitious', workspace: 'recompute', continueFromParent: true,
  automatedCheckpoints: true, replay: { domain: 'coding', shareBps: 5000, packetIds: ['replay-data'] },
};
const delegated = (): DelegatedTrainingDraft => ({ name: 'Support project', baseId: order.baseModelId, selected: order.packetIds!,
  method: order.recipeId!, profile: 'ambitious', teacherId: '', teacherDomain: 'conversation', design: structuredClone(DEFAULT_MODEL_DESIGN),
  suiteId: 'expanded-capabilities-1', budget: '5000.', reserve: '', duration: '32', importedTraining: structuredClone(order) });

test('unfinished manual and delegated forms survive reload without becoming commands', async () => {
  const store = storage(), first = new ModelWorkspaceController(store.io);
  first.open({ playerId: 'player', mode: 'owner', savedBytes: store.primary }); await flush();
  first.setDraft('manual',manual()); first.setDraft('delegated',delegated());
  assert.equal(first.saveBlueprint('Replay specialist',order,'expanded-capabilities-1'),null);
  const restarted = new ModelWorkspaceController(store.io);
  restarted.open({ playerId: 'player', mode: 'owner', savedBytes: store.primary }); await flush();
  assert.deepEqual(restarted.getSnapshot().manual,manual());
  assert.deepEqual(restarted.getSnapshot().delegated,delegated());
  assert.deepEqual(restarted.getSnapshot().blueprints[0].training,order,'Workspace/checkpoints/replay survive exactly.');
  assert.equal(store.primary,'original campaign','Draft writes cannot create a game transaction.');
  assert.equal(restarted.getSnapshot().persistent,true);
  const external = structuredClone(order); restarted.saveBlueprint('Replay specialist',external); external.packetIds!.push('injected-later');
  assert.deepEqual(restarted.getSnapshot().blueprints[0].training,order,'Later caller changes cannot mutate the saved blueprint.');
});

test('draft metadata follows only successful primary saves and refuses a foreign campaign', async () => {
  const store=storage(), controller=new ModelWorkspaceController(store.io);
  controller.open({playerId:'player',mode:'owner',savedBytes:store.primary}); await flush(); controller.setDraft('manual',manual());
  const next='saved week 2'; store.primary=next; await controller.saved(next);
  const reopened=new ModelWorkspaceController(store.io); reopened.open({playerId:'player',mode:'owner',savedBytes:next}); await flush();
  assert.deepEqual(reopened.getSnapshot().manual,manual());
  const before=store.metadata; await controller.saved('proposed but never written'); assert.equal(store.metadata,before);
  store.primary='different campaign'; const foreign=new ModelWorkspaceController(store.io);
  foreign.open({playerId:'player',mode:'owner',savedBytes:store.primary}); await flush();
  assert.equal(foreign.getSnapshot().manual,null); assert.equal(foreign.getSnapshot().blueprints.length,0);
});

test('accepted same-byte imports reset drafts; observer and memory sessions never write shared metadata', async () => {
  const store=storage(), controller=new ModelWorkspaceController(store.io);
  controller.open({playerId:'player',mode:'owner',savedBytes:store.primary}); await flush(); controller.setDraft('manual',manual()); controller.saveBlueprint('Keep',order);
  const original=store.metadata;
  const observer=new ModelWorkspaceController(store.io); observer.open({playerId:'player',mode:'observer',savedBytes:store.primary});
  observer.setDraft('manual',manual()); await observer.saved(store.primary); assert.equal(store.metadata,original);
  const memory=new ModelWorkspaceController(store.io); memory.open({playerId:'player',mode:'memory',savedBytes:store.primary}); memory.setDraft('manual',manual());
  assert.deepEqual(memory.getSnapshot().manual,manual()); assert.equal(store.metadata,original);
  controller.replace({playerId:'player',mode:'owner',savedBytes:store.primary}); await flush();
  assert.equal(controller.getSnapshot().manual,null); assert.equal(controller.getSnapshot().blueprints.length,0);
});

test('stale asynchronous digests cannot restore another timeline or overwrite its drafts', async () => {
  const store=storage();
  const waiting: Array<{bytes:string;resolve:(value:SavedByteBinding)=>void}> = [];
  store.io.hash=bytes=>new Promise(resolve=>waiting.push({bytes,resolve}));
  const controller=new ModelWorkspaceController(store.io);
  controller.open({playerId:'player',mode:'owner',savedBytes:store.primary});
  store.primary='replacement'; controller.replace({playerId:'player',mode:'owner',savedBytes:store.primary});
  waiting[0].resolve(hash(waiting[0].bytes)); await flush(); assert.equal(controller.getSnapshot().ready,false);
  waiting[1].resolve(hash(waiting[1].bytes)); await flush(); controller.setDraft('manual',manual());
  const before=store.metadata; controller.suspend();
  await controller.saved('another proposed save'); assert.equal(store.metadata,before);
});

test('malformed and oversized metadata cannot become a training blueprint', async () => {
  const store=storage(), controller=new ModelWorkspaceController(store.io);
  controller.open({playerId:'player',mode:'owner',savedBytes:store.primary}); await flush(); controller.saveBlueprint('Valid',order);
  const valid=store.metadata!; assert.ok(parseModelWorkspace(valid));
  const modified=JSON.parse(valid); modified.data.blueprints[0].training.kind='start_research'; assert.equal(parseModelWorkspace(JSON.stringify(modified)),null);
  assert.equal(parseModelWorkspace(valid+' '.repeat(128*1024)),null);
  assert.equal(isTrainingBlueprintOrder({...order,grantResearch:true}),false);
  assert.equal(isTrainingBlueprintOrder({...order,packetIds:[{}]}),false);
  const corrupt=JSON.parse(valid); corrupt.data.manual={...manual(),extraPackets:{length:3}};
  assert.equal(parseModelWorkspace(JSON.stringify(corrupt)),null);
});

test('storage failures keep editable work in the tab and give an honest status', async () => {
  const store=storage(), controller=new ModelWorkspaceController(store.io);
  controller.open({playerId:'player',mode:'owner',savedBytes:store.primary}); await flush();
  store.io.write=()=>{throw new Error('Quota');}; controller.setDraft('manual',manual());
  assert.deepEqual(controller.getSnapshot().manual,manual()); assert.equal(controller.getSnapshot().persistent,false);
  assert.match(controller.getSnapshot().notice,/kept in this tab/);
});

test('successful saves bind drafts synchronously before an immediate close and reopen', async () => {
  const store = storage(); store.io.hashSync = hashSavedSnapshotSync;
  const controller = new ModelWorkspaceController(store.io);
  controller.open({ playerId: 'player', mode: 'owner', savedBytes: store.primary }); await flush();
  controller.setDraft('manual', manual()); controller.setDraft('delegated', delegated()); controller.saveBlueprint('Saved before close', order);
  const openingHash = store.io.hash;
  store.io.hash = () => { throw new Error('A ready save must not defer its binding to an asynchronous digest.'); };
  store.primary = '{"week":2,"name":"研究室 🔬"}';
  void controller.saved(store.primary);
  assert.deepEqual(parseModelWorkspace(store.metadata)!.binding, hash(store.primary), 'The binding must already exist before any promise or event loop turn.');
  controller.suspend();
  store.io.hash = openingHash;
  const reopened = new ModelWorkspaceController(store.io);
  reopened.open({ playerId: 'player', mode: 'owner', savedBytes: store.primary }); await flush();
  assert.deepEqual(reopened.getSnapshot().manual, manual());
  assert.deepEqual(reopened.getSnapshot().delegated, delegated());
  assert.equal(reopened.getSnapshot().blueprints[0].name, 'Saved before close');
  assert.deepEqual(reopened.getSnapshot().blueprints[0].training, order);
});

test('synchronous save binding reuses identical bytes and requires ready ownership and a real primary receipt', async () => {
  const store = storage(); let syncCalls = 0;
  store.io.hashSync = bytes => { syncCalls++; return hashSavedSnapshotSync(bytes); };
  const controller = new ModelWorkspaceController(store.io);
  controller.open({ playerId: 'player', mode: 'owner', savedBytes: store.primary });
  await controller.saved(store.primary);
  assert.equal(syncCalls, 0, 'Opening and saves made before readiness retain asynchronous initialization guards.');
  controller.setDraft('manual', manual());
  void controller.saved(store.primary); assert.equal(syncCalls, 0, 'An identical successfully bound save does not need another digest.');
  store.primary = 'successful next save'; void controller.saved(store.primary); assert.equal(syncCalls, 1);
  const persisted = store.metadata;
  void controller.saved(store.primary); assert.equal(syncCalls, 1);
  void controller.saved('not written'); assert.equal(syncCalls, 1); assert.equal(store.metadata, persisted);
  controller.suspend(); void controller.saved(store.primary); assert.equal(syncCalls, 1);
  for (const mode of ['observer', 'memory'] as const) {
    const other = new ModelWorkspaceController(store.io); other.open({ playerId: 'player', mode, savedBytes: store.primary });
    other.setDraft('manual', manual()); void other.saved(store.primary);
    assert.equal(syncCalls, 1); assert.equal(store.metadata, persisted);
  }
});

test('a late asynchronous save digest cannot overwrite a newer synchronous binding in the same session', async () => {
  const store = storage(), controller = new ModelWorkspaceController(store.io);
  controller.open({ playerId: 'player', mode: 'owner', savedBytes: store.primary }); await flush(); controller.setDraft('manual', manual());
  let finish: ((value: SavedByteBinding) => void) | undefined;
  store.io.hash = () => new Promise(resolve => { finish = resolve; });
  store.primary = 'first saved bytes'; const old = controller.saved(store.primary); await flush(); assert.ok(finish);
  store.io.hashSync = hashSavedSnapshotSync; store.primary = 'latest saved bytes';
  void controller.saved(store.primary); const persisted = store.metadata;
  assert.deepEqual(parseModelWorkspace(persisted)!.binding, hash(store.primary));
  finish(hash('first saved bytes')); await old;
  assert.equal(store.metadata, persisted);
});

test('test recommendations match specialist and response goals without granting an evaluation', () => {
  const custom: DevelopmentTrainingOrder={kind:'start_training',baseModelId:'seed-0',packetId:'data',modelDesign:structuredClone(DEFAULT_MODEL_DESIGN)};
  assert.equal(recommendedDesignEvaluation(custom).suiteId,'basic-conversation-1');
  custom.modelDesign!.dataMix.longContext=20; assert.equal(recommendedDesignEvaluation(custom).suiteId,'advanced-capabilities-1');
  for (const system of Object.values(AI_SYSTEM_DEFAULTS)) {
    const advice = recommendedDesignEvaluation({ ...custom, modelDesign: { ...custom.modelDesign!, system: structuredClone(system) } });
    assert.equal(advice.suiteId, 'expanded-capabilities-1', `${system.kind} needs a paid capability baseline before its systems challenge.`);
    assert.match(advice.reason, /paid capability baseline/);
    assert.match(advice.reason, /systems challenge next/);
  }
  assert.equal(recommendedDesignEvaluation(custom).suiteId, 'advanced-capabilities-1', 'Conventional specialist designs keep their existing diagnostic advice.');
  assert.equal(recommendedDesignEvaluation({...order,recipeId:'behavior-reliability'}).suiteId,'behavior-cases-1');
  custom.modelDesign!.dataMix.longContext=0; custom.modelDesign!.dataMix.documents=80;
  assert.equal(recommendedDesignEvaluation(custom).suiteId,'expanded-capabilities-1');
});
