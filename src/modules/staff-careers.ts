import { RESOURCE_SCALE } from '../contracts/types';
import type { CompanySlice, ResourceFrame, StaffMember, StaffRole, StaffSpecialty } from '../contracts/types';
import { checkedAdd, mulDiv } from '../core/math';
import { getStaffPointProfile, STAFF_POINT_PROFILES, WORK_POINT_LABELS, WORK_POINTS_PER_UNIT } from './workforce-points';

const POINT = RESOURCE_SCALE / WORK_POINTS_PER_UNIT;
const roles = Object.keys(WORK_POINT_LABELS) as StaffRole[];
export const CAREER_RANKS = [
  { name: 'Associate', threshold: 0, primaryBonus: 0, salaryPercent: 100 },
  { name: 'Senior', threshold: 120 * POINT, primaryBonus: 2, salaryPercent: 102 },
  { name: 'Veteran', threshold: 360 * POINT, primaryBonus: 4, salaryPercent: 105 },
] as const;
export const SPECIALTY_BONUS = 6;
const maxBasePoints = Math.max(...Object.values(STAFF_POINT_PROFILES).map(profile => Object.values(profile).reduce((a, b) => a + b, 0)));
export const MAX_WEEKLY_EXPERIENCE = (maxBasePoints + CAREER_RANKS[2].primaryBonus + SPECIALTY_BONUS) * POINT;
type Path = { name: string; role: StaffRole };
export const STAFF_CAREER_PATHS: Record<StaffRole, Record<StaffSpecialty, Path>> = {
  research: { depth: { name: 'Methods lead', role: 'research' }, breadth: { name: 'Evaluation designer', role: 'ml' } },
  ml: { depth: { name: 'Model architect', role: 'ml' }, breadth: { name: 'Training scientist', role: 'research' } },
  data: { depth: { name: 'Data curator', role: 'data' }, breadth: { name: 'Pipeline engineer', role: 'infrastructure' } },
  infrastructure: { depth: { name: 'Reliability lead', role: 'infrastructure' }, breadth: { name: 'Performance engineer', role: 'ml' } },
  commercial: { depth: { name: 'Account director', role: 'commercial' }, breadth: { name: 'Solutions engineer', role: 'infrastructure' } },
  hardware: { depth: { name: 'Silicon architect', role: 'hardware' }, breadth: { name: 'Systems engineer', role: 'infrastructure' } },
};

const givenNames = ['Alex', 'Amara', 'Anika', 'Ari', 'Casey', 'Elena', 'Emery', 'Eva', 'Iris', 'Jamie', 'Jordan', 'Kai', 'Lee', 'Leila', 'Luca', 'Maya', 'Noah', 'Noor', 'Owen', 'Remy', 'Robin', 'Sam', 'Sasha', 'Taylor'];
const familyNames = ['Bennett', 'Brooks', 'Chen', 'Cruz', 'Ellis', 'Fernandez', 'Flores', 'Hall', 'Hassan', 'Hayes', 'Huang', 'Ito', 'Jensen', 'Kim', 'Lin', 'Malik', 'Meyer', 'Morgan', 'Nair', 'Park', 'Patel', 'Reyes', 'Shah', 'Silva', 'Singh', 'Tan', 'Tran', 'Walker', 'Wells', 'Yu', 'Zhou'];
/** The same employee keeps their display name when the roster changes or reloads. */
export function staffDisplayName(member: StaffMember) {
  let hash = 2166136261;
  for (let i = 0; i < member.id.length; i++) hash = Math.imul(hash ^ member.id.charCodeAt(i), 16777619) >>> 0;
  return givenNames[hash % givenNames.length] + ' ' + familyNames[Math.floor(hash / givenNames.length) % familyNames.length];
}

export function careerLevel(experience = 0) {
  return experience >= CAREER_RANKS[2].threshold ? 2 : experience >= CAREER_RANKS[1].threshold ? 1 : 0;
}
export function canChooseStaffSpecialty(member: StaffMember) {
  return careerLevel(member.career?.experience) >= 1 && !member.career?.specialty;
}
export function careerSalary(member: StaffMember, baseCents: number) {
  return member.career ? mulDiv(baseCents, CAREER_RANKS[careerLevel(member.career.experience)].salaryPercent, 100, 'nearest') : baseCents;
}
export function careerOutput(member: StaffMember, experience = member.career?.experience) {
  const output = getStaffPointProfile(member.role);
  output[member.role] += CAREER_RANKS[careerLevel(experience)].primaryBonus * POINT;
  if (member.career?.specialty) output[STAFF_CAREER_PATHS[member.role][member.career.specialty].role] += SPECIALTY_BONUS * POINT;
  return output;
}

/** Staff points fill each reservation before founder points. Credit only the
 * part that contributed, including actual compute when staff supervise a job.
 * Split each category across its contributors in proportion to their output. */
export function settleStaffCareers(company: CompanySlice, companyId: string, week: number, frame: Readonly<ResourceFrame>) {
  const promoted: StaffMember[] = [];
  if (!company.passiveWorkforce) return promoted;
  const members = Object.values(company.staff).filter(member => member.companyId === companyId && member.readyWeek <= week)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!members.length) return promoted;
  const outputs = members.map(member => careerOutput(member));
  const experience = members.map(() => 0);
  const requests = new Map(frame.requests.filter(r => r.companyId === companyId).map(r => [r.id, r]));
  const compute = new Map(frame.computeGrants.map(g => [g.requestId, g.hardwareEffectiveCUw]));
  for (const role of roles) {
    const capacity = outputs.reduce((sum, profile) => checkedAdd(sum, profile[role]), 0);
    if (!capacity) continue;
    let remaining = capacity, used = 0;
    for (const reservation of frame.staffGrants) {
      const request = requests.get(reservation.requestId);
      if (!request) continue;
      const grant = reservation.grants.find(g => g.role === role);
      if (!grant) continue;
      const reserved = Math.min(remaining, grant.staffWeeks);
      const supervision = request.supervision;
      const worked = supervision?.role === role
        ? Math.min(reserved, mulDiv(compute.get(request.id) ?? 0, RESOURCE_SCALE, supervision.workPerStaffWeek, 'ceil'))
        : reserved;
      used += worked;
      remaining -= reserved;
      if (!remaining) break;
    }
    if (!used) continue;
    // Cumulative integer shares conserve even the final fractional work unit.
    let cumulative = 0, attributed = 0;
    outputs.forEach((output, index) => {
      cumulative += output[role];
      const share = mulDiv(used, cumulative, capacity);
      experience[index] += share - attributed;
      attributed = share;
    });
  }
  members.forEach((member, index) => {
    const earned = experience[index];
    if (!earned || member.career?.earnedWeek === week) return;
    const before = member.career?.experience ?? 0;
    member.career = { ...member.career, experience: checkedAdd(before, earned), lastEarned: earned, earnedWeek: week };
    if (careerLevel(member.career.experience) > careerLevel(before)) promoted.push(member);
  });
  return promoted;
}
