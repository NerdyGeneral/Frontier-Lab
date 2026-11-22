'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { memo, useMemo, useState } from 'react';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { ArrowUpRight, Building2, CheckCircle2, Cpu, Gauge, Layers3, Leaf, Server, TriangleAlert } from 'lucide-react';
import type { CommandPayload, GameState } from '../contracts/types';
import type { FacilityProfile, FacilitySpecialization, FacilitySpecializationPoolView, FacilitySpecializationSiteView } from '../contracts/wave28-facilities';
import { CONTENT } from '../content/catalog';
import { formatMoney, formatUnits } from '../core/index';
import { getFacilitySpecializationView } from '../modules/facility-specialization';
import { getWorkforce } from '../modules/workforce';
import { ActionControl } from './components';
import { ChipSuccessorWorkbench } from './chips-panel';

export interface StudioCampusProps {
  game: GameState;
  canAct: boolean;
  onQueue: (payload: CommandPayload) => void;
  onOpenPanel?: (panel: string) => void;
  active?: boolean;
}

export function retainedCampusPropsEqual(previous: StudioCampusProps, next: StudioCampusProps): boolean {
  if (next.active === false) return true;
  return previous.active !== false && previous.game === next.game && previous.canAct === next.canAct
    && previous.onQueue === next.onQueue && previous.onOpenPanel === next.onOpenPanel;
}

const percent = (bps: number) => (bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
const multiplier = (bps: number) => (bps / 10000).toLocaleString('en-US', { maximumFractionDigits: 3 }) + '×';
const profileName = (profile?: FacilityProfile) => profile === 'serving' ? 'Serving profile' : profile === 'training' ? 'Training profile' : 'General purpose';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="campus-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

function CampusLink({ panel, children, onOpenPanel }: { panel: string; children: ReactNode; onOpenPanel?: StudioCampusProps['onOpenPanel'] }) {
  return <a className="campus-link" href={'#' + panel} onClick={event => { if (onOpenPanel) { event.preventDefault(); onOpenPanel(panel); } }}>{children}<ArrowUpRight size={14} aria-hidden="true" /></a>;
}

function Notice({ children, title, warning = false }: { children: ReactNode; title?: string; warning?: boolean }) {
  return <div className={'campus-notice' + (warning ? ' is-warning' : '')}>{warning ? <TriangleAlert size={17} aria-hidden="true" /> : <Layers3 size={17} aria-hidden="true" />}<div>{title && <strong>{title}</strong>}<p>{children}</p></div></div>;
}

function Progress({ label, done, required, unit, whole = false }: { label: string; done: number; required: number; unit: string; whole?: boolean }) {
  return <div className="campus-progress"><div><span>{label}</span><strong>{whole ? done : (unit.endsWith('points') ? formatWorkPoints : formatUnits)(done)} / {whole ? required : (unit.endsWith('points') ? formatWorkPoints : formatUnits)(required)} {unit}</strong></div><progress value={Math.min(done, required)} max={Math.max(1, required)} aria-label={label} /></div>;
}

function PoolComparison({ current, proposed, chosen }: { current: FacilitySpecializationPoolView; proposed?: FacilitySpecializationPoolView; chosen: FacilityProfile }) {
  const next = proposed ?? current;
  return <article className="campus-pool">
    <header><div><h4>{current.name}</h4><p>{current.rackCount} connected rack{current.rackCount === 1 ? '' : 's'} · {current.fastFabric ? 'Fast fabric installed' : 'Standard network'}</p><p>{current.architectures.join(' / ')} · {current.workloads.join(' / ')}</p></div><Server size={20} aria-hidden="true" /></header>
    <div className="campus-table-scroll"><table className="campus-table"><caption>{current.name}: current versus {profileName(chosen).toLowerCase()}</caption><thead><tr><th scope="col">Resource</th><th scope="col">Current</th><th scope="col">With profile</th></tr></thead><tbody>
      <tr><th scope="row">Usable GPU capacity</th><td>{formatUnits(current.capacityCU)} CU</td><td>{formatUnits(next.capacityCU)} CU</td></tr>
      <tr><th scope="row">Serving limit</th><td>{current.supportsServing ? formatUnits(current.servingCapacityCU) + ' CU' : 'Unsupported'}</td><td>{next.supportsServing ? formatUnits(next.servingCapacityCU) + ' CU' : 'Unsupported'}</td></tr>
      <tr><th scope="row">Training limit</th><td>{current.supportsTraining ? formatUnits(current.trainingCapacityCU) + ' CU' : 'Unsupported'}</td><td>{next.supportsTraining ? formatUnits(next.trainingCapacityCU) + ' CU' : 'Unsupported'}</td></tr>
      <tr><th scope="row">Connected memory</th><td>{formatUnits(current.memoryMU)} MU</td><td>{formatUnits(next.memoryMU)} MU</td></tr>
      <tr><th scope="row">Eligible serving cost<span>per CUw of GPU work</span></th><td>{current.supportsServing ? formatMoney(current.servingVariableCentsPerCUw) : 'Unsupported'}</td><td>{next.supportsServing ? formatMoney(next.servingVariableCentsPerCUw) : 'Unsupported'}</td></tr>
      <tr><th scope="row">Compatible cross-rack training<span>includes hardware and network effects</span></th><td>{current.crossRackTrainingMultiplierBps > 0 ? multiplier(current.crossRackTrainingMultiplierBps) : 'Unavailable'}</td><td>{next.crossRackTrainingMultiplierBps > 0 ? multiplier(next.crossRackTrainingMultiplierBps) : 'Unavailable'}</td></tr>
    </tbody></table></div>
    <div className="campus-coverage"><span>Staff {percent(current.staffCoverageBps)}</span><span>Power {percent(current.powerCoverageBps)}</span><span>Cooling {percent(current.coolingCoverageBps)}</span></div>
    {current.bottleneck && <p className="campus-blocker">{current.bottleneck}</p>}
    {current.crossRackTrainingMultiplierBps === 0 && <p className="campus-copy">Training across racks needs compatible training hardware and at least two active racks in this pool.</p>}
  </article>;
}

function ProfileProject({ project, game, canAct, onQueue }: Pick<StudioCampusProps, 'game' | 'canAct' | 'onQueue'> & { project: FacilitySpecialization }) {
  const latest = project.grants.at(-1);
  const progressing = project.status === 'building' && !project.paused
    && game.slices.company.companies[project.companyId].arrearsCents === 0;
  const staffProgress = progressing && latest?.week === game.week && latest.grantedStaff > 0
    && project.completedStaff < project.requiredStaff;
  const calendarOnly = progressing && project.completedStaff === project.requiredStaff
    && project.completedWork === project.requiredWork && project.elapsedWeeks < project.requiredWeeks;
  return <section className="campus-card" aria-labelledby={'campus-project-' + project.id}>
    <header className="campus-card-heading"><div><span className="campus-kicker">Paid retrofit</span><h3 id={'campus-project-' + project.id}>{profileName(project.profile)}</h3><p>Funded Week {project.startedWeek} · {formatMoney(project.purchaseCents)} paid once.</p></div><span className="campus-status">{project.status === 'ready' ? 'Activates Week ' + project.readyWeek : project.paused ? 'Paused' : 'In progress'}</span></header>
    <div className="campus-card-body">
      <Progress label="Construction time" done={project.elapsedWeeks} required={project.requiredWeeks} unit="weeks" whole />
      <Progress label="Infrastructure work" done={project.completedStaff} required={project.requiredStaff} unit="points" />
      <Progress label="Compute for testing" done={project.completedWork} required={project.requiredWork} unit="CUw" />
      <dl className="campus-facts"><Fact label="Memory needed in one pool">{formatUnits(project.requiredMemory)} MU</Fact><Fact label="GPU work completed">{formatUnits(project.physicalWork)} CUw</Fact></dl>
      {project.status === 'ready' ? <Notice title={'Ready for Week ' + project.readyWeek}>Work is complete. The site switches to its new profile at the start of the week shown above.</Notice>
        : staffProgress ? <Notice title="Infrastructure work progressing">This retrofit received {formatWorkPoints(latest.grantedStaff)} Operations points this week. It still needs {formatWorkPoints(project.requiredStaff - project.completedStaff)} points from your infrastructure team.</Notice>
          : calendarOnly ? <Notice title="Construction time">Staff and GPU work are complete. Construction still needs {project.requiredWeeks - project.elapsedWeeks} more week{project.requiredWeeks - project.elapsedWeeks === 1 ? '' : 's'}. The current profile stays active until the new one is ready to start.</Notice>
            : project.lastBottleneck ? <Notice warning title="Current blocker">{project.lastBottleneck}</Notice>
              : <p className="campus-copy">The current profile stays active while you complete the upgrade’s staff work, GPU work, and construction time.</p>}
      {latest && <details className="campus-details"><summary>Latest resources used · Week {latest.week}</summary><dl className="campus-facts">
        <Fact label="Staff work supplied / needed">{formatWorkPoints(latest.grantedStaff)} / {formatWorkPoints(latest.requestedStaff)} points</Fact>
        <Fact label="Compute supplied / needed">{formatUnits(latest.grantedWork)} / {formatUnits(latest.requestedWork)} CUw</Fact>
        <Fact label="Memory supplied / needed">{formatUnits(latest.grantedMemory)} / {formatUnits(latest.requiredMemory)} MU</Fact>
        <Fact label="Physical work">{formatUnits(latest.physicalWork)} CUw</Fact>
        <Fact label="Connected pool">{latest.pool?.name ?? 'No hardware pool assigned'}</Fact>
        <Fact label="Construction time">{latest.elapsed ? 'One week completed' : 'No progress this week'}</Fact>
      </dl></details>}
      {project.status === 'building' && <ActionControl game={game} canAct={canAct} onQueue={onQueue} payload={{ kind: 'set_facility_specialization_paused', specializationId: project.id, paused: !project.paused }} label={project.paused ? 'Resume site retrofit' : 'Pause site retrofit'} />}
    </div>
  </section>;
}

function SiteOperatingFacts({ site, ...props }: StudioCampusProps & { site: FacilitySpecializationSiteView }) {
  const workforce = getWorkforce(props.game, props.game.playerCompanyId);
  const allocation = props.game.slices.compute.fleets[props.game.playerCompanyId].allocation;
  return <section className="campus-card" aria-labelledby="campus-operations-heading"><header className="campus-card-heading"><div><span className="campus-kicker">Shared resources</span><h3 id="campus-operations-heading">Keep the site working.</h3><p>Check the racks, staff, and resources keeping this site running.</p></div><Gauge size={22} aria-hidden="true" /></header><div className="campus-card-body">
    <dl className="campus-facts">
      <Fact label="Installed / parked racks">{site.installedRacks} / {site.parkedRacks}</Fact>
      <Fact label="Site & rack fixed upkeep">{formatMoney(site.fixedWeeklyCents)} / week</Fact>
      <Fact label="Staff needed to run the site">{formatWorkPoints(site.requiredOperatingStaff)} Operations points / week</Fact>
      <Fact label="Infrastructure staff available">{formatWorkPoints(workforce.capacity.infrastructure)} points / week</Fact>
      <Fact label="Power demand / limit">{formatUnits(site.powerDemand)} / {formatUnits(site.powerLimit)}</Fact>
      <Fact label="Cooling demand / limit">{formatUnits(site.coolingDemand)} / {formatUnits(site.coolingLimit)}</Fact>
      <Fact label="Company development limit">{formatUnits(allocation.development)} CUw / week</Fact>
      <Fact label="Company research limit">{formatUnits(allocation.research)} CUw / week</Fact>
    </dl>
    <p className="campus-copy">Running the site and building upgrades draw from the same team. Work also competes with customer contracts and needs enough memory. Profile bonuses leave salaries, fixed site upkeep, and cloud rent unchanged.</p>
    <div className="campus-links"><CampusLink panel="people" onOpenPanel={props.onOpenPanel}>View team output</CampusLink><CampusLink panel="compute" onOpenPanel={props.onOpenPanel}>Allocate compute</CampusLink><CampusLink panel="infrastructure" onOpenPanel={props.onOpenPanel}>Racks, power & cooling</CampusLink><CampusLink panel="compute-costs" onOpenPanel={props.onOpenPanel}>Actual compute costs</CampusLink></div>
  </div></section>;
}

function FacilityWorkspace(props: StudioCampusProps) {
  const { game, canAct, onQueue, onOpenPanel } = props;
  const view = useMemo(() => getFacilitySpecializationView(game, CONTENT), [game]);
  const [siteId, setSiteId] = useState(() => view.sites.find(site => site.commissioned)?.id ?? view.sites[0]?.id ?? '');
  const [drafts, setDrafts] = useState<Record<string, FacilityProfile>>({});
  const site = view.sites.find(item => item.id === siteId);
  const chosen = drafts[siteId] ?? 'serving';
  const definition = view.profiles.find(item => item.profile === chosen);
  const choice = site?.choices.find(item => item.profile === chosen);
  const history = site?.history.filter(item => item.id !== site.active?.id && item.id !== site.pending?.id) ?? [];
  return <div id="campus-facilities">
    <div className="campus-toolbar"><label className="campus-field" htmlFor="campus-site">Owned site<select id="campus-site" value={siteId} onChange={event => setSiteId(event.target.value)} disabled={!view.sites.length}><option value="">{view.sites.length ? 'Choose a site to review' : 'Commission a site to begin'}</option>{siteId && !site && <option value={siteId}>Saved site is no longer present</option>}{view.sites.map(item => <option key={item.id} value={item.id}>{item.name} · {item.commissioned ? 'Commissioned' : 'Construction not complete'}</option>)}</select></label><span className={'campus-status' + (view.researched ? ' is-good' : '')}>{view.researched ? 'S5 researched' : 'S5 required'}</span></div>
    {!view.researched && <Notice title="Research Facility specialization (S5)">{view.researchReason ?? 'Research unlocks site profiles. Choose one, then pay for and complete its upgrade.'} <CampusLink panel="research" onOpenPanel={onOpenPanel}>Open research</CampusLink></Notice>}
    {!site ? <div className="campus-empty"><Building2 size={32} aria-hidden="true" /><h3>{siteId ? 'Choose a site to continue.' : 'Open your first data center.'}</h3><p>{siteId ? 'That site is no longer available. Choose another site to continue.' : 'Build and open your own data center, then choose a site profile. Cloud rentals and hardware sold to customers do not count.'}</p><CampusLink panel="infrastructure" onOpenPanel={onOpenPanel}>Open Infrastructure</CampusLink></div> : <div className="campus-layout">
      <div className="campus-stack">
        <section className="campus-card" aria-labelledby="campus-profile-heading"><header className="campus-card-heading"><div><span className="campus-kicker">One profile at a time</span><h3 id="campus-profile-heading">Make the site fit the work.</h3><p>{site.name} · {profileName(site.active?.profile)}{site.active ? ' since Week ' + site.active.activatedWeek : ''}</p></div><Building2 size={22} aria-hidden="true" /></header><div className="campus-card-body">
          <fieldset className="campus-choices"><legend>Choose an operating profile</legend>{view.profiles.map(profile => <label key={profile.profile} className={'campus-choice' + (chosen === profile.profile ? ' is-selected' : '')}><input type="radio" name="campus-operating-profile" value={profile.profile} checked={chosen === profile.profile} onChange={() => setDrafts(current => ({ ...current, [siteId]: profile.profile }))} disabled={!canAct} /><span><strong>{profile.name}</strong><span className="campus-choice-benefit">{profile.benefit}</span><span className="campus-choice-tradeoff"><b>Tradeoff</b> {profile.tradeoff}</span></span>{profile.profile === 'serving' ? <Leaf size={20} aria-hidden="true" /> : <Layers3 size={20} aria-hidden="true" />}</label>)}</fieldset>
          {definition && <dl className="campus-facts campus-investment"><Fact label="Profile retrofit fee">{formatMoney(definition.purchaseCents)}</Fact><Fact label="Minimum construction time">{definition.requiredWeeks} weeks</Fact><Fact label="Infrastructure effort">{formatWorkPoints(definition.requiredStaff)} points</Fact><Fact label="Compute for testing">{formatUnits(definition.requiredWork)} CUw</Fact><Fact label="Memory needed">{formatUnits(definition.requiredMemory)} MU</Fact><Fact label="Fixed upkeep change">None from the profile</Fact></dl>}
          {!site.commissioned && <Notice warning title="Commissioning required">Finish building and opening this site in Infrastructure before buying a profile upgrade.</Notice>}
          <ActionControl game={game} payload={choice?.payload ?? null} label={site.active ? 'Fund replacement profile' : 'Fund site profile'} canAct={canAct} onQueue={onQueue} emptyReason="Choose a site and profile to see the cost and requirements." />
          <p className="campus-copy">Starting the upgrade locks in your choice. Changing profiles later costs another upgrade. The current profile keeps working until its replacement is ready to start.</p>
        </div></section>
        {site.pending && <ProfileProject project={site.pending} {...props} />}
        <section className="campus-card" aria-labelledby="campus-pools-heading"><header className="campus-card-heading"><div><h3 id="campus-pools-heading">What changes in this site?</h3><p>Compare today’s usable hardware with your chosen profile.</p></div><Server size={22} aria-hidden="true" /></header><div className="campus-card-body campus-stack">
          {site.pools.length ? site.pools.map(pool => <PoolComparison key={pool.id} current={pool} proposed={choice?.proposedPools.find(item => item.id === pool.id)} chosen={chosen} />) : <Notice>Install compatible racks at this site to use a profile’s bonuses. Profiles do not add GPUs or connect cloud memory.</Notice>}
          <p className="campus-copy">These limits show how much each job type could use. Training and serving share the same GPUs, so they still compete for capacity. Jobs also need compatible hardware, networking, and enough memory.</p>
        </div></section>
      </div>
      <aside className="campus-stack" aria-label="Site operations and upgrade history"><SiteOperatingFacts site={site} {...props} />
        {site.active && <section className="campus-card"><header className="campus-card-heading"><div><span className="campus-kicker">Commissioned profile</span><h3>{profileName(site.active.profile)}</h3></div><CheckCircle2 size={22} aria-hidden="true" /></header><div className="campus-card-body"><dl className="campus-facts"><Fact label="Active since">Week {site.active.activatedWeek}</Fact><Fact label="Retrofit payment">{formatMoney(site.active.purchaseCents)}</Fact><Fact label="Infrastructure work completed">{formatWorkPoints(site.active.completedStaff)} points</Fact><Fact label="Testing work completed">{formatUnits(site.active.completedWork)} CUw</Fact></dl><p className="campus-evidence-id">{site.active.id}</p></div></section>}
        {history.length > 0 && <details className="campus-details campus-history"><summary>Previous profiles ({history.length})</summary>{history.map(item => <article key={item.id}><h4>{profileName(item.profile)}</h4><p>{formatMoney(item.purchaseCents)} paid · active Week {item.activatedWeek ?? '—'}{item.retiredWeek !== null ? '–' + item.retiredWeek : ''}</p><span className="campus-evidence-id">{item.id}</span></article>)}</details>}
      </aside>
    </div>}
  </div>;
}

const RetainedFacilities = memo(function RetainedFacilities(props: StudioCampusProps) {
  return props.active === false ? null : <FacilityWorkspace {...props} />;
}, retainedCampusPropsEqual);

const RetainedSilicon = memo(function RetainedSilicon(props: StudioCampusProps) {
  return props.active === false ? null : <ChipSuccessorWorkbench game={props.game} canAct={props.canAct} onQueue={props.onQueue} idPrefix="campus" onOpenPanel={props.onOpenPanel} />;
}, retainedCampusPropsEqual);

function CampusContent(props: StudioCampusProps) {
  const [tab, setTab] = useState<'facilities' | 'silicon'>('facilities');
  const commissioned = Object.values(props.game.slices.compute.facilities).filter(site => site.companyId === props.game.playerCompanyId && site.status === 'active').length;
  return <section id="campus" className="campus-workspace" aria-label="Campus workspace">
    <div className="campus-intro"><div><span className="campus-kicker">Your hardware campus</span><h2>Build around the work that matters.</h2><p>Upgrade your data center or design a better chip. Compare the benefits, drawbacks, costs, and work before you start.</p><span className={'campus-status' + (commissioned ? ' is-good' : '')}>{commissioned ? commissioned + ' commissioned owned site' + (commissioned === 1 ? '' : 's') : 'Your Campus room appears when your first data center opens'}</span></div>{commissioned > 0 && <Image unoptimized className="campus-intro-art" src="/studio/campus-room-night.webp" width={1536} height={1024} loading="lazy" alt="" aria-hidden="true" />}</div>
    <div className="campus-tabs" role="group" aria-label="Campus workspaces"><button type="button" aria-pressed={tab === 'facilities'} aria-controls="campus-facility-panel" onClick={() => setTab('facilities')}><Building2 size={16} aria-hidden="true" /> Site profiles</button><button type="button" aria-pressed={tab === 'silicon'} aria-controls="campus-silicon-panel" onClick={() => setTab('silicon')}><Cpu size={16} aria-hidden="true" /> Gen 2 silicon</button></div>
    <div id="campus-facility-panel" hidden={tab !== 'facilities'}><RetainedFacilities {...props} active={tab === 'facilities'} /></div>
    <div id="campus-silicon-panel" hidden={tab !== 'silicon'}><RetainedSilicon {...props} active={tab === 'silicon'} /></div>
  </section>;
}

/** Unvisited surfaces do no selector/quote work; visited drafts stay mounted while hidden. */
export const StudioCampus = memo(function StudioCampus(props: StudioCampusProps) {
  return props.active === false ? <section id="campus" className="campus-workspace" aria-label="Campus workspace" /> : <CampusContent {...props} />;
}, retainedCampusPropsEqual);

