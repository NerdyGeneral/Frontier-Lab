import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { canonicalStateHash } from '../src/core/canonical';
import { advanceWeek, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { migrateModelCustomizationState } from '../src/core/migration';
import { containsGameplayPolishFeatures } from '../src/core/gameplay-polish-version';
import { browserRecoveryOptions, readBrowserRecovery, readBrowserSnapshotWithBytes, writeBrowserSnapshotWithBytes } from '../src/persistence/wave0-browser';

// Captured from published 46dc6912, with paid M1/M3/M6 research and a real active
// 120-CUw customized run. No source rules or model scores were edited to make it.
const directory=typeof __dirname==='string'?join(__dirname,'fixtures'):join(process.cwd(),'tests','fixtures');
const initial=readFileSync(join(directory,'polish-035-initial-published.json'),'utf8');
const active=readFileSync(join(directory,'polish-035-active-published.json'),'utf8');
const historical={...CONTENT,version:'0.35.0',buildVersion:'0.35.0'};
const encode=(state:GameState)=>JSON.stringify({format:'frontier-lab',schemaVersion:5,contentVersion:state.contentVersion,checksum:canonicalStateHash(state),state});

test('published 0.35 labs keep every earned record and announced plan during 0.36 migration',()=>{
  for(const raw of [initial,active]) {
    const envelope=JSON.parse(raw), original:GameState=envelope.state;
    assert.equal(canonicalStateHash(original),envelope.checksum);
    assert.deepEqual(validateState(original,historical),[]);
    const result=deserializeState(raw); assert.ok(result.ok,result.ok?undefined:result.error);
    assert.equal(result.migratedFrom,35);
    assert.deepEqual(result.state,{...original,contentVersion:CONTENT.version,buildVersion:CONTENT.buildVersion});
    assert.equal(result.state.slices.markets.opportunityCalendar?.sequenceVersion,undefined,'Announced historical schedules keep their sequence.');
    assert.deepEqual(validateState(result.state),[]);
    const direct=migrateModelCustomizationState(original,CONTENT); assert.ok(direct.ok,direct.ok?undefined:direct.error);
    assert.deepEqual(direct.state,result.state);
  }
});

test('an active paid customization and its queued action survive upgrade, save and continued play',()=>{
  const original:GameState=JSON.parse(active).state;
  const imported=deserializeState(active); assert.ok(imported.ok,imported.ok?undefined:imported.error);
  const plan=original.slices.models.trainingRuns['training-published-035-training'];
  assert.equal(plan.status,'running'); assert.ok(plan.plan?.modelDesign?.customization);
  let a=imported.state;
  const decoded=deserializeState(serializeState(a)); assert.ok(decoded.ok,decoded.ok?undefined:decoded.error);
  let b=decoded.state;
  for(let week=0;week<4;week++) {
    const nextA=advanceWeek(a),nextB=advanceWeek(b);
    assert.ok(nextA.accepted,nextA.reason?.message); assert.ok(nextB.accepted,nextB.reason?.message);
    a=nextA.state;b=nextB.state;assert.deepEqual(a,b);
    assert.deepEqual(a.slices.models.trainingRuns[plan.id].plan,plan.plan,'Admission-time targets, effects and paid evidence stay frozen.');
  }
  assert.equal(a.commandReceipts['published-035-queued'].status,'accepted');
  assert.ok(a.slices.models.trainingRuns[plan.id].completedWork>plan.completedWork);
});

test('older headers reject specialist receipts, proofs and varied schedules before migration',()=>{
  const changes:Array<(game:GameState)=>void>=[
    game=>{game.slices.markets.opportunityCalendar!.sequenceVersion=2;},
    game=>{game.queuedCommands.push({id:'future-brief',companyId:game.playerCompanyId,issuedForWeek:game.week+1,payload:{kind:'accept_customer_brief',briefId:'visual-documents'}});},
    game=>{Object.values(game.slices.markets.rivals)[0].campaign!.tactics={version:1,focus:'efficiency'};},
    game=>{game.slices.company.postedFacts['brief-proof:forged']=true;},
  ];
  for(const change of changes){
    const game:GameState=JSON.parse(active).state;change(game);
    assert.equal(containsGameplayPolishFeatures(game),true);
    const result=deserializeState(encode(game));assert.equal(result.ok,false);
    if(!result.ok)assert.match(result.error,/historical save version/);
    assert.equal(migrateModelCustomizationState(game,CONTENT).ok,false);
  }
  assert.equal(containsGameplayPolishFeatures({name:'visual-documents',message:'support-at-scale',endings:{specialist:{week:10}}}),false);
});

class MemoryStorage implements Storage {
  values=new Map<string,string>(); writes:string[]=[]; failArchive=false;
  get length(){return this.values.size;} getItem(key:string){return this.values.get(key)??null;}
  setItem(key:string,value:string){if(this.failArchive&&key==='frontier-lab.content035.original')throw new DOMException('Quota','QuotaExceededError');this.values.set(key,value);this.writes.push(key);}
  removeItem(key:string){this.values.delete(key);}clear(){this.values.clear();}key(index:number){return [...this.values.keys()][index]??null;}
}
function browser(store:MemoryStorage,action:()=>void){const prior=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:store}});try{action();}finally{if(prior)Object.defineProperty(globalThis,'window',prior);else Reflect.deleteProperty(globalThis,'window');}}

test('browser migration archives the exact 0.35 bytes before writing the upgraded save',()=>{
  const store=new MemoryStorage(),primary='frontier-lab.wave0.snapshot',raw=initial.replace(/\n/g,'\r\n')+'\t\n';store.values.set(primary,raw);
  browser(store,()=>{const loaded=readBrowserSnapshotWithBytes();assert.equal(loaded.kind,'loaded');if(loaded.kind!=='loaded')return;
    assert.equal(loaded.migratedFrom,35);assert.deepEqual(store.writes,[]);
    assert.equal(writeBrowserSnapshotWithBytes(loaded.state).ok,true);
    assert.deepEqual(store.writes,['frontier-lab.content035.original',primary]);
    assert.equal(readBrowserRecovery('content035')?.text,raw);
    assert.ok(browserRecoveryOptions().some(option=>option.kind==='content035'));
  });
});

test('a failed original-save archive leaves the existing campaign untouched',()=>{
  const store=new MemoryStorage(),primary='frontier-lab.wave0.snapshot';store.values.set(primary,initial);store.failArchive=true;
  browser(store,()=>{const loaded=readBrowserSnapshotWithBytes();assert.equal(loaded.kind,'loaded');if(loaded.kind!=='loaded')return;
    assert.equal(writeBrowserSnapshotWithBytes(loaded.state).ok,false);assert.equal(store.getItem(primary),initial);assert.deepEqual(store.writes,[]);
  });
});
