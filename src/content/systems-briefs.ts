import type { SystemsBriefId } from '../contracts/systems-briefs';
import type { SystemsChallengeSuiteId } from '../contracts/model-challenges';

export const SYSTEMS_BRIEF_WINDOW_WEEKS = 12;
export const SYSTEMS_BRIEF_ACCEPT_WEEKS = 8;
export const SYSTEMS_BRIEF_ORDER_LIMIT = 2048;
export interface SystemsBriefDefinition {
  id: SystemsBriefId;
  title: string;
  description: string;
  clients: readonly string[];
  challengeSuiteId: SystemsChallengeSuiteId;
  feeCents: number;
  requestsPerWeek: number;
}
export const SYSTEMS_BRIEFS: readonly SystemsBriefDefinition[] = [
  { id: 'efficient-experts', title: 'Expert service desk', description: 'Deliver useful mixed support at a strict compute price. Efficient routing and small active networks can earn repeat customers.',
    clients: ['Relay Customer Care', 'Marquee Tickets', 'Cedar Support Cooperative'], challengeSuiteId: 'systems-cost-1', feeCents: 360000, requestsPerWeek: 4000 },
  { id: 'bounded-memory', title: 'Local knowledge assistant', description: 'Serve a useful private assistant within a complete model-and-session memory allowance.',
    clients: ['Pocket Desk', 'Fieldwork Devices', 'Orchard Local Systems'], challengeSuiteId: 'systems-memory-1', feeCents: 400000, requestsPerWeek: 2000 },
  { id: 'continuity-desk', title: 'Case continuity service', description: 'Retain changing facts and earlier exceptions across recurring client sessions. Keep the remembered state inside its memory budget.',
    clients: ['Alder Case Review', 'Meridian Archives', 'Northline Continuity'], challengeSuiteId: 'systems-retention-1', feeCents: 520000, requestsPerWeek: 2500 },
  { id: 'verified-analysis', title: 'Verified analysis desk', description: 'Check difficult conclusions and completed tool work against an independent result while meeting the response deadline.',
    clients: ['Clearline Operations', 'Aster Analysis Group', 'Linden Verification'], challengeSuiteId: 'systems-verification-1', feeCents: 640000, requestsPerWeek: 2000 },
];
export const systemsBriefDefinition = (id: string) => SYSTEMS_BRIEFS.find(brief => brief.id === id);
