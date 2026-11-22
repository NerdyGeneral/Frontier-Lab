'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { useState } from 'react';
import { CONTENT } from '../content/catalog';
import { formatMoney, formatUnits } from '../core/index';
import { getInfrastructureView } from '../modules/infrastructure';
import { ActionControl, Metric, Metrics, Section } from './components';
import type { PanelProps } from './panels';
import { FacilityRetrofitsPanel } from './facility-retrofits-panel';
import { RackRelocationControls } from './rack-relocation-controls';
import { activeRackRelocation } from '../modules/rack-relocation';

export function InfrastructurePanel(props: PanelProps) {
  const { game, canAct, onQueue } = props;
  const infrastructure = getInfrastructureView(game, game.playerCompanyId, CONTENT);
  const [hardwareId, setHardwareId] = useState('general');
  const [location, setLocation] = useState('colocation');
  const hardware = CONTENT.hardware.find(item => item.id === hardwareId) ?? CONTENT.hardware[0];
  const destination = location === 'colocation' || infrastructure.facilities.some(site => site.id === location) ? location : 'colocation';
  const facilityCost = CONTENT.infrastructure.stages.reduce((sum, stage) => sum + stage.costCents, 0);
  const facilityWeeks = CONTENT.infrastructure.stages.reduce((sum, stage) => sum + stage.elapsedWeeks, 0);
  const facilityStaff = CONTENT.infrastructure.stages.reduce((sum, stage) => sum + stage.staffWeeks, 0);
  return <Section title="Infrastructure" id="infrastructure">
    <Metrics><Metric label="Owned / usable capacity">{formatUnits(infrastructure.nominalOwnedCU)} / {formatUnits(infrastructure.usableOwnedCU)} CU</Metric><Metric label="Operations staff / required">{formatWorkPoints(infrastructure.operatingStaffAvailable)} / {formatWorkPoints(infrastructure.operatingStaffRequired)} points / week</Metric><Metric label="Owned fixed costs">{formatMoney(infrastructure.weeklyFixedCents)} / week</Metric><Metric label="Owned GPU work / last week">{formatMoney(infrastructure.lastVariableCents)}</Metric></Metrics>
    <p className="small-note">Racks need space, power, cooling, and infrastructure staff. Order them, wait for delivery, then install them. You pay for GPU use on owned hardware; cloud rent already includes energy.</p>
    <details className="inline-details"><summary>Purchase a GPU rack</summary>
      <label className="line-control wide-select" htmlFor="rack-hardware">Hardware<select id="rack-hardware" value={hardware.id} onChange={event => setHardwareId(event.target.value)} disabled={!canAct}>{CONTENT.hardware.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="line-control wide-select" htmlFor="rack-location">Destination<select id="rack-location" value={destination} onChange={event => setLocation(event.target.value)} disabled={!canAct}><option value="colocation">Rented colocation space</option>{infrastructure.facilities.map(site => <option key={site.id} value={site.id}>{site.name}{site.status !== 'active' ? ' · under construction' : ''}</option>)}</select></label>
      <Metrics><Metric label="Rack capacity">{formatUnits(CONTENT.infrastructure.rackCU)} CU</Metric><Metric label="Memory per CU">{formatUnits(hardware.memoryMUPerCU)} MU</Metric><Metric label="Training / serving efficiency">{hardware.trainingMultiplier}× / {hardware.servingMultiplier}×</Metric><Metric label="GPU use cost / CUw">{formatMoney(hardware.variableCentsPerCUw)}</Metric><Metric label="Delivery">{CONTENT.infrastructure.deliveryWeeks} weeks</Metric><Metric label="Installation effort">{formatWorkPoints(CONTENT.infrastructure.installationStaffWeeks)} Operations points</Metric></Metrics>
      <ActionControl game={game} payload={{ kind: 'order_rack', hardwareId: hardware.id, location: destination }} label="Order GPU rack" canAct={canAct} onQueue={onQueue} />
      <p className="small-note">Choose the destination before ordering. Delivered racks must be installed before they can work. After researching Enterprise operations, you can pay to move installed racks.</p>
    </details>
    {infrastructure.racks.length > 0 && <div className="asset-list">{infrastructure.racks.map((rack, index) => <details className="asset-row" key={rack.id}><summary>{rack.name} rack {index + 1}<span className="asset-summary">{activeRackRelocation(game, rack.id) ? 'Relocating' : rack.status === 'ordered' ? 'Delivery Week ' + rack.arrivalWeek : rack.status === 'inventory' ? 'Ready to install' : rack.status === 'installing' ? 'Installing' : rack.status === 'parked' ? 'Parked' : 'Installed'} · {rack.locationName}</span></summary>
      <Metrics><Metric label="Total capacity">{formatUnits(rack.cu)} CU / {formatUnits(rack.memoryMU)} MU</Metric><Metric label="Purchase cost">{formatMoney(rack.purchaseCents)}</Metric><Metric label="Fixed upkeep">{formatMoney(rack.fixedCostCents)} / week</Metric></Metrics>
      {rack.status === 'ordered' && <p className="small-note">Arrival is scheduled for Week {rack.arrivalWeek}. Installation uses infrastructure staff after delivery.</p>}
      {rack.status === 'inventory' && <ActionControl game={game} payload={{ kind: 'install_rack', rackId: rack.id }} label="Install rack" canAct={canAct} onQueue={onQueue} />}
      {rack.status === 'installing' && <><progress value={rack.installationProgressBps} max={10000} aria-label={'GPU rack ' + (index + 1) + ' installation'} /><p className="small-note">{formatWorkPoints(rack.completedInstallStaff)} / {formatWorkPoints(CONTENT.infrastructure.installationStaffWeeks)} Operations points{rack.readyWeek !== null ? ' · usable Week ' + rack.readyWeek : ''}</p></>}
      {rack.lastBottleneck && <p className="bottleneck">{rack.lastBottleneck}</p>}
      {(rack.status === 'installed' || rack.status === 'parked') && !activeRackRelocation(game, rack.id) && <><ActionControl game={game} payload={{ kind: 'set_rack_parked', rackId: rack.id, parked: rack.status !== 'parked' }} label={rack.status === 'parked' ? 'Activate rack' : 'Park rack'} canAct={canAct} onQueue={onQueue} /><p className="small-note">Parking a rack stops its power and cooling use. You still pay upkeep and need staff to maintain it.</p></>}
      {(rack.status === 'installed' || rack.status === 'parked') && <RackRelocationControls {...props} rackId={rack.id} />}
    </details>)}</div>}
    <details className="inline-details"><summary>Build a standard data center</summary>
      <Metrics><Metric label="Total construction cost">{formatMoney(facilityCost)}</Metric><Metric label="Construction time">{facilityWeeks} weeks minimum</Metric><Metric label="Construction effort">{formatWorkPoints(facilityStaff)} Operations points</Metric><Metric label="Space for racks">{formatUnits(CONTENT.infrastructure.siteSlotsCU)} CU</Metric><Metric label="Site upkeep">{formatMoney(CONTENT.infrastructure.siteFixedCentsPerWeek)} / week</Metric></Metrics>
      <ActionControl game={game} payload={{ kind: 'start_facility' }} label="Reserve a site" canAct={canAct} onQueue={onQueue} />
      <p className="small-note">Fund and finish each stage in order. Construction needs both staff work and time. The finished site provides space, power, and cooling. Buy GPUs separately.</p>
      <table className="compact-table"><caption>Construction stages</caption><thead><tr><th>Stage</th><th>Payment</th><th>Weeks</th></tr></thead><tbody>{CONTENT.infrastructure.stages.map(stage => <tr key={stage.id}><td>{stage.name}</td><td>{formatMoney(stage.costCents)}</td><td>{stage.elapsedWeeks}</td></tr>)}</tbody></table>
    </details>
    {infrastructure.facilities.map(site => <div className="project-row" key={site.id}><div className="project-heading"><strong>{site.name}</strong><span>{site.paused ? 'Paused' : site.status === 'active' ? 'Operational' : site.status === 'commissioning' ? 'Commissioning' : site.stageName}</span></div>
      {site.status !== 'active' ? <><Metrics><Metric label="Construction time">{site.elapsedWeeks} / {site.requiredWeeks} weeks</Metric><Metric label="Construction effort">{formatWorkPoints(site.completedStaff)} / {formatWorkPoints(site.requiredStaff)} points</Metric><Metric label="Payments made">{formatMoney(site.paidCents)}</Metric><Metric label="Remaining construction cost">{formatMoney(site.remainingCostCents)}</Metric>{site.readyWeek !== null && <Metric label="Operational from">Week {site.readyWeek}</Metric>}</Metrics>{site.canFund && <ActionControl game={game} payload={{ kind: 'fund_facility_stage', facilityId: site.id }} label={'Fund ' + site.stageName.toLowerCase()} canAct={canAct} onQueue={onQueue} />}{site.lastBottleneck && <p className="bottleneck">{site.lastBottleneck}</p>}{site.status === 'building' && <ActionControl game={game} payload={{ kind: 'set_facility_paused', facilityId: site.id, paused: !site.paused }} label={site.paused ? 'Resume construction' : 'Pause construction'} canAct={canAct} onQueue={onQueue} compact />}</> : <Metrics><Metric label="Installed / usable compute">{formatUnits(site.installedCU)} / {formatUnits(site.activeCU)} CU</Metric><Metric label="Power demand / limit">{formatUnits(site.powerDemand)} / {formatUnits(site.powerLimit)}</Metric><Metric label="Cooling demand / limit">{formatUnits(site.coolingDemand)} / {formatUnits(site.coolingLimit)}</Metric><Metric label="Site and rack upkeep">{formatMoney(site.fixedCostCents)} / week</Metric></Metrics>}
      {site.status === 'active' && <FacilityRetrofitsPanel {...props} facilityId={site.id} />}
    </div>)}
  </Section>;
}
