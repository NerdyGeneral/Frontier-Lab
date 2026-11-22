import type { GameState, ProductOffer, WeeklyUsage } from '../contracts/types';
import type { EvidenceCheckUsage, EvidenceCheckView } from '../contracts/wave6-evidence';
import type { ProductEfficiencyInstall } from '../contracts/wave4-research';
import { EVIDENCE_LINKS } from '../content/wave6-evidence';
import { canonicalStateHash } from '../core/canonical';
import { checkedInteger, mulDiv } from '../core/math';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const identifier = (value: unknown): boolean => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
const same = (a: unknown, b: unknown): boolean => canonicalStateHash(a) === canonicalStateHash(b);
const key = (productId: string) => productId + ':evidence-links';

/** Source/model identities are captured at rollout. A future index replacement needs a new rollout. */
export function evidenceInputsMatch(state: Readonly<GameState>, installation: ProductEfficiencyInstall): boolean {
  const product = state.slices.products.offers[installation.productId];
  const retrieval = state.slices.products.retrievalInstalls?.[installation.productId];
  return !!product && product.kind === 'business-docs' && product.companyId === installation.companyId
    && state.slices.products.deployments[product.deploymentId]?.modelId === installation.modelId
    && retrieval?.status === 'active' && retrieval.companyId === installation.companyId
    && retrieval.id === installation.retrievalId && retrieval.evidence.packetId === installation.evidencePacketId;
}

export function activeEvidenceCheck(state: Readonly<GameState>, productId: string): ProductEfficiencyInstall | null {
  const installation = state.slices.products.efficiencyInstalls?.[key(productId)];
  return installation?.kind === 'evidence-links' && installation.status === 'active' && installation.enabled && evidenceInputsMatch(state, installation)
    ? installation : null;
}

export function evidenceSupportBps(qualityBps: number, documentCoverageBps: number, freshnessBps: number): number {
  return mulDiv(mulDiv(qualityBps, documentCoverageBps, 10000), freshnessBps, 10000);
}

/** The fixed check is additional work after every inference, route and cache adjustment. */
export function evidenceWorkPerRequest(state: Readonly<GameState>, productId: string): number {
  return activeEvidenceCheck(state, productId) ? EVIDENCE_LINKS.workPerRequestCUw : 0;
}

function measuredEvidence(input: Pick<EvidenceCheckUsage, 'installationId' | 'retrievalId' | 'packetId' | 'qualityBps' | 'documentCoverageBps' | 'freshnessBps' | 'requestWorkCUw'>,
  requestedWork: number, executedWork: number): EvidenceCheckUsage {
  const supportBps = evidenceSupportBps(input.qualityBps, input.documentCoverageBps, input.freshnessBps);
  const requestedRequests = mulDiv(requestedWork, 1, input.requestWorkCUw, 'ceil');
  // A partial request can consume work but cannot provide a completed support check.
  const checkedRequests = mulDiv(executedWork, 1, input.requestWorkCUw);
  const supportedRequests = mulDiv(checkedRequests, supportBps, 10000);
  return { ...input, supportBps, requestedRequests, checkedRequests, supportedRequests,
    withheldRequests: checkedRequests - supportedRequests, uncheckedRequests: requestedRequests - checkedRequests,
    checkWorkCUw: mulDiv(executedWork, EVIDENCE_LINKS.workPerRequestCUw, input.requestWorkCUw) };
}

export function measureEvidenceChecks(state: Readonly<GameState>, product: ProductOffer, requestedWork: number, executedWork: number, requestWorkCUw: number): EvidenceCheckUsage | undefined {
  const installation = activeEvidenceCheck(state, product.id);
  if (!installation) return;
  const retrieval = state.slices.products.retrievalInstalls[product.id];
  return measuredEvidence({ installationId: installation.id, retrievalId: retrieval.id, packetId: retrieval.evidence.packetId,
    qualityBps: retrieval.evidence.qualityBps, documentCoverageBps: retrieval.evidence.documentCoverageBps,
    freshnessBps: retrieval.lastFreshnessBps, requestWorkCUw }, requestedWork, executedWork);
}

export function evidenceWithheldBps(usage: EvidenceCheckUsage | undefined): number {
  return usage?.checkedRequests ? mulDiv(usage.withheldRequests, 10000, usage.checkedRequests) : 0;
}

export function evidenceGoodForTrust(usage: EvidenceCheckUsage | undefined): boolean {
  return !usage || usage.checkedRequests > 0 && mulDiv(usage.supportedRequests, 10000, usage.checkedRequests) >= EVIDENCE_LINKS.trustSupportFloorBps;
}

export function getEvidenceCheckView(state: Readonly<GameState>, productId: string): EvidenceCheckView {
  const product = state.slices.products.offers[productId], installation = state.slices.products.efficiencyInstalls?.[key(productId)] ?? null;
  const retrieval = state.slices.products.retrievalInstalls?.[productId], active = !!activeEvidenceCheck(state, productId);
  const researched = !!product && (state.slices.research.completedByCompany[product.companyId] ?? []).includes('R6A');
  const capturedInputsMatch = !!installation && evidenceInputsMatch(state, installation);
  const last = state.slices.products.lastUsage[productId];
  return { researched, installation, active, capturedInputsMatch, retrievalReady: retrieval?.status === 'active',
    status: !researched ? 'Research Evidence links (R6A).' : !installation ? 'Install a checker for the current model and active retrieval index.'
      : installation.status === 'building' ? 'Implementation needs ML staff and development work.'
        : installation.status === 'ready' ? 'Implementation finished; activation is next week.'
          : !capturedInputsMatch ? 'The model or retrieval index changed. Install a new checker for these inputs.'
            : !installation.enabled ? 'Evidence checks are disabled.'
              : product.status !== 'active' ? 'Evidence checks are ready; the product is not serving.' : 'Check each completed query; withhold outputs without source support.',
    supportBps: retrieval?.status === 'active' ? evidenceSupportBps(retrieval.evidence.qualityBps, retrieval.evidence.documentCoverageBps, retrieval.lastFreshnessBps) : 0,
    usage: last?.evidence ?? null, usageWeek: last?.evidence ? last.week : null };
}

/**
 * Historical meters reconcile using their captured quality, coverage, freshness,
 * and request cost. A later index change must never rewrite an earlier result.
 * Current meters also reconcile to the actual enabled rollout and live request cost.
 */
export function assertEvidenceCheckUsage(state: Readonly<GameState>, usage: WeeklyUsage, currentRequestWorkCUw?: number): void {
  const product = state.slices.products.offers[usage.productId], evidence = usage.evidence;
  const active = activeEvidenceCheck(state, usage.productId);
  if (!evidence) {
    check(usage.week !== state.week || !active, 'An active evidence checker lost its settled support meter.');
    return;
  }
  check(product?.kind === 'business-docs', 'Only Business Documents can record citation support.');
  check(typeof evidence === 'object' && !Array.isArray(evidence), 'Evidence checking must retain a structured meter.');
  const identities = ['installationId', 'retrievalId', 'packetId'] as const;
  for (const name of identities) check(identifier(evidence[name]), 'Evidence checking lost a captured input identity.');
  check(evidence.installationId.startsWith('efficiency:') && evidence.retrievalId.startsWith('retrieval:'), 'Evidence checking lost its rollout or retrieval provenance.');
  const numericFields = ['qualityBps', 'documentCoverageBps', 'freshnessBps', 'supportBps', 'requestWorkCUw', 'checkWorkCUw', 'requestedRequests', 'checkedRequests', 'supportedRequests', 'withheldRequests', 'uncheckedRequests'] as const;
  check(Object.keys(evidence).length === identities.length + numericFields.length, 'Evidence checking contains an unknown or missing field.');
  for (const name of numericFields) checkedInteger(evidence[name], 'Evidence checking ' + name);
  for (const name of ['qualityBps', 'documentCoverageBps', 'freshnessBps', 'supportBps'] as const) check(evidence[name] <= 10000, 'Evidence checking rate exceeds 100%.');
  check(evidence.requestWorkCUw > EVIDENCE_LINKS.workPerRequestCUw, 'Evidence checking erased normal inference work.');
  const packet = state.slices.data.packets[evidence.packetId];
  check(packet && (packet.companyId ?? state.playerCompanyId) === product.companyId && packet.prepared && packet.rights.hosted
    && packet.qualityBps === evidence.qualityBps && packet.coverageBps.documents === evidence.documentCoverageBps, 'Evidence support differs from its owned prepared source.');
  const expected = measuredEvidence({ installationId: evidence.installationId, retrievalId: evidence.retrievalId, packetId: evidence.packetId,
    qualityBps: evidence.qualityBps, documentCoverageBps: evidence.documentCoverageBps, freshnessBps: evidence.freshnessBps,
    requestWorkCUw: evidence.requestWorkCUw }, usage.requestedWork, usage.executedWork);
  check(same(evidence, expected), 'Evidence checking counts or work do not reconcile with actually executed requests.');
  check(evidence.checkWorkCUw <= usage.executedWork && evidence.checkWorkCUw >= evidence.checkedRequests * EVIDENCE_LINKS.workPerRequestCUw,
    'Evidence support was claimed without its executed checking work.');
  if (usage.week === state.week) {
    const retrieval = state.slices.products.retrievalInstalls[usage.productId];
    check(active && evidence.installationId === active.id && evidence.retrievalId === active.retrievalId && evidence.packetId === active.evidencePacketId,
      'Current evidence support has no active matching implementation.');
    check(retrieval?.lastUpkeepWeek === usage.week && evidence.freshnessBps === retrieval.lastFreshnessBps,
      'Current evidence support ignored the actual data upkeep.');
    if (currentRequestWorkCUw !== undefined) check(evidence.requestWorkCUw === currentRequestWorkCUw, 'Evidence request work differs from current paid inference and checking costs.');
  }
}
