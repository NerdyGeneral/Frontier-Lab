'use client';

import { humanizeDesignRequirement } from './model-design-insights';

import { useId } from 'react';
import type { ReactNode } from 'react';
import { CUSTOMER_BRIEFS } from '../content/customer-briefs';
import { CONTENT } from '../content/catalog';
import { EFFICIENCY_RULES, SYSTEM_RULES } from '../content/wave4-research';
import { formatMoney } from '../core/index';
import type { CommandPayload, GameState, PreviewResult, StaffRole } from '../contracts/types';
import { getUiCommandPreview } from './command-preview';
import { useStudioCommandReview } from './studio-interaction-context';
import { getStudioCommandReviewReason } from './studio-command-flow';

export const ROLE_LABELS: Record<StaffRole, string> = {
  research: 'Research', ml: 'ML engineering', data: 'Data',
  infrastructure: 'Infrastructure', commercial: 'Commercial', hardware: 'Hardware',
};

export function Section({ title, children, className = '', id }: { title: string; children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={'lab-section ' + className} aria-label={title} tabIndex={id ? -1 : undefined}><div className="section-heading"><h2>{title}</h2>{id && <a className="section-top-link" href="#lab" aria-label={'Back to top from ' + title}>Top</a>}</div>{children}</section>;
}

export function Metrics({ children }: { children: ReactNode }) {
  return <dl className="metrics">{children}</dl>;
}

export function Metric({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <div className={'metric ' + className}><dt>{label}</dt><dd>{children}</dd></div>;
}

export function commandLabel(payload: CommandPayload): string {
  switch (payload.kind) {
    case 'start_development_plan': return 'Start development plan';
    case 'set_development_plan_paused': return payload.paused ? 'Pause development plan' : 'Resume development plan';
    case 'revise_development_plan': return 'Save limits and resume development';
    case 'cancel_development_plan': return 'Stop development plan';
    case 'set_product_strategy': return 'Apply product strategy';
    case 'select_chapter': return 'Choose chapter goal';
    case 'accept_customer_brief': return 'Accept ' + CUSTOMER_BRIEFS[payload.briefId].title;
    case 'start_facility_specialization': return 'Fund ' + payload.profile + ' site profile';
    case 'set_facility_specialization_paused': return payload.paused ? 'Pause site profile retrofit' : 'Resume site profile retrofit';
    case 'start_chip_successor': return 'Fund Gen 2 ' + payload.improvement + ' design “' + payload.name + '”';
    case 'start_release_canary': return 'Start ' + (payload.shareBps / 100) + '% paid release canary';
    case 'stop_release_canary': return 'Stop live test and use the current model';
    case 'accept_private_appliance_order': return 'Accept Cedar Records private appliance';
    case 'start_synthetic_generation': return 'Start paid ' + payload.domain + ' synthetic generation';
    case 'start_synthetic_review': return 'Start synthetic review & audit';
    case 'set_synthetic_job_paused': return payload.paused ? 'Pause synthetic job' : 'Resume synthetic job';
    case 'apply_studio_plan': return 'Confirm staff & compute plan';
    case 'set_batch_capacity': return 'Change batch capacity plan';
    case 'set_batch_job_placement': return 'Change batch GPU pool';
    case 'install_batch_scheduler': return 'Install batch scheduler';
    case 'accept_batch_job': return 'Accept batch job';
    case 'set_batch_job_paused': return payload.paused ? 'Pause batch job' : 'Resume batch job';
    case 'cancel_batch_job': return 'End batch job';
    case 'sign_assurance_contract': return 'Sign assured API contract';
    case 'requalify_assurance_contract': return 'Update accepted API qualification';
    case 'cancel_assurance_contract': return 'End assured API contract';
    case 'rename_company': return 'Rename company to “' + payload.name + '”';
    case 'allocate_compute': return 'Change compute allocation';
    case 'specialize_staff': return 'Choose career specialty';
    case 'hire_staff': return 'Hire ' + ROLE_LABELS[payload.role].toLowerCase() + ' staff';
    case 'dismiss_staff': return 'Dismiss employee';
    case 'assign_founder': return 'Change founder assignments';
    case 'set_staff_allocation': return 'Change employee assignment';
    case 'set_cloud_capacity': return 'Change rented compute capacity';
    case 'prepare_data': return 'Prepare training data';
    case 'buy_data': return 'Acquire training data';
    case 'curate_data': return 'Curate training data';
    case 'deduplicate_data': return 'Deduplicate training data';
    case 'start_training': return 'Start training run';
    case 'evaluate_model': return 'Evaluate model';
    case 'set_job_paused': return payload.paused ? 'Pause project' : 'Resume project';
    case 'deploy_product': return payload.productKind === 'developer-api' ? 'Deploy Developer API' : payload.productKind === 'business-docs' ? 'Deploy Business Documents' : 'Deploy Basic Chat';
    case 'set_product_terms': return 'Change product terms';
    case 'set_product_paused': return payload.paused ? 'Pause product' : 'Resume product';
    case 'set_consumer_sessions': return 'Change customer chat history';
    case 'set_product_features': return 'Change product features';
    case 'upgrade_product': return 'Deploy replacement model';
    case 'install_runtime_guardrail': return 'Install and audit ' + payload.profile + ' guardrails';
    case 'set_runtime_guardrail_enabled': return payload.enabled ? 'Enable runtime guardrails' : 'Disable runtime guardrails';
    case 'start_feedback_study': return 'Start customer-feedback study';
    case 'cancel_feedback_study': return 'End feedback study early';
    case 'start_feedback_review': return 'Start paid feedback review';
    case 'set_feedback_review_paused': return payload.paused ? 'Pause feedback review' : 'Resume feedback review';
    case 'start_release_rehearsal': return 'Start paid model rehearsal';
    case 'set_release_rehearsal_paused': return payload.paused ? 'Pause model rehearsal' : 'Resume model rehearsal';
    case 'start_prepared_release': return 'Prepare model handover';
    case 'set_prepared_release_paused': return payload.paused ? 'Pause release preparation' : 'Resume release preparation';
    case 'discard_prepared_release': return 'Discard release preparation';
    case 'promote_prepared_release': return 'Schedule prepared handover';
    case 'start_release_rollback': return 'Prepare a switch back to the original model';
    case 'start_model_research': return 'Fund architecture research';
    case 'set_model_research_paused': return payload.paused ? 'Pause architecture research' : 'Resume architecture research';
    case 'start_research': return 'Research ' + (CONTENT.research.find(item => item.id === payload.researchId)?.name.toLowerCase() ?? payload.researchId);
    case 'set_research_paused': return payload.paused ? 'Pause research' : 'Resume research';
    case 'order_rack': return 'Order GPU rack';
    case 'install_rack': return 'Install GPU rack';
    case 'set_rack_parked': return payload.parked ? 'Park GPU rack' : 'Activate GPU rack';
    case 'start_facility': return 'Reserve a data-center site';
    case 'start_facility_retrofit': return payload.retrofitKind === 'power-feed' ? 'Extend site power feed' : 'Expand site cooling loop';
    case 'set_facility_retrofit_paused': return payload.paused ? 'Pause site extension' : 'Resume site extension';
    case 'start_rack_relocation': return 'Relocate GPU rack';
    case 'set_rack_relocation_paused': return payload.paused ? 'Pause rack relocation' : 'Resume rack relocation';
    case 'fund_facility_stage': return 'Fund next construction stage';
    case 'set_facility_paused': return payload.paused ? 'Pause construction' : 'Resume construction';
    case 'start_agent_job': return 'Accept support order';
    case 'set_agent_job_paused': return payload.paused ? 'Pause support job' : 'Resume support job';
    case 'review_agent_job': return payload.decision === 'approve' ? 'Approve proposed support action' : 'Reject proposed support action';
    case 'recover_agent_job': return 'Recover support workflow';
    case 'cancel_agent_job': return 'Cancel support job';
    case 'install_retrieval': return 'Install document retrieval index';
    case 'sign_business_contract': return payload.contractKind === 'customer-hosted' ? 'Sign customer-hosted model license' : 'Sign private-hosted business contract';
    case 'set_business_renewal': return payload.renew ? 'Enable business contract renewal' : 'End business contract at term';
    case 'create_model_variant': return payload.variant === 'compression' ? 'Apply model compression' : 'Apply compact memory format';
    case 'install_product_efficiency': return 'Install ' + EFFICIENCY_RULES[payload.method].name.toLowerCase();
    case 'set_product_efficiency_enabled': return (payload.enabled ? 'Enable ' : 'Disable ') + EFFICIENCY_RULES[payload.method].name.toLowerCase();
    case 'start_system_rollout': return 'Install ' + SYSTEM_RULES[payload.method].name.toLowerCase();
    case 'configure_research_assistant': return payload.enabled ? 'Configure research assistance' : 'Disable research assistance';
    case 'start_chip_design': return 'Start chip design “' + payload.name + '”';
    case 'start_chip_prototype': return 'Build and validate chip prototype';
    case 'set_chip_project_paused': return payload.paused ? 'Pause chip project' : 'Resume chip project';
    case 'order_chip_batch': return 'Order custom chip production';
    case 'accept_hardware_order': return 'Accept accelerator order';
    case 'install_fast_fabric': return 'Install fast fabric';
    case 'set_fabric_paused': return payload.paused ? 'Pause fabric installation' : 'Resume fabric installation';
  }
}

/** This only groups pending UI actions; admission remains in the engine. */
function actionKey(payload: CommandPayload): string {
  switch (payload.kind) {
    case 'accept_customer_brief': return payload.kind + ':' + payload.briefId;
    case 'start_facility_specialization': return payload.kind + ':' + payload.facilityId;
    case 'set_facility_specialization_paused': return payload.kind + ':' + payload.specializationId;
    case 'start_chip_successor': return payload.kind + ':' + payload.parentDesignId;
    case 'start_release_canary': return payload.kind + ':' + payload.releaseId;
    case 'stop_release_canary': return payload.kind + ':' + payload.canaryId;
    case 'accept_private_appliance_order': return payload.kind + ':' + payload.buyerId;
    case 'start_synthetic_generation': return [payload.kind, payload.teacherModelId, payload.sourcePacketId, payload.domain].join(':');
    case 'start_synthetic_review': case 'set_synthetic_job_paused': return payload.kind + ':' + payload.jobId;
    case 'set_batch_capacity': case 'install_batch_scheduler': return payload.kind;
    case 'accept_batch_job': return [payload.kind, payload.productId, payload.orderId, payload.modelId, payload.weeklyWorkCapCUw].join(':');
    case 'set_batch_job_placement': case 'set_batch_job_paused': case 'cancel_batch_job': return payload.kind + ':' + payload.jobId;
    case 'sign_assurance_contract': return payload.kind + ':' + payload.buyerId;
    case 'requalify_assurance_contract': case 'cancel_assurance_contract': return payload.kind + ':' + payload.contractId;
    case 'hire_staff': return payload.kind + ':' + payload.role;
    case 'specialize_staff': return payload.kind + ':' + payload.staffId + ':' + payload.specialty;
    case 'dismiss_staff':
    case 'set_staff_allocation': return payload.kind + ':' + payload.staffId;
    case 'prepare_data':
    case 'curate_data': case 'deduplicate_data': return payload.kind + ':' + payload.packetId;
    case 'buy_data': return payload.kind + ':' + payload.catalogId;
    case 'start_training': return payload.kind + ':' + payload.baseModelId + ':' + payload.packetId + ':' + (payload.recipeId ?? 'compact-conversation-adaptation');
    case 'evaluate_model': return payload.kind + ':' + payload.modelId + ':' + (payload.suiteId ?? 'basic-conversation-1');
    case 'set_job_paused': return payload.kind + ':' + payload.jobId;
    case 'start_research': return payload.kind + ':' + payload.researchId;
    case 'set_research_paused': return payload.kind + ':' + payload.projectId;
    case 'order_rack': return payload.kind + ':' + payload.hardwareId + ':' + payload.location;
    case 'install_rack':
    case 'set_rack_parked': return payload.kind + ':' + payload.rackId;
    case 'fund_facility_stage':
    case 'set_facility_paused': return payload.kind + ':' + payload.facilityId;
    case 'start_facility_retrofit': return payload.kind + ':' + payload.facilityId + ':' + payload.retrofitKind;
    case 'set_facility_retrofit_paused': return payload.kind + ':' + payload.retrofitId;
    case 'start_rack_relocation': return payload.kind + ':' + payload.rackId;
    case 'set_rack_relocation_paused': return payload.kind + ':' + payload.relocationId;
    case 'deploy_product': return payload.kind + ':' + (payload.productKind ?? 'basic-chat');
    case 'install_runtime_guardrail': case 'set_runtime_guardrail_enabled':
    case 'start_feedback_study': return payload.kind + ':' + payload.productId;
    case 'cancel_feedback_study': case 'start_feedback_review': return payload.kind + ':' + payload.studyId;
    case 'set_feedback_review_paused': return payload.kind + ':' + payload.reviewId;
    case 'start_release_rehearsal': case 'start_prepared_release': return payload.kind + ':' + payload.productId;
    case 'set_model_research_paused': return payload.kind + ':' + payload.projectId;
    case 'set_release_rehearsal_paused': return payload.kind + ':' + payload.rehearsalId;
    case 'set_prepared_release_paused': case 'discard_prepared_release': case 'promote_prepared_release': case 'start_release_rollback': return payload.kind + ':' + payload.releaseId;
    case 'set_product_strategy':
    case 'set_product_terms':
    case 'set_consumer_sessions':
    case 'set_product_features':
    case 'upgrade_product':
    case 'set_product_paused': return payload.kind + ':' + payload.productId;
    case 'start_agent_job': return payload.kind + ':' + payload.orderId;
    case 'set_agent_job_paused':
    case 'review_agent_job':
    case 'recover_agent_job':
    case 'cancel_agent_job': return payload.kind + ':' + payload.jobId;
    case 'install_retrieval': return payload.kind + ':' + payload.productId;
    case 'sign_business_contract': return payload.kind + ':' + payload.customerId;
    case 'set_business_renewal': return payload.kind + ':' + payload.contractId;
    case 'create_model_variant': return payload.kind + ':' + payload.modelId + ':' + payload.variant;
    case 'install_product_efficiency':
    case 'set_product_efficiency_enabled': return payload.kind + ':' + payload.productId + ':' + payload.method;
    case 'start_system_rollout': return payload.kind + ':' + payload.method;
    case 'start_chip_design': return payload.kind + ':' + payload.spec.architecture + ':' + payload.spec.target + ':' + payload.spec.memory;
    case 'start_chip_prototype':
    case 'set_chip_project_paused': return payload.kind + ':' + payload.designId;
    case 'order_chip_batch': return payload.kind + ':' + payload.designId + ':' + payload.location + ':' + (payload.foundry ?? 'standard');
    case 'accept_hardware_order': return payload.kind + ':' + payload.buyerId;
    case 'install_fast_fabric': return payload.kind + ':' + payload.location;
    case 'set_fabric_paused': return payload.kind + ':' + payload.fabricId;
    default: return payload.kind;
  }
}

export function isQueued(game: GameState, payload: CommandPayload): boolean {
  return game.queuedCommands.some(command => command.companyId === game.playerCompanyId && actionKey(command.payload) === actionKey(payload));
}

export function Quote({ preview, queuedWeek, emptyReason, id }: { preview: PreviewResult | null; queuedWeek?: number; emptyReason?: string; id?: string }) {
  if (queuedWeek !== undefined) return <p id={id} className="action-explanation">Queued for Week {queuedWeek}. Resume the game or advance one week to apply.</p>;
  if (!preview) return <p id={id} className="action-explanation blocked-explanation">{emptyReason ?? 'Fill in the options to see the cost.'}</p>;
  return <div id={id} className="action-quote">
    {(preview.upfrontCostCents > 0 || preview.weeklyCostDeltaCents !== 0) && <p className="quote-costs">
      {preview.upfrontCostCents > 0 && <span>{formatMoney(preview.upfrontCostCents)} upfront</span>}
      {preview.weeklyCostDeltaCents !== 0 && <span>{preview.weeklyCostDeltaCents > 0 ? '+' : ''}{formatMoney(preview.weeklyCostDeltaCents)} / week</span>}
    </p>}
    {preview.upfrontCostCents > 0 && <p className="quote-remaining">Cash after planned actions: {formatMoney(preview.cashAfterCommitmentsCents)}</p>}
    <p className={'action-explanation ' + (!preview.accepted ? 'blocked-explanation' : '')}>{preview.reason?.message ?? preview.summary}</p>
  </div>;
}

export function actionCostLabel(preview: Pick<PreviewResult, 'upfrontCostCents' | 'weeklyCostDeltaCents'> | null): string {
  if (!preview) return '';
  return [preview.upfrontCostCents > 0 ? formatMoney(preview.upfrontCostCents) : '',
    preview.weeklyCostDeltaCents !== 0 ? `${preview.weeklyCostDeltaCents > 0 ? '+' : ''}${formatMoney(preview.weeklyCostDeltaCents)} / week` : '']
    .filter(Boolean).join(' · ');
}

export function ActionControl({ game, payload, label, canAct, onQueue, emptyReason, extraDisabled = false, compact = false, taskAction }: {
  game: GameState; payload: CommandPayload | null; label: string; canAct: boolean;
  onQueue: (payload: CommandPayload) => void; emptyReason?: string; extraDisabled?: boolean; compact?: boolean;
  /** Presentation identity stays available when an incomplete draft has no payload. */
  taskAction?: string;
}) {
  const quoteId = useId();
  const reviewCommand = useStudioCommandReview();
  const rawQuote = payload ? getUiCommandPreview(game, payload, CONTENT) : null;
  const customDesign = payload?.kind === 'start_training' ? payload.modelDesign : payload?.kind === 'start_development_plan' ? payload.training.modelDesign : null;
  const quote = customDesign && rawQuote?.reason ? { ...rawQuote, reason: { ...rawQuote.reason, message: humanizeDesignRequirement(rawQuote.reason.message) } } : rawQuote;
  const queued = payload ? isQueued(game, payload) : false;
  const requiresReview = !!reviewCommand && !!payload && !!getStudioCommandReviewReason(payload);
  const actionLabel = payload && /^(review|confirm)\b/i.test(label) ? commandLabel(payload) : label;
  const buttonLabel = queued ? 'Scheduled for Week ' + (game.week + 1) : (requiresReview ? 'Review: ' : '') + actionLabel;
  const cost = queued ? '' : actionCostLabel(quote);
  return <div className={'action-control ' + (compact ? 'compact-action' : '')}>
    <button type="button" aria-describedby={quoteId} data-studio-review={payload?.kind ?? 'incomplete'} data-studio-action-flow={requiresReview ? 'review' : 'direct'} data-studio-action-id={'action-' + quoteId} data-studio-primary-for={taskAction}
      data-studio-blocked-reason={queued ? 'Already scheduled for Week ' + (game.week + 1) + '.' : !canAct ? 'Wait until this lab is ready to make choices.' : !payload ? emptyReason ?? 'Complete the options above.' : extraDisabled ? 'Complete the requirements above.' : !quote?.accepted ? quote?.reason?.message ?? 'Check the requirements above.' : undefined}
      onClick={() => { if (payload && !reviewCommand?.(payload, actionLabel, game)) onQueue(payload); }} disabled={!canAct || !quote?.accepted || queued || extraDisabled}>{buttonLabel}{cost && <span className="action-label-cost"> · {cost}</span>}</button>
    <Quote id={quoteId} preview={quote} queuedWeek={queued ? game.week + 1 : undefined} emptyReason={emptyReason} />
  </div>;
}

/** Convert user-entered decimals to stored integer units, without float multiplication. */
export function parseFixed(value: string, decimals: number): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d*)?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) return null;
  const result = Number(whole) * (10 ** decimals) + Number(fraction.padEnd(decimals, '0'));
  return Number.isSafeInteger(result) ? result : null;
}

export function parseWhole(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
}
