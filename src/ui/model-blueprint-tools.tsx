'use client';

import { useState } from 'react';
import type { EvaluationSuiteId } from '../contracts/types';
import type { DevelopmentTrainingOrder } from '../contracts/development-plans';
import type { ModelBlueprint } from '../persistence/model-workspace';
import { useModelWorkspace } from './model-workspace-context';

export function ModelBlueprintTools({ training, suiteId, canAct, onLoad, onDelegate, onEdit }: {
  training: DevelopmentTrainingOrder | null; suiteId?: EvaluationSuiteId; canAct: boolean;
  onLoad: (blueprint: ModelBlueprint) => void; onDelegate?: () => void; onEdit?: () => void;
}) {
  const workspace = useModelWorkspace();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('');
  if (!workspace) return null;
  const selectedBlueprint = workspace.blueprints.find(b => b.id === selected);
  return <section className="model-blueprint-tools" aria-label="Model drafts and blueprints">
    <div className="model-blueprint-status"><p className="small-note" role="status">{!workspace.ready ? 'Opening model drafts…' : workspace.notice || (workspace.persistent ? 'Draft saved in this browser for this lab.' : 'Draft kept in this tab.')}</p>
      {onDelegate && <button type="button" className="training-text-action" onClick={onDelegate} disabled={!canAct || !training}>Delegate this design</button>}
      {onEdit && <button type="button" className="training-text-action" onClick={onEdit} disabled={!canAct || !training}>Edit in training workbench</button>}
    </div>
    <details className="inline-details"><summary>Named blueprints{workspace.blueprints.length ? ` (${workspace.blueprints.length})` : ''}</summary>
      <p className="small-note">Keep alternative plans in this lab. Saving an existing name updates that blueprint. Loading only changes your draft; it spends nothing.</p>
      <div className="model-blueprint-row"><label>Blueprint name<input value={name} maxLength={48} placeholder={training?.modelDesign?.name || 'Name this plan'} onChange={e => setName(e.target.value)} /></label>
        <button type="button" disabled={!canAct || !workspace.ready || !training} onClick={() => { if (!training) return; const title = name.trim() || training.modelDesign?.name || ''; const error = workspace.saveBlueprint(title, training, suiteId); setMessage(error || `Saved “${title}”.`); }}>Save blueprint</button></div>
      {workspace.blueprints.length > 0 && <div className="model-blueprint-row"><label>Saved blueprint<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose a blueprint</option>{workspace.blueprints.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <button type="button" disabled={!canAct || !selectedBlueprint} onClick={() => { if (!selectedBlueprint) return; workspace.setDevelopmentGoal(selectedBlueprint.objective ?? null); onLoad(structuredClone(selectedBlueprint)); setName(selectedBlueprint.name); setMessage(`Loaded “${selectedBlueprint.name}” with its saved objective. Review current requirements before starting.`); }}>Load blueprint</button></div>}
      {message && <p className="small-note" role="status">{message}</p>}
    </details>
  </section>;
}
