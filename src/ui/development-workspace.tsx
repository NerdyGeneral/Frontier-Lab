'use client';

import { useId } from 'react';
import { Check, Compass, GitBranch, Route } from 'lucide-react';
import type { GameState, ModelVersion } from '../contracts/types';
import type { DevelopmentGoal } from '../persistence/model-workspace';
import { isDevelopmentGoal } from '../persistence/model-workspace';
import { CONTENT } from '../content/catalog';
import { hasResearch } from '../modules/research';
import { useModelWorkspace } from './model-workspace-context';
import { useStudioTaskActions } from './studio-interaction-context';
import { MODEL_DESIGN_PURPOSES } from './model-design-draft';
import { BRIEF_GOAL_NAMES, SYSTEMS_GOAL_NAMES, developmentGoalChecks, developmentGoalName, developmentGoalResearch } from './development-goals';

export function DevelopmentWorkspaceHeader({ game, mode, canAct, onManual, onDelegate }: {
  game: GameState; mode: 'manual' | 'delegated'; canAct: boolean; onManual?: () => void; onDelegate?: () => void;
}) {
  const id = useId(), workspace = useModelWorkspace();
  const goal = workspace?.developmentGoal;
  const actions = useStudioTaskActions();
  return <section className="development-workspace-header" aria-label="Develop a model">
    <div className="development-workspace-heading"><div><span className="strategy-eyebrow">DEVELOP A MODEL</span><h3>Choose the outcome. Shape the system.</h3></div>
      <div className="development-workspace-mode" role="group" aria-label="Development workflow">
        <button type="button" aria-pressed={mode === 'manual'} disabled={!canAct || mode !== 'manual' && !onManual} onClick={onManual}><GitBranch size={16} aria-hidden="true" />Manual</button>
        <button type="button" aria-pressed={mode === 'delegated'} disabled={!canAct || mode !== 'delegated' && !onDelegate} onClick={onDelegate}><Route size={16} aria-hidden="true" />Delegated</button>
      </div>
    </div>
    <p>{mode === 'manual' ? 'Choose each training step yourself, or hand this exact design and data to a delegated plan.' : 'Keep your design and data together. Set a budget and deadline; your team prepares, trains and evaluates before your final decision.'}</p>
    <label className="development-goal-selector" htmlFor={id + '-goal'}><span><Compass size={16} aria-hidden="true" />Working toward</span><select id={id + '-goal'} value={goal ? goal.kind + ':' + goal.id : ''} disabled={!canAct || !workspace?.ready} onChange={event => {
      if (!event.target.value) { workspace?.setDevelopmentGoal(null); return; }
      const [kind, goalId] = event.target.value.split(':'); const next = { kind, id: goalId };
      if (isDevelopmentGoal(next)) workspace?.setDevelopmentGoal(next);
    }}><option value="">Open exploration</option>
      <optgroup label="Model purpose">{MODEL_DESIGN_PURPOSES.map(item => <option key={item.id} value={'purpose:' + item.id}>{item.name}</option>)}</optgroup>
      <optgroup label="Systems challenges">{Object.entries(SYSTEMS_GOAL_NAMES).map(([key, name]) => <option key={key} value={'system-challenge:' + key}>{name}</option>)}</optgroup>
      <optgroup label="Renewable customer briefs">{Object.entries(BRIEF_GOAL_NAMES).map(([key, name]) => <option key={key} value={'renewable-brief:' + key}>{name}</option>)}</optgroup>
    </select></label>
    {goal && <DevelopmentGoalSummary game={game} goal={goal} compact />}
    {goal && actions?.openResearch && <p className="small-note">Your objective stays selected when you visit research, datasets or a delegated plan.</p>}
  </section>;
}

export function DevelopmentGoalSummary({ game, goal, model, projected = false, compact = false }: {
  game: GameState; goal?: DevelopmentGoal | null; model?: ModelVersion; projected?: boolean; compact?: boolean;
}) {
  const workspace = useModelWorkspace(), actions = useStudioTaskActions();
  const current = goal ?? workspace?.developmentGoal;
  if (!current) return null;
  const view = developmentGoalChecks(game, current, model);
  const missingResearch = developmentGoalResearch(current).filter(id => !hasResearch(game, game.playerCompanyId, id));
  const checks = view.checks;
  return <section className={'development-goal-summary' + (compact ? ' is-compact' : '')} aria-label="Development objective and requirements">
    <header><strong>{developmentGoalName(current)}</strong>{checks.length > 0 && <span>{checks.filter(item => item.passed).length} / {checks.length} challenge workloads {projected ? 'forecast to pass' : 'met by this model'}</span>}</header>
    {!compact && <p>{view.description}</p>}
    {checks.length > 0 ? <ul className="development-goal-checks">{checks.map((check, index) => <li key={index} data-met={check.passed}><span aria-hidden="true">{check.passed ? '✓' : '○'}</span><div><strong>{check.title}</strong><span>{check.requirementText}</span><small>{check.measurementText}</small></div></li>)}</ul>
      : !compact && view.requirements.length > 0 && <p className="small-note">{view.requirements.join(' · ')}</p>}
    {!compact && current.kind === 'renewable-brief' && checks.length > 0 && <div className="development-customer-requirements"><p className="small-note"><strong>Current customer terms:</strong> {view.requirements.join(' · ')}.</p><p className="small-note">{view.customerMissing.length ? 'Still needed for this customer: ' + view.customerMissing.join(', ') + '.' : 'The model meets this customer’s operating thresholds. A passing paid challenge, rights and serving capacity are also required.'}</p></div>}
    {projected && checks.length > 0 && <p className="small-note">Forecast only. A paid test on the completed model is still required; customer delivery also needs capacity and valid model rights.</p>}
    <div className="development-goal-links"><a href={view.destination}>{view.destinationLabel}</a>{missingResearch.length > 0 && actions?.openResearch
      ? <button type="button" className="training-text-action" onClick={() => actions.openResearch?.(missingResearch[0])}>Explore {CONTENT.research.find(item => item.id === missingResearch[0])?.name ?? missingResearch[0]}</button>
      : missingResearch.length === 0 && <span><Check size={14} aria-hidden="true" />Suggested research path complete</span>}</div>
  </section>;
}

export function DevelopForGoalButton({ goal, label = 'Develop for this target', canAct = true }: { goal: DevelopmentGoal; label?: string; canAct?: boolean }) {
  const workspace = useModelWorkspace(), actions = useStudioTaskActions();
  const select = () => { workspace?.setDevelopmentGoal(goal); actions?.openModelDesigner?.(); };
  return actions?.openModelDesigner ? <button type="button" className="training-text-action" disabled={!canAct || !!workspace && !workspace.ready} onClick={select}>{label}</button>
    : <a href="#lab-projects" onClick={() => workspace?.setDevelopmentGoal(goal)}>{label}</a>;
}
