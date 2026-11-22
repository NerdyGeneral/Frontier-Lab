'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CONTENT } from '../content/catalog';
import { TRAINING_PROFILES, TRAINING_RECIPES } from '../content/wave2-lab';
import type { CapabilityDomain, GameState } from '../contracts/types';
import { canonicalStateHash } from '../core/canonical';
import { formatMoney, formatUnits, previewCommand } from '../core/index';
import { getCorpusEvidence, getTrainingPreview } from '../modules/lab-planner';
import type { TrainingOptions, TrainingPreview } from '../modules/lab-planner';
import { inheritedModelRights } from '../modules/model-runtime';
import { Metric, Metrics } from './components';
import { ReplayReceiptDetails } from './replay-training-controls';
import { TrainingCurriculumDetails } from './training-curriculum-controls';

const LABELS: Record<CapabilityDomain, string> = { conversation: 'Conversation', documents: 'Documents', coding: 'Coding', tools: 'Tool use' };
const range = (low: number, high: number) => low === high ? String(low / 100) : `${low / 100}–${high / 100}`;
interface Draft { id: number; key: string; options: TrainingOptions }
interface ComparedDraft extends Draft {
  preview: TrainingPreview | null;
  reason: string | null;
  rights: { hosted: boolean; weights: boolean } | null;
  available: boolean;
}

function retentionLabel(options: TrainingOptions): string {
  if (options.curriculum) return `${options.curriculum.tracks.map(track => LABELS[track.domain]).join(' + ')} · ${options.curriculum.shareBps / 100}% replay`;
  if (options.replay) return `${LABELS[options.replay.domain]} · ${options.replay.shareBps / 100}% replay`;
  return 'Ordinary updates';
}

function compareDraft(game: GameState, draft: Draft): ComparedDraft {
  const { options } = draft;
  const packetIds = options.packetIds?.length ? options.packetIds : [options.packetId];
  const retainedCorpora = options.curriculum?.tracks.map(track => track.packetIds) ?? (options.replay ? [options.replay.packetIds] : []);
  const allIds = [...packetIds, ...retainedCorpora.flat()];
  const base = game.slices.models.versions[options.baseModelId];
  const teacher = options.teacherModelId ? game.slices.models.versions[options.teacherModelId] : undefined;
  const available = !!base && base.companyId === game.playerCompanyId
    && allIds.every(id => !!game.slices.data.packets[id]) && (!options.teacherModelId || !!teacher);
  if (!available) return { ...draft, preview: null, reason: 'This plan uses a model or dataset that is no longer available.', rights: null, available: false };
  const preview = getTrainingPreview(game, game.playerCompanyId, options, CONTENT);
  const admission = previewCommand(game, { kind: 'start_training', ...options }, CONTENT);
  const rights = [inheritedModelRights(game, base.id, CONTENT), preview.corpus.rights,
    ...retainedCorpora.map(ids => getCorpusEvidence(game, game.playerCompanyId, ids).rights),
    ...(teacher ? [inheritedModelRights(game, teacher.id, CONTENT)] : [])];
  const retentionReady = (!options.replay || !!preview.replay) && (!options.curriculum || !!preview.curriculum);
  return { ...draft, preview: retentionReady ? preview : null, available: true, reason: admission.reason?.message ?? preview.reason?.message ?? null,
    rights: retainedCorpora.some(ids => !ids.length) ? null : { hosted: rights.every(item => item.hosted), weights: rights.every(item => item.weights) } };
}

export function TrainingExperimentsPanel({ game, choices, canAct, onUse }: {
  game: GameState;
  choices: TrainingOptions | null;
  canAct: boolean;
  onUse: (options: TrainingOptions) => void;
}) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const nextId = useRef(1);
  const currentKey = choices ? canonicalStateHash(choices) : null;
  const alreadyCaptured = drafts.some(draft => draft.key === currentKey);
  const comparisons = useMemo(() => open ? drafts.map(draft => compareDraft(game, draft)) : [], [game, drafts, open]);
  const capture = () => {
    if (!choices || drafts.length >= 3 || alreadyCaptured) return;
    setDrafts([...drafts, { id: nextId.current++, key: canonicalStateHash(choices), options: structuredClone(choices) }]);
  };
  const row = (label: string, value: (draft: ComparedDraft) => ReactNode) => <tr key={label}><th scope="row">{label}</th>{comparisons.map(draft => <td key={draft.id}>{value(draft)}</td>)}</tr>;
  return <details className="inline-details" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Compare training experiments{drafts.length ? ` · ${drafts.length} designs` : ''}</summary>
    {open && <>
      <p className="small-note">Compare up to three training plans. Add your current choices, then change the data, method, or replay budget to try another. Comparing plans is free. Plans stay here until you reload or open another lab.</p>
      <button type="button" onClick={capture} disabled={!choices || drafts.length >= 3 || alreadyCaptured}>Add current plan</button>
      {alreadyCaptured && <p className="small-note">This plan is already in the comparison. Change a training choice to add another.</p>}
      {drafts.length >= 3 && <p className="small-note">Remove a design below to make room for another.</p>}
      {comparisons.length > 0 && <>
        <div className="table-scroll"><table className="compact-table"><caption>Compared training designs · current estimates</caption><thead><tr><th>Training choice</th>{comparisons.map(draft => <th key={draft.id}>Design {draft.id}</th>)}</tr></thead><tbody>
          {row('Update work', draft => draft.preview ? `${formatUnits(draft.preview.workCUw)} CUw` : '—')}
          {row('Checkpoint work', draft => draft.preview ? `${formatUnits(draft.preview.checkpointOverheadWork)} CUw` : '—')}
          {row('Connected memory needed', draft => draft.preview ? `${formatUnits(draft.preview.memoryMU)} MU` : '—')}
          {row('Research preparation', draft => draft.preview ? `${formatWorkPoints(draft.preview.preparationStaff)} points` : '—')}
          {row('Recipe fee', draft => draft.preview ? formatMoney(draft.preview.feeCents) : '—')}
          {(Object.keys(LABELS) as CapabilityDomain[]).map(domain => row(LABELS[domain], draft => draft.preview ? range(draft.preview.capabilityRange.minimum[domain], draft.preview.capabilityRange.maximum[domain]) : '—'))}
          {row('Reliability', draft => draft.preview ? range(draft.preview.reliabilityRange.minimum, draft.preview.reliabilityRange.maximum) : '—')}
          {row('Hosted use', draft => draft.rights ? draft.rights.hosted ? 'Allowed' : 'Unavailable' : '—')}
          {row('Weight distribution', draft => draft.rights ? draft.rights.weights ? 'Allowed' : 'Unavailable' : '—')}
          {row('Ready to start', draft => draft.reason ? 'Blocked · see details' : 'Ready')}
        </tbody></table></div>
        <p className="small-note">These ranges estimate training results; you will still need to test the model. Training work measures progress, while actual GPU use depends on your hardware. A teacher model uses extra compute, shown in the plan details. GPU rental, salaries, facility bills, and later tests cost extra. Other projects share your staff, memory, and compute.</p>
        {comparisons.map(draft => <details className="inline-details" key={draft.id}>
          <summary>Design {draft.id} · {TRAINING_RECIPES.find(recipe => recipe.id === (draft.options.recipeId ?? CONTENT.firstTraining.id))?.name ?? 'Training'} · {retentionLabel(draft.options)}</summary>
          <p className="small-note">Base: {game.slices.models.versions[draft.options.baseModelId]?.name ?? 'Unavailable model'}. Primary data: {(draft.options.packetIds?.length ? draft.options.packetIds : [draft.options.packetId]).map(id => game.slices.data.packets[id]?.name ?? 'Unavailable dataset').join('; ')}.</p>
          <p className="small-note">Profile: {draft.options.profile ? TRAINING_PROFILES[draft.options.profile].name : 'Reference opening'}. {draft.options.architecture ? `${draft.options.architecture === 'sparse' ? 'Sparse' : 'Dense'} foundation. ` : ''}{draft.options.asAdapter ? 'Adapter training. ' : ''}{draft.options.automatedCheckpoints ? 'Automated checkpoints included.' : 'Ordinary checkpoint schedule.'}</p>
          {draft.options.teacherModelId && <p className="small-note">Teacher: {game.slices.models.versions[draft.options.teacherModelId]?.name ?? 'Unavailable model'} · {draft.options.teacherDomain ? LABELS[draft.options.teacherDomain] : 'Choose a transfer domain'}.</p>}
          {draft.reason && <p className="bottleneck">{draft.reason}</p>}
          <div className="guide-actions"><button type="button" disabled={!canAct || !draft.available} onClick={() => onUse(structuredClone(draft.options))}>Use design {draft.id}</button><button type="button" onClick={() => setDrafts(current => current.filter(item => item.id !== draft.id))}>Remove design {draft.id}</button></div>
          {draft.preview && <>
            <Metrics><Metric label="Distinct primary data">{draft.preview.corpus.distinctUnits} units</Metric><Metric label="Broad primary data">{draft.preview.corpus.broadUnits} units</Metric></Metrics>
            {draft.preview.replay && <ReplayReceiptDetails replay={draft.preview.replay} title={`Design ${draft.id} replay`} />}
            {draft.preview.curriculum && <TrainingCurriculumDetails curriculum={draft.preview.curriculum} title={`Design ${draft.id} curriculum`} />}
            <details className="inline-details"><summary>Design {draft.id} estimates and details</summary>{draft.preview.notes.map((note, index) => <p className="small-note" key={index}>{note}</p>)}</details>
          </>}
        </details>)}
        <p className="small-note">Use design copies these choices into the training menu. Check the cost, then choose Start training. Test each new model before release; testing costs extra.</p>
      </>}
    </>}
  </details>;
}
