import { CUSTOMER_BRIEFS } from '../content/customer-briefs';
import { CONTENT } from '../content/catalog';
import { DATA_CATALOG } from '../content/wave2-lab';
import { BUSINESS_BY_ID, COMMERCE_RULES } from '../content/wave3-commerce';
import { AGENT_TOOLS } from '../content/wave3-agents';
import { EFFICIENCY_RULES, SYSTEM_RULES, VARIANT_RULES } from '../content/wave4-research';
import { CHIP_RULES, chipSpecificationValues, chipPrototypeValues } from '../content/wave4-hardware';
import { CHIP_FOUNDRIES, HARDWARE_BUYERS, chipProductionTerms } from '../content/silicon-market';
import { FACILITY_RETROFITS } from '../content/wave8-retrofits';
import { PREPARED_RELEASE_RULES } from '../content/wave9-releases';
import { RELEASE_REHEARSAL_RULES } from '../content/wave9-rehearsals';
import { ASSURANCE_BUYERS, ASSURANCE_RULES } from '../content/wave13-assurance';
import { BATCH_COMMANDS, BATCH_ORDERS } from '../content/wave14-batch';
import { SYNTHETIC_RULES } from '../content/wave26-synthetic';
import { PRIVATE_APPLIANCE_BUYER } from '../content/wave27-appliance';
import { FACILITY_PROFILES } from '../content/wave28-facilities';
import { GEN2_SILICON_RULES } from '../content/wave28-silicon';
import type { CommandPayload, GameState, StaffRole } from '../contracts/types';
import { formatMoney, formatUnits, toUnits } from '../core/math';
import { getAgentView } from '../modules/agents';
import { getModelResearchQuote } from '../modules/model-research';
import { getComputePools } from '../modules/compute-pools';
import { getQualifiedReleaseRehearsal } from '../modules/release-rehearsals';
import { previewPrivateApplianceOrder } from '../modules/private-appliances';
import { previewSyntheticGeneration } from '../modules/synthetic-data';
import { ROLE_LABELS } from './components';
import { formatWorkPoints, WORK_POINT_LABELS } from '../modules/workforce-points';

export interface StudioManagementReview {
  facts: { label: string; value: string }[];
  notes: string[];
}

const words = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, letter => letter.toUpperCase());
const units = (value: number, unit: string) => `${formatUnits(value)} ${unit}`;
const percent = (value: number) => `${value / 100}%`;
const staffUnit = (_value: number, role?: StaffRole) => `${role ? WORK_POINT_LABELS[role] + ' ' : ''}points`;
const staffEffort = (value: number, role?: StaffRole) => `${formatWorkPoints(value)} ${staffUnit(value, role)}`;

/** Read-only description of the exact captured command. Quotes and eligibility remain
 * authoritative in command-preview; missing references never select a replacement. */
export function getStudioManagementReview(game: GameState, payload: CommandPayload): StudioManagementReview {
  const facts: StudioManagementReview['facts'] = [], notes: string[] = [];
  const productBatchCommand = BATCH_COMMANDS.some(kind => kind === payload.kind);
  const captured: Record<string, unknown> = { ...payload };
  const handled = new Set(['kind']);
  const add = (label: string, value: string) => { facts.push({ label, value }); };
  const field = (key: string, label: string, value: string) => { handled.add(key); add(label, value); };
  const owned = <T extends { companyId?: string }>(item: T | undefined): T | undefined => item?.companyId === game.playerCompanyId ? item : undefined;
  const identity = (kind: string, id: string, name?: string) => name ? `${name} · ${id}` : `Unavailable ${kind} (${id})`;
  const modelName = (id: string) => identity('model', id, owned(game.slices.models.versions[id])?.name);
  const packetName = (id: string) => {
    const packet = game.slices.data.packets[id];
    return identity('dataset', id, packet && (packet.companyId === game.playerCompanyId || (!packet.companyId && id === CONTENT.starterData.id)) ? packet.name : undefined);
  };
  const locationName = (id: string) => id === 'colocation' ? 'Colocation' : identity('site', id, owned(game.slices.compute.facilities[id])?.name);
  const progress = (label: string, done: number, required: number, unit: string) => add(label, `${(unit.endsWith('points') ? formatWorkPoints : formatUnits)(done)} / ${(unit.endsWith('points') ? formatWorkPoints : formatUnits)(required)} ${unit}`);
  const work = (item: { status?: string; phase?: string; paused?: boolean; completedWork?: number; requiredWork?: number; completedStaff?: number; requiredStaff?: number; requiredMemory?: number; memoryMU?: number; availableWeek?: number | null; readyWeek?: number | null; lastBottleneck?: string }) => {
    if (item.status || item.phase) add('Status', `${words(item.status ?? item.phase ?? '')}${item.paused ? ' · paused' : ''}`);
    if (item.requiredWork !== undefined) {
      if (item.completedWork !== undefined) progress('Work completed', item.completedWork, item.requiredWork, 'CUw');
      else add('Required work', units(item.requiredWork, 'CUw; completed work is unavailable'));
    }
    if (item.requiredStaff !== undefined) {
      if (item.completedStaff !== undefined) progress('Work points completed', item.completedStaff, item.requiredStaff, staffUnit(item.requiredStaff));
      else add('Required work points', staffEffort(item.requiredStaff) + '; completed effort is unavailable');
    }
    const memory = item.requiredMemory ?? item.memoryMU;
    if (memory !== undefined) add('Required memory', units(memory, 'MU'));
    const ready = item.availableWeek ?? item.readyWeek;
    if (ready !== undefined && ready !== null) add('Available from', `Week ${ready}`);
    if (item.lastBottleneck) add('What’s holding it up', item.lastBottleneck);
  };
  const product = (id: string) => {
    const offer = owned(game.slices.products.offers[id]);
    add('Product', identity('product', id, offer?.name));
    if (!offer) return;
    add('Product state', `${words(offer.kind)} · ${words(offer.status)}`);
    const deployment = owned(game.slices.products.deployments[offer.deploymentId]);
    add('Live model', deployment ? `${modelName(deployment.modelId)} · ${deployment.id}` : `Unavailable deployment (${offer.deploymentId})`);
    const contract = owned(game.slices.products.contracts[offer.contractId]);
    if (contract) add('Current offer', offer.kind === 'developer-api'
      ? `${formatMoney(contract.weeklyPriceCents)} reference bill / 600 requests · ${contract.allowance.toLocaleString()} requests / account / week`
      : `${formatMoney(contract.weeklyPriceCents)} / account / week · ${contract.allowance.toLocaleString()} included exchanges`);
  };

  // Every ID is resolved independently, including when a later command is blocked.
  if ('productId' in payload) { handled.add('productId'); product(payload.productId); }
  for (const key of ['modelId', 'candidateModelId', 'teacherModelId', 'secondaryModelId'] as const) {
    const id = captured[key];
    if (typeof id === 'string') {
      field(key, { modelId: 'Selected model', candidateModelId: 'New model', teacherModelId: 'Teacher model', secondaryModelId: 'Routing model' }[key], modelName(id));
      const model = owned(game.slices.models.versions[id]);
      if (model) add(`${words(key.replace('Id', ''))} memory`, units(model.residentMU, 'MU resident'));
    }
  }
  for (const key of ['packetId', 'sourcePacketId'] as const) { const id = captured[key]; if (typeof id === 'string') field(key, key === 'packetId' ? 'Dataset' : 'Source dataset', packetName(id)); }
  if (payload.kind === 'start_model_research') {
    const quote = getModelResearchQuote(game, game.playerCompanyId);
    add('Architecture level', String(quote.level));
    add('Research work', `${units(quote.requiredWork, 'CUw')} · ${staffEffort(quote.requiredStaff, 'research')}`);
    add('Unlock', quote.unlock);
    notes.push('Complete both work meters, then advance one more week to use the new knowledge. Future custom designs can use this research; existing models retain their scores.');
  }
  if ('researchId' in payload) {
    const method = CONTENT.research.find(item => item.id === payload.researchId);
    field('researchId', 'Research method', identity('method', payload.researchId, method?.name));
    if (method) {
      // Research definitions author whole staff-weeks; unlike workCUw and
      // project meters, this field needs the same conversion as getResearchView.
      add('Research work', `${units(method.workCUw, 'CUw')} · ${staffEffort(toUnits(method.staffWeeks), method.role)}`);
      add('Prerequisites', method.requires.length ? method.requires.map(id => identity('method', id, CONTENT.research.find(item => item.id === id)?.name)).join('; ') : 'None');
      notes.push(method.description, 'Once researched, this discovery becomes available to use. Building its upgrades or training models costs extra work points and compute.');
    }
  }
  if ('projectId' in payload) {
    if (payload.kind === 'set_model_research_paused') {
      const project = owned(game.slices.research.modelResearch?.[payload.projectId]);
      field('projectId', 'Architecture research', identity('research project', payload.projectId, project ? 'Architecture level ' + project.level : undefined));
      if (project) work(project);
      notes.push('Pausing or resuming preserves progress and does not charge another entry fee.');
    } else {
      const project = owned(game.slices.research.projects[payload.projectId]);
      field('projectId', 'Research project', identity('research project', payload.projectId, project ? CONTENT.research.find(item => item.id === project.researchId)?.name ?? project.researchId : undefined));
      if (project) work(project);
    }
  }
  if ('catalogId' in payload) field('catalogId', 'Data catalog', identity('catalog entry', payload.catalogId, DATA_CATALOG.find(item => item.id === payload.catalogId)?.name));
  if ('facilityId' in payload) {
    const site = owned(game.slices.compute.facilities[payload.facilityId]);
    field('facilityId', 'Site', identity('site', payload.facilityId, site?.name));
    if (site) {
      work(site);
      const stage = CONTENT.infrastructure.stages[site.stageIndex];
      if (stage) add('Current construction stage', `${stage.name} · ${formatMoney(stage.costCents)} · ${stage.elapsedWeeks} weeks and ${staffEffort(stage.staffWeeks, 'infrastructure')}`);
    }
  }
  if ('rackId' in payload) {
    const rack = owned(game.slices.compute.racks[payload.rackId]);
    field('rackId', 'Rack', identity('rack', payload.rackId, rack ? CONTENT.hardware.find(item => item.id === rack.hardwareId)?.name ?? rack.hardwareId : undefined));
    if (rack) {
      add('Rack state', words(rack.status)); add('Current location', locationName(rack.location));
      add('Arrives', `Week ${rack.arrivalWeek}`);
      add('Installation', rack.installedWeek !== null ? `Installed in Week ${rack.installedWeek}` : 'Waiting for installation');
      add('Useful rack capacity', units(rack.usableCU ?? CONTENT.infrastructure.rackCU, 'CU'));
    }
  }
  for (const key of ['designId', 'parentDesignId'] as const) { const id = captured[key]; if (typeof id !== 'string') continue;
    const design = owned(game.slices.compute.chipDesigns[id]);
    field(key, key === 'parentDesignId' ? 'Parent chip design' : 'Chip design', identity('chip design', id, design?.name));
    if (design) {
      add('Chip state', `${words(design.status)}${design.paused ? ' · paused' : ''}`);
      add('Chip specification', `${words(design.spec.architecture)} · ${words(design.spec.target)} · ${words(design.spec.memory)} memory`);
      add(key === 'parentDesignId' ? 'Measured parent yield' : 'Measured yield', design.qualifiedYieldBps === null ? 'Not validated' : percent(design.qualifiedYieldBps));
      if (payload.kind === 'set_chip_project_paused') {
        const stage = design.prototypeRun ?? design.design;
        progress('Current chip stage work', stage.completedWorkCUw, stage.requiredWorkCUw, 'CUw');
        progress('Hardware effort completed', stage.completedHardwareStaff, stage.requiredHardwareStaff, staffUnit(stage.requiredHardwareStaff, 'hardware'));
        progress('ML engineering effort completed', stage.completedMlStaff, stage.requiredMlStaff, staffUnit(stage.requiredMlStaff, 'ml'));
        if (stage.lastBottleneck) add('What’s holding up the chip', stage.lastBottleneck);
      }
      if (payload.kind === 'start_chip_prototype') {
        const terms = chipPrototypeValues(design);
        add('Prototype effort', `${units(terms.workCUw, 'CUw')} · ${staffEffort(terms.hardwareStaff, 'hardware')} · ${staffEffort(terms.mlStaff, 'ml')}`);
      }
    }
  }
  if ('location' in payload) field('location', 'Destination', locationName(payload.location));
  if ('destination' in payload) field('destination', 'Destination', locationName(payload.destination));
  if ('hardwareId' in payload) field('hardwareId', 'Hardware', identity('hardware', payload.hardwareId, CONTENT.hardware.find(item => item.id === payload.hardwareId)?.name));
  if ('poolId' in payload && payload.poolId) {
    const pool = getComputePools(game, game.playerCompanyId, CONTENT).find(item => item.id === payload.poolId);
    field('poolId', 'Placement', payload.poolId === 'auto' ? 'Choose compatible hardware automatically' : identity('compute pool', payload.poolId, pool?.name));
  }
  if ('buyerId' in payload) {
    const buyer = payload.kind === 'accept_private_appliance_order' ? (payload.buyerId === PRIVATE_APPLIANCE_BUYER.id ? PRIVATE_APPLIANCE_BUYER : undefined)
      : payload.kind === 'accept_hardware_order' ? HARDWARE_BUYERS[payload.buyerId] : ASSURANCE_BUYERS.find(item => item.id === payload.buyerId);
    field('buyerId', 'Buyer', identity('buyer', payload.buyerId, buyer?.name));
  }
  if ('customerId' in payload) {
    const buyer = BUSINESS_BY_ID[payload.customerId];
    field('customerId', 'Customer', identity('customer', payload.customerId, buyer?.name));
    if (buyer) {
      add('Service term', `${buyer.termWeeks} weeks · ${buyer.weeklyRequests.toLocaleString()} requests / week · ${percent(buyer.slaBps)} SLA`);
      add('Weekly contract price', formatMoney(payload.contractKind === 'private-hosted' ? buyer.hostedWeeklyCents : buyer.licenseWeeklyCents));
      add('Delivery staff', staffEffort(payload.contractKind === 'private-hosted' ? COMMERCE_RULES.privateDeploymentStaff : COMMERCE_RULES.licenseDeliveryStaff));
    }
  }
  if ('contractId' in payload) {
    const contract = payload.kind === 'set_business_renewal' ? owned(game.slices.products.commercialContracts[payload.contractId]) : owned(game.slices.products.assuranceContracts?.[payload.contractId]);
    const buyerId = contract && ('customerId' in contract ? contract.customerId : contract.buyerId);
    const name = buyerId ? BUSINESS_BY_ID[buyerId]?.name ?? ASSURANCE_BUYERS.find(item => item.id === buyerId)?.name ?? buyerId : undefined;
    field('contractId', 'Contract', identity('contract', payload.contractId, name));
    if (contract) {
      work(contract); add('Weekly contract price', formatMoney(contract.weeklyPriceCents));
      add('Term ends', contract.termEndsWeek === null ? 'Term has not started' : `Week ${contract.termEndsWeek}`);
      if ('modelId' in contract) add('Contract model', modelName(contract.modelId));
      if ('productId' in contract) product(contract.productId);
    }
  }
  if ('releaseId' in payload) {
    const release = owned(game.slices.products.preparedReleases?.[payload.releaseId]);
    field('releaseId', 'Prepared release', identity('prepared release', payload.releaseId, release ? 'Release bundle' : undefined));
    if (release) {
      product(release.productId); add('Original model', modelName(release.sourceModelId)); add('New model', modelName(release.candidateModelId));
      const rollback = release.rollback && ['preparing', 'ready', 'scheduled'].includes(release.rollback.status) ? release.rollback : undefined;
      const restoresSource = payload.kind === 'start_release_rollback' || !!rollback;
      add('Release direction', restoresSource ? 'Switch back to the original model' : 'Switch to the new model');
      add('Model after the switch', modelName(restoresSource ? release.sourceModelId : release.candidateModelId));
      add('Rehearsal results', release.rehearsalId); work(rollback ?? release);
      add('Rollback deadline', release.rollbackExpiresWeek === null ? 'Starts when the new model goes live' : `Week ${release.rollbackExpiresWeek}${game.week >= release.rollbackExpiresWeek ? ' · too late to start a rollback' : ''}`);
      if (release.rollback) add('Rollback preparation', `${release.rollback.id} · ${words(release.rollback.status)}${release.rollback.paused ? ' · paused' : ''} · ${formatUnits(release.rollback.completedWork)} / ${formatUnits(release.rollback.requiredWork)} CUw · ${formatWorkPoints(release.rollback.completedStaff)} / ${staffEffort(release.rollback.requiredStaff, 'ml')}`);
    }
  }
  if ('rehearsalId' in payload) {
    const rehearsal = owned(game.slices.products.releaseRehearsals?.[payload.rehearsalId]);
    field('rehearsalId', 'Rehearsal', identity('rehearsal', payload.rehearsalId, rehearsal ? 'Release rehearsal' : undefined));
    if (rehearsal) { product(rehearsal.productId); add('Current model', modelName(rehearsal.sourceModelId)); add('New model', modelName(rehearsal.candidateModelId)); work(rehearsal); }
  }
  if ('canaryId' in payload) {
    const canary = owned(game.slices.products.canaryReleases?.[payload.canaryId]);
    field('canaryId', 'Canary', identity('canary', payload.canaryId, canary ? 'Live release test' : undefined));
    if (canary) {
      product(canary.productId); add('Model being tested', modelName(canary.candidateModelId)); add('Test status', words(canary.status));
      add('Paid traffic share', percent(canary.shareBps)); progress('Test compute used', canary.consumedWorkCUw, canary.budgetCUw, 'CUw'); add('Required sample', canary.sampleFloor.toLocaleString() + ' exchanges in each customer group');
    }
  }
  if ('jobId' in payload) {
    if (payload.kind.includes('synthetic')) {
      const job = owned(game.slices.data.syntheticJobs?.[payload.jobId]);
      field('jobId', 'Synthetic job', identity('synthetic job', payload.jobId, job ? 'Targeted synthetic data' : undefined));
      if (job) {
        add('Teacher model', modelName(job.teacherModelId)); add('Source dataset', packetName(job.sourcePacketId)); add('Target domain', words(job.domain)); work(job);
        progress('Generation work', job.generation.completedWork, job.generation.requiredWork, 'CUw'); progress('Review effort', job.review.completedStaff, job.review.requiredStaff, staffUnit(job.review.requiredStaff, 'data'));
      }
    } else if (payload.kind.includes('agent')) {
      const job = owned(game.slices.agents.jobs[payload.jobId]);
      field('jobId', 'Agent job', identity('agent job', payload.jobId, job?.terms.name));
      if (job) {
        add('Order', `${job.terms.name} · ${job.orderId}`); add('Model for this job', `${job.model.name} · ${job.model.id}`); work(job);
        add('Current stage', words(job.stage)); progress('Compute used', job.spentWork, job.configuration.workBudget, 'CUw'); add('Human decision', words(job.humanDecision ?? 'Not required'));
        add('Agent settings', `${words(job.configuration.mode)} · ${words(job.configuration.verification)} verification`);
        add('Review scope', job.configuration.mode === 'draft' ? 'Prepare a draft for your team to review and deliver; the agent cannot act for the customer'
          : `Customer action: ${AGENT_TOOLS.find(item => item.id === job.terms.actionTool)?.name ?? words(job.terms.actionTool)}`);
        add('Action record', job.receiptId ?? 'No action recorded');
      }
    } else if (productBatchCommand) {
      const job = owned(game.slices.products.batchJobs?.[payload.jobId]);
      field('jobId', 'Batch job', identity('batch job', payload.jobId, job?.terms.name));
      if (job) { product(job.productId); add('Model for this job', modelName(job.model.modelId)); work(job); add('Deadline', `Week ${job.deadlineWeek}`); add('Weekly work cap', units(job.weeklyWorkCapCUw, 'CUw')); }
    } else {
      const job = owned(game.slices.models.trainingRuns[payload.jobId] ?? game.slices.models.evaluationRuns[payload.jobId] ?? game.slices.data.preparationJobs[payload.jobId] ?? game.slices.models.applicationRuns[payload.jobId]);
      field('jobId', 'Project', identity('project', payload.jobId, job ? 'Lab project' : undefined));
      if (job) {
        work(job);
        for (const key of ['modelId', 'baseModelId', 'sourceModelId', 'outputModelId'] as const) {
          const id = (job as unknown as Record<string, unknown>)[key];
          if (typeof id === 'string') add(words(key.replace('Id', '')), modelName(id));
        }
        if ('packetId' in job) add('Project dataset', packetName(job.packetId));
      }
    }
  }
  if ('studyId' in payload) {
    const study = owned(game.slices.data.feedbackStudies?.[payload.studyId]);
    field('studyId', 'Feedback study', identity('study', payload.studyId, study ? 'Customer feedback' : undefined));
    if (study) { product(study.productId); work(study); add('Sampling', words(study.sampling)); add('Consent', words(study.consent)); }
  }
  if ('reviewId' in payload) {
    const review = owned(game.slices.data.feedbackReviews?.[payload.reviewId]);
    field('reviewId', 'Feedback review', identity('review', payload.reviewId, review ? 'Customer feedback review' : undefined));
    if (review) { add('Source study', review.studyId); add('Review method', words(review.mode)); work(review); }
  }
  if ('retrofitId' in payload) {
    const retrofit = owned(game.slices.compute.facilityRetrofits?.[payload.retrofitId]);
    field('retrofitId', 'Retrofit', identity('retrofit', payload.retrofitId, retrofit ? FACILITY_RETROFITS.find(item => item.kind === retrofit.kind)?.name : undefined));
    if (retrofit) { add('Site', locationName(retrofit.facilityId)); work(retrofit); }
  }
  if ('specializationId' in payload) {
    const profile = owned(game.slices.compute.facilitySpecializations?.[payload.specializationId]);
    field('specializationId', 'Site profile project', identity('site profile', payload.specializationId, profile ? FACILITY_PROFILES.find(item => item.profile === profile.profile)?.name : undefined));
    if (profile) { add('Site', locationName(profile.facilityId)); work(profile); }
  }
  if ('relocationId' in payload) {
    const move = owned(game.slices.compute.rackRelocations?.[payload.relocationId]);
    field('relocationId', 'Relocation', identity('relocation', payload.relocationId, move ? 'Rack relocation' : undefined));
    if (move) { add('Rack', move.rackId); add('Route', `${locationName(move.sourceLocation)} → ${locationName(move.destination)}`); work(move); }
  }
  if ('fabricId' in payload) {
    const fabric = owned(game.slices.compute.fabricProjects[payload.fabricId]);
    field('fabricId', 'Interconnect', identity('fabric project', payload.fabricId, fabric ? 'Fast fabric' : undefined));
    if (fabric) { add('Site', locationName(fabric.location)); work(fabric); progress('Fabric work completed', fabric.completedWorkCUw, fabric.requiredWorkCUw, 'CUw'); }
  }

  switch (payload.kind) {
    case 'set_product_terms': {
      const offer = owned(game.slices.products.offers[payload.productId]);
      if (offer?.kind === 'developer-api') {
        field('priceCents', 'New sample bill / 600 requests', formatMoney(payload.priceCents));
        field('allowance', 'New weekly request limit / account', payload.allowance.toLocaleString());
        notes.push('This sample bill sets your input and output token prices. Customers pay for tokens you process; reasoning tokens use the output price. You earn nothing from requests you cannot serve.');
      }
      break;
    }
    case 'start_synthetic_generation': {
      // Do not expose a foreign teacher through the otherwise useful terms selector.
      if (owned(game.slices.models.versions[payload.teacherModelId]) && !packetName(payload.sourcePacketId).startsWith('Unavailable')) {
        const terms = previewSyntheticGeneration(game, payload, CONTENT);
        add('Generation resources', `${units(terms.requiredWork, 'CUw')} · ${units(terms.memoryMU, 'MU')}`);
        add('Review and audit costs', `${formatMoney(terms.reviewFeeCents)} · ${staffEffort(terms.reviewStaff, 'data')} · ${units(terms.auditWork, 'audit CUw')} · ${staffEffort(terms.auditStaff, 'research')}`);
      }
      add('Generated data', `${SYNTHETIC_RULES.candidateUnits} units before review and audit`);
      break;
    }
    case 'start_prepared_release': {
      const rehearsal = getQualifiedReleaseRehearsal(game, payload.productId, payload.candidateModelId, CONTENT);
      add('Passed rehearsal', rehearsal?.companyId === game.playerCompanyId ? `${rehearsal.id} · available Week ${rehearsal.availableWeek}` : 'Run a successful rehearsal with this product, model and settings first');
      add('Preparation effort', `${units(PREPARED_RELEASE_RULES.forwardWork, 'development CUw')} · ${staffEffort(PREPARED_RELEASE_RULES.forwardStaff, 'ml')}`);
      break;
    }
    case 'start_release_rehearsal': add('Comparison scope', `${RELEASE_REHEARSAL_RULES.cases} reserved cases · ${RELEASE_REHEARSAL_RULES.cases * RELEASE_REHEARSAL_RULES.exchangesPerCase} exchanges per model`); break;
    case 'start_release_rollback': add('Rollback preparation effort', `${units(PREPARED_RELEASE_RULES.rollbackWork, 'development CUw')} · ${staffEffort(PREPARED_RELEASE_RULES.rollbackStaff, 'ml')}`); break;
    case 'start_release_canary':
      field('shareBps', 'Paid traffic sent to the new model', percent(payload.shareBps));
      field('sampleFloor', 'Minimum sample per customer group', payload.sampleFloor.toLocaleString() + ' exchanges');
      field('budgetCUw', 'Live test compute limit', units(payload.budgetCUw, 'CUw; not a cash charge')); break;
    case 'accept_private_appliance_order': {
      if (!owned(game.slices.models.versions[payload.modelId]) || !owned(game.slices.compute.chipDesigns[payload.designId])) break;
      const terms = previewPrivateApplianceOrder(game, payload, CONTENT);
      add('Fabrication and delivery setup', `${formatMoney(terms.fabricationCostCents)} fabrication + ${formatMoney(terms.deliverySetupCents)} setup`);
      add('Payment after customer approval', `${formatMoney(terms.bundlePriceCents)} after acceptance`);
      add('License and support term', `${terms.termWeeks} weeks · ${formatMoney(terms.licenseWeeklyCents)} / week · ${staffEffort(terms.supportStaffPerWeek, 'commercial') + ' / week'}`);
      add('Delivery effort', staffEffort(terms.requiredDeliveryStaff));
      if (terms.configuration) { const config = terms.configuration; add('Customer hardware', `${config.racks} racks · ${units(config.usableCU, 'useful CU')} · ${units(config.memoryMU, 'MU')} · ${config.leadWeeks} fabrication weeks`); }
      break;
    }
    case 'set_cloud_capacity': add('Current cloud reservation', units(game.slices.compute.fleets[game.playerCompanyId].cloudCU, 'CU')); field('cu', 'Proposed cloud reservation', units(payload.cu, 'CU')); break;
    case 'allocate_compute':
      for (const key of ['serving', 'development', 'research'] as const) field(key, words(key) + ' CU: current → proposed', `${formatUnits(game.slices.compute.fleets[game.playerCompanyId].allocation[key])} → ${formatUnits(payload[key])}`); break;
    case 'set_batch_capacity': field('cloudCU', 'Cloud reservation', units(payload.cloudCU, 'CU')); field('servingCU', 'Serving allocation', units(payload.servingCU, 'CU')); break;
    case 'order_rack': add('Rack capacity', units(CONTENT.infrastructure.rackCU, 'CU')); add('Delivery and installation', `${CONTENT.infrastructure.deliveryWeeks} delivery weeks · ${staffEffort(CONTENT.infrastructure.installationStaffWeeks, 'infrastructure')} to install`); break;
    case 'install_rack': add('Installation effort', staffEffort(CONTENT.infrastructure.installationStaffWeeks, 'infrastructure')); break;
    case 'start_facility': add('Site construction', CONTENT.infrastructure.stages.map(stage => `${stage.name}: ${formatMoney(stage.costCents)}`).join(' · ')); add('Capacity when built', units(CONTENT.infrastructure.siteSlotsCU, 'CU of rack slots; hardware purchased separately')); break;
    case 'start_facility_retrofit': {
      const retrofit = FACILITY_RETROFITS.find(item => item.kind === payload.retrofitKind);
      if (retrofit) { field('retrofitKind', 'Extension', retrofit.name); add('Construction effort', `${retrofit.requiredWeeks} weeks · ${staffEffort(retrofit.requiredStaff, 'infrastructure')}`); add('Added site capacity', units(retrofit.envelopeUnits, retrofit.envelopeName.toLowerCase() + ' units')); add('Extension operation', `${formatMoney(retrofit.weeklyCents)} / week · ${staffEffort(retrofit.operatingStaff, 'infrastructure') + ' / week'}`); }
      break;
    }
    case 'start_facility_specialization': {
      const profile = FACILITY_PROFILES.find(item => item.profile === payload.profile);
      if (profile) { field('profile', 'Site profile', profile.name); add('Site upgrade work', `${profile.requiredWeeks} weeks · ${staffEffort(profile.requiredStaff, 'infrastructure')} · ${units(profile.requiredWork, 'CUw')} · ${units(profile.requiredMemory, 'MU')}`); notes.push(profile.benefit, profile.tradeoff, 'Your current site setup stays active during the upgrade. The new setup takes over when the work is finished and ready to use.'); }
      break;
    }
    case 'start_chip_design': {
      field('spec', 'Chip specification', `${words(payload.spec.architecture)} · ${words(payload.spec.target)} · ${words(payload.spec.memory)} memory`);
      const terms = chipSpecificationValues(payload.spec); add('Design effort', `${units(terms.designWorkCUw, 'CUw')} · ${staffEffort(terms.designHardwareStaff, 'hardware')}`); break;
    }
    case 'start_chip_successor':
      add('Successor design effort', `${units(GEN2_SILICON_RULES.designWorkCUw, 'CUw')} · ${staffEffort(GEN2_SILICON_RULES.designHardwareStaff, 'hardware')}`);
      notes.push('Design and test a new prototype for this chip before ordering production. Both steps have their own costs.'); break;
    case 'order_chip_batch':
    case 'accept_hardware_order': {
      const design = owned(game.slices.compute.chipDesigns[payload.designId]);
      const buyer = payload.kind === 'accept_hardware_order' ? HARDWARE_BUYERS[payload.buyerId] : undefined;
      const racks = payload.kind === 'order_chip_batch' ? payload.racks : buyer!.racks;
      if (design) {
        const terms = chipProductionTerms(design, racks, CONTENT.infrastructure.rackCU, payload.foundry ?? 'standard');
        add('Fabrication', `${racks} rack${racks === 1 ? '' : 's'} · ${units(terms.attemptedCU, 'attempted CU')} · ${units(terms.usableCU, 'useful CU')} · ${percent(terms.yieldBps)} yield`);
        add('Fabrication lead time', `${terms.leadWeeks} weeks`);
        if (!payload.foundry) add('Foundry route', CHIP_FOUNDRIES.standard.name);
      }
      if (buyer) { add('Hardware sale payment', `${formatMoney(buyer.priceCents)} on shipment`); notes.push('These chips go to the customer, so your lab’s compute stays the same.'); }
      break;
    }
    case 'sign_assurance_contract': {
      const buyer = ASSURANCE_BUYERS.find(item => item.id === payload.buyerId);
      if (buyer) { add('Assurance term', `${ASSURANCE_RULES.termWeeks} weeks · ${buyer.weeklyRequests.toLocaleString()} requests / week`); add('Weekly contract price', formatMoney(buyer.weeklyPriceCents)); add('Support staff needed', staffEffort(buyer.supportStaffPerWeek, 'commercial') + ' / week'); add('Onboarding effort', staffEffort(ASSURANCE_RULES.onboardingStaff)); }
      break;
    }
    case 'install_fast_fabric': add('Installation effort', `${CHIP_RULES.fabricElapsedWeeks} weeks · ${staffEffort(CHIP_RULES.fabricStaff, 'infrastructure')} · ${units(CHIP_RULES.fabricWorkCUw, 'CUw')}`); add('Operating upkeep', `${formatMoney(CHIP_RULES.fabricFixedCentsPerWeek)} / week`); break;
    case 'create_model_variant': { const rule = VARIANT_RULES[payload.variant]; field('variant', 'Application', rule.name); add('Application effort', `${units(rule.work, 'CUw')} · ${staffEffort(rule.staff, 'ml')}`); notes.push('Creates a new version of the model. Test the new version before release; the original model’s test results do not carry over.'); break; }
    case 'install_product_efficiency': { const rule = EFFICIENCY_RULES[payload.method]; field('method', 'Installation', rule.name); add('Installation effort', `${units(rule.work, 'CUw')} · ${staffEffort(rule.staff)}`); break; }
    case 'start_system_rollout': { const rule = SYSTEM_RULES[payload.method]; field('method', 'System rollout', rule.name); add('Rollout effort', `${units(rule.work, 'CUw')} · ${staffEffort(rule.staff)}`); break; }
    case 'start_agent_job': {
      const board = getAgentView(game, game.playerCompanyId, CONTENT);
      const order = [...board.orders, ...board.codingOrders].find(item => item.id === payload.orderId);
      field('orderId', 'Agent order', identity('agent order', payload.orderId, order?.name));
      if (order) { add('Order window', `Weeks ${order.availableWeek}–${order.expiresWeek}`); add('Job size', `${order.caseCount} cases`); add('Payment terms', `${formatMoney(order.draftFeeCents)} reviewed draft · ${formatMoney(order.outcomeFeeCents)} verified outcome · ${formatMoney(order.failurePenaltyCents)} failure penalty`); }
      field('tools', 'Allowed tools', payload.tools.length ? payload.tools.map(tool => AGENT_TOOLS.find(item => item.id === tool)?.name ?? words(tool)).join(', ') : 'None');
      break;
    }
    case 'accept_batch_job': {
      const order = BATCH_ORDERS.find(item => item.id === payload.orderId);
      field('orderId', 'Batch order', identity('batch order', payload.orderId, order?.name));
      if (order) add('Batch job size', `${order.requests.toLocaleString()} requests · ${order.windowWeeks} week window`);
      if (!payload.poolId) add('Placement', 'Choose compatible hardware automatically'); break;
    }
    case 'accept_customer_brief': {
      const brief = CUSTOMER_BRIEFS[payload.briefId];
      field('briefId', 'Customer brief', brief.title);
      add('Client', brief.client);
      add('Delivery window', `${brief.weeks} weeks`);
      add('Fee on delivery', formatMoney(brief.feeCents));
      notes.push(brief.terms);
      break;
    }
    case 'dismiss_staff': { const member = owned(game.slices.company.staff[payload.staffId]); field('staffId', 'Employee', identity('employee', payload.staffId, member ? ROLE_LABELS[member.role] : undefined)); break; }
  }

  // Explicit formats preserve the units of captured terms; scalar fallback makes
  // less common options visible without dumping object representations into UI.
  for (const [key, value] of Object.entries(payload)) {
    if (handled.has(key) || value === undefined) continue;
    if (key === 'features' && typeof value === 'object' && value !== null) {
      for (const [feature, enabled] of Object.entries(value)) add(words(feature), enabled ? 'Enabled' : 'Disabled');
    } else if (typeof value === 'boolean') add(words(key), value ? 'Yes' : 'No');
    else if (typeof value === 'number') {
      const amount = key.endsWith('Cents') ? formatMoney(value) : ['workBudget', 'weeklyWorkCapCUw', 'budgetCUw'].includes(key) ? units(value, 'CUw') : key === 'maxAssistedFte' ? staffEffort(value, 'research') + ' / week' : value.toLocaleString();
      add(({ priceCents: 'New price / account / week', allowance: 'New included exchanges', workBudget: 'Total work allowance', weeklyWorkCapCUw: 'Weekly work cap', maxSteps: 'Maximum steps', maxRetries: 'Maximum retries' } as Record<string, string>)[key] ?? words(key), amount);
    } else if (typeof value === 'string') add(key === 'foundry' ? 'Foundry route' : words(key), key === 'foundry' ? CHIP_FOUNDRIES[value as keyof typeof CHIP_FOUNDRIES]?.name ?? words(value) : key.endsWith('Id') || key === 'name' ? value : words(value));
  }

  if (payload.kind.includes('synthetic')) notes.push('Generate the data, pay your team to review it, then run an independent check. Only data that passes can be used for training, which has its own cost.');
  if (payload.kind.includes('release') || payload.kind.includes('rehearsal')) notes.push('Your current model keeps serving customers during rehearsal and preparation. Both use staff and compute. When the new model is ready, choose when to switch.');
  if (payload.kind.includes('canary')) notes.push('The live test sends a share of paid requests to the new model. Free trials stay on the current model, and customers are charged once. The compute limit caps test usage; it does not prepay the bill or switch the full product automatically.');
  if (payload.kind === 'start_release_rollback' || payload.kind === 'set_prepared_release_paused') notes.push('Preparing a rollback costs work points and compute. You must confirm the switch when it is ready. Pausing does not extend the rollback deadline.');
  if (payload.kind === 'discard_prepared_release') notes.push('Your current model stays live. Money and work already spent on preparation are not refunded.');
  if (payload.kind === 'accept_private_appliance_order') notes.push('Build and ship the appliance, then install it for the customer. You receive the bundle payment after they accept it. The hardware belongs to them and adds no compute to your lab; license income and support continue for the agreed term.');
  if (/rack|facility|fabric|chip/.test(payload.kind) || payload.kind === 'accept_hardware_order') notes.push('Hardware must arrive and be installed before you can use it. Check that the site has room, power, cooling, compatible memory and staff. Wages and fixed upkeep can continue while work is paused or racks are parked.');
  if (payload.kind === 'start_rack_relocation' || payload.kind === 'set_rack_relocation_paused') notes.push('A rack is offline while it moves. Its hardware and installation stay intact, and its compute becomes available at the new site after the move.');
  if (payload.kind.includes('chip') || payload.kind === 'accept_hardware_order') notes.push('Design the chip, test a prototype, order production, then install the finished racks. Each step takes its own resources; compute becomes usable after installation.');
  if (payload.kind.includes('agent')) notes.push('Choose what the agent may do and set its step, retry and compute limits. A draft, a customer action and a checked result are different stages. Taking the job earns no payment by itself.');
  if (productBatchCommand) notes.push('You earn money for completed requests. Deadlines keep counting down during pauses or shortages. Your chosen hardware and compute limit still share resources with other work.');
  if (payload.kind.includes('business') || payload.kind.includes('assurance')) notes.push('Finish delivery or customer setup before service begins. Income depends on the contract and the service you provide. Keep enough staff, memory and compute available for support.');
  if (payload.kind.includes('feedback')) notes.push('Collect new examples using the permission level you chose. Gathering and reviewing feedback does not train a model. Select the reviewed data in a later training run to use it.');
  if (payload.kind === 'set_product_terms' || payload.kind === 'set_product_features' || payload.kind === 'set_consumer_sessions' || payload.kind === 'set_runtime_guardrail_enabled') notes.push('These changes affect your live product. Features and chat history can use more compute or memory. Changing settings may require new release tests or contract checks.');
  if (payload.kind === 'upgrade_product') notes.push('Replacing the model directly pauses service during setup and credits subscribers for missed service. Finish the launch work before the new model goes live. Changed settings may need fresh tests.');
  return { facts, notes };
}
