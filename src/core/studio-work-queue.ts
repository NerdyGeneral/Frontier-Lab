import type { GameState } from '../contracts/types';
import type { StudioProject } from './studio';

const stageJobIds = (commandIds: string[]) => new Set(commandIds.flatMap(id => [
  'preparation-' + id, 'training-' + id, 'evaluation-' + id,
]));

/** A delegated plan owns its stage jobs until it ends. Cancelled plans keep
 * their history, but unfinished paid jobs return to the ordinary work queue
 * so the player can resume them independently. Archiving must not hide work.
 */
export function getStudioWorkQueue(game: GameState, projects: StudioProject[]) {
  const planStageJobs: Record<string, StudioProject[]> = {};
  const grouped = new Set<string>();
  const blockedPlanIds = new Set<string>();
  const plans = Object.values(game.slices.models.developmentPlans ?? {})
    .filter(plan => plan.companyId === game.playerCompanyId);
  for (const plan of plans) {
    const ids = stageJobIds(plan.steps.map(step => step.commandId));
    const jobs = projects.filter(project => ids.has(project.id));
    planStageJobs[plan.id] = jobs;
    if (plan.status !== 'cancelled' && plan.status !== 'review' && jobs.some(project => project.status === 'blocked')) blockedPlanIds.add(plan.id);
    for (const project of jobs) {
      if (plan.status !== 'cancelled' || project.status === 'complete') grouped.add(project.id);
    }
  }
  for (const plan of Object.values(game.slices.models.developmentPlanArchive ?? {})) {
    if (plan.companyId !== game.playerCompanyId) continue;
    const ids = stageJobIds(plan.stageCommandIds);
    for (const project of projects) {
      if (ids.has(project.id) && project.status === 'complete') grouped.add(project.id);
    }
  }
  return { individualProjects: projects.filter(project => !grouped.has(project.id)), planStageJobs, blockedPlanIds };
}
