import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { CUSTOMIZATION_RESEARCH, CUSTOMIZATION_RESEARCH_GROUPS, CUSTOMIZATION_RESEARCH_IDS } from '../src/content/model-customization-research';
import { validateContent } from '../src/content/validate';
import { IMPLEMENTED_RESEARCH_IDS } from '../src/content/wave2-lab';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { createInitialState, previewCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { getResearchView } from '../src/modules/research';
import { advanceResearchWeek as step, earnResearch, queueResearchChoice as queue } from './fixtures/customization-research';
import { createPlayerOnlyState } from './fixtures/player-only';

test('customization research registers thirteen paid choices, complete pathways and valid prerequisite references', () => {
  assert.deepEqual(validateContent(CONTENT), []);
  assert.deepEqual(CUSTOMIZATION_RESEARCH.map(item => item.id), ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12', 'M13']);
  assert.equal(CONTENT.research.length, 54);
  assert.deepEqual(CUSTOMIZATION_RESEARCH_GROUPS.flatMap(group => [...group.ids]), [...CUSTOMIZATION_RESEARCH_IDS]);
  for (const definition of CUSTOMIZATION_RESEARCH) {
    assert.equal(CONTENT.research.filter(item => item.id === definition.id).length, 1);
    assert.ok((IMPLEMENTED_RESEARCH_IDS as readonly string[]).includes(definition.id));
    assert.ok(definition.implemented && definition.feeCents > 0 && definition.staffWeeks > 0 && definition.workCUw > 0);
    assert.ok(definition.requires.length > 0 && definition.requires.every(id => CONTENT.research.some(item => item.id === id)));
  }
  const game = createPlayerOnlyState(), before = serializeState(game);
  const choices = getResearchView(game, game.playerCompanyId).filter(item => item.id.startsWith('M'));
  assert.equal(choices.length, 13);
  assert.ok(choices.every(item => item.status === 'locked' && item.implemented));
  assert.equal(previewCommand(game, { kind: 'start_research', researchId: 'M1' }).accepted, false);
  assert.equal(serializeState(game), before);
});

test('customization discovery pays independent meters once, pauses safely and unlocks on the next boundary', () => {
  let game = earnResearch(['R3']);
  const originalModels = canonicalStateHash(game.slices.models.versions);
  game = queue(game, { kind: 'allocate_compute', serving: 0, development: 0, research: 0 }, 'customization-staff-only');
  game = queue(game, { kind: 'start_research', researchId: 'M1' }, 'customization-M1');
  assert.equal(previewCommand(game, { kind: 'start_research', researchId: 'M1' }).reason?.code, 'ALREADY_ACTIVE');
  game = step(step(game));
  const projectId = 'research-customization-M1';
  assert.equal(game.slices.research.projects[projectId].completedStaff, 2 * U);
  assert.equal(game.slices.research.projects[projectId].completedWork, 0);
  assert.equal(game.slices.company.postedFacts[projectId + ':method:M1'], true);
  assert.equal(game.slices.company.ledger.filter(item => item.id === projectId + ':fee').length, 1);
  assert.equal(game.slices.company.ledger.find(item => item.id === projectId + ':fee')?.amountCents, 180_000);
  game = queue(game, { kind: 'set_research_paused', projectId, paused: true }, 'customization-pause');
  game = queue(game, { kind: 'allocate_compute', serving: 0, development: 0, research: 2 * U }, 'customization-work');
  game = step(step(game));
  assert.equal(game.slices.research.projects[projectId].completedWork, 0);
  const resumed = deserializeState(serializeState(game)); assert.ok(resumed.ok, resumed.ok ? '' : resumed.error);
  assert.deepEqual(resumed.state, game);
  game = queue(resumed.state, { kind: 'set_research_paused', projectId, paused: false }, 'customization-resume');
  game = step(step(game));
  const complete = game.slices.research.projects[projectId];
  assert.equal(complete.status, 'complete');
  assert.equal(complete.completedWork, 4 * U);
  assert.equal(complete.availableWeek, game.week + 1);
  assert.equal(getResearchView(game, game.playerCompanyId).find(item => item.id === 'M1')?.status, 'pending');
  game = step(game);
  assert.equal(getResearchView(game, game.playerCompanyId).find(item => item.id === 'M1')?.status, 'complete');
  assert.equal(previewCommand(game, { kind: 'start_research', researchId: 'M1' }).reason?.code, 'NO_IMPROVEMENT');
  assert.equal(canonicalStateHash(game.slices.models.versions), originalModels, 'Discovery does not silently improve an existing model');
  assert.equal(game.slices.company.ledger.filter(item => item.id === projectId + ':fee').length, 1);
  assert.deepEqual(validateState(game), []);
});

test('a downstream attention discovery requires both its paid attention and retrieval branches', () => {
  let game = earnResearch(['R3', 'M1']);
  const rejected = previewCommand(game, { kind: 'start_research', researchId: 'M2' });
  assert.equal(rejected.accepted, false); assert.match(rejected.reason?.message ?? '', /R6/);
  game = earnResearch(['R1', 'R2', 'R6'], game);
  const ready = previewCommand(game, { kind: 'start_research', researchId: 'M2' });
  assert.equal(ready.accepted, true, ready.reason?.message);
  assert.equal(ready.upfrontCostCents, 420_000);
  game = earnResearch(['M2'], game);
  const project = game.slices.research.projects['research-customization-research-M2'];
  for (const prerequisite of ['M1', 'R6']) {
    const proof = Object.values(game.slices.research.projects).find(item => item.researchId === prerequisite)!;
    assert.ok(proof.availableWeek! <= project.startedWeek);
  }
  assert.deepEqual(validateState(game), []);
});

test('a university lab can use legitimate founding knowledge in a paid customization discovery', () => {
  const opening = createInitialState(CONTENT, 'release', 'university');
  assert.ok(opening.slices.research.completedByCompany[opening.playerCompanyId].includes('R1'));
  assert.equal(Object.values(opening.slices.research.projects).some(project => project.companyId === opening.playerCompanyId && project.researchId === 'R1'), false);
  const game = earnResearch(['R4', 'M8'], opening);
  const project = game.slices.research.projects['research-customization-research-M8'];
  assert.equal(project.status, 'complete');
  assert.equal(project.completedWork, project.requiredWork);
  assert.equal(project.completedStaff, project.requiredStaff);
  assert.equal(game.slices.company.postedFacts[project.id + ':method:M8'], true);
  assert.deepEqual(validateState(game), []);
});

test('backdated or relabelled customization research cannot forge paid knowledge under a valid checksum', () => {
  const game = earnResearch(['R3', 'M1', 'R1', 'R1A', 'D1']);
  assert.deepEqual(validateState(game), []);
  const projectId = 'research-customization-research-M1';
  const corruptions = [
    (forged: typeof game) => { forged.slices.research.projects[projectId].startedWeek = forged.slices.research.projects['research-customization-research-R3'].availableWeek! - 1; },
    (forged: typeof game) => { delete forged.slices.company.postedFacts[projectId + ':method:M1']; },
    (forged: typeof game) => {
      forged.slices.research.projects[projectId].researchId = 'M13';
      forged.slices.research.completed = forged.slices.research.completed.map(id => id === 'M1' ? 'M13' : id).sort();
      forged.slices.research.completedByCompany[forged.playerCompanyId] = [...forged.slices.research.completed];
    },
  ];
  for (const corrupt of corruptions) {
    const forged = structuredClone(game); corrupt(forged);
    assert.ok(validateState(forged).length > 0);
    const imported = deserializeState(JSON.stringify({ format: 'frontier-lab', schemaVersion: forged.schemaVersion,
      contentVersion: forged.contentVersion, checksum: canonicalStateHash(forged), state: forged }));
    assert.equal(imported.ok, false);
  }
});
