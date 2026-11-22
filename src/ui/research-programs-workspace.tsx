'use client';

import { useId, useState } from 'react';
import { FlaskConical, Layers3 } from 'lucide-react';
import { ModelResearchPanel } from './model-research-panel';
import { ResearchProgramsPanel } from './research-programs-panel';
import type { PanelProps } from './panels';

export interface ResearchProgramsSelection {
  intentId: number;
  programType: 'systems' | 'architecture';
}
export type ResearchProgramsWorkspaceProps = Pick<PanelProps, 'game' | 'canAct' | 'onQueue'> & {
  selection?: ResearchProgramsSelection | null;
};

/** Programs have one stable home. Switching program types preserves each draft. */
export function ResearchProgramsWorkspace({ selection, ...props }: ResearchProgramsWorkspaceProps) {
  const id = useId().replaceAll(':', '');
  const [programType, setProgramType] = useState<ResearchProgramsSelection['programType']>(selection?.programType ?? 'systems');
  const [consumedSelection, setConsumedSelection] = useState<number | null>(selection?.intentId ?? null);
  // Explicit navigation selects a program once. Ordinary renders and local tab
  // changes preserve the player's choice and both mounted program drafts.
  if (selection && selection.intentId !== consumedSelection) {
    setConsumedSelection(selection.intentId);
    setProgramType(selection.programType);
  }
  return <section id="research-programs" className="research-programs-workspace" aria-label="Research programs" tabIndex={-1}>
    <header className="research-programs-intro"><h2>Research programs</h2><p className="small-note">Prove a finished system against published workloads, or invest in the potential of future model designs.</p></header>
    <div className="systems-challenge-filter research-programs-types" role="group" aria-label="Research program type">
      <button type="button" aria-pressed={programType === 'systems'} aria-controls={id + '-systems'} onClick={() => setProgramType('systems')}><FlaskConical size={16} aria-hidden="true" />Systems experiments</button>
      <button type="button" aria-pressed={programType === 'architecture'} aria-controls={id + '-architecture'} onClick={() => setProgramType('architecture')}><Layers3 size={16} aria-hidden="true" />Architecture program</button>
    </div>
    <div id={id + '-systems'} hidden={programType !== 'systems'}><ResearchProgramsPanel {...props} /></div>
    <div id={id + '-architecture'} hidden={programType !== 'architecture'}><ModelResearchPanel {...props} /></div>
  </section>;
}
