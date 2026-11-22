'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { CONTENT } from '../content/catalog';
import { formatMoney, formatUnits } from '../core/math';
import { getFacilityRetrofitsView } from '../modules/facility-retrofits';
import { ActionControl, Metric, Metrics } from './components';
import type { PanelProps } from './panels';

export function FacilityRetrofitsPanel({ game, canAct, onQueue, facilityId }: PanelProps & { facilityId: string }) {
  const view = getFacilityRetrofitsView(game, facilityId);
  if (!view.operational) return null;
  return <details className="inline-details" id={`facility-retrofits-${facilityId}`}>
    <summary>Power and cooling upgrades</summary>
    <p className="small-note">Upgrade power and cooling separately. Rack space stays at {formatUnits(CONTENT.infrastructure.siteSlotsCU)} CU. Your hardware still needs enough power, cooling, and staff. Existing racks keep working during construction.</p>
    {!view.researched ? <p className="planned-note">Research Enterprise operations (R12) before funding these projects. <a href="#research">Review research</a>.</p> : view.choices.map(choice => {
      const project = choice.project;
      return <div className="project-row" key={choice.kind}>
        <div className="project-heading"><strong>{choice.name}</strong><span>{!project ? 'Available' : project.paused ? 'Paused' : project.status === 'active' ? 'Operational' : project.status === 'ready' ? 'Commissioning' : 'Building'}</span></div>
        <Metrics><Metric label={`${choice.envelopeName} limit after completion`}>{formatUnits(choice.envelopeUnits)} units</Metric><Metric label="Added upkeep when operational">{formatMoney(choice.weeklyCents)} / week</Metric><Metric label="Extra staff needed">{formatWorkPoints(choice.operatingStaff)} points / week</Metric></Metrics>
        {!project ? <>
          <Metrics><Metric label="Upfront cost">{formatMoney(choice.purchaseCents)}</Metric><Metric label="Minimum construction time">{choice.requiredWeeks} weeks</Metric><Metric label="Infrastructure effort">{formatWorkPoints(choice.requiredStaff)} points</Metric></Metrics>
          <ActionControl game={game} canAct={canAct} onQueue={onQueue} payload={{ kind: 'start_facility_retrofit', facilityId, retrofitKind: choice.kind }} label={`Fund ${choice.name.toLowerCase()}`} />
        </> : <>
          <Metrics><Metric label="Cost paid">{formatMoney(project.purchaseCents)}</Metric>{project.status !== 'active' && <><Metric label="Construction time">{project.elapsedWeeks} / {project.requiredWeeks} weeks</Metric><Metric label="Infrastructure work">{formatWorkPoints(project.completedStaff)} / {formatWorkPoints(project.requiredStaff)} points</Metric></>}{project.readyWeek !== null && <Metric label="Operational from">Week {project.readyWeek}</Metric>}</Metrics>
          {project.lastBottleneck && <p className="bottleneck">{project.lastBottleneck}</p>}
          {project.status === 'building' && <ActionControl game={game} canAct={canAct} onQueue={onQueue} payload={{ kind: 'set_facility_retrofit_paused', retrofitId: project.id, paused: !project.paused }} label={project.paused ? 'Resume extension' : 'Pause extension'} compact />}
        </>}
      </div>;
    })}
  </details>;
}
