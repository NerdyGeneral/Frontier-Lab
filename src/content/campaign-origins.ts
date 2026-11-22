import type { CampaignOrigin } from '../contracts/wave4-campaign';
import type { StaffRole } from '../contracts/types';

interface OriginDefinition {
  id: CampaignOrigin;
  name: string;
  description: string;
  cashCents: number;
  crew: StaffRole[];
  knowledge: string[];
  team: string;
  advantage: string;
  pressure: string;
  openingNotice: string;
}

export const CAMPAIGN_ORIGINS: Record<CampaignOrigin, OriginDefinition> = {
  garage: {
    id: 'garage', name: 'Garage Lab', description: 'Build your first product from a founder’s workbench.',
    cashCents: 4_800_000, crew: [], knowledge: [], team: 'Solo founder',
    advantage: 'The longest runway and room to choose your first hire.',
    pressure: 'One founder covers every project until you recruit.',
    openingNotice: 'Your garage is open. Prepare the starter data for your first model.',
  },
  university: {
    id: 'university', name: 'University Spinout', description: 'Turn a university research project into a working lab.',
    cashCents: 3_000_000, crew: ['research', 'data'], knowledge: ['R1', 'R2'],
    team: 'Founder, researcher and data engineer',
    advantage: 'Start with Evaluation Suite and Data Curation already discovered.',
    pressure: 'A $700 weekly payroll and an established Atlas Chat audience.',
    openingNotice: 'Your research team is ready. Evaluation Suite and Data Curation are already unlocked.',
  },
  consultancy: {
    id: 'consultancy', name: 'Client Consultancy', description: 'Ship a signed pilot for your first client, Alder & Finch.',
    cashCents: 3_600_000, crew: ['ml'], knowledge: [], team: 'Founder and ML engineer',
    advantage: 'Earn $8,000 for a trained, evaluated, live Basic Chat pilot by Week 8.',
    pressure: 'Your engineer costs $300 a week. Harbor AI has a head start with business clients.',
    openingNotice: 'Alder & Finch signed your Basic Chat pilot. Deliver by the end of Week 8 to earn $8,000.',
  },
};

export function originStaffId(origin: CampaignOrigin, role: StaffRole) {
  return 'origin-' + origin + '-' + role;
}
