'use client';

import { useId, useState } from 'react';
import type { ModelResearchFocus } from '../contracts/model-research';
import { formatMoney, formatUnits } from '../core/index';
import { formatWorkPoints } from '../modules/workforce-points';
import { getActiveModelResearch, getModelResearchFocus, getModelResearchLevel, getModelResearchQuote, MODEL_RESEARCH_FOCUSES, modelResearchBonusBps, modelResearchGate, modelResearchProjects } from '../modules/model-research';
import { ActionControl, Metric, Metrics, Section } from './components';
import type { PanelProps } from './panels';

export function ModelResearchPanel(props: Pick<PanelProps, 'game' | 'canAct' | 'onQueue'>) {
  const { game, canAct, onQueue } = props, owner = game.playerCompanyId;
  const uniqueId = useId().replaceAll(':', '');
  const [focus, setFocus] = useState<ModelResearchFocus>('balanced');
  const knowledge = getModelResearchFocus(game, owner);
  const level = getModelResearchLevel(game, owner), quote = getModelResearchQuote(game, owner);
  const active = getActiveModelResearch(game, owner), gate = modelResearchGate(game, owner);
  const gain = (quote.potentialBonusBps - modelResearchBonusBps(level)) / 100;
  const reliabilityGain = Math.min(gain * MODEL_RESEARCH_FOCUSES[focus].reliability / 100, (650 - (knowledge?.reliabilityBonusBps ?? 0)) / 100);
  return <Section title="Architecture research" id={'model-architecture-research-' + uniqueId}>
    <p className="small-note">Run an ongoing research program to unlock model families and raise the potential of future custom designs. Research also improves learning for your compute budget and reduces serving work for new foundations. Each iteration takes more resources, with diminishing returns. Your existing models keep their trained scores.</p>
    <Metrics>
      <Metric label="Research level">{level}</Metric>
      <Metric label="Edge family">{level >= 1 ? 'Unlocked' : 'Unlocks at level 1'}</Metric>
      <Metric label="Frontier family">{level >= 3 ? 'Unlocked' : 'Unlocks at level 3'}</Metric>
      <Metric label="Design potential gained">+{((knowledge?.capacityBonusBps ?? modelResearchBonusBps(level)) / 100).toFixed(2)} points</Metric>
      <Metric label="Engineering efficiency">{((knowledge?.efficiencyBonusBps ?? modelResearchBonusBps(level) / 2) / 100).toFixed(2)}%</Metric>
      <Metric label="Future reliability target">{(9200 + (knowledge?.reliabilityBonusBps ?? 0)) / 100}%</Metric>
    </Metrics>
    {active ? <article className="project-row" aria-label={`Architecture research level ${active.level}`}>
      <h3>Level {active.level} {active.status === 'complete' ? 'completed' : active.status === 'paused' ? 'paused' : 'in progress'}</h3>
      <p className="small-note">Focus: <strong>{MODEL_RESEARCH_FOCUSES[active.focus ?? 'balanced'].name}</strong>. {MODEL_RESEARCH_FOCUSES[active.focus ?? 'balanced'].description} This iteration’s choice is fixed.</p>
      <label className="small-note" htmlFor={`architecture-compute-${uniqueId}-${active.id}`}>Research compute · {formatUnits(active.completedWork)} / {formatUnits(active.requiredWork)} CUw</label>
      <progress id={`architecture-compute-${uniqueId}-${active.id}`} style={{ width: '100%' }} max={active.requiredWork} value={active.completedWork} />
      <label className="small-note" htmlFor={`architecture-staff-${uniqueId}-${active.id}`}>Research points · {formatWorkPoints(active.completedStaff)} / {formatWorkPoints(active.requiredStaff)}</label>
      <progress id={`architecture-staff-${uniqueId}-${active.id}`} style={{ width: '100%' }} max={active.requiredStaff} value={active.completedStaff} />
      {active.lastBottleneck && <p className="bottleneck">{active.lastBottleneck}</p>}
      {active.status !== 'complete' && <ActionControl game={game} payload={{ kind: 'set_model_research_paused', projectId: active.id, paused: active.status !== 'paused' }}
        label={active.status === 'paused' ? 'Resume architecture research' : 'Pause architecture research'} canAct={canAct} onQueue={onQueue} taskAction="architecture-research" compact />}
    </article> : <div className="system-application">
      <h3>Next: level {quote.level}</h3>
      <p className="small-note">{quote.unlock}. Choose how this iteration’s diminishing research gain contributes to future custom designs.</p>
      <label className="line-control wide-select" htmlFor={'architecture-focus-' + uniqueId}>Research focus<select id={'architecture-focus-' + uniqueId} value={focus} onChange={event => setFocus(event.target.value as ModelResearchFocus)} disabled={!canAct}>{Object.entries(MODEL_RESEARCH_FOCUSES).map(([key, definition]) => <option key={key} value={key}>{definition.name}</option>)}</select></label>
      <p className="small-note">{MODEL_RESEARCH_FOCUSES[focus].description} This iteration contributes approximately {(gain * MODEL_RESEARCH_FOCUSES[focus].capacity / 100).toFixed(2)} skill-potential points, {(gain * MODEL_RESEARCH_FOCUSES[focus].efficiency / 200).toFixed(2)}% engineering efficiency and {reliabilityGain.toFixed(2)} reliability-target points. The reliability target caps at 98.5%; skill potential is also limited by the chosen model family.</p>
      {focus === 'reliability' && reliabilityGain === 0 && <p className="small-note">The reliability target has reached its cap. This focus adds no further reliability; compare its remaining potential and efficiency gains with the other choices.</p>}
      <Metrics>
        <Metric label="One-time research fee">{formatMoney(quote.feeCents)}</Metric>
        <Metric label="Research compute">{formatUnits(quote.requiredWork)} CUw</Metric>
        <Metric label="Research work">{formatWorkPoints(quote.requiredStaff)} points</Metric>
      </Metrics>
      {gate && <p className="bottleneck">{gate}</p>}
      <ActionControl game={game} payload={{ kind: 'start_model_research', focus }} label={`Fund architecture level ${quote.level}`} canAct={canAct} onQueue={onQueue} taskAction="architecture-research" />
      <p className="small-note">Finish both progress bars, then advance one more week to use the discovery. Staff payroll and actual compute use are separate from the fee. You can return for another iteration whenever the current one is available.</p>
    </div>}
    {level > 0 && <details className="inline-details"><summary>Earned research focus history</summary><ul>{modelResearchProjects(game, owner).filter(project => project.availableWeek !== undefined && project.availableWeek <= game.week).slice(-12).map(project => <li key={project.id}>Level {project.level}: {MODEL_RESEARCH_FOCUSES[project.focus ?? 'balanced'].name} · available in Week {project.availableWeek}</li>)}</ul><p className="small-note">Every paid iteration is retained in the save. Existing model receipts preserve the research available when training started.</p></details>}
  </Section>;
}
