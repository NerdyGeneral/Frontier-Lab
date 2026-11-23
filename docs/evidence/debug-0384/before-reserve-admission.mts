import assert from 'node:assert/strict';
import { CONTENT } from '/workspace/sites/frontier-lab/.sites-checkout/src/content/catalog.ts';
import { createInitialState, submitCommand, advanceWeek, validateState } from '/workspace/sites/frontier-lab/.sites-checkout/src/core/engine.ts';
import { canonicalStateHash } from '/workspace/sites/frontier-lab/.sites-checkout/src/core/canonical.ts';
import { serializeState, deserializeState } from '/workspace/sites/frontier-lab/.sites-checkout/src/core/snapshot.ts';
let state = createInitialState(CONTENT, 'release', 'garage');
const planSpec = {kind: 'start_development_plan' as const, name: 'Cash reserve probe', training: {kind: 'start_training' as const, baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id}, suiteId: 'basic-conversation-1' as const, feeBudgetCents: 100000, cashReserveCents: 3990000, deadlineWeek: 30};
let result = submitCommand(state, planSpec, CONTENT, 'reserve-probe-plan'); assert.ok(result.accepted, result.reason?.message); state=result.state;
let tick=advanceWeek(state);assert.ok(tick.accepted,tick.reason?.message);state=tick.state;
const plan=state.slices.models.developmentPlans!['development-reserve-probe-plan'];
assert.equal(plan.steps.length,1);
const stage=plan.steps[0];
result=submitCommand(state,{kind:'buy_data',catalogId:'specialist-coding-1'},CONTENT,'reserve-probe-data');assert.ok(result.accepted,result.reason?.message);state=result.state;
const decoded=deserializeState(serializeState(state));assert.ok(decoded.ok);assert.equal(canonicalStateHash(decoded.state),canonicalStateHash(state));
console.log(JSON.stringify({build:CONTENT.buildVersion,beforeWeek:state.week,cash:state.slices.company.companies[state.playerCompanyId].cashCents,reserve:plan.cashReserveCents,stage:stage.payload,queued:state.queuedCommands.filter(c=>c.companyId===state.playerCompanyId).map(c=>({id:c.id,payload:c.payload,reservedCents:c.reservedCents})),valid:validateState(state)},null,2));
for(const order of ['ordinary','purchase-first-control'] as const){
 const branch=structuredClone(state);
 if(order==='purchase-first-control') branch.queuedCommands.sort((a,b)=>Number(b.id==='reserve-probe-data')-Number(a.id==='reserve-probe-data'));
 assert.deepEqual(validateState(branch),[]);
 const next=advanceWeek(branch);assert.ok(next.accepted,next.reason?.message);
 const company=next.state.slices.company.companies[next.state.playerCompanyId];
 console.log(JSON.stringify({order,week:next.state.week,cash:company.cashCents,reserve:plan.cashReserveCents,stageReceipt:next.state.commandReceipts[stage.commandId],purchaseReceipt:next.state.commandReceipts['reserve-probe-data'],plan:next.state.slices.models.developmentPlans![plan.id].status,arrears:company.arrearsCents},null,2));
}
