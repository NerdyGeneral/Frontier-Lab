import test from 'node:test';
import assert from 'node:assert/strict';
import type { CampaignWeek, GameState } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { createInitialState, advanceWeek } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { assertWave4CampaignState } from '../src/core/wave4-campaign-validation';
import { advanceCampaignProgress, campaignRouteCriteria, captureCampaignWeek, getCampaignView, qualifiesForEnding } from '../src/modules/campaign-progress';

function platformWeek(week: number): CampaignWeek {
  return { week,revenueCents:1_000_000,operatingExpenseCents:700_000,cashCents:8_000_000,baseCostCents:700_000,arrearsCents:0,
    consumerAccounts:700,developerAccounts:80,businessOrganizations:0,paidProductKinds:2,serviceBps:9900,trustBps:8000,agentPenaltyCents:0,
    frontierModelId:null,frontierScoreBps:0,frontierReliabilityBps:0,frontierBehaviorTested:false,
    specialistModelId:null,specialistScoreBps:0,specialistReliabilityBps:0,sustainedContracts:0 };
}
const emptyCampaign = (): GameState['slices']['campaign'] => ({milestones:[],endingStreaks:{frontier:0,platform:0,specialist:0},history:[],endings:{}});

test('W4-C01: the platform route needs simultaneous paid reach, service, margin, trust and cash reserve', () => {
  const row=platformWeek(1);assert.equal(qualifiesForEnding(row,'platform'),true);
  for (const bad of [{consumerAccounts:599},{developerAccounts:59},{paidProductKinds:1},{serviceBps:9799},{trustBps:7499},
    {cashCents:5_599_999},{arrearsCents:1},{operatingExpenseCents:850_001},{revenueCents:599_999},{agentPenaltyCents:1}]) {
    assert.equal(qualifiesForEnding({...row,...bad},'platform'),false,JSON.stringify(bad));
  }
  assert.equal(qualifiesForEnding(row,'frontier'),false);assert.equal(qualifiesForEnding(row,'specialist'),false);
});

test('W4-C02: frontier quality, reliability and behavior evidence must belong to the same delivered model', () => {
  const row={...platformWeek(1),frontierModelId:'trained-frontier',frontierScoreBps:8000,frontierReliabilityBps:9200,frontierBehaviorTested:true};
  assert.equal(qualifiesForEnding(row,'frontier'),true);
  for(const bad of [{frontierModelId:null},{frontierScoreBps:7999},{frontierReliabilityBps:9199},{frontierBehaviorTested:false}]) assert.equal(qualifiesForEnding({...row,...bad},'frontier'),false);
  const specialist={...platformWeek(1),businessOrganizations:12,specialistModelId:'trained-domain',specialistScoreBps:6500,specialistReliabilityBps:9200,sustainedContracts:1};
  assert.equal(qualifiesForEnding(specialist,'specialist'),true);
  assert.equal(qualifiesForEnding({...specialist,sustainedContracts:0},'specialist'),false);
  assert.equal(qualifiesForEnding({...specialist,businessOrganizations:11},'specialist'),false);
});

test('W4-C03: a breach or missing week resets progress and an ending cannot be earned by repeated same-week updates', () => {
  const campaign=emptyCampaign();
  for(let week=1;week<=11;week++)assert.equal(advanceCampaignProgress(campaign,platformWeek(week)).length,0);
  assert.equal(campaign.endingStreaks.platform,11);
  advanceCampaignProgress(campaign,{...platformWeek(12),serviceBps:9000});assert.equal(campaign.endingStreaks.platform,0);
  advanceCampaignProgress(campaign,platformWeek(13));advanceCampaignProgress(campaign,platformWeek(15));assert.equal(campaign.endingStreaks.platform,1);
  const fingerprint=canonicalStateHash(campaign);assert.equal(advanceCampaignProgress(campaign,platformWeek(15)).length,0);assert.equal(canonicalStateHash(campaign),fingerprint);
  assert.throws(()=>advanceCampaignProgress(campaign,{...platformWeek(15),revenueCents:1}),/cannot be rewritten/);
  assert.equal(campaign.endings.platform,undefined);
});

test('W4-C04: earned endings persist through later losses with bounded proof and a once-only announcement', () => {
  const campaign=emptyCampaign();let announcements=0;
  for(let week=1;week<=100;week++)announcements+=advanceCampaignProgress(campaign,platformWeek(week)).length;
  assert.equal(announcements,1);assert.equal(campaign.endings.platform?.achievedWeek,12);assert.equal(campaign.endings.platform?.proof.length,12);
  assert.equal(campaign.history.length,16);assert.equal(campaign.endingStreaks.platform,12);
  advanceCampaignProgress(campaign,{...platformWeek(101),arrearsCents:10});assert.equal(campaign.endingStreaks.platform,0);
  assert.equal(campaign.endings.platform?.achievedWeek,12);assert.equal(campaign.milestones.filter(id=>id==='ending-platform').length,1);
  const state=createInitialState();state.week=101;state.slices.campaign=campaign;
  assert.doesNotThrow(()=>assertWave4CampaignState(state,CONTENT));
  const corrupted=structuredClone(state);corrupted.slices.campaign.endingStreaks.platform=12;
  assert.throws(()=>assertWave4CampaignState(corrupted,CONTENT),/streak/);
  const brokenProof=structuredClone(state);brokenProof.slices.campaign.endings.platform!.proof[3].week++;
  assert.throws(()=>assertWave4CampaignState(brokenProof,CONTENT),/nonconsecutive/);
});

test('W4-C05: rival starting assets, trials and next-week cohorts do not create player victory progress', () => {
  const state=createInitialState(), row=captureCampaignWeek(state);
  assert.equal(row.consumerAccounts,0);assert.equal(row.developerAccounts,0);assert.equal(row.businessOrganizations,0);
  assert.equal(row.frontierModelId,null);assert.equal(row.specialistModelId,null);
  assert.equal(getCampaignView(state).completedCount,0);
  const loss=campaignRouteCriteria({...platformWeek(1),operatingExpenseCents:2_000_000},'platform').find(item=>item.id==='margin');
  assert.equal(loss?.met,false);assert.equal(loss?.current,'-100.0%');
});

test('W4-C06: real weekly play records only bounded settled evidence and survives save/load without ending awards', () => {
  let state=createInitialState();
  for(let i=0;i<20;i++){const result=advanceWeek(state);assert.ok(result.accepted,result.reason?.message);state=result.state;}
  assert.equal(state.slices.campaign.history.length,16);assert.equal(state.slices.campaign.history.at(-1)?.week,20);
  assert.deepEqual(state.slices.campaign.endingStreaks,{frontier:0,platform:0,specialist:0});
  const loaded=deserializeState(serializeState(state));assert.ok(loaded.ok,loaded.ok?'':loaded.error);
  assert.equal(canonicalStateHash(loaded.state),canonicalStateHash(state));assert.equal(getCampaignView(loaded.state).completedCount,0);
});
