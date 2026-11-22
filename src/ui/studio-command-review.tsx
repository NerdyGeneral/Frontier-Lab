'use client';

import { CONTENT } from '../content/catalog';
import { TRAINING_WORKSPACES } from '../content/model-designs';
import { EVALUATION_SUITES, TRAINING_PROFILES, TRAINING_RECIPES } from '../content/wave2-lab';
import type { CommandPayload, GameState } from '../contracts/types';
import { getUiCommandPreview } from './command-preview';
import { commandLabel, Metric, Quote } from './components';
import { formatMoney, formatUnits } from '../core/math';
import { modelScoreHighlights } from '../core/model-score-highlights';
import { getTrainingDevelopment } from '../modules/model-development';
import { isCapabilitySuite } from '../modules/evaluation-classification';
import { getStudioManagementReview } from './studio-management-review';
import { StudioDecisionLayout } from './studio-decision-layout';
import { getStudioCommandReviewReason } from './studio-command-flow';
import { RESOURCE_SCALE } from '../contracts/types';
import { staffDisplayName, careerOutput, careerSalary, STAFF_CAREER_PATHS } from '../modules/staff-careers';
import { formatWorkPoints, getEmployeeWorkOutput, getStaffPotentialOutput, WORK_POINT_LABELS } from '../modules/workforce-points';

export interface StudioCommandReviewProps {
  game: GameState;
  payload: CommandPayload;
  label: string;
  stale: boolean;
  onRefresh: () => void;
  canRefresh: boolean;
  busy: boolean;
  reportId?: string;
  showTitle?: boolean;
  concise?: boolean;
}

/** A display of the captured commitment against current authoritative state.
 * The parent owns review identity, queueing, acknowledgement and form drafts. */
export function StudioCommandReview({ game, payload, label, stale, onRefresh, canRefresh, busy, reportId, showTitle = true, concise = false }: StudioCommandReviewProps) {
  const preview = getUiCommandPreview(game, payload, CONTENT);
  const modelName = (id: string) => {
    const model = game.slices.models.versions[id];
    return model?.companyId === game.playerCompanyId ? model.name : `Unavailable model (${id})`;
  };
  const dataName = (id: string) => {
    const packet = game.slices.data.packets[id];
    return packet && (packet.companyId === game.playerCompanyId || (!packet.companyId && id === CONTENT.starterData.id))
      ? packet.name : `Unavailable dataset (${id})`;
  };
  const summary: { label: string; value: string }[] = [];
  let managementNotes: string[] = [];
  if (payload.kind === 'prepare_data') {
    summary.push({ label: 'Dataset', value: dataName(payload.packetId) });
  } else if (payload.kind === 'start_training') {
    const recipeId = payload.recipeId ?? CONTENT.firstTraining.id;
    const recipe = TRAINING_RECIPES.find(item => item.id === recipeId);
    summary.push({ label: recipe?.kind === 'foundation' ? 'Reference model' : 'Base model', value: modelName(payload.baseModelId) },
      { label: 'Training method', value: recipe?.name ?? `Unavailable method (${recipeId})` },
      { label: 'Primary dataset', value: dataName(payload.packetId) });
    const additional = [...new Set(payload.packetIds ?? [])].filter(id => id !== payload.packetId);
    if (additional.length) summary.push({ label: 'Additional primary data', value: additional.map(dataName).join(', ') });
    if (preview.accepted) {
      const development = getTrainingDevelopment(game, payload);
      if (development.forecastUsable) {
        const highlights = modelScoreHighlights(development.rows);
        if (highlights.gain) summary.push({ label: recipe?.kind === 'foundation' ? 'Projected advantage over reference' : 'Projected improvement', value: highlights.gain });
        if (highlights.loss) summary.push({ label: recipe?.kind === 'foundation' ? 'Projected weakness against reference' : 'Projected tradeoff', value: highlights.loss });
        if (!highlights.gain && !highlights.loss) managementNotes.push(development.explanation);
      }
    }
    if (payload.modelDesign) {
      const design = payload.modelDesign;
      summary.push({ label: 'Custom model', value: design.name }, { label: 'Architecture', value: `${design.family} · ${design.parameterMillions / 1000}B parameters · ${design.sparsityBps / 100}% sparse` },
        { label: 'Compute budget', value: `${formatUnits(design.computeBudgetCUw)} CUw` }, { label: 'Training balance', value: Object.entries(design.dataMix).filter(([, weight]) => weight > 0).map(([skill, weight]) => `${skill === 'longContext' ? 'Long context' : skill} ${weight}`).join(' · ') });
      managementNotes.push('These weights set the relative training balance. Your prepared data and the paid compute determine the earned results; existing models do not change.');
    }
    if (payload.teacherModelId) summary.push({ label: 'Teacher model', value: modelName(payload.teacherModelId) });
    if (payload.teacherDomain) summary.push({ label: 'Transfer domain', value: payload.teacherDomain });
    if (payload.workspace) summary.push({ label: 'Training workspace', value: TRAINING_WORKSPACES[payload.workspace].name + ' · ' + TRAINING_WORKSPACES[payload.workspace].detail });
    if (payload.profile) summary.push({ label: 'Training profile', value: TRAINING_PROFILES[payload.profile].name });
    if (payload.architecture) summary.push({ label: 'Architecture', value: payload.architecture === 'sparse' ? 'Sparse' : 'Dense' });
    if (payload.asAdapter) summary.push({ label: 'Training type', value: 'Adapter for the selected base model' });
    if (payload.automatedCheckpoints) summary.push({ label: 'Checkpoints', value: 'Automated checkpoints enabled' });
    if (payload.replay) summary.push({ label: 'Skill retention', value: `Replay for ${payload.replay.domain}` });
    if (payload.curriculum) summary.push({ label: 'Skill retention', value: payload.curriculum.tracks.map(track => track.domain).join(' and ') });
  } else if (payload.kind === 'evaluate_model') {
    const suiteId = payload.suiteId ?? 'basic-conversation-1';
    summary.push({ label: 'Candidate', value: modelName(payload.modelId) },
      { label: 'Evaluation suite', value: EVALUATION_SUITES.find(item => item.id === suiteId)?.name ?? `Unavailable suite (${suiteId})` });
  } else if (payload.kind === 'deploy_product') {
    const model = game.slices.models.versions[payload.modelId];
    const reports = Object.values(game.slices.models.reports).filter(report => report.companyId === game.playerCompanyId && report.modelId === payload.modelId && isCapabilitySuite(report.suiteId));
    const report = reportId ? reports.find(report => report.id === reportId) : reports.find(report => report.basicChatEligible) ?? reports[0];
    const suite = report ? EVALUATION_SUITES.find(suite => suite.id === (report.suiteId ?? 'basic-conversation-1')) : undefined;
    summary.push({ label: 'Candidate', value: modelName(payload.modelId) },
      { label: 'Product', value: payload.productKind === 'developer-api' ? 'Developer API' : payload.productKind === 'business-docs' ? 'Business Documents' : 'Basic Chat' },
      { label: payload.productKind === 'developer-api' ? 'Reference bill / 600 requests' : 'Price / account / week', value: formatMoney(payload.priceCents) },
      { label: payload.productKind === 'developer-api' ? 'Request limit / account / week' : 'Included exchanges', value: payload.allowance.toLocaleString() },
      { label: 'Test results', value: report ? `${suite?.name ?? 'Capability evaluation'} · Week ${report.week} · ${report.id}` : 'These test results are no longer available.' },
      { label: 'Launch work', value: `${formatWorkPoints(CONTENT.firstSale.deploymentStaff)} Design points` });
    if (model?.companyId === game.playerCompanyId) summary.push({ label: 'Model memory', value: `${formatUnits(model.residentMU)} MU on compatible, connected hardware` });
    if (payload.features) summary.push({ label: 'Features', value: `Memory ${payload.features.memory ? 'on' : 'off'} · Extended context ${payload.features.extendedContext ? 'on' : 'off'} · Deep reasoning ${payload.features.deepReasoning ? 'on' : 'off'}` });
    if (payload.productKind === 'developer-api') managementNotes.push('This sample bill sets your input and output token prices. Customers pay for tokens you process; reasoning tokens use the output price. You earn nothing from requests you cannot serve.');
  } else if (payload.kind === 'hire_staff') {
    const role = CONTENT.staff.find(item => item.id === payload.role);
    if (role) summary.push({ label: 'Role', value: role.name },
      { label: 'Recruitment', value: formatMoney(role.recruitmentCents) },
      { label: 'Weekly pay', value: formatMoney(role.weeklyCents) + ' / week from Week ' + (game.week + 1) },
      { label: 'Onboarding', value: role.onboardingWeeks + ' weeks; ready in Week ' + (game.week + 1 + role.onboardingWeeks) },
      { label: 'Weekly output after onboarding', value: Object.entries(getStaffPotentialOutput(role.id)).filter(([, amount]) => amount > 0).map(([id, amount]) => `${formatWorkPoints(amount)} ${WORK_POINT_LABELS[id as typeof role.id]}`).join(' · ') + ' points / week' });
  } else if (payload.kind === 'specialize_staff') {
    const member = game.slices.company.staff[payload.staffId];
    if (member?.companyId === game.playerCompanyId) {
      const path = STAFF_CAREER_PATHS[member.role][payload.specialty];
      const definition = CONTENT.staff.find(item => item.id === member.role)!;
      const current = careerOutput(member)[path.role];
      const planned = member.career ? careerOutput({ ...member, career: { ...member.career, specialty: payload.specialty } })[path.role] : current;
      summary.push({ label: 'Employee', value: staffDisplayName(member) + ' · ' + definition.name }, { label: 'Permanent specialty', value: path.name },
        { label: WORK_POINT_LABELS[path.role] + ' points per week', value: formatWorkPoints(current) + ' → ' + formatWorkPoints(planned) },
        { label: 'Weekly pay', value: formatMoney(careerSalary(member, definition.weeklyCents)) });
    }
  } else if (payload.kind === 'set_staff_allocation') {
    const member = game.slices.company.staff[payload.staffId];
    const own = member?.companyId === game.playerCompanyId ? member : null;
    const role = own ? CONTENT.staff.find(item => item.id === own.role) : null;
    // Match the staff cards' full player roster order and global employee number.
    const employeeNumber = own ? Object.values(game.slices.company.staff).filter(item => item.companyId === game.playerCompanyId)
      .sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id)).findIndex(item => item.id === own.id) + 1 : null;
    summary.push({ label: 'Employee', value: own && role ? `${role.name} ${employeeNumber}` : 'Unavailable employee' },
      { label: 'Output setting: now → planned', value: `${own ? own.assignedFte / RESOURCE_SCALE * 100 + '%' : 'Unavailable'} → ${payload.fte / RESOURCE_SCALE * 100}%` });
    if (own) {
      summary.push({ label: 'Readiness', value: own.readyWeek <= game.week ? 'Ready' : 'Onboarding until Week ' + own.readyWeek });
      if (Number.isSafeInteger(payload.fte) && payload.fte >= 0 && payload.fte <= RESOURCE_SCALE) {
        const current = getEmployeeWorkOutput(own, game.week), planned = getEmployeeWorkOutput({ ...own, assignedFte: payload.fte }, game.week + 1);
        for (const role of CONTENT.staff) if (current[role.id] || planned[role.id]) summary.push({ label: WORK_POINT_LABELS[role.id] + ' points: this week → Week ' + (game.week + 1), value: formatWorkPoints(current[role.id]) + ' → ' + formatWorkPoints(planned[role.id]) });
        if (own.readyWeek > game.week + 1) summary.push({ label: 'Weekly output from Week ' + own.readyWeek, value: Object.entries(getStaffPotentialOutput(own.role, payload.fte)).filter(([, amount]) => amount > 0).map(([id, amount]) => `${formatWorkPoints(amount)} ${WORK_POINT_LABELS[id as typeof own.role]}`).join(' · ') + ' points / week' });
      }
      if (own.readyWeek > game.week) summary.push({ label: 'Points available now', value: '0 during onboarding' });
    }
    if (role && own) summary.push({ label: 'Weekly pay', value: formatMoney(careerSalary(own, role.weeklyCents)) + ' / week, even when idle' });
  } else if (payload.kind === 'assign_founder') {
    const current = game.slices.company.founderAssignments[game.playerCompanyId];
    for (const role of CONTENT.staff) {
      if (current[role.id] || payload.allocations[role.id]) summary.push({ label: WORK_POINT_LABELS[role.id] + ' points / week: now → planned',
        value: formatWorkPoints(current[role.id]) + ' → ' + formatWorkPoints(payload.allocations[role.id]) });
    }
    summary.push({ label: 'Founder point budget', value: formatWorkPoints(game.slices.company.companies[game.playerCompanyId].founderFte) + ' points / week across all areas' });
  } else {
    const management = getStudioManagementReview(game, payload);
    summary.push(...management.facts);
    managementNotes = management.notes;
    if (!summary.length) summary.push({ label: 'Decision', value: commandLabel(payload) });
  }

  const research = payload.kind === 'start_research' ? CONTENT.research.find(item => item.id === payload.researchId) : undefined;
  // Only this repeated explanation moves into help. Authored benefits and every
  // other management note stay visible, including financial and license terms.
  const applicationExplanation = 'Once researched, this discovery becomes available to use. Building its upgrades or training models costs extra work points and compute.';
  const researchHelp: string[] = research ? managementNotes.filter(note => note === applicationExplanation) : [];
  const visibleNotes = managementNotes.filter(note => note !== research?.description && !researchHelp.includes(note));
  const displayPreview = research && preview.accepted ? { ...preview,
    summary: 'Complete both the work points and compute work listed above. This discovery unlocks the following week.',
  } : preview;
  const staleNotice = stale && <div className="studio-review-note" role="status">
    <p>Your lab has changed. Check the updated costs below, then refresh this review to continue. Your choices are still here.</p>
    <button type="button" onClick={onRefresh} disabled={!canRefresh || busy}>Refresh review</button>
  </div>;

  if (concise) return <section className="studio-task-review studio-task-review-concise" aria-label="Review your choice" aria-busy={busy}>
    {showTitle && <h3>{label.trim() || commandLabel(payload)}</h3>}
    {staleNotice}
    <p className="studio-command-consequence">{getStudioCommandReviewReason(payload)}</p>
    <dl className="metrics studio-task-summary">{summary.map((item, index) => <Metric key={`${item.label}:${index}`} label={item.label}>{item.value}</Metric>)}</dl>
    <Quote preview={displayPreview} />
    <p className="small-note">Scheduled for Week {game.week + 1}. Your lab stays paused until you advance or resume.</p>
  </section>;

  return <section className="studio-task-review" aria-label="Review your choice" aria-busy={busy}>
    {showTitle && <h3>{label.trim() || commandLabel(payload)}</h3>}
    {staleNotice}
    <StudioDecisionLayout focused className="studio-review-layout" summary={<>
    <section className="studio-review-costs" aria-label="Cost and requirements">
      <p className="small-heading">Cost and requirements</p>
      <p className="studio-review-cash">Cash balance now: <strong>{formatMoney(game.slices.company.companies[game.playerCompanyId].cashCents)}</strong></p>
      {payload.kind === 'start_training' && preview.accepted && preview.upfrontCostCents === 0 && <p className="small-note">Training fee <strong>{formatMoney(0)}</strong></p>}
      <Quote preview={displayPreview} />
    </section>
    <section className="studio-review-next" aria-label="What happens next">
      <p className="small-heading">What happens next</p>
      <p className="small-note"><strong>Scheduled for Week {game.week + 1} when you confirm.</strong> Resume the game or advance one week to apply it.</p>
      {visibleNotes.map(note => <p className="small-note" key={note}>{note}</p>)}
      {payload.kind === 'start_training' && <p className="small-note">Follow the run in Projects. When it finishes, open the new version to compare its scores, test it or continue training.</p>}
      {payload.kind === 'evaluate_model' && <p className="small-note">This test measures the selected model without training it. Other products may need different tests before launch.</p>}
      {payload.kind === 'deploy_product' && <p className="small-note">Finish launch work before opening to customers. Free trials and paid chats share compute, and conversations need memory in addition to the model. Your first sale counts when a customer pays for use.</p>}
      {payload.kind === 'hire_staff' && <p className="small-note">Pay starts when the hire takes effect. After onboarding, this employee automatically contributes their weekly points to active work. Projects also need their required compute.</p>}
      {(payload.kind === 'set_staff_allocation' || payload.kind === 'assign_founder') && <p className="small-note">This changes weekly point output. Projects share the team’s points automatically, with live operations taking priority. Unallocated points do not carry into the next week.</p>}
    </section>
    </>}>
    <section className="studio-review-choice" aria-label="Your choice">
      <p className="small-heading">Your choice</p>
      <dl className="metrics studio-task-summary">{summary.map((item, index) => <Metric key={`${item.label}:${index}`} label={item.label}>{item.value}</Metric>)}</dl>
      {research && <p className="small-note studio-review-benefit">{research.description}</p>}
    </section>
    <details className="studio-review-help">
      <summary>How costs and timing work</summary>
      <p className="small-note">This review accounts for your other queued choices. Wages, rent and usage charges still apply. Progress depends on available staff and compute shared with other projects, so completion estimates can change.</p>
      {researchHelp.map(note => <p className="small-note" key={note}>{note}</p>)}
    </details>
    </StudioDecisionLayout>
  </section>;
}
