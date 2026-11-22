'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { CONTENT } from '../content/catalog';
import { SYNTHETIC_RULES } from '../content/wave26-synthetic';
import type { CommandPayload, DataPacket, EvaluationReport, GameState, ModelVersion, TrainingRun } from '../contracts/types';
import type { CapabilityDomain, CorpusEvidence } from '../contracts/wave2-lab';
import type { SyntheticJobView, SyntheticView } from '../contracts/wave26-synthetic';
import { formatMoney, formatUnits } from '../core/math';
import { DOMAINS, getCorpusEvidence, getTrainingPreview, packetOwnedBy, packetSources } from '../modules/lab-planner';
import { hasCapabilityEvaluation, inheritedModelRights } from '../modules/model-runtime';
import { getSyntheticView, previewSyntheticGeneration } from '../modules/synthetic-data';
import { ActionControl, Section } from './components';
import { IndependentHoldoutDetails } from './independent-holdout-details';

const DOMAIN_NAMES: Record<CapabilityDomain, string> = {
  conversation: 'Conversation', documents: 'Documents', coding: 'Coding', tools: 'Tools',
};
const score = (value: number) => (value / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
const count = (value: number) => value.toLocaleString('en-US');
type SyntheticPanelProps = { game: GameState; canAct: boolean; onQueue: (payload: CommandPayload) => void };

const PHASE_NAMES: Record<SyntheticJobView['phase'], string> = {
  generating: 'Generating', 'awaiting-review': 'Needs paid review', reviewing: 'Data review',
  auditing: 'Independent audit', ready: 'Available next week', complete: 'Audit complete',
};

function WorkMeter({ label, completed, required, unit }: { label: string; completed: number; required: number; unit: string }) {
  return <div className="synthetic-work-meter">
    <div><span>{label}</span><strong>{(unit.endsWith('points') ? formatWorkPoints : formatUnits)(completed)} / {(unit.endsWith('points') ? formatWorkPoints : formatUnits)(required)} {unit}</strong></div>
    <progress value={Math.min(completed, required)} max={Math.max(1, required)} aria-label={label + ' progress'} />
  </div>;
}

function RightsSummary({ rights, includeFeedback = true }: { rights: DataPacket['rights']; includeFeedback?: boolean }) {
  return <dl className="synthetic-rights">
    <div><dt>Hosted use</dt><dd><Permission allowed={rights.hosted} /></dd></div>
    <div><dt>Weight transfer</dt><dd><Permission allowed={rights.weights} /></dd></div>
    {includeFeedback && <div><dt>Feedback reuse</dt><dd><Permission allowed={rights.feedback} /></dd></div>}
  </dl>;
}

function StageHeading({ step, title, detail }: { step: number; title: string; detail: string }) {
  return <div className="synthetic-stage-heading"><span className="synthetic-step-number" aria-hidden="true">0{step}</span><div><h3>{title}</h3><p>{detail}</p></div></div>;
}

function SyntheticGeneration({ game, canAct, onQueue, view }: SyntheticPanelProps & { view: SyntheticView }) {
  const [domain, setDomain] = useState<CapabilityDomain>('conversation');
  const [teacherId, setTeacherId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const teacher = view.teachers.find(item => item.id === teacherId)
    ?? view.teachers.find(item => item.eligibleDomains.includes(domain)) ?? view.teachers[0];
  const source = view.sources.find(item => item.id === sourceId) ?? view.sources.find(item => item.eligible) ?? view.sources[0];
  const options = teacher && source ? { teacherModelId: teacher.id, sourcePacketId: source.id, domain } : null;
  const preview = options ? previewSyntheticGeneration(game, options, CONTENT) : null;
  return <div className="synthetic-stage">
    <StageHeading step={1} title="Generate new training cases" detail="Choose a qualified teacher model, licensed source data, and a skill to focus on." />
    {view.generationGate && <p className="synthetic-gate">{view.generationGate} <a href="#research">Open research</a>.</p>}
    <div className="synthetic-generation-layout">
      <div className="synthetic-form-fields">
        <label className="synthetic-field" htmlFor="synthetic-domain"><span>Target skill</span>
          <select id="synthetic-domain" value={domain} onChange={event => setDomain(event.target.value as CapabilityDomain)} disabled={!canAct}>
            {DOMAINS.map(item => <option key={item} value={item}>{DOMAIN_NAMES[item]}</option>)}
          </select>
        </label>
        <label className="synthetic-field" htmlFor="synthetic-teacher"><span>Teacher model</span>
          <select id="synthetic-teacher" value={teacher?.id ?? ''} onChange={event => setTeacherId(event.target.value)} disabled={!canAct || !view.teachers.length} aria-describedby="synthetic-teacher-note">
            {!view.teachers.length && <option value="">No owned models</option>}
            {view.teachers.map(item => <option key={item.id} value={item.id}>{item.name}{item.eligibleDomains.includes(domain) ? '' : ' · unavailable for this skill'}</option>)}
          </select>
        </label>
        <p className="synthetic-note" id="synthetic-teacher-note">{teacher?.reason ?? (teacher && !teacher.eligibleDomains.includes(domain) ? `${DOMAIN_NAMES[domain]} needs a teacher score of at least ${score(SYNTHETIC_RULES.minimumTeacherScoreBps)} / 100.` : teacher ? `${DOMAIN_NAMES[domain]} ${score(teacher.capabilityBps[domain])} / 100 · reliability ${score(teacher.reliabilityBps)} / 100 · ${formatUnits(teacher.residentMU)} MU resident memory · paid capability evaluation recorded.` : 'Train and pay for a capability evaluation to qualify a teacher.')} <a href="#models">View models</a>.</p>
        <label className="synthetic-field" htmlFor="synthetic-source"><span>Licensed source data</span>
          <select id="synthetic-source" value={source?.id ?? ''} onChange={event => setSourceId(event.target.value)} disabled={!canAct || !view.sources.length} aria-describedby="synthetic-source-note">
            {!view.sources.length && <option value="">No owned sources</option>}
            {view.sources.map(item => <option key={item.id} value={item.id}>{item.name}{item.eligible ? '' : ' · unavailable'}</option>)}
          </select>
        </label>
        <p className="synthetic-note" id="synthetic-source-note">{source?.reason ?? (source ? `${count(source.readyUnits)} prepared units · ${score(source.qualityBps)}% quality · ${source.sourceIds.length} source identit${source.sourceIds.length === 1 ? 'y' : 'ies'}.` : 'Acquire and prepare licensed training data.')} <a href="#data">View data</a>.</p>
      </div>
      <div className="synthetic-order-summary">
        <span className="synthetic-eyebrow">Batch size</span>
        <strong className="synthetic-batch-count">{preview?.candidateUnits ?? SYNTHETIC_RULES.candidateUnits}<small>candidate cases</small></strong>
        <dl className="synthetic-facts">
          <div><dt>Generation fee</dt><dd>{formatMoney(view.costs.generationFeeCents)}</dd></div>
          <div><dt>Development work</dt><dd>{preview ? formatUnits(preview.requiredWork) + ' CUw' : 'Select teacher'}</dd></div>
          <div><dt>GPU workspace</dt><dd>{preview ? formatUnits(preview.memoryMU) + ' MU' : 'Select teacher'}</dd></div>
          <div><dt>Later review fee</dt><dd>{formatMoney(view.costs.reviewFeeCents)}</dd></div>
        </dl>
        {preview?.rights && <RightsSummary rights={preview.rights} />}
        <p className="synthetic-note">Generation uses ML staff and development GPUs. Pay for review and an audit before using the new cases for training.</p>
      </div>
    </div>
    <ActionControl game={game} payload={options ? { kind: 'start_synthetic_generation', ...options } : null} label="Generate training cases" canAct={canAct} onQueue={onQueue} emptyReason="Choose one of your teacher models and licensed source data to see the cost." />
    <details className="synthetic-details"><summary>Teacher and data requirements</summary>
      <p className="synthetic-note">The teacher needs a paid capability evaluation, weight-transfer rights, a score in the target skill of at least {score(SYNTHETIC_RULES.minimumTeacherScoreBps)} / 100 and reliability of at least {score(SYNTHETIC_RULES.minimumTeacherReliabilityBps)} / 100. Neither it nor its earlier models may have used synthetic training. The licensed source needs at least {SYNTHETIC_RULES.minimumSourceUnits} prepared units at {score(SYNTHETIC_RULES.minimumSourceQualityBps)}% quality. You cannot use reserved test cases, policy cases, or audit cases as source data.</p>
      <p className="synthetic-note">Each original source can produce one batch per target skill. Curating it again or choosing another teacher does not reset that limit. The finished data keeps its teacher’s history and must follow both the source and teacher licenses.</p>
    </details>
  </div>;
}

function SyntheticJobCard({ job, game, canAct, onQueue }: SyntheticPanelProps & { job: SyntheticJobView }) {
  const active = ['generating', 'reviewing', 'auditing'].includes(job.phase);
  const audit = job.audit;
  return <article className="synthetic-job-card">
    <div className="synthetic-card-heading"><div><h4>{DOMAIN_NAMES[job.domain]} · {job.teacherName}</h4><p>{job.sourceName}</p></div>
      <span className={'synthetic-status ' + (job.phase === 'complete' ? 'is-complete' : '')}>{job.paused ? 'Paused' : PHASE_NAMES[job.phase]}</span>
    </div>
    {active && <><progress className="synthetic-overall-progress" value={job.progressBps} max={10000} aria-label={DOMAIN_NAMES[job.domain] + ' synthetic batch overall progress'} />
      {job.lastBottleneck && <p className="synthetic-bottleneck">{job.lastBottleneck}</p>}
      <ActionControl game={game} payload={{ kind: 'set_synthetic_job_paused', jobId: job.id, paused: !job.paused }} label={job.paused ? 'Resume synthetic work' : 'Pause synthetic work'} canAct={canAct} onQueue={onQueue} compact />
    </>}
    {job.phase === 'awaiting-review' && <>
      <p className="synthetic-note">Generation is finished. Data review checks the {job.candidateUnits} candidates, then a separate audit measures overlap and answer quality.</p>
      <ActionControl game={game} payload={{ kind: 'start_synthetic_review', jobId: job.id }} label="Review and audit cases" canAct={canAct} onQueue={onQueue} />
    </>}
    {job.phase === 'ready' && <p className="synthetic-gate">Reviewed data becomes available in Week {job.availableWeek ?? game.week + 1}.</p>}
    {audit && <div className="synthetic-audit-results">
      <span className="synthetic-eyebrow">Audit results · {job.candidateUnits} candidates</span>
      <dl className="synthetic-audit-counts">
        <div className="is-accepted"><dt>Usable new cases</dt><dd>{audit.acceptedUnits}</dd></div>
        <div><dt>Source overlap</dt><dd>{audit.sourceOverlapUnits}</dd></div>
        <div><dt>Holdout overlap</dt><dd>{audit.holdoutOverlapUnits}</dd></div>
        <div><dt>Rejected answers</dt><dd>{audit.qualityRejectedUnits}</dd></div>
      </dl>
      <p className="synthetic-note">{audit.sourceOverlapUnits + audit.holdoutOverlapUnits} overlapping cases removed from training · {score(audit.qualityBps)}% quality for the usable data. Only the {audit.acceptedUnits} accepted new cases can be used for training.</p>
      <RightsSummary rights={job.rights} />
    </div>}
    <details className="synthetic-details"><summary>Work, costs, and source history</summary>
      <WorkMeter label="Teacher generation" completed={job.generation.completedWork} required={job.generation.requiredWork} unit="CUw" />
      <p className="synthetic-note">GPU work used for generation: {formatUnits(job.generation.physicalWork)} CUw · ML staff work completed: {formatWorkPoints(job.generationStaffGranted)} points.</p>
      <WorkMeter label="Data review" completed={job.review.completedStaff} required={job.review.requiredStaff} unit="points" />
      <WorkMeter label="Audit development work" completed={job.auditCompute.completedWork} required={job.auditCompute.requiredWork} unit="CUw" />
      <WorkMeter label="Research audit" completed={job.auditStaff.completedStaff} required={job.auditStaff.requiredStaff} unit="points" />
      <dl className="synthetic-facts">
        <div><dt>Fees paid</dt><dd>{formatMoney(job.generationFeeCents + (job.reviewStartedWeek !== null ? job.reviewFeeCents : 0))}</dd></div>
        <div><dt>Estimated GPU cost</dt><dd>{formatMoney(job.actualGpuTariffEstimateCents)}</dd></div>
        <div><dt>Teacher score when started</dt><dd>{score(job.teacherScoreBps)} / 100</dd></div>
        <div><dt>Generation started</dt><dd>Week {job.startedWeek}</dd></div>
      </dl>
      <p className="synthetic-note">The GPU estimate uses the price recorded for this work. Your actual GPU rental and salary bills appear in the weekly ledger. This batch keeps its progress and source licenses.</p>
      <h4>Source history</h4>
      <dl className="synthetic-provenance">
        <div><dt>Teacher version</dt><dd>{job.teacherName} · {job.teacherModelId}</dd></div>
        <div><dt>Teacher evaluation</dt><dd>{job.teacherReportId}</dd></div>
        <div><dt>Data source IDs</dt><dd>{job.sourceIds.join(', ')}</dd></div>
        <div><dt>Source fingerprint</dt><dd>{job.sourceFingerprint}</dd></div>
        {audit && <div><dt>Audit fingerprint</dt><dd>{audit.fingerprint}</dd></div>}
      </dl>
    </details>
  </article>;
}

function TargetedTraining({ game, canAct, onQueue, view, runs }: SyntheticPanelProps & { view: SyntheticView; runs: TrainingRun[] }) {
  const models = ownedModels(game).filter(model => !model.runtimeVariant && !(model.trainingRunId && game.slices.models.trainingRuns[model.trainingRunId]?.plan?.adapter));
  const [baseId, setBaseId] = useState('');
  const [packetId, setPacketId] = useState('');
  const base = models.find(model => model.id === baseId) ?? models[0];
  const packet = view.packets.find(item => item.id === packetId) ?? view.packets[view.packets.length - 1];
  const options = base && packet ? { baseModelId: base.id, packetId: packet.id, recipeId: SYNTHETIC_RULES.recipeId } : null;
  const preview = options ? getTrainingPreview(game, game.playerCompanyId, options, CONTENT) : null;
  const baseRights = base ? inheritedModelRights(game, base.id, CONTENT) : null;
  const activeRuns = runs.filter(run => run.status !== 'complete');
  return <div className="synthetic-stage">
    <StageHeading step={3} title="Train a specialist model" detail="Use the reviewed data to teach a separate student model." />
    {view.trainingGate && <p className="synthetic-gate">{view.trainingGate} <a href="#research">Open research</a>.</p>}
    <div className="synthetic-two-up">
      <label className="synthetic-field" htmlFor="synthetic-training-packet"><span>Reviewed dataset</span>
        <select id="synthetic-training-packet" value={packet?.id ?? ''} onChange={event => setPacketId(event.target.value)} disabled={!canAct || !view.packets.length}>
          {!view.packets.length && <option value="">No reviewed dataset yet</option>}
          {view.packets.map(item => <option key={item.id} value={item.id}>{item.name} · {item.acceptedUnits} accepted</option>)}
        </select>
      </label>
      <label className="synthetic-field" htmlFor="synthetic-student"><span>Student base model</span>
        <select id="synthetic-student" value={base?.id ?? ''} onChange={event => setBaseId(event.target.value)} disabled={!canAct || !models.length}>
          {!models.length && <option value="">No eligible model designs</option>}
          {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label>
    </div>
    {packet && <div className="synthetic-callout"><strong>{DOMAIN_NAMES[packet.domain]} curriculum · {packet.acceptedUnits} accepted units</strong><p>Teacher: {packet.teacherName} · quality: {score(packet.qualityBps)}%. This reviewed data determines the target skill and teacher history.</p>{baseRights && <><p>The new model must follow the licenses for both its base model and this data.</p><RightsSummary includeFeedback={false} rights={{ hosted: baseRights.hosted && packet.rights.hosted, weights: baseRights.weights && packet.rights.weights, feedback: packet.rights.feedback }} /></>}</div>}
    <dl className="synthetic-facts">
      <div><dt>Training fee</dt><dd>{formatMoney(view.costs.trainingFeeCents)}</dd></div>
      <div><dt>Development update work</dt><dd>{formatUnits(preview?.workCUw ?? view.costs.trainingWork)} CUw</dd></div>
      {preview && <div><dt>GPU workspace</dt><dd>{formatUnits(preview.memoryMU)} MU</dd></div>}
    </dl>
    <ActionControl game={game} payload={options ? { kind: 'start_training', ...options } : null} label="Start targeted training" canAct={canAct} onQueue={onQueue} emptyReason="Generate cases, then pay for review and an audit to get usable synthetic data." />
    <p className="synthetic-note">The student cannot be the teacher or a model trained from it. Training uses development GPUs and ML staff. Test the finished model afterward. <a href="#lab-projects">Open other training recipes</a> for adaptation and replay.</p>
    {activeRuns.map(run => <article className="synthetic-job-card" key={run.id}>
      <div className="synthetic-card-heading"><h4>Targeted run · {game.slices.models.versions[run.baseModelId]?.name ?? 'Student model'}</h4><span className="synthetic-status">{run.status === 'paused' ? 'Paused' : 'Training'}</span></div>
      <WorkMeter label="Targeted training" completed={run.completedWork} required={run.requiredWork} unit="CUw" />
      {run.lastBottleneck && <p className="synthetic-bottleneck">{run.lastBottleneck}</p>}
      <ActionControl game={game} payload={{ kind: 'set_job_paused', jobId: run.id, paused: run.status !== 'paused' }} label={run.status === 'paused' ? 'Resume targeted training' : 'Pause targeted training'} canAct={canAct} onQueue={onQueue} compact />
    </article>)}
  </div>;
}

function SyntheticCandidates({ game, canAct, onQueue, runs }: SyntheticPanelProps & { runs: TrainingRun[] }) {
  const completed = runs.filter(run => run.status === 'complete' && game.slices.models.versions[run.outputModelId]);
  return <div className="synthetic-stage">
    <StageHeading step={4} title="Test the finished model" detail="Pay for a capability test, then run an independent test on cases kept out of training." />
    {!completed.length && <p className="synthetic-empty">Finished specialist models appear here. Each needs its own paid independent test.</p>}
    {completed.map(run => {
      const model = game.slices.models.versions[run.outputModelId];
      const report = modelReports(game, model.id).find(item => item.holdout);
      const qualified = hasCapabilityEvaluation(game, model.id);
      const capabilityRun = Object.values(game.slices.models.evaluationRuns).find(item => item.companyId === game.playerCompanyId && item.modelId === model.id && ['expanded-capabilities-1', 'basic-conversation-1'].includes(item.suiteId ?? 'basic-conversation-1') && item.status !== 'complete');
      const evaluation = Object.values(game.slices.models.evaluationRuns).find(item => item.companyId === game.playerCompanyId && item.modelId === model.id && item.suiteId === 'independent-holdouts-1' && item.status !== 'complete');
      return <article className="synthetic-job-card" key={run.id}>
        <div className="synthetic-card-heading"><div><h4>{model.name}</h4><p>Training complete · Week {run.completedWeek ?? model.createdWeek ?? game.week}</p></div><span className={'synthetic-status ' + (report ? 'is-complete' : '')}>{report ? 'Independent report ready' : evaluation?.status === 'paused' || capabilityRun?.status === 'paused' ? 'Evaluation paused' : evaluation || capabilityRun ? 'Evaluating' : 'Needs evaluation'}</span></div>
        {!qualified && <>
          <p className="synthetic-note">Run a paid capability test on this model first. That unlocks its independent test.</p>
          {capabilityRun ? <><WorkMeter label="Capability evaluation" completed={capabilityRun.completedWork} required={capabilityRun.requiredWork} unit="CUw" />{capabilityRun.lastBottleneck && <p className="synthetic-bottleneck">{capabilityRun.lastBottleneck}</p>}<ActionControl game={game} payload={{ kind: 'set_job_paused', jobId: capabilityRun.id, paused: capabilityRun.status !== 'paused' }} label={capabilityRun.status === 'paused' ? 'Resume capability evaluation' : 'Pause capability evaluation'} canAct={canAct} onQueue={onQueue} compact /></>
            : <ActionControl game={game} payload={{ kind: 'evaluate_model', modelId: model.id, suiteId: 'expanded-capabilities-1' }} label="Run capability test" canAct={canAct} onQueue={onQueue} />}
        </>}
        {report ? <details className="synthetic-details"><summary>Independent outcome · {report.holdout!.totals.actualSuccesses} / {report.holdout!.totals.cases} actually correct</summary><IndependentHoldoutDetails report={report} /></details>
          : evaluation ? <><WorkMeter label="Independent evaluation" completed={evaluation.completedWork} required={evaluation.requiredWork} unit="CUw" /><WorkMeter label="Research evaluation" completed={evaluation.completedStaff} required={evaluation.requiredStaff} unit="points" />{evaluation.lastBottleneck && <p className="synthetic-bottleneck">{evaluation.lastBottleneck}</p>}<ActionControl game={game} payload={{ kind: 'set_job_paused', jobId: evaluation.id, paused: evaluation.status !== 'paused' }} label={evaluation.status === 'paused' ? 'Resume independent evaluation' : 'Pause independent evaluation'} canAct={canAct} onQueue={onQueue} compact /></>
            : qualified ? <><p className="synthetic-note">Capability test finished. Run the independent test to compare the checker’s approvals with the correct results.</p><ActionControl game={game} payload={{ kind: 'evaluate_model', modelId: model.id, suiteId: 'independent-holdouts-1' }} label="Run independent test" canAct={canAct} onQueue={onQueue} /></> : null}
      </article>;
    })}
    <p className="synthetic-note">Independent cases stay separate from generation, source data and training. <a href="#model-corpus-compare">Compare models and corpora</a> or <a href="#models">inspect all evaluation suites</a>.</p>
  </div>;
}

export function SyntheticDataPanel({ game, canAct, onQueue }: SyntheticPanelProps) {
  const view: SyntheticView = getSyntheticView(game, game.playerCompanyId, CONTENT);
  const runs = Object.values(game.slices.models.trainingRuns)
    .filter(run => run.companyId === game.playerCompanyId && run.recipeId === SYNTHETIC_RULES.recipeId)
    .sort((a, b) => b.startedWeek - a.startedWeek || b.id.localeCompare(a.id));
  return <Section title="Synthetic data studio" id="synthetic-data" className="synthetic-panel">
    <p className="synthetic-intro">Use a teacher model to create training data for a specific skill. Review the data, train a student, then test what it learned. Each step tracks costs, licenses, and results.</p>
    <ol className="synthetic-path" aria-label="Synthetic data workflow">
      <li><span>01</span><strong>Generate</strong><small>{formatMoney(view.costs.generationFeeCents)} + work</small></li>
      <li><span>02</span><strong>Review & audit</strong><small>{formatMoney(view.costs.reviewFeeCents)} + work</small></li>
      <li><span>03</span><strong>Targeted training</strong><small>{formatMoney(view.costs.trainingFeeCents)} + work</small></li>
      <li><span>04</span><strong>Independent test</strong><small>Paid evaluation suite</small></li>
    </ol>
    <SyntheticGeneration game={game} canAct={canAct} onQueue={onQueue} view={view} />
    <div className="synthetic-stage">
      <StageHeading step={2} title="Review and remove unusable cases" detail={`${formatWorkPoints(view.costs.reviewStaff)} Data points, then ${formatWorkPoints(view.costs.auditStaff)} Research points and ${formatUnits(view.costs.auditWork)} development CUw.`} />
      {view.jobs.length ? <div className="synthetic-job-list">{view.jobs.map(job => <SyntheticJobCard key={job.id} job={job} game={game} canAct={canAct} onQueue={onQueue} />)}</div> : <p className="synthetic-empty">Generation batches appear here. Paid review removes source overlap; a separate audit checks holdout overlap and answer quality.</p>}
    </div>
    <TargetedTraining game={game} canAct={canAct} onQueue={onQueue} view={view} runs={runs} />
    <SyntheticCandidates game={game} canAct={canAct} onQueue={onQueue} runs={runs} />
  </Section>;
}

function ownedModels(game: GameState): ModelVersion[] {
  return Object.values(game.slices.models.versions)
    .filter(model => model.companyId === game.playerCompanyId)
    .sort((a, b) => (a.createdWeek ?? 0) - (b.createdWeek ?? 0) || a.id.localeCompare(b.id));
}

function ownedPackets(game: GameState): DataPacket[] {
  return Object.values(game.slices.data.packets)
    .filter(packet => packetOwnedBy(packet, game.playerCompanyId, game.playerCompanyId));
}

function modelReports(game: GameState, modelId: string): EvaluationReport[] {
  return Object.values(game.slices.models.reports)
    .filter(report => report.companyId === game.playerCompanyId && report.modelId === modelId)
    .sort((a, b) => b.week - a.week || b.id.localeCompare(a.id));
}

function Permission({ allowed }: { allowed: boolean }) {
  return <span className={'synthetic-permission ' + (allowed ? 'is-allowed' : 'is-restricted')}>
    {allowed ? 'Permitted' : 'Restricted'}
  </span>;
}

function ComparisonTable({ caption, left, right, rows }: {
  caption: string; left: string; right: string;
  rows: { label: string; left: ReactNode; right: ReactNode }[];
}) {
  return <div className="table-scroll synthetic-comparison-scroll" tabIndex={0} role="region" aria-label={caption}>
    <table className="compact-table synthetic-comparison-table">
      <caption>{caption}</caption>
      <thead><tr><th scope="col">Measure</th><th scope="col">{left}</th><th scope="col">{right}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.left}</td><td>{row.right}</td></tr>)}</tbody>
    </table>
  </div>;
}

function ModelComparison({ game }: { game: GameState }) {
  const models = ownedModels(game);
  const [leftId, setLeftId] = useState(() => models[0]?.id ?? '');
  const [rightId, setRightId] = useState(() => models[models.length - 1]?.id ?? '');
  const left = models.find(model => model.id === leftId) ?? models[0];
  const right = models.find(model => model.id === rightId) ?? models[models.length - 1];
  if (!left || !right) return <p className="synthetic-empty">Complete a training run to compare model versions.</p>;
  const leftRights = inheritedModelRights(game, left.id, CONTENT);
  const rightRights = inheritedModelRights(game, right.id, CONTENT);
  const leftReports = modelReports(game, left.id), rightReports = modelReports(game, right.id);
  const leftHoldout = leftReports.find(report => report.holdout);
  const rightHoldout = rightReports.find(report => report.holdout);
  const holdoutCell = (report: EvaluationReport | undefined, field: 'actualSuccesses' | 'claimedCompletions' | 'independentFalseAccepts') => report?.holdout
    ? field === 'independentFalseAccepts' && !report.holdout.totals.independentAccepted ? 'No accepted cases' : `${report.holdout.totals[field]} / ${field === 'independentFalseAccepts' ? report.holdout.totals.independentAccepted : report.holdout.totals.cases}`
    : 'Not evaluated';
  return <div className="synthetic-compare-body">
    <div className="synthetic-two-up">
      <label className="synthetic-field" htmlFor="synthetic-compare-model-a"><span>Model A</span>
        <select id="synthetic-compare-model-a" value={left.id} onChange={event => setLeftId(event.target.value)}>
          {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label>
      <label className="synthetic-field" htmlFor="synthetic-compare-model-b"><span>Model B</span>
        <select id="synthetic-compare-model-b" value={right.id} onChange={event => setRightId(event.target.value)}>
          {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label>
    </div>
    {left.id === right.id && <p className="synthetic-note">The same version is selected on both sides. Choose another version to see a difference.</p>}
    <ComparisonTable caption="Version characteristics" left={left.name} right={right.name} rows={[
      { label: 'Design', left: `${left.family} · ${left.architecture}`, right: `${right.family} · ${right.architecture}` },
      { label: 'Status', left: left.status, right: right.status },
      { label: 'Resident memory', left: formatUnits(left.residentMU) + ' MU', right: formatUnits(right.residentMU) + ' MU' },
      ...DOMAINS.map(domain => ({ label: DOMAIN_NAMES[domain] + ' / 100', left: score(left.capabilityBps[domain]), right: score(right.capabilityBps[domain]) })),
      { label: 'Reliability / 100', left: score(left.reliabilityBps), right: score(right.reliabilityBps) },
      { label: 'Hosted use', left: <Permission allowed={leftRights.hosted} />, right: <Permission allowed={rightRights.hosted} /> },
      { label: 'Weight transfer', left: <Permission allowed={leftRights.weights} />, right: <Permission allowed={rightRights.weights} /> },
    ]} />
    <p className="synthetic-note">These are the model’s skill scores. Paid tests show how it performs on test cases. Comparing models does not change your live products.</p>
    <ComparisonTable caption="Independent test results · the same 100 unseen cases" left={left.name} right={right.name} rows={[
      { label: 'Latest independent report', left: leftHoldout ? `Week ${leftHoldout.week}` : 'Not evaluated', right: rightHoldout ? `Week ${rightHoldout.week}` : 'Not evaluated' },
      { label: 'Actually correct', left: holdoutCell(leftHoldout, 'actualSuccesses'), right: holdoutCell(rightHoldout, 'actualSuccesses') },
      { label: 'Claimed complete', left: holdoutCell(leftHoldout, 'claimedCompletions'), right: holdoutCell(rightHoldout, 'claimedCompletions') },
      { label: 'Incorrect among checker accepts', left: holdoutCell(leftHoldout, 'independentFalseAccepts'), right: holdoutCell(rightHoldout, 'independentFalseAccepts') },
    ]} />
    <p className="synthetic-note">Each report is for the selected model version. <a href="#models">Open evaluation</a> to run a paid test or inspect the results.</p>
  </div>;
}

function CorpusPicker({ label, id, packets, selected, onChange }: {
  label: string; id: string; packets: DataPacket[]; selected: string[]; onChange: (ids: string[]) => void;
}) {
  return <fieldset className="synthetic-corpus-picker"><legend>{label}</legend>
    <div className="synthetic-packet-list">{packets.map(packet => <label className="synthetic-packet-option" key={packet.id} htmlFor={id + '-' + packet.id}>
      <input type="checkbox" id={id + '-' + packet.id} checked={selected.includes(packet.id)} onChange={event => onChange(event.target.checked ? [...selected, packet.id] : selected.filter(value => value !== packet.id))} />
      <span><strong>{packet.name}</strong><small>{count(packet.readyUnits)} ready units · {packetSources(packet).length} source{packetSources(packet).length === 1 ? '' : 's'} · {score(packet.qualityBps)}% quality</small></span>
    </label>)}</div>
    <p className="synthetic-note">{selected.length ? `${selected.length} packet${selected.length === 1 ? '' : 's'} selected` : 'Choose one or more prepared datasets.'}</p>
  </fieldset>;
}

function CorpusComparison({ game }: { game: GameState }) {
  const packets = ownedPackets(game).filter(packet => packet.prepared);
  const [leftIds, setLeftIds] = useState<string[]>([]);
  const [rightIds, setRightIds] = useState<string[]>([]);
  const availableIds = new Set(packets.map(packet => packet.id));
  const leftSelected = leftIds.filter(id => availableIds.has(id)), rightSelected = rightIds.filter(id => availableIds.has(id));
  const left = getCorpusEvidence(game, game.playerCompanyId, leftSelected);
  const right = getCorpusEvidence(game, game.playerCompanyId, rightSelected);
  const selectedValue = (corpus: CorpusEvidence, value: ReactNode) => corpus.packetIds.length ? value : 'Choose datasets';
  const sharedSources = left.sourceIds.filter(source => right.sourceIds.includes(source));
  const duplicateSources = (ids: string[], corpus: CorpusEvidence) => ids.reduce((total, id) => total + packetSources(game.slices.data.packets[id]).length, 0) - corpus.sourceIds.length;
  if (!packets.length) return <p className="synthetic-empty">Prepare licensed data to start comparing datasets. <a href="#data">Open data preparation</a>.</p>;
  return <div className="synthetic-compare-body">
    <div className="synthetic-two-up">
      <CorpusPicker label="Data group A" id="synthetic-corpus-a" packets={packets} selected={leftSelected} onChange={setLeftIds} />
      <CorpusPicker label="Data group B" id="synthetic-corpus-b" packets={packets} selected={rightSelected} onChange={setRightIds} />
    </div>
    <ComparisonTable caption="Unique data after removing repeated sources" left="Data group A" right="Data group B" rows={[
      { label: 'Selected packets', left: left.packetIds.length, right: right.packetIds.length },
      { label: 'Distinct sources', left: selectedValue(left, left.sourceIds.length), right: selectedValue(right, right.sourceIds.length) },
      { label: 'Distinct ready units', left: selectedValue(left, count(left.distinctUnits)), right: selectedValue(right, count(right.distinctUnits)) },
      { label: 'Broad units', left: selectedValue(left, count(left.broadUnits)), right: selectedValue(right, count(right.broadUnits)) },
      { label: 'Behavior units', left: selectedValue(left, count(left.behaviorUnits)), right: selectedValue(right, count(right.behaviorUnits)) },
      ...DOMAINS.map(domain => ({ label: DOMAIN_NAMES[domain] + ' relevant units', left: selectedValue(left, formatUnits(left.relevantUnits[domain])), right: selectedValue(right, formatUnits(right.relevantUnits[domain])) })),
      ...DOMAINS.map(domain => ({ label: DOMAIN_NAMES[domain] + ' quality', left: selectedValue(left, score(left.qualityBps[domain]) + '%'), right: selectedValue(right, score(right.qualityBps[domain]) + '%') })),
      { label: 'Hosted use', left: selectedValue(left, <Permission allowed={left.rights.hosted} />), right: selectedValue(right, <Permission allowed={right.rights.hosted} />) },
      { label: 'Weight transfer', left: selectedValue(left, <Permission allowed={left.rights.weights} />), right: selectedValue(right, <Permission allowed={right.rights.weights} />) },
      { label: 'Feedback reuse', left: selectedValue(left, <Permission allowed={left.rights.feedback} />), right: selectedValue(right, <Permission allowed={right.rights.feedback} />) },
    ]} />
    <div className="synthetic-callout">
      <strong>Shared sources count once.</strong>
      <p>Curated copies and repeated choices do not add new data. These groups share {sharedSources.length} source identit{sharedSources.length === 1 ? 'y' : 'ies'}; repeated source entries removed within A: {duplicateSources(leftSelected, left)}, within B: {duplicateSources(rightSelected, right)}.</p>
    </div>
    <details className="synthetic-details"><summary>Data source IDs and dataset fingerprints</summary>
      <div className="synthetic-two-up">{[{ name: 'Data group A', corpus: left }, { name: 'Data group B', corpus: right }].map(({ name, corpus }) => <div key={name}>
        <h4>{name}</h4>
        {corpus.sourceIds.length ? <><ul className="synthetic-id-list">{corpus.sourceIds.map(id => <li key={id}>{id}</li>)}</ul><p className="synthetic-fingerprint">{corpus.fingerprint}</p></> : <p className="synthetic-note">No datasets selected.</p>}
      </div>)}</div>
    </details>
  </div>;
}

export function ModelCorpusComparison({ game }: { game: GameState }) {
  const [mode, setMode] = useState<'models' | 'corpora'>('models');
  return <Section title="Compare models and data" id="model-corpus-compare" className="synthetic-panel synthetic-compare">
    <p className="synthetic-intro">Compare models and training data before choosing your next training plan.</p>
    <div className="synthetic-mode-switch" role="group" aria-label="Comparison type">
      <button type="button" aria-pressed={mode === 'models'} aria-controls="synthetic-model-comparison" onClick={() => setMode('models')}>Models</button>
      <button type="button" aria-pressed={mode === 'corpora'} aria-controls="synthetic-corpus-comparison" onClick={() => setMode('corpora')}>Training data</button>
    </div>
    <div id="synthetic-model-comparison" hidden={mode !== 'models'}><ModelComparison game={game} /></div>
    <div id="synthetic-corpus-comparison" hidden={mode !== 'corpora'}><CorpusComparison game={game} /></div>
  </Section>;
}
