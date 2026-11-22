import type { ReactNode } from 'react';
import { ArrowUpRight, CircleCheck, CirclePause, Info, TriangleAlert } from 'lucide-react';
import type { CommandPayload, GameState } from '../contracts/types';
import { formatWorkPoints } from '../modules/workforce-points';
import { formatUnits } from '../core/math';

export interface StudioReleaseDeskProps {
  game: GameState;
  canAct: boolean;
  onQueue: (payload: CommandPayload) => void;
  onOpenPanel?: (panel: string) => void;
  /** Hidden surfaces retain their mounted draft; their next visible render receives current state. */
  active?: boolean;
}

export function retainedReleasePropsEqual(previous: StudioReleaseDeskProps, next: StudioReleaseDeskProps): boolean {
  if (next.active === false) return true;
  return previous.active !== false && previous.game === next.game && previous.canAct === next.canAct
    && previous.onQueue === next.onQueue && previous.onOpenPanel === next.onOpenPanel;
}

export type ReleaseTone = 'neutral' | 'active' | 'good' | 'warning';

export function ReleaseStatus({ children, tone = 'neutral' }: { children: ReactNode; tone?: ReleaseTone }) {
  return <span className={'release-desk-status tone-' + tone}><span aria-hidden="true" />{children}</span>;
}

export function ReleaseFact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="release-desk-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function ReleaseNotice({ children, title, tone = 'neutral' }: { children: ReactNode; title?: string; tone?: ReleaseTone }) {
  const Icon = tone === 'warning' ? TriangleAlert : tone === 'good' ? CircleCheck : tone === 'active' ? CirclePause : Info;
  return <div className={'release-desk-notice tone-' + tone}><Icon size={17} aria-hidden="true" /><div>{title && <strong>{title}</strong>}<p>{children}</p></div></div>;
}

export function ReleaseLink({ children, panel, onOpenPanel }: { children: ReactNode; panel: string; onOpenPanel?: (panel: string) => void }) {
  return <a href={'#' + panel} className="release-desk-link" onClick={event => { if (onOpenPanel) { event.preventDefault(); onOpenPanel(panel); } }}>{children}<ArrowUpRight size={14} aria-hidden="true" /></a>;
}

export function ReleaseProgress({ label, completed, required, unit }: { label: string; completed: number; required: number; unit: string }) {
  return <div className="release-desk-progress"><div><span>{label}</span><strong>{(unit.endsWith('points') ? formatWorkPoints : formatUnits)(completed)} / {(unit.endsWith('points') ? formatWorkPoints : formatUnits)(required)} {unit}</strong></div><progress aria-label={label} value={Math.min(completed, required)} max={Math.max(1, required)} /></div>;
}

export const releasePercent = (basisPoints: number): string => (basisPoints / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
export const releaseCount = (count: number): string => count.toLocaleString('en-US');
