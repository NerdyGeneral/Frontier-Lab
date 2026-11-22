'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { useState } from 'react';
import { RACK_RELOCATION_RULES as RULES } from '../content/wave8-relocation';
import { formatMoney, formatUnits } from '../core/math';
import { getRackRelocationView } from '../modules/rack-relocation';
import { ActionControl, Metric, Metrics } from './components';
import type { PanelProps } from './panels';

export function RackRelocationControls(props: PanelProps & { rackId: string }) {
  const { game, rackId, canAct } = props, view = getRackRelocationView(game, rackId);
  const [selected, setSelected] = useState('colocation');
  const destination = view.destinations.some(item => item.id === selected) ? selected : view.destinations[0]?.id ?? '';
  const project = view.active;
  return <details className="inline-details"><summary>Relocate this rack{project ? ' · ' + (project.paused ? 'paused' : project.status === 'ready' ? 'commissioning' : 'in progress') : ''}</summary>
    {!view.researched ? <p className="small-note">Research Enterprise operations (R12) to move installed hardware between your operational sites and colocation.</p> : project ? <>
      <p className="small-note">{view.locationName(project.sourceLocation)} → {view.locationName(project.destination)}. The rack is offline during the move. You still pay upkeep at its old location, and both locations keep space reserved.</p>
      <Metrics><Metric label="Relocation paid">{formatMoney(project.paidCents)}</Metric><Metric label="Stage">{project.status === 'ready' ? 'Commissioning' : RULES.stages[project.stageIndex].name}</Metric><Metric label="After the move">{project.restoreStatus === 'parked' ? 'Parked' : 'Active, subject to destination limits'}</Metric>{project.readyWeek !== null && <Metric label="Arrival">Week {project.readyWeek}</Metric>}</Metrics>
      <table className="compact-table"><caption>Moving progress</caption><thead><tr><th>Stage</th><th>Weeks</th><th>Operations points</th></tr></thead><tbody>{RULES.stages.map((stage, index) => <tr key={stage.id}><td>{stage.name}</td><td>{project.stages[index].elapsedWeeks} / {stage.elapsedWeeks}</td><td>{formatWorkPoints(project.stages[index].completedStaff)} / {formatWorkPoints(stage.staffWeeks)}</td></tr>)}</tbody></table>
      {project.lastBottleneck && <p className="bottleneck">{project.lastBottleneck}</p>}
      {project.status === 'moving' && <ActionControl {...props} payload={{ kind: 'set_rack_relocation_paused', relocationId: project.id, paused: !project.paused }} label={project.paused ? 'Resume relocation' : 'Pause relocation'} compact />}
    </> : <>
      <label className="line-control wide-select" htmlFor={'move-' + rackId}>Destination<select id={'move-' + rackId} value={destination} onChange={event => setSelected(event.target.value)} disabled={!canAct || !view.destinations.length}>{view.destinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <p className="small-note">{formatMoney(RULES.feeCents)} upfront; at least four weeks and 20 Operations points. The rack keeps its capacity, chip yield, and installation history. Fast fabric stays at the old location.</p>
      {destination ? <ActionControl {...props} payload={{ kind: 'start_rack_relocation', rackId, destination }} label="Fund rack relocation" /> : <p className="small-note">Finish opening a second location before moving this rack.</p>}
      <p className="small-note">{view.projects.length} / {RULES.maximumMovesPerRack} moves used. Rack upkeep switches to the new location when the move is complete. Site costs continue throughout.</p>
    </>}
    {view.projects.some(item => item.status === 'complete') && <details className="inline-details"><summary>Completed moves</summary>{view.projects.filter(item => item.status === 'complete').map(item => <p className="small-note" key={item.id}>{view.locationName(item.sourceLocation)} → {view.locationName(item.destination)} · commissioned Week {item.completedWeek} · {formatMoney(item.paidCents)}</p>)}</details>}
  </details>;
}
