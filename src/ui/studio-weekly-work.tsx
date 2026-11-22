'use client';

import { useState } from 'react';
import { Activity, ChevronRight } from 'lucide-react';
import type { GameState } from '../contracts/types';
import { CONTENT } from '../content/catalog';
import type { StudioProject } from '../core/studio';
import { STAFF_ROLES } from '../modules/workforce';
import { careerOutput } from '../modules/staff-careers';
import { formatWorkPoints, WORK_POINT_LABELS } from '../modules/workforce-points';

interface WeeklyWorkProps {
  game: GameState;
  projects: StudioProject[];
  onInspect: (project: StudioProject) => void;
}

function projectUpdate(projects: StudioProject[], previous: StudioProject[]) {
  const before = new Map(previous.map(project => [project.id, project]));
  const finished = projects.find(project => project.status === 'complete' && before.get(project.id)?.status !== 'complete'
    && (before.has(project.id) || project.progressBps > 0));
  const advanced = projects.find(project => project.progressBps > (before.get(project.id)?.progressBps ?? 0)
    && project.status !== 'complete');
  return finished ?? advanced;
}

export function StudioWeeklyWork({ game, projects, onInspect }: WeeklyWorkProps) {
  // Compare consecutive settled weeks only. Loading a save or returning to the
  // room shows the saved numbers without replaying old work as a new gain.
  const [snapshot, setSnapshot] = useState({ week: game.week, projects, change: undefined as StudioProject | undefined, tick: false });
  if (snapshot.week !== game.week) {
    const tick = game.week === snapshot.week + 1;
    setSnapshot({ week: game.week, projects, change: tick ? projectUpdate(projects, snapshot.projects) : undefined, tick });
  }
  const last = game.slices.company.lastStaff[game.playerCompanyId];
  const produced = STAFF_ROLES.filter(role => (last?.capacity[role] ?? 0) > 0);
  const available = produced.reduce((sum, role) => sum + last.capacity[role], 0);
  const granted = STAFF_ROLES.reduce((sum, role) => sum + (last?.granted[role] ?? 0), 0);
  const blocked = projects.find(project => project.status === 'blocked');
  const spotlight = snapshot.change ?? blocked ?? projects.find(project => project.status === 'working')
    ?? projects.find(project => project.status === 'waiting');
  const progress = spotlight && Math.floor(spotlight.progressBps / 100);
  const empty = game.week === 0
    ? 'Start a project and advance the week to see your team at work.'
    : granted ? 'The team supported ongoing lab work this week.'
      : 'Ready staff pick up matching work automatically.';
  return <section className="studio-weekly-work" aria-label="Weekly team contributions">
    <header><h2><Activity size={16} aria-hidden="true" />Weekly team output</h2>
      <span className="studio-work-week">Week {game.week}</span>
    </header>
    {game.week > 0 && <div className="studio-work-output">
      {produced.length > 0 && <ul key={game.week} className={'studio-work-chips' + (snapshot.tick ? ' has-new-week' : '')} aria-label="Points generated">
        {produced.map(role => <li key={role} data-role={role}><b>+{formatWorkPoints(last.capacity[role])}</b> {WORK_POINT_LABELS[role]}</li>)}
      </ul>}
      <span className="studio-work-matched">{available ? formatWorkPoints(granted) + ' of ' + formatWorkPoints(available) + ' points matched to work' : 'No points produced'}</span>
    </div>}
    {spotlight ? <button type="button" className="studio-work-project" onClick={() => onInspect(spotlight)}>
      <strong>{spotlight.title}</strong>
      <span>{spotlight.status === 'complete' ? 'Complete' : progress + '%'}</span>
      {spotlight.status === 'waiting' && <span>Waiting</span>}
      {spotlight.status === 'blocked' && <span className="studio-work-blocked">Blocked{spotlight.bottleneck && ' · ' + spotlight.bottleneck}</span>}
      <ChevronRight size={15} aria-hidden="true" />
    </button> : <p className="studio-work-note">{empty}</p>}
  </section>;
}


/** A short sample from the team that just worked. The persistent strip above
 * the room shows the complete week's production, including all secondary roles. */
export function StudioDeskContribution({ game }: { game: GameState }) {
  const [openingWeek] = useState(game.week);
  const last = game.slices.company.lastStaff[game.playerCompanyId];
  if (game.week <= openingWeek || !last?.founderOutput || !STAFF_ROLES.some(role => last.capacity[role] > 0)) return null;
  const founder = last.founderOutput;
  const focus = STAFF_ROLES.reduce((best, role) => founder[role] > founder[best] ? role : best);
  const hasFounder = founder[focus] > 0;
  const ready = Object.values(game.slices.company.staff)
    .filter(member => member.companyId === game.playerCompanyId && member.readyWeek <= game.week)
    .sort((a, b) => a.id.localeCompare(b.id));
  const count = ready.length + Number(hasFounder);
  if (!count) return null;
  const index = (game.week - 1) % count;
  const employee = ready[index - Number(hasFounder)];
  const role = employee?.role ?? focus;
  const career = employee?.career;
  const settledExperience = career && career.earnedWeek === game.week ? career.experience - career.lastEarned : career?.experience;
  const amount = employee ? careerOutput(employee, settledExperience)[role] : founder[focus];
  const name = employee ? CONTENT.staff.find(item => item.id === role)!.name : 'Founder';
  const desk = employee ? role === 'ml' ? 'lab' : 'team' : 'founder';
  return <div key={game.week} className={'studio-desk-gain from-' + desk} aria-hidden="true">
    <span>{name}</span><strong>+{formatWorkPoints(amount)} {WORK_POINT_LABELS[role]}</strong>
  </div>;
}
