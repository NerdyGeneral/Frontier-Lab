'use client';

import { createContext, memo, useContext } from 'react';
import type { ReactNode } from 'react';

export interface StudioWorkbenchVisibility {
  mode: 'studio' | 'classic';
  panel: string | null;
  standalone: 'research-tree' | 'planner' | null;
  epoch: number;
  draftGenerations?: Readonly<Record<string, number>>;
}

// Panels rendered outside Studio keep the ordinary Classic behavior.
const StudioWorkbenchContext = createContext<StudioWorkbenchVisibility>({ mode: 'classic', panel: null, standalone: null, epoch: 0 });

export function StudioWorkbenchProvider({ value, children }: { value: StudioWorkbenchVisibility; children: ReactNode }) {
  return <StudioWorkbenchContext.Provider value={value}>{children}</StudioWorkbenchContext.Provider>;
}

export function isStudioWorkbenchActive(visibility: StudioWorkbenchVisibility, panelId: string, studioOnly = false): boolean {
  if (visibility.mode === 'classic') return !studioOnly;
  return studioOnly ? visibility.standalone === panelId : visibility.panel === panelId;
}

export interface RetainedWorkbenchProps {
  active: boolean;
  epoch: number;
  children: ReactNode;
}

export function retainedWorkbenchPropsEqual(previous: RetainedWorkbenchProps, next: RetainedWorkbenchProps): boolean {
  if (previous.epoch !== next.epoch) return false;
  if (!next.active) return true;
  return previous.active && previous.children === next.children;
}

/** An inactive update retains the last rendered subtree; existing CSS hides it.
 * A never-visited panel renders null. Reopening receives the latest child props.
 * Only the outer gate consumes visibility, so context updates cannot bypass this memo.
 */
const RetainedWorkbench = memo(function RetainedWorkbench({ active, children }: RetainedWorkbenchProps) {
  return active ? children : null;
}, retainedWorkbenchPropsEqual);

export function StudioWorkbenchPanel({ panelId, studioOnly = false, children }: { panelId: string; studioOnly?: boolean; children: ReactNode }) {
  const visibility = useContext(StudioWorkbenchContext);
  const active = isStudioWorkbenchActive(visibility, panelId, studioOnly);
  // Importing or starting another company resets even previously visited forms.
  return <RetainedWorkbench key={visibility.epoch + ':' + panelId + ':' + (visibility.draftGenerations?.[panelId] ?? 0)} epoch={visibility.epoch} active={active}>{children}</RetainedWorkbench>;
}
