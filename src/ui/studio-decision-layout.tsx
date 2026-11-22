'use client';

import { useId, useRef, type ReactNode } from 'react';

export interface StudioDecisionLayoutProps {
  children: ReactNode;
  summary: ReactNode;
  details?: ReactNode;
  focused?: boolean;
  summaryLabel?: string;
  className?: string;
  decisionSummary?: ReactNode;
}

/** Presentation only. Both columns retain their original form/command owners;
 * changing view, opening a review or resizing never creates another form. */
export function StudioDecisionLayout({ children, summary, details, focused = false, summaryLabel = 'Cost and requirements', className = '', decisionSummary }: StudioDecisionLayoutProps) {
  const summaryId = useId(), summaryRef = useRef<HTMLElement>(null);
  return <div className={'studio-decision-layout ' + className} data-focused={focused || undefined} data-persistent-summary={!!decisionSummary || undefined}>
    {decisionSummary && <div className="studio-decision-bar" aria-label="Current decision summary">{decisionSummary}<button type="button" aria-controls={summaryId} onClick={() => {
      summaryRef.current?.focus({ preventScroll: true }); summaryRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
    }}>Full forecast</button></div>}
    <div className="studio-decision-fields">{children}</div>
    <aside id={summaryId} ref={summaryRef} tabIndex={-1} className="studio-decision-summary" aria-label={summaryLabel}>{summary}</aside>
    {details && <div className="studio-decision-details">{details}</div>}
  </div>;
}
