'use client';

import type { CommandPayload, GameState, GameView, RoleAllocation, StaffMember, StaffRole } from '../contracts/types';
import { staffDisplayName, canChooseStaffSpecialty, careerOutput, careerLevel, CAREER_RANKS, careerSalary, SPECIALTY_BONUS, STAFF_CAREER_PATHS } from '../modules/staff-careers';
import { getFounderWeeklyOutput } from '../modules/workforce';
import { CONTENT } from '../content/catalog';
import { formatMoney } from '../core/math';
import { formatWorkPoints, getEmployeeWorkOutput, getStaffPointProfile, WORK_POINT_LABELS } from '../modules/workforce-points';
import { ActionControl, Metric, Metrics, ROLE_LABELS } from './components';
import { useStudioCommandReview, useStudioTaskActions, useStudioTaskMode } from './studio-interaction-context';
import type { StudioStaffingSelection } from './studio-interaction-context';
import { StudioDecisionLayout } from './studio-decision-layout';

export const STAFFING_FOUNDER_ROLES: readonly StaffRole[] = ['research', 'ml', 'data', 'infrastructure', 'commercial'];
const ROLE_WORK: Record<StaffRole, string> = {
  research: 'Research points advance discoveries and model evaluations.',
  ml: 'Design points supervise model training and build releases. Training also needs GPUs.',
  data: 'Data points prepare training packets and maintain customer data services.',
  infrastructure: 'Operations points bring racks online and keep owned compute running.',
  commercial: 'Business points help deliver ongoing support to contracted customers.',
  hardware: 'Hardware points advance chip designs and prototypes.',
};
const POINT_ROLES: readonly StaffRole[] = [...STAFFING_FOUNDER_ROLES, 'hardware'];
const outputRoles = (output: RoleAllocation) => POINT_ROLES.filter(role => output[role] > 0);
const outputDescription = (output: RoleAllocation) => outputRoles(output).map(role => formatWorkPoints(output[role]) + ' ' + WORK_POINT_LABELS[role]).join(' · ');

/** The retained PeoplePanel owns this draft in both Studio and Classic views. */
export interface StaffingDraft {
  mode: 'hire' | 'assign';
  hireRole: StaffRole;
  target: string;
  reason: string;
  unavailableReason: string;
}

export interface StudioStaffingHelpTarget {
  mode: 'hire' | 'assign';
  role: StaffRole;
  staffId?: string;
}

/** A resource shortcut opens the relevant specialist or their hiring card. */
export function getStudioStaffingHelpTarget(game: GameState, role: StaffRole): StudioStaffingHelpTarget {
  const member = Object.values(game.slices.company.staff)
    .filter(person => person.companyId === game.playerCompanyId && person.role === role)
    .sort((a, b) => Number(a.readyWeek > game.week) - Number(b.readyWeek > game.week)
      || a.readyWeek - b.readyWeek || a.id.localeCompare(b.id))[0];
  if (member && member.readyWeek <= game.week) return { mode: 'assign', role, staffId: member.id };
  if (member) return { mode: 'assign', role, staffId: member.id };
  return { mode: 'hire', role };
}

/** Keep roster selection when opening the team from another workbench.
 * An explicit missing or foreign employee never falls back to the founder. */
export function applyStudioStaffingSelection(draft: StaffingDraft, selection: StudioStaffingSelection): StaffingDraft {
  const roleOnlyAssignment = selection.mode === 'assign' && selection.staffId === undefined && !!selection.role;
  const founderCanHelp = !!selection.role && STAFFING_FOUNDER_ROLES.includes(selection.role);
  const target = selection.mode === 'assign' && selection.staffId !== undefined ? selection.staffId ?? ''
    : roleOnlyAssignment ? founderCanHelp ? 'founder' : '' : draft.target;
  return { ...draft, mode: selection.mode, target,
    ...(selection.role ? { hireRole: selection.role } : {}),
    reason: selection.reason ?? '',
    unavailableReason: selection.unavailableReason ?? (roleOnlyAssignment && !founderCanHelp
      ? `${ROLE_LABELS[selection.role!]} work needs a specialist. Choose one from your team or switch to Hire.` : ''),
  };
}

export function createStaffingDraft(): StaffingDraft {
  return { mode: 'hire', hireRole: 'ml', target: 'founder', reason: '', unavailableReason: '' };
}

interface StudioStaffingFormProps {
  game: GameState;
  view: GameView;
  canAct: boolean;
  onQueue: (payload: CommandPayload) => void;
  draft: StaffingDraft;
  onChange: (update: (draft: StaffingDraft) => StaffingDraft) => void;
}

/** One presentation for employee profiles, current output and proposed output.
 * Values always come from the workforce model, never a separate UI formula. */
export function StaffPointBreakdown({ output, roles = outputRoles(output), specialty, label = 'Points per week' }: { output: RoleAllocation; roles?: readonly StaffRole[]; specialty?: StaffRole; label?: string }) {
  const orderedRoles = specialty ? [...roles].sort((a, b) => Number(b === specialty) - Number(a === specialty)) : roles;
  return <div className="staff-point-breakdown">
    <p className="staff-point-caption">{label}</p>
    {orderedRoles.length ? <dl className="staff-point-values">{orderedRoles.map(role => <div key={role} data-point-role={role} data-specialty={specialty === role || undefined}>
      <dt>{WORK_POINT_LABELS[role]}{specialty === role && <span>Specialty</span>}</dt><dd>{formatWorkPoints(output[role])}<small> points</small></dd>
    </div>)}</dl> : <p className="small-note">No points used this week.</p>}
  </div>;
}

export function StaffOutputCard({ member, number, week, selected = false, selectedDetail = false, onSelect }: { member: StaffMember; number: number; week: number; selected?: boolean; selectedDetail?: boolean; onSelect?: () => void }) {
  const definition = CONTENT.staff.find(role => role.id === member.role)!;
  const profile = careerOutput(member);
  const career = member.career, level = careerLevel(career?.experience);
  const nextRank = CAREER_RANKS[level + 1];
  const path = career?.specialty && STAFF_CAREER_PATHS[member.role][career.specialty];
  const onboarding = member.readyWeek > week;
  return <article className="staff-point-card" data-staff-output={selectedDetail ? undefined : member.id} data-selected-staff-output={selectedDetail ? member.id : undefined} data-selected={selected || undefined}>
    <header><strong>{definition.name} {number} · {staffDisplayName(member)}</strong><span className="staff-point-specialty">{WORK_POINT_LABELS[member.role]} specialist</span></header>
    <p className="staff-point-status">{onboarding ? 'Onboarding · ready Week ' + member.readyWeek : 'Ready · automatic output'}</p>
    <div className="staff-career-progress">
      <span><strong>{CAREER_RANKS[level].name}</strong>{path ? ' · ' + path.name : canChooseStaffSpecialty(member) ? ' · Specialty available' : ''}</span>
      <span>{formatWorkPoints(career?.experience ?? 0)} XP{nextRank ? ' / ' + formatWorkPoints(nextRank.threshold) : ''}</span>
      {nextRank && <progress aria-label={'Experience toward ' + nextRank.name} value={career?.experience ?? 0} max={nextRank.threshold} />}
    </div>
    {selectedDetail && <p className="small-note">{career?.earnedWeek === week ? '+' + formatWorkPoints(career.lastEarned) + ' XP this week. ' : ''}Each point used on project work earns 1 XP.{nextRank && ' At ' + formatWorkPoints(nextRank.threshold) + ' XP, ' + nextRank.name + ' earns +' + nextRank.primaryBonus + ' ' + WORK_POINT_LABELS[member.role] + ' points per week and ' + (nextRank.salaryPercent - 100) + '% above starting pay.'}</p>}
    <StaffPointBreakdown output={onboarding ? getEmployeeWorkOutput(member, week) : profile} roles={outputRoles(profile)} specialty={member.role} label="Available points per week" />
    {onboarding && <p className="small-note staff-point-future">0 points now. From Week {member.readyWeek}: {outputDescription(profile)} points per week.</p>}
    <footer><span>{formatMoney(careerSalary(member, definition.weeklyCents))} / week</span>{onSelect && <button type="button" className="studio-surface-button" aria-label={'View output for ' + definition.name + ' ' + number} aria-pressed={selected} onClick={onSelect}>View output</button>}</footer>
  </article>;
}

export function StudioStaffingForm({ game, view, canAct, onQueue, draft, onChange }: StudioStaffingFormProps) {
  const review = useStudioCommandReview();
  const actions = useStudioTaskActions();
  const taskMode = useStudioTaskMode();
  const focused = taskMode === 'hire-staff' || taskMode === 'assign-staff';
  const company = game.slices.company.companies[game.playerCompanyId];
  const founderOutput = getFounderWeeklyOutput(game, game.playerCompanyId);
  const members = Object.values(game.slices.company.staff).filter(member => member.companyId === game.playerCompanyId).sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id));
  const completedResearch = game.slices.research.completedByCompany[game.playerCompanyId] ?? [];
  const hireEligible = (role: typeof CONTENT.staff[number]) => !role.availableOnResearchEntry || completedResearch.includes(role.availableOnResearchEntry)
    || Object.values(game.slices.research.projects).some(project => project.companyId === game.playerCompanyId && project.researchId === role.availableOnResearchEntry);
  const hireDefinition = CONTENT.staff.find(role => role.id === draft.hireRole)!;
  const hireProfile = getStaffPointProfile(draft.hireRole);
  const effectiveWeek = game.week + 1;
  const readyWeek = effectiveWeek + hireDefinition.onboardingWeeks;
  const founder = draft.target === 'founder';
  const member = !founder ? members.find(item => item.id === draft.target) : undefined;
  const targetAvailable = founder || !!member;
  const changeMode = (mode: StaffingDraft['mode']) => {
    if (actions?.openTask) actions.openTask(mode === 'hire' ? 'hire-staff' : 'assign-staff');
    else onChange(current => ({ ...current, mode }));
  };
  const choosePerson = (target: string) => onChange(current => ({ ...current, target, unavailableReason: '' }));
  const hireSummary = <>
    <h3>Cost and start date</h3>
    <div className="studio-staffing-commitment">
      <p className="small-heading">{hireDefinition.name}</p>
      <Metrics><Metric label="Recruitment cost">{formatMoney(hireDefinition.recruitmentCents)}</Metric><Metric label="Weekly pay">{formatMoney(hireDefinition.weeklyCents)} / week</Metric><Metric label="Hiring and payroll begin">Week {effectiveWeek}</Metric><Metric label="Ready to work">Week {readyWeek}</Metric></Metrics>
      <p>{hireDefinition.onboardingWeeks} onboarding weeks. Salary begins during onboarding.</p>
    </div>
    {!hireEligible(hireDefinition) && <p className="studio-journey-warning" role="status">Start Chip feasibility research before recruiting this specialist. Your role selection will stay here.</p>}
    <ActionControl game={game} payload={{ kind: 'hire_staff', role: draft.hireRole }} label={review ? "Review hire" : "Hire employee"} taskAction="hire-staff" canAct={canAct} onQueue={onQueue} />
    <p className="small-note">New hires generate their full weekly output automatically after onboarding. Their points are shared across active projects in each category.</p>
  </>;
  const granted = view.workforce.granted;
  const weeklySummary = <section aria-label="Team contributions">
    <h3>{game.week ? 'Team contributions · Week ' + game.week : 'First week of work'}</h3>
    {outputRoles(granted).length
      ? <><p className="small-note">Active projects drew these points from the team this week.</p><StaffPointBreakdown output={granted} label="Points supplied to projects" /></>
      : <p className="small-note">{game.week ? 'Projects used no team points this week.' : 'Start a project and advance the week to see the team’s contributions here.'}</p>}
    <p className="small-note">Points flow to matching work each week. Unused points expire at the end of the week.</p>
  </section>;

  return <div className="studio-staffing" data-staffing-mode={draft.mode}>
    <div className="studio-staffing-heading">
      <div className="studio-training-view" role="group" aria-label="Staffing decision"><button type="button" aria-pressed={draft.mode === 'hire'} onClick={() => changeMode('hire')}>Hire staff</button><button type="button" aria-pressed={draft.mode === 'assign'} onClick={() => changeMode('assign')}>Team output</button></div>
    </div>
    {draft.reason && <div className="studio-staffing-context"><p className="small-heading">Why you are here</p><p>{draft.reason}</p><p className="small-note">Each hire adds the point types shown below once onboarding finishes.</p></div>}
    <Metrics><Metric label="Ready employees">{view.workforce.ready}</Metric><Metric label="Onboarding">{view.workforce.onboarding}</Metric><Metric label="Current employee payroll">{formatMoney(view.payrollCents)} / week</Metric></Metrics>

    {draft.mode === 'hire' ? <section className="studio-staffing-decision" aria-label="Hire staff">
      <StudioDecisionLayout focused={focused} summary={hireSummary} summaryLabel="Hiring cost and start date">
        <h3>Choose a specialist</h3>
        <label className="line-control" htmlFor="hire-role">Role<select id="hire-role" value={draft.hireRole} disabled={!canAct} onChange={event => onChange(current => ({ ...current, hireRole: event.target.value as StaffRole, unavailableReason: '' }))}>{CONTENT.staff.map(role => <option value={role.id} key={role.id} disabled={!hireEligible(role)}>{role.name}{!hireEligible(role) ? ' · Start Chip feasibility research' : ''}</option>)}</select></label>
        <div className="staff-point-card staff-point-hire" data-hire-output={draft.hireRole}>
          <header><strong>{hireDefinition.name}</strong><span className="staff-point-specialty">{WORK_POINT_LABELS[draft.hireRole]} specialist</span></header>
          <StaffPointBreakdown output={hireProfile} specialty={draft.hireRole} label={'Weekly output from Week ' + readyWeek} />
          <p className="small-note">0 points during onboarding. All three categories become available automatically in Week {readyWeek}.</p>
        </div>
        <p className="small-note">{ROLE_WORK[draft.hireRole]}</p>
      </StudioDecisionLayout>
    </section> : <section className="studio-staffing-decision" aria-label="Team output">
      <StudioDecisionLayout focused={focused} summary={weeklySummary} summaryLabel="Weekly output and effect">
        <h3>Individual output</h3>
        <label className="line-control" htmlFor="staffing-person">Person<select id="staffing-person" value={targetAvailable ? draft.target : ''} onChange={event => choosePerson(event.target.value)}>
          {!targetAvailable && <option value="">Choose an available person</option>}
          <option value="founder">Founder · generalist</option>
          {members.map((item, index) => <option key={item.id} value={item.id}>{CONTENT.staff.find(role => role.id === item.role)!.name} {index + 1} · {staffDisplayName(item)}{item.readyWeek > game.week ? ' · Onboarding' : ' · Ready'}</option>)}
        </select></label>
        {!targetAvailable && <p className="studio-journey-warning" role="status">{draft.unavailableReason || 'This employee is no longer available. Choose another person.'}</p>}
        {founder && <article className="staff-point-card" data-staff-output="founder">
          <header><strong>Founder</strong><span className="staff-point-specialty">Generalist</span></header>
          <p className="staff-point-status">Up to {formatWorkPoints(company.founderFte)} points per week</p>
          <p>The founder automatically helps with active work across Research, Design, Data, Operations and Business. Hardware work needs a specialist.</p>
          {game.week > 0 && <StaffPointBreakdown output={founderOutput} label={'Founder contributions · Week ' + game.week} />}
        </article>}
        {member && <>
          <StaffOutputCard member={member} number={members.findIndex(item => item.id === member.id) + 1} week={game.week} selectedDetail />
          {game.slices.company.passiveWorkforce && !member.career?.specialty && <section className="staff-career-paths" aria-label="Career specialties">
            <h4>Career specialty</h4>
            <p className="small-note">{canChooseStaffSpecialty(member) ? 'Choose one permanent specialty. Its bonus starts next week.' : 'At 120 XP, choose one permanent specialty.'}</p>
            {(['depth', 'breadth'] as const).map(specialty => {
              const path = STAFF_CAREER_PATHS[member.role][specialty];
              return <div key={specialty}><strong>{path.name}</strong><span>+{SPECIALTY_BONUS} {WORK_POINT_LABELS[path.role]} points / week</span>
                {canChooseStaffSpecialty(member) && <ActionControl game={game} payload={{ kind: 'specialize_staff', staffId: member.id, specialty }} label={'Choose ' + path.name} canAct={canAct} onQueue={onQueue} />}</div>;
            })}
          </section>}
          <details className="inline-details"><summary>Dismiss this employee</summary><p className="small-note">Output and salary stop next week. Dismissal costs two weeks of severance.</p><ActionControl game={game} payload={{ kind: 'dismiss_staff', staffId: member.id }} label={review ? "Review dismissal" : "Dismiss employee"} canAct={canAct} onQueue={onQueue} /></details>
        </>}
      </StudioDecisionLayout>
    </section>}

    {members.length > 0 && <section className="staff-point-roster" aria-label="Team weekly output">
      <h3>Your team’s weekly output</h3>
      <p className="small-note">Ready employees generate points automatically. Active projects share each category. Unused points do not carry forward.</p>
      <div className="staff-point-roster-grid">
        {members.map((item, index) => <StaffOutputCard key={item.id} member={item} number={index + 1} week={game.week} selected={draft.mode === 'assign' && draft.target === item.id} onSelect={draft.mode === 'assign' ? () => choosePerson(item.id) : undefined} />)}
      </div>
    </section>}
    {actions && <div className="studio-staffing-footer"><button type="button" onClick={actions.reviewResources}>Review people and compute</button></div>}
    <details className="inline-details"><summary>Team capacity by category</summary><div className="table-scroll"><table className="compact-table studio-staffing-table"><thead><tr><th scope="col">Category</th><th scope="col">Available / week</th><th scope="col">Supplied in Week {game.week}</th></tr></thead><tbody>{CONTENT.staff.filter(role => hireEligible(role) || members.some(member => member.role === role.id)).map(role => <tr key={role.id}><th scope="row">{WORK_POINT_LABELS[role.id]}</th><td>{formatWorkPoints(view.workforce.capacity[role.id])} points</td><td>{formatWorkPoints(view.workforce.granted[role.id])} points</td></tr>)}</tbody></table></div><p className="small-note">Project progress also depends on compute, memory and the other specialties each job requires.</p></details>
  </div>;
}
