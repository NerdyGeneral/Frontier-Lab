'use client';

import { useState } from 'react';
import type { Allocation, CommandPayload, GameState, GameView } from '../contracts/types';
import { RESOURCE_SCALE, SCORE_SCALE } from '../contracts/types';
import { CONTENT } from '../content/catalog';
import { formatMoney, formatUnits } from '../core/index';
import { getComputePools, getInfrastructureBaseCost } from '../modules/compute-pools';
import { ActionControl, Metric, Metrics, parseFixed, parseWhole, Section } from './components';
import { useStudioStaffingSelection, useStudioTaskActions, useStudioTaskMode } from './studio-interaction-context';
import { applyStudioStaffingSelection, createStaffingDraft, StudioStaffingForm } from './studio-staffing';
import { StudioDecisionLayout } from './studio-decision-layout';

export interface PanelProps {
  game: GameState; view: GameView; canAct: boolean; onQueue: (payload: CommandPayload) => void;
}
const CATEGORIES: readonly (keyof Allocation)[] = ['serving', 'development', 'research'];
const score = (value: number) => String(value / SCORE_SCALE);
const unitsInput = (value: number) => String(value / RESOURCE_SCALE);

export function BusinessPanel({ game, view, canAct, onQueue }: PanelProps) {
  const company = game.slices.company.companies[game.playerCompanyId];
  const [name, setName] = useState(company.name);
  const entries = game.slices.company.ledger.filter(entry => entry.companyId === company.id && entry.week === game.week);
  const ownedBaseCost = getInfrastructureBaseCost(game, game.playerCompanyId, CONTENT);
  return <Section title="Business" id="business">
    <p className="company-name">{company.name}</p>
    <Metrics>
      <Metric label="Cash balance" className="funds">{formatMoney(company.cashCents)}</Metric>
      {view.reservedCashCents > 0 && <><Metric label="Reserved for queued actions">{formatMoney(view.reservedCashCents)}</Metric><Metric label="Cash left to spend">{formatMoney(view.availableCashCents)}</Metric></>}
      <Metric label="Revenue / last week">{formatMoney(company.lastWeek.revenueCents)}</Metric>
      <Metric label="Operating costs / last week">{formatMoney(company.lastWeek.operatingExpenseCents)}</Metric>
      <Metric label="Operating surplus">{formatMoney(view.operatingSurplusCents)}</Metric>
      <Metric label="Cash change / last week">{formatMoney(company.lastWeek.cashChangeCents)}</Metric>
    </Metrics>
    <p className="next-bill">Base costs: <strong>{formatMoney(view.weeklyBaseCostCents)} / week</strong></p>
    <p className="small-note">Runway at the current pace: <strong>{view.runwayWeeks === null ? 'Self-funding' : view.runwayWeeks.toFixed(1) + ' weeks'}</strong>. New projects and hires change this forecast.</p>
    <details className="inline-details"><summary>Base cost breakdown</summary>
      <Metrics><Metric label="Reserved cloud">{formatMoney(view.cloudRentCents)} / week</Metric><Metric label="Employee payroll">{formatMoney(view.payrollCents)} / week</Metric>{ownedBaseCost > 0 && <Metric label="Owned hardware and facilities">{formatMoney(ownedBaseCost)} / week</Metric>}<Metric label="Founder and overhead">{formatMoney(CONTENT.opening.overheadCentsPerWeek)} / week</Metric></Metrics>
      <p className="small-note">Cloud rent includes energy and is paid even when idle. Payroll includes onboarding and idle weeks. Owned GPU work adds variable operating costs to these fixed bills.</p>
    </details>
    <details className="inline-details"><summary>Company name</summary>
      <div className="simple-form"><label htmlFor="company-name">Name</label><input id="company-name" value={name} maxLength={48} onChange={event => setName(event.target.value)} disabled={!canAct} autoComplete="off" />
        <ActionControl game={game} payload={{ kind: 'rename_company', name }} label="Rename company" canAct={canAct} onQueue={onQueue} extraDisabled={name.trim() === company.name} />
      </div>
    </details>
    <details className="inline-details"><summary>Last week’s transactions</summary>
      {entries.length ? <div className="table-scroll"><table className="compact-table"><thead><tr><th>Week {game.week}</th><th>Amount</th><th>Unpaid</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td>{entry.label}<span className="table-subline">{entry.kind === 'receipt' ? 'Receipt' : 'Expense'}</span></td><td>{formatMoney(entry.amountCents)}</td><td>{formatMoney(entry.unpaidCents)}</td></tr>)}</tbody></table></div> : <p className="small-note">Your first week has not started yet. Purchase costs and weekly bills will appear here when it does.</p>}
    </details>
  </Section>;
}

export function PeoplePanel({ game, view, canAct, onQueue }: PanelProps) {
  const selection = useStudioStaffingSelection();
  const [staffing, setStaffing] = useState(createStaffingDraft);
  const [consumedSelection, setConsumedSelection] = useState<number | null>(null);
  if (selection && consumedSelection !== selection.intentId) {
    setConsumedSelection(selection.intentId);
    setStaffing(current => applyStudioStaffingSelection(current, selection));
  }
  return <Section title="People" id="people"><StudioStaffingForm game={game} view={view} canAct={canAct} onQueue={onQueue} draft={staffing} onChange={setStaffing} /></Section>;
}

export { DataPanel, LabPanel, ModelsPanel, ResearchPanel } from './lab-panels';
export { InfrastructurePanel } from './infrastructure-panel';

export function ComputePanel({ game, view, canAct, onQueue }: PanelProps) {
  const actions = useStudioTaskActions();
  const taskMode = useStudioTaskMode();
  const focusedAllocation = taskMode === 'allocate-compute';
  const focusedRental = taskMode === 'rent-compute';
  const focused = focusedAllocation || focusedRental;
  const fleet = game.slices.compute.fleets[game.playerCompanyId];
  const pools = getComputePools(game, game.playerCompanyId, CONTENT);
  const ownedPools = pools.filter(pool => pool.ownership === 'owned');
  const [draft, setDraft] = useState(() => ({ serving: unitsInput(fleet.allocation.serving), development: unitsInput(fleet.allocation.development), research: unitsInput(fleet.allocation.research) }));
  const [cloud, setCloud] = useState(unitsInput(fleet.cloudCU));
  const parsedCloud = parseWhole(cloud);
  const serving = parseFixed(draft.serving, 9);
  const development = parseFixed(draft.development, 9);
  const research = parseFixed(draft.research, 9);
  const payload: CommandPayload | null = serving === null || development === null || research === null ? null : { kind: 'allocate_compute', serving, development, research };
  const rentalPayload: CommandPayload | null = parsedCloud === null || !Number.isSafeInteger(parsedCloud * RESOURCE_SCALE) ? null : { kind: 'set_cloud_capacity', cu: parsedCloud * RESOURCE_SCALE };
  const capacity = <Metrics><Metric label="Rented capacity">{formatUnits(fleet.cloudCU)} CU</Metric>{ownedPools.length > 0 && <Metric label="Usable owned capacity">{formatUnits(ownedPools.reduce((sum, pool) => sum + pool.capacityCU, 0))} CU</Metric>}<Metric label="Memory occupied / total">{formatUnits(view.memoryInUse)} / {formatUnits(fleet.memoryMU)} MU</Metric><Metric label="Weekly cloud bill">{formatMoney(view.cloudRentCents)}</Metric></Metrics>;
  const currentWork = <table className="compact-table allocation-table"><caption>Capacity and actual work</caption><thead><tr><th>Workload</th><th>Allocated CU</th><th>Last CUw</th></tr></thead><tbody>{CATEGORIES.map(category => <tr key={category}><td className="capitalize">{category}</td><td>{formatUnits(fleet.allocation[category])}</td><td>{formatUnits(fleet.lastWork[category])}</td></tr>)}</tbody></table>;
  return <Section title="Compute" id="compute">
    {actions?.openTask && <div className="studio-training-view studio-compute-modes" role="group" aria-label="Compute decision"><button type="button" aria-pressed={focusedAllocation} onClick={() => actions.openTask?.('allocate-compute')}>Allocate compute</button><button type="button" aria-pressed={focusedRental} onClick={() => actions.openTask?.('rent-compute')}>Rent or release compute</button></div>}
    <div hidden={focused}>{capacity}{currentWork}</div>
    {fleet.lastBottleneck && <p className="bottleneck">{fleet.lastBottleneck}</p>}
    <section className="studio-compute-choice" aria-label="Compute allocation" hidden={focusedRental}>
      <StudioDecisionLayout focused={focusedAllocation} summary={<><h3>Capacity and requirements</h3><div hidden={!focusedAllocation}>{capacity}{currentWork}</div><ActionControl game={game} payload={payload} label="Set compute allocation" taskAction="allocate-compute" canAct={canAct} onQueue={onQueue} /><p className="small-note">Allocations take effect next week. Jobs share their workload’s capacity and still need enough staff and memory.</p>{actions?.openTask && <button type="button" className="studio-surface-button" onClick={() => actions.openTask?.('rent-compute')}>Review rented capacity</button>}</>} summaryLabel="Compute capacity and requirements">
      <h3>Allocate capacity</h3>
      <p className="small-note">Choose how much compute each workload can use. This changes the split of your existing capacity.</p>
      <div className="allocation-inputs">{CATEGORIES.map(category => <label key={category} htmlFor={'allocate-' + category}><span className="capitalize">{category}</span><span className="unit-input"><input id={'allocate-' + category} type="number" min="0" step="0.25" inputMode="decimal" value={draft[category]} disabled={!canAct} onChange={event => setDraft(current => ({ ...current, [category]: event.target.value }))} /><span>CU</span></span></label>)}</div>
      <dl className="studio-compute-workloads"><div><dt>Serving</dt><dd>Live products and customer requests.</dd></div><div><dt>Development</dt><dd>Training and model evaluation.</dd></div><div><dt>Research</dt><dd>Research projects and experiments.</dd></div></dl>
      </StudioDecisionLayout>
    </section>
    <section className="studio-compute-choice" aria-label="Cloud capacity" hidden={focusedAllocation}>
      <StudioDecisionLayout focused={focusedRental} summary={<><h3>Cost and requirements</h3><div hidden={!focusedRental}>{capacity}</div><ActionControl game={game} payload={rentalPayload} label="Change cloud capacity" taskAction="rent-compute" canAct={canAct} onQueue={onQueue} extraDisabled={parsedCloud !== null && parsedCloud * RESOURCE_SCALE === fleet.cloudCU} /><p className="small-note">After renting more GPUs, choose how to use their capacity. Before renting fewer, reduce your allocations and free memory used by running models.</p>{actions?.openTask && <button type="button" className="studio-surface-button" onClick={() => actions.openTask?.('allocate-compute')}>Review allocations</button>}</>} summaryLabel="Cloud rental cost and requirements">
      <h3>Set total rented capacity</h3>
      <p className="small-note">Enter the total cloud capacity you want next week. A higher total rents more; a lower total releases capacity.</p>
      <label className="line-control" htmlFor="cloud-total">Total rented CU<input id="cloud-total" type="number" min="0" max={CONTENT.firstSale.maxCloudCU / RESOURCE_SCALE} step="1" value={cloud} disabled={!canAct} onChange={event => setCloud(event.target.value)} /></label>
      <p className="small-note">Rent is a weekly commitment. The quote includes the change to your cloud bill; confirming does not advance time.</p>
      </StudioDecisionLayout>
    </section>
    <details className="inline-details"><summary>Last week’s resource use</summary>
      {fleet.lastGrants.length ? <ul className="grant-list">{fleet.lastGrants.map(grant => <li key={grant.requestId}><strong>{formatUnits(grant.grantedWork)} / {formatUnits(grant.requestedWork)} CUw</strong><p className="small-note">{grant.reason}</p></li>)}</ul> : <p className="small-note">No work has used resources yet.</p>}
      <p className="small-note">Serving reserves some spare capacity, but you pay usage costs only for work performed. Training and tests also need free memory.</p>
    </details>
    {ownedPools.length > 0 && <details className="inline-details"><summary>Hardware groups and limits</summary>{pools.map(pool => <div className="pool-row" key={pool.id}><p className="small-heading">{pool.name}</p><Metrics><Metric label="Nominal / usable">{formatUnits(pool.nominalCU)} / {formatUnits(pool.capacityCU)} CU</Metric><Metric label="Usable memory">{formatUnits(pool.memoryMU)} MU</Metric><Metric label="Training / serving efficiency">{pool.trainingBps / 10000}× / {pool.servingBps / 10000}×</Metric>{pool.ownership === 'owned' && <><Metric label="Staff coverage">{score(pool.staffCoverageBps)}%</Metric><Metric label="Power / cooling coverage">{score(pool.powerCoverageBps)}% / {score(pool.coolingCoverageBps)}%</Metric></>}</Metrics>{pool.bottleneck && <p className="bottleneck">{pool.bottleneck}</p>}</div>)}<p className="small-note">Each job must fit in one connected group of GPUs. Memory from different sites, cloud rentals or hardware types cannot be combined. Training across racks needs network links; sparse models need compatible hardware and fast fabric.</p></details>}
    <details className="inline-details"><summary>What are CU, CUw, and MU?</summary><p className="small-note">CU measures compute capacity. One CU working for one game week supplies one CUw of physical work. MU measures memory. These are fictional game units. General cloud rent includes energy. Owned GPUs have separate purchase, operating, and workload costs.</p></details>
  </Section>;
}

export { ProductPanel, DeveloperApiPanel, MarketPanel } from './product-panels';
