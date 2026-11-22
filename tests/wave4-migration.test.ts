import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek, createInitialState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateLegacyWave3State } from '../src/core/legacy-wave3-validation';
import { validateState } from '../src/core/validation';

// Authored QA scenario advanced by the actual published Wave 3 engine. The save
// contains pending licensed delivery, an agent review, and five queued actions.
const raw = readFileSync(join(__dirname, 'fixtures/wave3-snapshot.json'), 'utf8');
const envelope = () => JSON.parse(raw) as { format: string; schemaVersion: number; contentVersion: string; state: GameState; checksum: string };
function owned<T extends { companyId: string }>(record: Record<string, T>, id: string) { return Object.fromEntries(Object.entries(record).filter(([,value]) => value.companyId === id)); }
function projection(state: GameState) {
  const id = state.playerCompanyId;
  const models = structuredClone(state.slices.models) as Partial<GameState['slices']['models']>; delete models.applicationRuns;
  const products = structuredClone(state.slices.products) as Partial<GameState['slices']['products']>; delete products.efficiencyInstalls;
  return {
    week: state.week, player: state.slices.company.companies[id],
    ledger: state.slices.company.ledger.filter(item => item.companyId === id && item.week === state.week),
    fleet: state.slices.compute.fleets[id], staff: owned(state.slices.company.staff,id),
    research: owned(state.slices.research.projects,id), completedResearch: state.slices.research.completedByCompany[id],
    racks: owned(state.slices.compute.racks,id), agents: state.slices.agents, products, models,
    queuedCommands: state.queuedCommands.filter(command => command.companyId === id),
    scheduled: state.scheduled.filter(item => item.companyId === id), random: state.random,
  };
}
const oracle = JSON.parse(readFileSync(join(__dirname,'fixtures/wave3-expected.json'),'utf8')) as {
  sourceCommit: string; baseline: ReturnType<typeof projection>; weeks: ReturnType<typeof projection>[];
};
function migrated() { const result = deserializeState(raw); assert.ok(result.ok, result.ok ? '' : result.error); return result; }

test('W4-S01: published Wave 3 state gains inert Wave 4 records and the announced market calendar', () => {
  const old = envelope();
  assert.equal(oracle.sourceCommit, 'aa7e3d6f8d1d2b3a4e567b7ead047dc2f87afddd');
  assert.equal(old.schemaVersion,4); assert.equal(old.contentVersion,'0.4.0');
  assert.equal(old.checksum,'362608fc'); assert.equal(old.checksum,canonicalStateHash(old.state));
  assert.deepEqual(validateLegacyWave3State(old.state,{...CONTENT,version:'0.4.0',buildVersion:'0.4.0'}),[]);
  const result=migrated(), state=result.state;
  assert.equal(result.migratedFrom,4); assert.equal(state.schemaVersion,5); assert.equal(state.contentVersion,CONTENT.version);
  for (const key of ['week','revision','nextId','seed','playerCompanyId','random','queuedCommands','commandReceipts','scheduled','journal','lastTick'] as const) assert.deepEqual(state[key],old.state[key]);
  for (const key of ['company','data','agents'] as const) assert.deepEqual(state.slices[key],old.state.slices[key]);
  assert.deepEqual(state.slices.markets, { ...old.state.slices.markets, opportunityCalendar: { startedWeek: old.state.week, sequenceVersion: 2 as const } });
  assert.deepEqual(state.slices.compute,{...old.state.slices.compute,chipDesigns:{},chipBatches:{},fabricProjects:{},servingHistory:{}});
  assert.deepEqual(state.slices.models,{...old.state.slices.models,applicationRuns:{}});
  assert.deepEqual(state.slices.research,{...old.state.slices.research,systemRollouts:{},assistantsByCompany:{}});
  assert.deepEqual(state.slices.products,{...old.state.slices.products,efficiencyInstalls:{}});
  assert.deepEqual(state.slices.campaign,{...old.state.slices.campaign,history:[],endings:{}});
  assert.deepEqual(projection(state),oracle.baseline);
  assert.deepEqual(validateState(state,CONTENT),[]);
});

test('W4-S02: active agent, license delivery and queued obligations preserve the published three-week economic oracle', () => {
  // Upgrade the schema while retaining the original staff economics for this published oracle.
  const replayContent = { ...CONTENT, version: '0.5.0', buildVersion: '0.5.0' };
  const replay = deserializeState(raw, replayContent); assert.ok(replay.ok, replay.ok ? '' : replay.error);
  let state=replay.state;
  for (const expected of oracle.weeks) {
    const result=advanceWeek(state, replayContent); assert.ok(result.accepted,result.reason?.message); state=result.state;
    assert.deepEqual(projection(state),expected,`Published economic outcome changed in Week ${expected.week}`);
    assert.equal(Object.keys(state.slices.compute.chipDesigns).length,0);
    assert.equal(Object.keys(state.slices.models.applicationRuns).length,0);
  }
  for (const command of envelope().state.queuedCommands) assert.equal(state.commandReceipts[command.id].status,'accepted');
});

test('W4-S03: migration and subsequent replay remain deterministic across a schema5 round trip', () => {
  const first=migrated(), second=migrated(); assert.deepEqual(first,second);
  const restored=deserializeState(serializeState(first.state)); assert.ok(restored.ok,restored.ok?'':restored.error);
  assert.equal(restored.migratedFrom,undefined);
  let left=first.state,right=restored.state;
  for(let i=0;i<6;i++) {
    const a=advanceWeek(left),b=advanceWeek(right);assert.ok(a.accepted,a.reason?.message);assert.ok(b.accepted,b.reason?.message);
    left=a.state;right=b.state;assert.equal(canonicalStateHash(left),canonicalStateHash(right));
  }
});

test('W4-S04: checksum corruption, fake legacy headers and future commands cannot bypass schema4 validation', () => {
  const corrupt=envelope();corrupt.state.slices.company.companies[corrupt.state.playerCompanyId].cashCents++;
  const failed=deserializeState(JSON.stringify(corrupt));assert.equal(failed.ok,false);if(!failed.ok)assert.match(failed.error,/checksum/);
  const newerContent={...CONTENT,version:'0.36.0',buildVersion:'0.36.0'};
  const fake=createInitialState(newerContent);
  assert.deepEqual(validateState(fake,newerContent),[],'Isolate the historical calendar feature before changing its headers.');
  fake.schemaVersion=4;fake.contentVersion='0.4.0';fake.buildVersion='0.4.0';
  const rejected=deserializeState(JSON.stringify({format:'frontier-lab',schemaVersion:4,contentVersion:'0.4.0',state:fake,checksum:canonicalStateHash(fake)}));
  assert.equal(rejected.ok,false);if(!rejected.ok)assert.match(rejected.error,/Specialist commissions and varied campaign schedules do not belong to this historical save version/);
  const command=envelope();command.state.queuedCommands[0].payload={kind:'start_chip_design',name:'Forged',spec:{architecture:'dense',target:'inference',memory:'balanced'}};
  command.checksum=canonicalStateHash(command.state);const unsupported=deserializeState(JSON.stringify(command));assert.equal(unsupported.ok,false);
  if(!unsupported.ok)assert.match(unsupported.error,/Unknown command/);
});
