import type { AgentOrderDefinition, AgentTool } from '../contracts/wave3-agents';

export const AGENT_TOOLS: readonly { id: AgentTool; name: string; kind: 'read' | 'test' | 'write'; description: string }[] = [
  { id: 'read_ticket', name: 'Read ticket', kind: 'read', description: 'Read only the cases assigned to this order.' },
  { id: 'search_docs', name: 'Search policy documents', kind: 'read', description: 'Look up the customer-approved support policy.' },
  { id: 'send_reply', name: 'Send support reply', kind: 'write', description: 'Send only the approved response for this order; a durable receipt prevents duplicate sends.' },
  { id: 'issue_credit', name: 'Issue bounded account credit', kind: 'write', description: 'Apply only this order’s permitted credit. Scope does not guarantee that a credit is the correct business decision.' },
  { id: 'read_repository', name: 'Read assigned repository', kind: 'read', description: 'Inspect only the simulated files assigned to this order.' },
  { id: 'read_issue', name: 'Read issue brief', kind: 'read', description: 'Read the customer objective and acceptance criteria.' },
  { id: 'read_test_spec', name: 'Read test specification', kind: 'read', description: 'Inspect the public test requirements without changing them.' },
  { id: 'run_sandbox_tests', name: 'Run sandbox tests', kind: 'test', description: 'Run simulated smoke tests without publishing or changing the customer repository.' },
  { id: 'publish_patch', name: 'Publish scoped patch', kind: 'write', description: 'Deliver the approved patch only during the authorized delivery stage.' },
];

/** Fictional game orders. Each company can accept each template once per four-week intake. */
export const AGENT_ORDERS: readonly AgentOrderDefinition[] = [
  { id: 'support-replies', name: 'Routine support replies', description: 'Prepare answers for a small batch of routine support tickets.', caseCount: 10,
    setupCents: 2_500, draftFeeCents: 15_000, outcomeFeeCents: 35_000, failurePenaltyCents: 5_000,
    minConversationBps: 4500, minDocumentsBps: 2500, minToolsBps: 0, difficultyBps: 1000,
    readTools: ['read_ticket'], actionTool: 'send_reply' },
  { id: 'policy-answers', name: 'Policy-grounded support', description: 'Read the case and its policy before answering a more demanding support batch.', caseCount: 20,
    setupCents: 5_000, draftFeeCents: 25_000, outcomeFeeCents: 60_000, failurePenaltyCents: 10_000,
    minConversationBps: 4500, minDocumentsBps: 4500, minToolsBps: 3000, difficultyBps: 1800,
    readTools: ['read_ticket', 'search_docs'], actionTool: 'send_reply' },
  { id: 'credit-review', name: 'Account-credit review', description: 'Check eligibility and resolve a bounded credit case. An incorrect but permitted credit can create a service penalty.', caseCount: 25,
    setupCents: 7_500, draftFeeCents: 35_000, outcomeFeeCents: 90_000, failurePenaltyCents: 20_000,
    minConversationBps: 5000, minDocumentsBps: 4500, minToolsBps: 5000, difficultyBps: 2500,
    readTools: ['read_ticket', 'search_docs'], actionTool: 'issue_credit' },
];
export const CODING_AGENT_ORDER: AgentOrderDefinition = {
  id: 'repository-maintenance', name: 'Repository maintenance',
  description: 'Investigate assigned issues, prepare patches, run sandbox smoke tests, and independently verify the proposed fixes. Delivered patches face a separate customer regression audit.',
  caseCount: 40, setupCents: 7_500, draftFeeCents: 65_000, outcomeFeeCents: 180_000, failurePenaltyCents: 90_000,
  minConversationBps: 0, minDocumentsBps: 0, minToolsBps: 2500, difficultyBps: 2000,
  coding: { minCodingBps: 5000, minReliabilityBps: 8500 },
  readTools: ['read_issue', 'read_repository', 'read_test_spec'], actionTool: 'publish_patch',
};
export const ALL_AGENT_ORDERS = [...AGENT_ORDERS, CODING_AGENT_ORDER];
export const AGENT_INTAKE_WEEKS = 4;
export const MAX_ACTIVE_AGENT_JOBS = 8;
export const AGENT_TERMINAL_HISTORY = 32;
export const AGENT_INVOICE_HISTORY = 32;
