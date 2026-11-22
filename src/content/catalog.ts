import { CONNECTED_COMPANY_CONTENT_VERSION } from '../core/connected-company-version';
import { AI_SYSTEMS_CONTENT_VERSION } from '../core/ai-systems-version';
import { AI_SYSTEM_RESEARCH } from './ai-systems';
import { DESIGN_RESEARCH } from './model-designs';
import { CUSTOMIZATION_RESEARCH } from './model-customization-research';
import { WORKFORCE_POINTS_CONTENT_VERSION } from './wave29';
import { INFRASTRUCTURE_CONTENT } from './wave2-infrastructure';
import type { GameContent } from '../contracts/types';

/**
 * Frontier Lab, Technical Systems Edition 3.0, pp. 5, 8, 10, 16, 24-29, 32.
 * These are fictional game values. Money is cents, resource quantities use 1e9,
 * and scores/coverage/quality use basis points. Work is charged by its owner;
 * research fees below exclude wages, compute, and later application work.
 */
export const CONTENT: GameContent = {
  version: CONNECTED_COMPANY_CONTENT_VERSION,
  buildVersion: '0.38.2',
  infrastructure: INFRASTRUCTURE_CONTENT,
  title: 'Frontier Lab',
  opening: {
    companyId: 'company-player',
    companyName: 'Frontier Lab',
    seed: 'frontier-lab-wave-0',
    cashCents: 4_800_000,
    cloudCU: 4_000_000_000,
    memoryMU: 8_000_000_000,
    rentCentsPerCUWeek: 20_000,
    overheadCentsPerWeek: 20_000,
    waitlist: 40,
    allocation: { serving: 0, development: 2_000_000_000, research: 0 },
  },
  clock: { secondsPerWeek: 10, speeds: [1, 2, 5] },
  seedModel: {
    id: 'seed-0',
    name: 'Seed 0',
    companyId: 'company-player',
    family: 'compact',
    architecture: 'dense',
    status: 'checkpoint',
    capabilityBps: { conversation: 4_000, documents: 3_000, coding: 2_000, tools: 2_000 },
    reliabilityBps: 7_000,
    residentMU: 2_000_000_000,
    source: 'Your starting model, licensed for commercial use. Its included test report helps you plan your first training run.',
  },
  starterData: {
    id: 'starter-public',
    name: 'Starter public sample',
    rawUnits: 100,
    readyUnits: 0,
    qualityBps: 8_000,
    coverageBps: { conversation: 10_000, documents: 3_500, coding: 2_500, tools: 2_500 },
    rights: { hosted: true, weights: true, feedback: false },
    prepared: false,
  },
  preparation: { feeCents: 100_000, staffWeeks: 2 },
  firstTraining: {
    id: 'compact-conversation-adaptation',
    name: 'Conversation adaptation',
    workCUw: 12_000_000_000,
    relevantUnits: 100,
    conversationTargetBps: 5_000,
    reliabilityAnchorBps: 7_000,
    reliabilityTargetBps: 9_000,
  },
  evaluation: { workCUw: 2_000_000_000, researchStaffWeeks: 0.5, cases: 20 },
  firstSale: {
    minConversationBps: 4500, minReliabilityBps: 6500,
    defaultPriceCents: 1200, defaultAllowance: 100, population: 4000,
    weeklyReach: 20, reachPerCommercialFte: 15, shoppingBps: 300,
    conversionBps: 4500, churnBps: 100, trialWork: 5_000_000,
    exchangeWork: 200_000, sessionMemory: 20_000_000, servingHeadroomBps: 1000,
    deploymentStaff: 1_000_000_000, trainingMemory: 4_000_000_000,
    trainingWorkPerMl: 4_000_000_000,
    trainingTargetsBps: { conversation: 5000, documents: 3200, coding: 2000, tools: 2400 },
    minPriceCents: 100, maxPriceCents: 10000, minAllowance: 25, maxAllowance: 500,
    maxCloudCU: 128_000_000_000,
  },
  staff: [
    { id: 'research', name: 'Researcher', weeklyCents: 45_000, recruitmentCents: 225_000, onboardingWeeks: 2 },
    { id: 'ml', name: 'ML engineer', weeklyCents: 30_000, recruitmentCents: 150_000, onboardingWeeks: 2 },
    { id: 'data', name: 'Data engineer', weeklyCents: 25_000, recruitmentCents: 125_000, onboardingWeeks: 2 },
    { id: 'infrastructure', name: 'Infrastructure engineer', weeklyCents: 35_000, recruitmentCents: 175_000, onboardingWeeks: 2 },
    { id: 'commercial', name: 'Product / commercial', weeklyCents: 25_000, recruitmentCents: 125_000, onboardingWeeks: 2 },
    { id: 'hardware', name: 'Hardware specialist', weeklyCents: 60_000, recruitmentCents: 300_000, onboardingWeeks: 2, availableOnResearchEntry: 'R16' },
  ],
  hardware: [
    { id: 'general', name: 'General GPU', purchaseCentsPerCU: 225_000, cloudCentsPerCUWeek: 20_000, variableCentsPerCUw: 5_000, memoryMUPerCU: 2_000_000_000, trainingMultiplier: 1, servingMultiplier: 1, powerPerCU: 1 },
    { id: 'memory-rich', name: 'Memory-rich GPU', purchaseCentsPerCU: 340_000, cloudCentsPerCUWeek: 26_000, variableCentsPerCUw: 5_500, memoryMUPerCU: 4_000_000_000, trainingMultiplier: 1.1, servingMultiplier: 1, powerPerCU: 1.1 },
    { id: 'training', name: 'Training GPU', purchaseCentsPerCU: 400_000, cloudCentsPerCUWeek: 33_000, variableCentsPerCUw: 7_500, memoryMUPerCU: 2_000_000_000, trainingMultiplier: 1.8, servingMultiplier: 1.1, powerPerCU: 1.6 },
  ],
  research: [
    {
      id: 'R1', name: 'Evaluation suite', requires: [], feeCents: 100_000,
      role: 'research', staffWeeks: 2, workCUw: 2_000_000_000, implemented: true,
      description: "Unlock 100-case tests and model comparisons. Tests show how well a model performs; training is what improves it. Each test needs its own work points and compute.",
    },
    {
      id: 'R2', name: 'Data curation', requires: ['R1'], feeCents: 200_000,
      role: 'data', staffWeeks: 3, workCUw: 4_000_000_000, implemented: true,
      description: "Clean an existing dataset to raise its quality by 10 points, up to 95%. Each cleaning job needs Data points. It keeps the same amount of data and skill coverage.",
    },
    {
      id: 'R3', name: 'Checkpoint automation', requires: [], feeCents: 150_000,
      role: 'ml', staffWeeks: 2, workCUw: 2_000_000_000, implemented: true,
      description: "Save progress every 10% during future training runs, using extra compute. Runs already save halfway through and at the end. More checkpoints give you more versions to inspect, without improving their scores.",
    },
    {
      id: 'R4', name: 'Efficient adaptation', requires: ['R2'], feeCents: 400_000,
      role: 'ml', staffWeeks: 4, workCUw: 6_000_000_000, implemented: true,
      description: "Use 25% less training work for eligible adaptation runs started after this discovery. Runs already in progress, foundation training and customer-serving costs stay the same.",
    },
    {
      id: 'R5', name: 'Preference tuning', requires: ['R1', 'R2'], feeCents: 400_000,
      role: 'research', staffWeeks: 3, workCUw: 8_000_000_000, implemented: true,
      description: "Unlock training methods that improve model behavior and reliability. Each run still needs suitable feedback data, training compute and a test afterward.",
    },
    {
      id: 'R6', name: 'Retrieval', requires: ['R2'], feeCents: 300_000,
      role: 'ml', staffWeeks: 3, workCUw: 6_000_000_000, implemented: true,
      description: "Let Business Documents look up information in a document index. Setup takes 40 Design points. Each business customer then needs 2 Data points each week for upkeep. This adds a product feature without retraining the model.",
    },
    {
      id: 'R7', name: 'Compression', requires: ['R1'], feeCents: 400_000,
      role: 'ml', staffWeeks: 4, workCUw: 8_000_000_000, implemented: true,
      description: "Create a compressed model that aims to use 20% less serving compute, with a task-score loss of up to three points. Applying it takes 40 Design points and two development CUw. Test the new version before launch.",
    },
    {
      id: 'R8', name: 'Request routing', requires: ['R7'], feeCents: 500_000,
      role: 'ml', staffWeeks: 4, workCUw: 8_000_000_000, implemented: true,
      description: "Send easy and difficult requests to different tested models. Setup takes 40 Design points and two development CUw. Both models still need memory, and routing adds 0.00002 baseline CUw per request.",
    },
    {
      id: 'R9', name: 'Defined workflows', requires: ['R1', 'R6'], feeCents: 500_000,
      role: 'ml', staffWeeks: 4, workCUw: 10_000_000_000, implemented: true,
      description: "Unlock support agents with approved tools, step limits and basic checks. Choose draft-only work or require approval before action. Every model call, check and retry uses resources.",
    },
    {
      id: 'R10', name: 'Outcome verification', requires: ['R9'], feeCents: 600_000,
      role: 'research', staffWeeks: 4, workCUw: 12_000_000_000, implemented: true,
      description: "Check agent results independently and charge for successful work. These checks use compute and can still miss mistakes. An agent saying “done” is not enough to earn payment.",
    },
    {
      id: 'R11', name: 'Bounded agents', requires: ['R5', 'R10'], feeCents: 800_000,
      role: 'ml', staffWeeks: 6, workCUw: 16_000_000_000, implemented: true,
      description: "Let agents choose their next steps within the tools, permissions and budget you set. Human approval, retry limits and result checks still apply.",
    },
    {
      id: 'R12', name: 'Enterprise operations', requires: ['R3', 'R10'], feeCents: 800_000,
      role: 'infrastructure', staffWeeks: 6, workCUw: 12_000_000_000, implemented: true,
      description: "Unlock private services, customer-hosted licenses, site extensions, rack moves and planned model releases. Testing and setup need staff and compute. Contracts still require the right licenses and enough capacity; customers run customer-hosted models on their own hardware.",
    },
    {
      id: 'R13', name: 'Distillation', requires: ['R4', 'R7'], feeCents: 1_000_000,
      role: 'research', staffWeeks: 6, workCUw: 20_000_000_000, implemented: true,
      description: "Teach a smaller student model using a model you own and have permission to transfer from. The tested teacher needs a score of at least 60 in the chosen skill and a 10-point lead over the student’s starting score. Teacher calls and student training are charged separately.",
    },
    {
      id: 'R14', name: 'Sparse architecture', requires: ['R3', 'R4'], feeCents: 1_200_000,
      role: 'research', staffWeeks: 8, workCUw: 30_000_000_000, implemented: true,
      description: "Requires at least 16 compatible CU. Unlock sparse models for new foundation runs. You still need enough memory and compatible fast fabric; buy and install the hardware separately.",
    },
    {
      id: 'R15', name: 'Research assistant', requires: ['R11'], feeCents: 1_000_000,
      role: 'research', staffWeeks: 6, workCUw: 20_000_000_000, implemented: true,
      description: "Requires tested Coding 65 and Tools 60. After setup, an assistant can add up to 20% to eligible research staff progress. Each 20 Research points assisted uses 0.25 baseline serving CUw and 2 Business points for review. Research compute costs stay the same, and assistants cannot boost themselves.",
    },
    {
      id: 'R16', name: 'Chip feasibility', requires: ['R7', 'R12'], feeCents: 1_500_000,
      role: 'hardware', staffWeeks: 8, workCUw: 16_000_000_000, implemented: true,
      description: "Requires eight weeks of serving history. Starting this research unlocks hardware hiring, so specialists can help with its 160 Hardware points. Then design chips and compare their costs; finished hardware must still be built.",
    },
    {
      id: 'R1A', parentId: 'R1', name: 'Behavior cases', requires: ['R1'], feeCents: 150_000,
      role: 'research', staffWeeks: 2, workCUw: 4_000_000_000, implemented: true,
      description: "Test whether a model gives confident wrong answers, refuses valid requests or asks for clarification. Each 100-case test uses four development CUw and 20 Research points. Testing measures behavior without training the model.",
    },
    {
      id: 'R2A', parentId: 'R2', name: 'Deduplication', requires: ['R2'], feeCents: 100_000,
      role: 'data', staffWeeks: 2, workCUw: 2_000_000_000, implemented: true,
      description: "Remove repeated data so future training can use up to 10% less update work. Setup takes 20 Design points and one development CUw. Unique examples, quality, licenses and training targets stay the same; runs already in progress keep their original costs.",
    },
    {
      id: 'R3B', parentId: 'R3', name: 'Run supervisor', requires: ['R3'], feeCents: 100_000,
      role: 'ml', staffWeeks: 2, workCUw: 2_000_000_000, implemented: true,
      description: "Automate training supervision after testing and setup. Setup takes 20 Design points and one development CUw. Each familiar run then needs 10 Design points per week, plus 5 for each started group of eight CU. Unfamiliar or sparse runs need another 10 Design points until one run is finished and tested. GPUs still do the training work.",
    },
    {
      id: 'R4B', parentId: 'R4', name: 'Adapter bank', requires: ['R4'], feeCents: 100_000,
      role: 'ml', staffWeeks: 2, workCUw: 2_000_000_000, implemented: true,
      description: "Let dense adaptations share one unchanged base model in the same serving pool. Each different adapter adds 0.25 MU. Setup takes 20 Design points and one development CUw. Requests still need their usual compute and cache memory; unrelated models cannot share a base.",
    },
    {
      id: 'R4C', parentId: 'R4', name: 'Replay curricula', requires: ['R4'], feeCents: 300_000,
      role: 'research', staffWeeks: 3, workCUw: 6_000_000_000, implemented: true,
      description: "Practice an old skill while learning a new one. Use one replay dataset for 25% or 50% of training, or split 50% or 75% between two skills. All updates need GPUs and ML supervision. Use separate, suitable datasets with the right licenses, then test the result.",
    },
    {
      id: 'R5A', parentId: 'R5', name: 'Calibration curriculum', requires: ['R5', 'R1A'], feeCents: 300_000,
      role: 'research', staffWeeks: 4, workCUw: 8_000_000_000, implemented: true,
      description: "Unlock behavior training using 100 reviewed cases and 16 CUw. It aims to halve the original model’s rate of confident wrong answers. The model learns to ask for clarification, explain limits or seek help instead; those responses still use compute or review time.",
    },
    {
      id: 'R6A', parentId: 'R6', name: 'Evidence links', requires: ['R6', 'R10'], feeCents: 100_000,
      role: 'ml', staffWeeks: 2, workCUw: 2_000_000_000, implemented: true,
      description: "Check that Business Documents answers have supporting sources. Requires active retrieval. Setup takes 20 Design points and one development CUw; each request adds 0.00002 baseline CUw. Unsupported answers are held for clarification. A supporting source does not guarantee that an answer is correct.",
    },
    {
      id: 'R7A', parentId: 'R7', name: 'Memory format', requires: ['R7'], feeCents: 100_000,
      role: 'ml', staffWeeks: 2, workCUw: 2_000_000_000, implemented: true,
      description: "Create a model version that uses half the memory for its weights, with a five-point task-score loss. Setup takes 20 Design points and one development CUw, followed by testing. Chat memory and compute costs stay the same. This format cannot be combined with compression on one version.",
    },
    {
      id: 'R8A', parentId: 'R8', name: 'Prefix cache', requires: ['R8'], feeCents: 100_000,
      role: 'ml', staffWeeks: 2, workCUw: 2_000_000_000, implemented: true,
      description: "Reuse repeated input for 20% of its usual input compute work. Each customer has a separate cache that uses memory. Output and reasoning within the same call still cost the usual amount. Test the method, then spend 20 Design points and one development CUw on setup.",
    },
    {
      id: 'R9A', parentId: 'R9', name: 'Action receipts', requires: ['R9'], feeCents: 100_000,
      role: 'ml', staffWeeks: 2, workCUw: 2_000_000_000, implemented: true,
      description: "Continue paused or over-budget support jobs without repeating a customer action. Setup takes 20 Design points and one development CUw, and continued work is paid. Keep the same results, tools and total usage across at most two handoffs. Recovery cannot undo a wrong action or reopen a bill.",
    },
    {
      id: 'R10A', parentId: 'R10', name: 'Independent holdouts', requires: ['R10', 'R1'], feeCents: 150_000,
      role: 'research', staffWeeks: 2, workCUw: 4_000_000_000, implemented: true,
      description: "Check how well an agent’s claims match useful results, including false approvals and needless retries. Run this separate 100-case test after a capability test. It costs four development CUw and 20 Research points. Unlocking the test does not improve the checker by itself.",
    },
    {
      id: 'R11A', parentId: 'R11', name: 'Budgeted planner', requires: ['R11'], feeCents: 300_000,
      role: 'research', staffWeeks: 4, workCUw: 8_000_000_000, implemented: true,
      description: "Train an agent planner on 100 cases for 16 CUw. The recipe aims to cut avoidable repeated steps by 20% from the original model’s rate. Required steps, checks, task difficulty and hard budgets still apply.",
    },
    {
      id: 'R12A', parentId: 'R12', name: 'Capacity forecast', requires: ['R12'], feeCents: 100_000,
      role: 'infrastructure', staffWeeks: 2, workCUw: 2_000_000_000, implemented: true,
      description: "Plan capacity twelve weeks ahead or track actual costs. Each tool takes 20 Design points and one development CUw to install. Forecasts compare expected growth with connected memory, staff and compute, without reserving them. Cost reports show work, idle rentals and shared upkeep.",
    },
    {
      id: 'S1', name: 'Synthetic provenance', requires: ['R2A', 'R10A'], feeCents: 600_000,
      role: 'data', staffWeeks: 3, workCUw: 6_000_000_000, implemented: true,
      description: "Generate new training examples from an approved teacher and licensed source data. Pay separately for generation, review and checks that remove overlaps. Accepted examples keep the most restrictive permissions from the teacher and source data. Reserved test cases stay out of training.",
    },
    {
      id: 'S2', name: 'Targeted synthetic curriculum', requires: ['S1', 'R4C'], feeCents: 900_000,
      role: 'ml', staffWeeks: 5, workCUw: 12_000_000_000, implemented: true,
      description: "Train a separate student using approved synthetic data. Its learning target stays below the teacher’s score. Generation, review, training and independent testing each have their own cost.",
    },
    {
      id: 'S3', name: 'Release telemetry', requires: ['R1A', 'R12A'], feeCents: 700_000,
      role: 'research', staffWeeks: 4, workCUw: 8_000_000_000, implemented: true,
      description: "Test a new model on a small share of live paid traffic. Set the minimum sample and compute limit, then compare completed requests, costs and behavior with the current model. The test stops for worse results, serious incidents or insufficient spare capacity.",
    },
    {
      id: 'S4', name: 'Private appliance', requires: ['R7A', 'R12', 'S3'], feeCents: 1_100_000,
      role: 'infrastructure', staffWeeks: 5, workCUw: 12_000_000_000, implemented: true,
      description: "Deliver a fixed model-and-hardware package for a customer to run. Check the package first, then pay for production and installation. Customer approval and ongoing support have their own license, staffing, capacity and payment rules.",
    },
    {
      id: 'S5', name: 'Facility specialization', requires: ['R12A'], feeCents: 1_400_000,
      role: 'infrastructure', staffWeeks: 6, workCUw: 14_000_000_000, implemented: true,
      description: "Requires a working data center you own. Unlock a paid upgrade that specializes a site in serving or training. Each site can use one setup at a time, improving one workload at the cost of capacity for the other. Build the upgrade after researching it.",
    },
    {
      id: 'S6', name: 'Second-generation silicon', requires: ['R16', 'S5'], feeCents: 2_200_000,
      role: 'hardware', staffWeeks: 8, workCUw: 18_000_000_000, implemented: true,
      description: "Requires a completed accelerator shipment to a buyer. Design a next-generation chip with more memory or higher compatible throughput. Fund its design and prototype separately, then produce it for your lab or a customer.",
    },
    ...DESIGN_RESEARCH,
    ...CUSTOMIZATION_RESEARCH,
    ...AI_SYSTEM_RESEARCH,
  ],
  roadmap: [
    { wave: 0, title: 'Foundation', description: 'Shared state, deterministic weeks, validated commands, opening content, and versioned snapshots.', status: 'complete' },
    { wave: 1, title: 'First sale', description: 'Prepare data, hire, adapt, evaluate, launch Basic Chat, serve customers, and collect a correct bill.', status: 'complete' },
    { wave: 2, title: 'Strategic company', description: 'Research, model choices, customers, rivals, physical hardware, and standard facilities.', status: 'complete' },
    { wave: 3, title: 'Agents and commitments', description: 'Bounded support work, independent checks, human review, outcome billing, and licensing.', status: 'complete' },
    { wave: 4, title: 'Late game', description: 'Applied research, compatible custom chips, and distinct routes to victory.', status: 'complete' },
    { wave: 5, title: 'Release', description: 'Full campaign playthroughs, measured progression, clearer guidance, save compatibility, and release checks.', status: 'complete' },
    { wave: 6, title: 'Evidence and operations', description: 'Deduplicate training inputs, check document evidence, and plan twelve weeks of capacity and commitments.', status: 'complete' },
    { wave: 7, title: 'Specialists and agents', description: 'Share compatible adapter bases, test independent outcomes, train bounded planners, and recover agent workflows with preserved receipts.', status: 'complete' },
    { wave: 8, title: 'Physical scale and costs', description: 'Expand facility power and cooling, relocate paid hardware, and reconcile workload costs with the company ledger.', status: 'complete' },
    { wave: 9, title: 'Model release operations', description: 'Rehearse candidate models, prepare a replacement while the current model serves, and fund a bounded rollback when needed.', status: 'complete' },
    { wave: 10, title: 'Customer feedback', description: 'Collect consenting examples from paid Chat and API use, fund data review, and train evaluated candidates with reusable, licensed feedback.', status: 'complete' },
    { wave: 11, title: 'Policy learning', description: 'Train on licensed allowed/restricted pairs, compare two refusal strategies, and test exact candidates before commercial use.', status: 'complete' },
    { wave: 12, title: 'Runtime guardrails', description: 'Audit balanced and strict response checks, pay their serving costs, and bind protection to the exact deployed configuration.', status: 'complete' },
    { wave: 13, title: 'Assured API contracts', description: 'Qualify for enterprise buyers, reserve dedicated workloads and support, and earn retainers after delivered-service credits.', status: 'complete' },
    { wave: 14, title: 'Batch inference', description: 'Process deferred customer orders with spare serving capacity, choose efficient models, and earn payment for completed work before fixed deadlines.', status: 'complete' },
    { wave: 15, title: 'Replay curricula', description: 'Spend training compute on separate replay data to preserve an evaluated skill while learning another, then test the candidate for commercial use.', status: 'complete' },
    { wave: 16, title: 'Compute planning and profitability', description: 'Compare connected batch pools, forecast finite delivery and GPU costs, and choose placement and cloud reservations before committing.', status: 'complete' },
    { wave: 17, title: 'Training experiments and deeper curricula', description: 'Compare training designs and fund separate replay corpora to preserve two evaluated skills during a new specialization.', status: 'complete' },
    { wave: 18, title: 'Persistent consumer sessions', description: 'Continuing consumer conversations with bounded history, recurring usage, and real serving costs.', status: 'complete' },
    { wave: 19, title: 'Coding agent business', description: 'Scoped repository work, paid sandbox tests, human checkpoints, and audited delivery.', status: 'complete' },
    { wave: 20, title: 'Strategic rivals and commercial competition', description: 'Distinct rival strategies, comparable public offers, contested buyers and renewable licenses.', status: 'complete' },
    { wave: 21, title: 'Campaign completion and release', description: 'Rebalanced endings, weekly operating summary, clearer opening and direct local recovery.', status: 'complete' },
    { wave: 22, title: 'Foundries and production', description: 'Compare fabrication cost, lead time, yield and foundry capacity before ordering custom racks.', status: 'complete' },
    { wave: 23, title: 'Accelerator sales', description: 'Match qualified custom designs to finite hardware buyers and collect on verified shipment.', status: 'complete' },
    { wave: 24, title: 'Studio shell', description: 'Explore actual company work through the garage, stations, projects and accessible workbenches.', status: 'complete' },
    { wave: 25, title: 'Studio planning', description: 'Review workforce, connected pools and exact next-week capacity before applying one atomic plan.', status: 'complete' },
    { wave: 26, title: 'Research and synthetic data', description: 'Navigate the research graph, produce audited synthetic evidence and train independently evaluated specialists.', status: 'complete' },
    { wave: 27, title: 'Release desk and private appliance', description: 'Stage public canaries with measured stop rules, triage release incidents and deliver a qualified customer-hosted appliance.', status: 'complete' },
    { wave: 28, title: 'Campus specialization and Gen 2 silicon', description: 'Specialize a commissioned site with workload tradeoffs, then qualify, fabricate and use or sell independently prototyped successor chips.', status: 'complete' },
    { wave: 29, title: 'Responsive workbenches', description: 'Keep active workbenches fresh, retain drafts between visits, and follow decisions, weekly settlement and local saving with clear feedback.', status: 'complete' },
    { wave: 30, title: 'Connected workspaces and decisions', description: 'Navigate six connected workspaces, inspect research methods, and review product, release, staffing and infrastructure decisions while keeping the original task draft.', status: 'current' },
  ],
};

/** Non-research prerequisites remain explicit without masquerading as graph IDs. */
export type ResearchGate =
  | { kind: 'qualified_teacher'; transferRights: true; minimumDomainScoreBps: number; minimumStudentLeadBps: number }
  | { kind: 'compatible_capacity'; minimumCU: number }
  | { kind: 'held_out_scores'; codingBps: number; toolsBps: number }
  | { kind: 'serving_history'; minimumWeeks: number }
  | { kind: 'active_owned_site' }
  | { kind: 'shipped_accelerator_order' };

export const RESEARCH_GATES: Readonly<Record<string, readonly ResearchGate[]>> = {
  R13: [{ kind: 'qualified_teacher', transferRights: true, minimumDomainScoreBps: 6_000, minimumStudentLeadBps: 1_000 }],
  R14: [{ kind: 'compatible_capacity', minimumCU: 16_000_000_000 }],
  R15: [{ kind: 'held_out_scores', codingBps: 6_500, toolsBps: 6_000 }],
  R16: [{ kind: 'serving_history', minimumWeeks: 8 }],
  S5: [{ kind: 'active_owned_site' }],
  S6: [{ kind: 'shipped_accelerator_order' }],
};

export const PRIORITIZED_APPLIED_RESEARCH_IDS = [
  'R1A', 'R2A', 'R3B', 'R4B', 'R4C', 'R5A', 'R6A',
  'R7A', 'R8A', 'R9A', 'R10A', 'R11A', 'R12A',
] as const;
