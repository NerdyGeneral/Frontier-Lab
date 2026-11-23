import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { CONTENT } from '/workspace/sites/frontier-lab/.sites-checkout/src/content/catalog.ts';
import { RESOURCE_SCALE as U, type CommandPayload, type GameState } from '/workspace/sites/frontier-lab/.sites-checkout/src/contracts/types.ts';
import { createInitialState, submitCommand, previewCommand, advanceWeek, validateState } from '/workspace/sites/frontier-lab/.sites-checkout/src/core/engine.ts';
import { canonicalStateHash } from '/workspace/sites/frontier-lab/.sites-checkout/src/core/canonical.ts';
import { serializeState, deserializeState } from '/workspace/sites/frontier-lab/.sites-checkout/src/core/snapshot.ts';
import { getStudioView } from '/workspace/sites/frontier-lab/.sites-checkout/src/core/studio.ts';
import { getStudioJourney, type StudioJourneyFocus } from '/workspace/sites/frontier-lab/.sites-checkout/src/core/studio-journey.ts';
import { companyChapterEarnedWeek } from '/workspace/sites/frontier-lab/.sites-checkout/src/modules/progression-state.ts';
import { briefPaymentId } from '/workspace/sites/frontier-lab/.sites-checkout/src/modules/customer-briefs.ts';

const seedBase = 'campaign-6eeb41f41dbf9876bb3a212a573398e2';
const content = { ...CONTENT, opening: { ...CONTENT.opening, seed: seedBase } };
const traces: any[] = [];
class Campaign {
  state: GameState; serial=0; focus: StudioJourneyFocus={}; commands: any[]=[]; checkpoints: any[]=[]; reloads: any[]=[]; minimumCash=Infinity;
  constructor(readonly name: string, readonly origin: 'garage'|'university'|'consultancy') { this.state=createInitialState(content,'release',origin); this.record('opening'); }
  get owner(){return this.state.playerCompanyId;}
  get company(){return this.state.slices.company.companies[this.owner];}
  queue(payload: CommandPayload){
    const hash=canonicalStateHash(this.state), preview=previewCommand(this.state,payload,CONTENT);
    assert.ok(preview.accepted,preview.reason?.message);assert.equal(canonicalStateHash(this.state),hash);
    const id=this.name+'-'+(++this.serial), result=submitCommand(this.state,payload,CONTENT,id);
    assert.ok(result.accepted,result.reason?.message);assert.equal(canonicalStateHash(this.state),hash);this.state=result.state;
    if(['prepare_data','start_training','evaluate_model','deploy_product'].includes(payload.kind))this.focus={command:{id,effectiveWeek:this.state.week+1,payload}};
    this.commands.push({week:this.state.week,id,payload,quotedUpfrontCents:preview.upfrontCostCents});return id;
  }
  record(label: string){
    const hash=canonicalStateHash(this.state), view=getStudioView(this.state), journey=getStudioJourney(this.state,this.focus,view.projects);
    assert.equal(canonicalStateHash(this.state),hash);this.minimumCash=Math.min(this.minimumCash,this.company.cashCents);
    const invoiceCents=this.state.slices.products.invoices.filter(x=>x.companyId===this.owner).reduce((n,x)=>n+x.amountCents,0);
    const row={label,week:this.state.week,cashCents:this.company.cashCents,earnedRevenueCents:this.company.earnedRevenueCents,publicInvoiceCents:invoiceCents,journey,
      firstPayingServiceChapterWeek:companyChapterEarnedWeek(this.state,'first-product')};
    this.checkpoints.push(row);return journey;
  }
  step(expectedRejections: string[]=[]){
    const before=this.state, hash=canonicalStateHash(before), due=before.queuedCommands.filter(x=>x.companyId===this.owner);
    const result=advanceWeek(before);assert.ok(result.accepted,result.reason?.message);assert.equal(canonicalStateHash(before),hash);this.state=result.state;
    for(const q of due)assert.equal(this.state.commandReceipts[q.id]?.status,expectedRejections.includes(q.id)?'rejected':'accepted',q.id+': '+this.state.commandReceipts[q.id]?.reason?.message);
    assert.equal(this.company.arrearsCents,0);this.record('settled');
  }
  until(predicate:()=>boolean,limit=24){for(let i=0;!predicate()&&i<limit;i++)this.step();assert.ok(predicate(),this.name+' did not reach boundary');}
  reload(label:string){
    const original=this.state, bytes=serializeState(original), decoded=deserializeState(bytes);assert.ok(decoded.ok,decoded.ok?'':decoded.error);
    assert.equal(canonicalStateHash(decoded.state),canonicalStateHash(original));
    const a=advanceWeek(original),b=advanceWeek(decoded.state);assert.ok(a.accepted,a.reason?.message);assert.ok(b.accepted,b.reason?.message);
    assert.equal(canonicalStateHash(a.state),canonicalStateHash(b.state));
    this.reloads.push({label,week:original.week,checksum:canonicalStateHash(original),nextWeekChecksum:canonicalStateHash(a.state)});this.state=decoded.state;
  }
  finish(extra:Record<string,unknown>={}){assert.deepEqual(validateState(this.state),[]);const result={name:this.name,origin:this.origin,seed:this.state.seed,finalWeek:this.state.week,cashCents:this.company.cashCents,minimumCashCents:this.minimumCash,arrearsCents:this.company.arrearsCents,...extra,commands:this.commands,checkpoints:this.checkpoints,reloads:this.reloads};traces.push(result);console.log(JSON.stringify({name:result.name,origin:result.origin,seed:result.seed,finalWeek:result.finalWeek,cashCents:result.cashCents,reloads:result.reloads.length,...extra}));}
}
function openingPlan(c:Campaign){return c.queue({kind:'start_development_plan',name:'Normal delegated opening',training:{kind:'start_training',baseModelId:CONTENT.seedModel.id,packetId:CONTENT.starterData.id},suiteId:'basic-conversation-1',feeBudgetCents:100000,cashReserveCents:300000,deadlineWeek:24,leadStaffId:'founder',capacityShareBps:10000});}
function launchAndBill(c:Campaign,modelId:string){
  const id=c.queue({kind:'deploy_product',modelId,priceCents:1200,allowance:100});c.queue({kind:'allocate_compute',serving:2*U,development:2*U,research:0});
  assert.equal(c.record('launch queued').status,'queued');c.reload('launch queued');
  const deployment=()=>c.state.slices.products.deployments['deployment:'+id];
  c.until(()=>!!deployment()&&deployment().status==='active');const liveWeek=c.state.week;c.record('live product');
  c.until(()=>c.state.slices.products.invoices.some(x=>x.companyId===c.owner&&x.amountCents>0));const firstInvoiceWeek=c.state.week;c.reload('first billed public service');
  return {deploymentReadyWeek:deployment().readyWeek,liveWeek,firstInvoiceWeek,firstPayingServiceChapterWeek:companyChapterEarnedWeek(c.state,'first-product')};
}
for(const origin of ['garage','consultancy'] as const){
  const c=new Campaign('manual-'+origin,origin);c.queue({kind:'prepare_data',packetId:CONTENT.starterData.id});c.queue({kind:'allocate_compute',serving:0,development:4*U,research:0});
  c.until(()=>c.state.slices.data.packets[CONTENT.starterData.id].prepared);const preparedWeek=c.state.week;
  const train=c.queue({kind:'start_training',baseModelId:CONTENT.seedModel.id,packetId:CONTENT.starterData.id});assert.equal(c.record('training queued').status,'queued');c.step();
  const run=()=>c.state.slices.models.trainingRuns['training-'+train];assert.ok(run().completedWork>0);c.reload('paid training active');
  if(origin==='garage'){
    const paidWork=run().completedWork;c.queue({kind:'set_job_paused',jobId:run().id,paused:true});c.step();assert.equal(run().completedWork,paidWork);assert.equal(c.record('paid training paused').status,'waiting');c.reload('paid training paused');
    c.queue({kind:'set_job_paused',jobId:run().id,paused:false});c.step();assert.ok(run().completedWork>paidWork);
  }
  c.until(()=>run().status==='complete');const trainedWeek=c.state.week,modelId=run().outputModelId;assert.deepEqual(c.record('training complete').primary.action,{kind:'evaluate',modelId});
  const evaluation=c.queue({kind:'evaluate_model',modelId});c.reload('evaluation queued');c.until(()=>c.state.slices.models.evaluationRuns['evaluation-'+evaluation]?.status==='complete');
  const reportId=c.state.slices.models.evaluationRuns['evaluation-'+evaluation].reportId!;assert.deepEqual(c.record('evaluation complete').primary.action,{kind:'launch',modelId,reportId});
  const evaluatedWeek=c.state.week,launch=launchAndBill(c,modelId),pilot=c.state.slices.campaign.customerBriefs?.['consultancy-pilot'];
  if(origin==='consultancy'){assert.equal(pilot?.status,'completed');assert.equal(pilot?.finishedWeek,8);assert.ok(c.state.slices.company.postedFacts[briefPaymentId(c.owner,'consultancy-pilot')]);}
  c.finish({preparedWeek,trainedWeek,evaluatedWeek,paidTrainingCUw:run().physicalWork/U,...launch,pilot:pilot??null});
}
{
  const c=new Campaign('delegated-university','university');const id=openingPlan(c);c.queue({kind:'allocate_compute',serving:0,development:4*U,research:0});c.step();c.reload('delegated preparation queued');
  const plan=()=>c.state.slices.models.developmentPlans!['development-'+id];
  c.until(()=>Object.values(c.state.slices.models.trainingRuns).some(r=>r.companyId===c.owner&&r.status==='running'));c.reload('delegated training active');
  c.until(()=>plan().status==='review');const reviewedWeek=c.state.week;assert.deepEqual(plan().steps.map(x=>x.key),['prepare:'+CONTENT.starterData.id,'train','evaluate']);
  assert.equal(Object.values(c.state.slices.products.offers).filter(offer=>offer.companyId===c.owner).length,0,'Delegation does not authorize a launch.');c.reload('paid report awaiting review');
  const launch=launchAndBill(c,plan().modelId!);c.finish({reviewedWeek,stages:plan().steps.length,...launch});
}
{
  const c=new Campaign('consultancy-expiry','consultancy');c.until(()=>c.state.week===7,7);c.reload('before inclusive pilot deadline');c.step();
  const pilot=c.state.slices.campaign.customerBriefs!['consultancy-pilot'];assert.equal(pilot.status,'expired');assert.equal(pilot.finishedWeek,8);assert.equal(c.company.earnedRevenueCents,0);c.step();assert.equal(c.company.earnedRevenueCents,0);c.finish({pilot});
}
{
  const c=new Campaign('cancel-paid-preparation','garage'),id=openingPlan(c);c.step();c.step();const plan=()=>c.state.slices.models.developmentPlans!['development-'+id];
  const stage=plan().steps[0],job=()=>c.state.slices.data.preparationJobs['preparation-'+stage.commandId];assert.ok(job().completedStaff>0&&job().status!=='complete');
  const paidWork=job().completedStaff;c.queue({kind:'cancel_development_plan',planId:plan().id});c.step();assert.equal(job().status,'paused');assert.equal(job().completedStaff,paidWork);const cancelled=structuredClone(plan());c.reload('cancelled paid preparation');
  c.queue({kind:'set_job_paused',jobId:job().id,paused:false});c.until(()=>job().status==='complete');c.step();assert.deepEqual(plan(),cancelled);assert.equal(Object.keys(c.state.slices.models.trainingRuns).length,0);
  assert.equal(c.state.slices.company.ledger.filter(f=>f.id===job().id+':fee').length,1);c.finish({paidPreparationCompletedWeek:job().completedWeek,noAutomaticTraining:true});
}
{
  const c=new Campaign('cancel-queued-handoff','garage'),id=openingPlan(c);c.step();const plan=c.state.slices.models.developmentPlans!['development-'+id],stage=plan.steps[0];
  c.queue({kind:'cancel_development_plan',planId:plan.id});c.reload('queued stage plus cancellation');c.step([stage.commandId]);assert.equal(c.state.slices.models.developmentPlans![plan.id].status,'cancelled');assert.equal(c.state.slices.data.preparationJobs['preparation-'+stage.commandId],undefined);
  assert.equal(c.state.slices.company.postedFacts['preparation-'+stage.commandId+':fee'],undefined);c.finish({cancelledStageCharged:false});
}
writeFileSync('/tmp/frontier-menu-gameplay-0384-natural.json',JSON.stringify({build:CONTENT.buildVersion,content:CONTENT.version,sourceCommit:'6eeb41f41dbf9876bb3a212a573398e2f08eacf9',method:'Ordinary submitCommand/advanceWeek only, no resource grants or direct progress mutation. Navigation/preview inspections assert canonical immutability. Reload checks compare restored state and separately advanced next-week outcomes.',cases:traces,pairedSaveContinuationChecks:traces.reduce((n,x)=>n+x.reloads.length,0)},null,2)+'\n');
