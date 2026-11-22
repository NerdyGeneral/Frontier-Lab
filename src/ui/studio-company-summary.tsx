'use client';

import { ArrowUpRight, Hourglass, Server, Users, Wallet } from 'lucide-react';
import { formatMoney, formatUnits } from '../core/math';
import type { StudioView } from '../core/studio';
import type { StudioPanelId } from '../core/studio-tasks';

export interface StudioCompanySummaryProps {
  summary: StudioView['summary'];
  disabled?: boolean;
  onOpenPanel: (panel: StudioPanelId) => void;
}

/** Company shortcuts use the existing summary, without projecting new income or capacity. */
export function StudioCompanySummary({ summary, disabled = false, onOpenPanel }: StudioCompanySummaryProps) {
  const metrics = [
    {
      id: 'cash', label: 'Company cash', Icon: Wallet, panel: 'business',
      value: formatMoney(summary.availableCashCents), unit: 'available',
      compactLabel: 'Available cash', compactValue: formatMoney(summary.availableCashCents), compactUnit: '',
      detail: `${formatMoney(summary.cashCents)} total · ${formatMoney(summary.reservedCashCents)} reserved for queued actions`,
      action: 'View finances',
      help: 'Available cash is what you can spend after setting aside money for queued actions.',
    },
    {
      id: 'runway', label: 'Runway', Icon: Hourglass, panel: 'business',
      value: summary.runwayWeeks === null ? 'Costs covered' : summary.runwayWeeks.toLocaleString('en-US'),
      unit: summary.runwayWeeks === null ? '' : summary.runwayWeeks === 1 ? 'week' : 'weeks',
      compactLabel: 'Runway', compactValue: summary.runwayWeeks === null ? 'Costs covered' : summary.runwayWeeks.toLocaleString('en-US'),
      compactUnit: summary.runwayWeeks === null ? '' : summary.runwayWeeks === 1 ? 'week' : 'weeks',
      detail: 'At current pace', action: 'View finances',
      help: 'This estimate uses available cash, current base costs, recent GPU running costs and last week’s revenue. New spending and hires can change it.',
    },
    {
      id: 'team', label: 'Team', Icon: Users, panel: 'people',
      value: summary.totalStaff.toLocaleString('en-US'), unit: summary.totalStaff === 1 ? 'person' : 'people',
      compactLabel: 'Team', compactValue: summary.readyStaff.toLocaleString('en-US'), compactUnit: 'ready',
      detail: `${summary.readyStaff.toLocaleString('en-US')} ready · ${summary.onboardingStaff.toLocaleString('en-US')} onboarding`,
      action: 'Manage team',
      help: 'The team count includes the founder. New hires cannot work until onboarding ends.',
    },
    {
      id: 'compute', label: 'Compute', Icon: Server, panel: 'compute',
      value: formatUnits(summary.totalCU), unit: 'CU total',
      compactLabel: 'Compute', compactValue: formatUnits(summary.totalCU), compactUnit: 'CU total',
      detail: `${formatUnits(summary.executedCUw)} CUw used last week`, action: 'Manage allocation',
      help: 'Total usable compute across cloud and owned machines. CU measures capacity; CUw measures work. Open Compute to see how capacity is allocated.',
    },
  ] satisfies {
    id: string; label: string; Icon: typeof Wallet; panel: StudioPanelId;
    value: string; unit: string; detail: string; action: string; help: string;
    compactLabel: string; compactValue: string; compactUnit: string;
  }[];

  return <nav className="studio-company-summary" aria-label="Company status">
    {metrics.map(({ id, label, Icon, panel, value, unit, detail, action, help, compactLabel, compactValue, compactUnit }) => <button
      key={id} type="button" className={'studio-summary-metric studio-summary-' + id} disabled={disabled}
      aria-label={`${label}: ${value}${unit ? ' ' + unit : ''}${id === 'cash' ? ' cash' : ''}. ${detail}. ${action}.`}
      title={`${label}: ${value}${unit ? ' ' + unit : ''}. ${detail}. ${help} ${action}.`} onClick={() => onOpenPanel(panel)}>
      <span className="studio-summary-label"><Icon size={14} strokeWidth={1.7} aria-hidden="true" /><span className="studio-summary-full-label">{label}</span><span className="studio-summary-compact-label" aria-hidden="true">{compactLabel}</span></span>
      <span className="studio-summary-value">{value}{unit && <small className="studio-summary-unit"> {unit}</small>}</span>
      <span className="studio-summary-detail">{detail}</span>
      <span className="studio-summary-action" aria-hidden="true"><ArrowUpRight size={14} /></span>
      <span className="studio-summary-compact-value" aria-hidden="true">{compactValue}{compactUnit && <small className="studio-summary-unit"> {compactUnit}</small>}</span>
    </button>)}
  </nav>;
}
