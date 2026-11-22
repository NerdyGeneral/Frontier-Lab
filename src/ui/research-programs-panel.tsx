'use client';

import { useId, useState } from 'react';
import type { ResearchProgramId } from '../contracts/company-progression';
import { RESEARCH_PROGRAMS, RESEARCH_PROGRAM_IDS, RESEARCH_PROGRAM_STAGES } from '../content/company-progression';
import { hasConnectedCompanyRules } from '../core/connected-company-version';
import { formatMoney, formatUnits } from '../core/math';
import { createResearchExperimentTerms, getResearchProgramLevel, researchExperimentBaseline, researchExperimentChecks, researchProgramGate } from '../modules/research-programs';
import { formatWorkPoints } from '../modules/workforce-points';
import { ActionControl, Metric, Metrics, Section } from './components';
import type { PanelProps } from './panels';
import { useContinueTraining, useStudioTaskActions } from './studio-interaction-context';

export function ResearchProgramsPanel({ game, canAct, onQueue, selection }: Pick<PanelProps, 'game' | 'canAct' | 'onQueue'> & {
  selection?: { intentId: number; experimentId: string };
}) {
  const uid = useId().replaceAll(':', '');
  const [selected, setSelected] = useState<ResearchProgramId>('efficient-systems');
  const [modelChoice, setModelChoice] = useState('');
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null);
  const [consumedSelection, setConsumedSelection] = useState<number | null>(null);
  const continueTraining = useContinueTraining(), actions = useStudioTaskActions();
  const progression = game.slices.campaign.progression;
  const ownedExperiment = (id: string) => {
    const experiment = progression?.experiments[id];
    return experiment?.id === id && experiment.companyId === game.playerCompanyId && RESEARCH_PROGRAM_IDS.includes(experiment.programId) ? experiment : undefined;
  };
  if (selection && selection.intentId !== consumedSelection) {
    setConsumedSelection(selection.intentId); setSelectedExperimentId(selection.experimentId);
    const experiment = ownedExperiment(selection.experimentId);
    if (experiment) { setSelected(experiment.programId); setModelChoice(experiment.modelId); }
  }
  const selectedExperiment = selectedExperimentId ? ownedExperiment(selectedExperimentId) : undefined;
  const definition = RESEARCH_PROGRAMS[selected];
  const programChoices = <div className="guide-actions" role="group" aria-label="Choose a systems research program">{RESEARCH_PROGRAM_IDS.map(id => <button key={id} type="button" aria-pressed={id === selected} onClick={() => { setSelected(id); setModelChoice(''); setSelectedExperimentId(null); }}>{RESEARCH_PROGRAMS[id].name} · {getResearchProgramLevel(game, id)}/4</button>)}</div>;
  if (selectedExperimentId && !selectedExperiment) return <Section title="Systems research programs" id={'systems-research-programs-' + uid}>
    <p className="bottleneck" role="status">This research experiment is unavailable in the current lab. Choose another program or result.</p>{programChoices}
  </Section>;
  if (!progression) return <Section title="Systems research programs" id={'systems-research-programs-' + uid}>
    <p className="small-note">Develop a useful system, then fund an independent experiment against published operating constraints. Passed stages earn accreditation for matching products.</p>
    {programChoices}
    <h3>{definition.name}</h3><p className="small-note">{definition.description}</p>
    <ol className="milestone-steps" aria-label="Research program stages">{RESEARCH_PROGRAM_STAGES.map(name => <li key={name}>{name}</li>)}</ol>
    <p className="planned-note" role="status">{hasConnectedCompanyRules(game.contentVersion)
      ? 'Program costs and eligibility will load after your next week. Your first trained, independently tested paying service is required before funding.'
      : 'Systems programs require a current campaign. Architecture research remains available for this campaign.'}</p>
    <p className="guide-actions"><a href="#campaign">Review company milestones</a></p>
  </Section>;
  const experiments = Object.values(progression.experiments).filter(experiment => experiment.companyId === game.playerCompanyId), active = experiments.find(experiment => experiment.status === 'running');
  const level = getResearchProgramLevel(game, selected), planningLevel = getResearchProgramLevel(game, selected, game.week + 1), stage = Math.min(4, planningLevel + 1);
  const terms = createResearchExperimentTerms(game, selected, stage, game.week + 1);
  const models = Object.values(game.slices.models.versions).filter(model => model.companyId === game.playerCompanyId && researchExperimentBaseline(game, model.id));
  const ranked = models.map(model => ({ model, checks: researchExperimentChecks(model, selected, terms) }))
    .sort((a, b) => b.checks.filter(check => check.passed).length - a.checks.filter(check => check.passed).length || a.model.name.localeCompare(b.model.name));
  const chosen = modelChoice ? ranked.find(row => row.model.id === modelChoice) : ranked[0];
  const candidateReport = chosen ? researchExperimentBaseline(game, chosen.model.id) : undefined;
  const reason = researchProgramGate(game, selected, chosen?.model.id ?? '', game.week + 1);
  const history = experiments.filter(experiment => experiment.programId === selected).sort((a, b) => b.startedWeek - a.startedWeek);
  const latest = selectedExperimentId ? selectedExperiment?.status === 'complete' ? selectedExperiment : undefined
    : history.find(experiment => experiment.status === 'complete');
  return <Section title="Systems research programs" id={'systems-research-programs-' + uid}>
    <p className="small-note">Develop a useful system, then fund an independent experiment against published operating constraints. Every passed stage earns accreditation for matching products and opens a harder workload. Staff and compute come from your existing research allocation.</p>
    {programChoices}
    <h3>{definition.name}</h3>
    <p className="small-note">{definition.description}</p>
    <p className="small-note"><strong>Earned benefit:</strong> {definition.reward} Current accreditation: {level * 2}%.</p>
    <ol className="milestone-steps" aria-label="Research program stages">{RESEARCH_PROGRAM_STAGES.map((name, index) => <li key={name} className={level > index ? 'done' : ''}>{level > index ? '✓ ' : ''}{name}</li>)}</ol>
    {active && <article className="project-row" aria-label="Active systems experiment">
      <div className="project-heading"><strong>{RESEARCH_PROGRAMS[active.programId].name} · {RESEARCH_PROGRAM_STAGES[active.terms.stage - 1]}</strong><span>In progress</span></div>
      <p className="small-note">{game.slices.models.versions[active.modelId]?.name}. Frozen model, evaluation and workload. {active.lastBottleneck || 'Funded work is advancing.'}</p>
      <label className="small-note" htmlFor={'program-compute-' + uid}>Research compute · {formatUnits(active.completedWork)} / {formatUnits(active.terms.requiredWork)} CUw</label>
      <progress id={'program-compute-' + uid} value={active.completedWork} max={active.terms.requiredWork} />
      <label className="small-note" htmlFor={'program-staff-' + uid}>Research work · {formatWorkPoints(active.completedStaff)} / {formatWorkPoints(active.terms.requiredStaff)} points</label>
      <progress id={'program-staff-' + uid} value={active.completedStaff} max={active.terms.requiredStaff} />
      <p className="guide-actions"><a href="#planner">Plan people and compute</a></p>
    </article>}
    {planningLevel < 4 && <article className="system-application" aria-label="Next systems experiment">
      <h4>Next experiment · {RESEARCH_PROGRAM_STAGES[stage - 1]}</h4>
      <Metrics><Metric label="Entry fee">{formatMoney(terms.feeCents)}</Metric><Metric label="Research compute">{formatUnits(terms.requiredWork)} CUw</Metric><Metric label="Research work">{formatWorkPoints(terms.requiredStaff)} points</Metric><Metric label="Concurrent sessions">{terms.concurrentSessions}</Metric></Metrics>
      <label className="line-control wide-select" htmlFor={'program-model-' + uid}>Evaluated candidate<select id={'program-model-' + uid} value={chosen?.model.id ?? ''} disabled={!canAct || !models.length} onChange={event => setModelChoice(event.target.value)}>{!models.length && <option value="">Train and evaluate a model first</option>}{ranked.map(({ model, checks }) => <option key={model.id} value={model.id}>{model.name} · {checks.filter(check => check.passed).length}/{checks.length} constraints</option>)}</select></label>
      {chosen && <ul className="campaign-criteria" aria-label="Published experiment constraints">{chosen.checks.map(check => <li key={check.id}><span aria-hidden="true">{check.passed ? '✓' : '·'}</span> <strong>{check.label}</strong><span>{check.detail}</span></li>)}</ul>}
      {chosen && chosen.checks.some(check => !check.passed) && <p className="bottleneck">This candidate misses published constraints. A completed failing experiment keeps its evidence but earns no accreditation. Improve the model or choose another candidate before funding.</p>}
      {reason && <p className="bottleneck">{reason}</p>}
      <div className="guide-actions research-program-candidate-actions">
        {chosen && continueTraining ? <button type="button" className="training-text-action" disabled={!canAct} onClick={() => continueTraining(chosen.model.id)}>Improve {chosen.model.name}</button>
          : !chosen && actions?.openModelDesigner ? <button type="button" className="training-text-action" disabled={!canAct} onClick={() => actions.openModelDesigner?.()}>Develop a candidate</button> : <a href="#lab-projects">Develop a candidate</a>}
        {candidateReport && actions?.reviewReport ? <button type="button" className="training-text-action" onClick={() => actions.reviewReport?.(candidateReport.id)}>Review candidate evaluation</button> : <a href="#models">Review models and evaluations</a>}
        {reason && <a href="#campaign">Review company milestones</a>}
      </div>
      {chosen && <ActionControl game={game} payload={{ kind: 'start_research_experiment', programId: selected, modelId: chosen.model.id }} label={'Fund experiment · ' + formatMoney(terms.feeCents)} canAct={canAct} onQueue={onQueue} extraDisabled={!!reason} />}
      <p className="small-note">The entry fee includes your world grant and earned company benefits. Payroll and physical compute still cost money. Finish both meters; the result and next stage become available the following week.</p>
    </article>}
    {level === 4 && <p className="campaign-achievement">All four stages earned. This program’s full accreditation remains with the company when you release new models.</p>}
    {latest && <article className="project-row" aria-label={selectedExperimentId ? 'Selected experiment evidence' : 'Latest experiment evidence'} data-experiment-id={latest.id}><div className="project-heading"><strong>{selectedExperimentId ? 'Selected' : 'Latest'} paid evidence · {RESEARCH_PROGRAM_STAGES[latest.terms.stage - 1]}</strong><span>{latest.passed ? 'Passed' : 'Constraints unmet'} · Week {latest.completedWeek}</span></div><p className="small-note">{game.slices.models.versions[latest.modelId]?.name ?? 'Candidate unavailable'} · {formatUnits(latest.physicalWork)} physical CUw and {formatWorkPoints(latest.completedStaff)} Research points delivered. {latest.availableWeek! > game.week ? `Available in Week ${latest.availableWeek}.` : 'Saved with the exact model and paid baseline evaluation.'}</p>
      <details className="inline-details"><summary>Inspect experiment evidence and previous attempts</summary>{history.map(experiment => <div key={experiment.id} data-experiment-id={experiment.id}><p className="small-note"><strong>{RESEARCH_PROGRAM_STAGES[experiment.terms.stage - 1]} · {game.slices.models.versions[experiment.modelId]?.name ?? 'Candidate unavailable'}</strong> · {experiment.status === 'running' ? 'Running' : experiment.passed ? 'Passed' : 'Constraints unmet'}</p>{game.slices.models.versions[experiment.modelId] && <ul className="small-note">{researchExperimentChecks(game.slices.models.versions[experiment.modelId], experiment.programId, experiment.terms).map(check => <li key={check.id}>{check.passed ? '✓' : '·'} {check.label}: {check.detail}</li>)}</ul>}</div>)}</details>
    </article>}
  </Section>;
}
