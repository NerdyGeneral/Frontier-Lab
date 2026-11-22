'use client';

import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode, RefObject } from 'react';
import { ArrowLeft, ArrowUpRight, X } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { StudioTaskPrimaryActions } from './studio-task-primary';

export type StudioTaskSurfaceMode = 'hidden' | 'inline' | 'dialog';
export type StudioTaskCloseReason = 'close' | 'escape';

export interface StudioTaskSurfaceProps {
  mode: StudioTaskSurfaceMode;
  title: string;
  /** A short introduction only; do not pass the whole task body as its description. */
  description?: ReactNode;
  eyebrow?: string;
  /** Read-only clock, controller, save and operation status supplied by the shell. */
  status?: ReactNode;
  footer?: ReactNode;
  editingAction?: { key: string; actionKey?: string };
  children: ReactNode;
  onClose: (reason: StudioTaskCloseReason) => void;
  onBack?: () => void;
  closeDisabled?: boolean;
  busy?: boolean;
  closeLabel?: string;
  backLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  headingId?: string;
  id?: string;
  className?: string;
  /** Render a workspace page. The header and navigation remain interactive;
   * only the workspace covered by the page is removed from keyboard navigation. */
  docked?: boolean;
}

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button', 'input:not([type="hidden"])', 'select',
  'textarea', 'summary', 'iframe', '[contenteditable="true"]', '[tabindex]',
  'audio[controls]', 'video[controls]',
].join(',');

function visibleFocusTarget(element: HTMLElement | null | undefined): element is HTMLElement {
  if (!element?.isConnected) return false;
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open
      && !ancestor.querySelector(':scope > summary')?.contains(element)) return false;
  }
  return !element.closest('[hidden], [inert], [aria-hidden="true"]')
    && !element.matches(':disabled') && element.getClientRects().length > 0
    && window.getComputedStyle(element).visibility !== 'hidden';
}

function tabbableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(element => element.tabIndex >= 0 && visibleFocusTarget(element));
}

/** Conceal covered workspace branches without moving the retained form. A docked
 * page keeps its header/sidebar and portalled navigation menus usable. */
function isolateTask(host: HTMLElement, docked = false): () => void {
  const previous = new Map<HTMLElement, boolean>();
  const parents = new Set<HTMLElement>();
  const shell = docked ? host.closest<HTMLElement>('.studio-mode') : null;
  const conceal = (element: HTMLElement) => {
    if (!previous.has(element)) previous.set(element, element.inert);
    element.inert = true;
  };
  const isolate = () => {
    let branch: HTMLElement = host;
    while (branch.parentElement && branch.parentElement !== document.documentElement) {
      const parent = branch.parentElement;
      parents.add(parent);
      for (const sibling of Array.from(parent.children)) {
        if (!(sibling instanceof HTMLElement) || sibling === branch
          || ['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) continue;
        if (docked && sibling.matches('.studio-chrome')) {
          parents.add(sibling);
          for (const child of Array.from(sibling.children)) {
            if (child instanceof HTMLElement && !child.matches('.studio-header, .studio-sidebar, .studio-status-line, .decision-clock-controls, .studio-operation-error, .migration-note, .skip-link')) conceal(child);
          }
        } else conceal(sibling);
      }
      // Navigation menus portal outside the lab. They belong to the still-usable
      // chrome and must not be made inert when their portal is added later.
      if (parent === shell) break;
      branch = parent;
    }
  };
  isolate();
  // Retained workspace siblings stay isolated; the shared clock, stop reason,
  // error and navigation controls remain reachable on a docked task page.
  const observer = new MutationObserver(isolate);
  for (const parent of parents) observer.observe(parent, { childList: true });
  return () => {
    observer.disconnect();
    for (const [element, wasInert] of previous) element.inert = wasInert;
  };
}

function lockPageScroll(): () => void {
  const bodyOverflow = document.body.style.overflow;
  const rootOverflow = document.documentElement.style.overflow;
  const bodyPadding = document.body.style.paddingRight;
  const gutter = window.innerWidth - document.documentElement.clientWidth;
  if (gutter > 0) {
    const padding = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    document.body.style.paddingRight = `${padding + gutter}px`;
  }
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  return () => {
    document.body.style.overflow = bodyOverflow;
    document.documentElement.style.overflow = rootOverflow;
    document.body.style.paddingRight = bodyPadding;
  };
}

/**
 * One host for an existing workbench. Header/status/body/footer keep the same
 * positions in every mode, so moving inline <-> dialog never remounts its fields.
 * StudioWorkbenchPanel continues to own lazy rendering and draft retention.
 * This component never changes the simulation clock or submits a command.
 */
export function StudioTaskSurface({
  mode, title, description, eyebrow, status, footer, editingAction, children, onClose, onBack,
  closeDisabled = false, busy = false, closeLabel = 'Close and keep draft', backLabel = 'Back',
  initialFocusRef, returnFocusRef, fallbackFocusRef, headingId, id, className = '', docked = false,
}: StudioTaskSurfaceProps) {
  const generatedId = useId();
  const titleId = headingId ?? `${id ?? `studio-task-${generatedId}`}-title`;
  const descriptionId = `${id ?? `studio-task-${generatedId}`}-description`;
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousHeading = useRef({ modal: false, title, titleId });
  const shown = mode === 'dialog';
  const modal = shown && !docked;
  const requestClose = useEffectEvent((reason: StudioTaskCloseReason) => {
    if (!closeDisabled) onClose(reason);
  });

  // The visual viewport also shrinks when a software keyboard opens. Both
  // presentations must keep their focused controls above it.
  useEffect(() => {
    const host = hostRef.current;
    if (!shown || !host) return;
    const updateViewport = () => {
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      host.style.setProperty('--studio-surface-viewport-height', `${height}px`);
      host.style.setProperty('--studio-surface-viewport-top', `${viewport?.offsetTop ?? 0}px`);
      host.dataset.shortViewport = String(height < 480);
    };
    const updateFooter = () => host.style.setProperty('--studio-surface-footer-height', `${footerRef.current?.getBoundingClientRect().height ?? 0}px`);
    updateViewport(); updateFooter();
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateFooter);
    if (footerRef.current) observer?.observe(footerRef.current);
    return () => {
      observer?.disconnect();
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      host.style.removeProperty('--studio-surface-viewport-height');
      host.style.removeProperty('--studio-surface-viewport-top');
      host.style.removeProperty('--studio-surface-footer-height');
      delete host.dataset.shortViewport;
    };
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    const host = hostRef.current, frame = frameRef.current;
    if (!host || !frame) return;
    const returnAtEntry = returnFocusRef?.current;
    const fallbackAtEntry = fallbackFocusRef?.current;
    const opener = visibleFocusTarget(returnAtEntry) ? returnAtEntry
      : document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        && document.activeElement !== document.documentElement ? document.activeElement : null;
    const focusInside = () => {
      const preferred = initialFocusRef?.current;
      const target = preferred && frame.contains(preferred) && visibleFocusTarget(preferred)
        ? preferred : headingRef.current ?? frame;
      target.focus({ preventScroll: true });
    };
    focusInside();
    host.scrollTop = 0;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    const restoreBackground = isolateTask(host, docked);
    const restoreScroll = lockPageScroll();

    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !frame.contains(event.target)) focusInside();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') {
        const active = document.activeElement;
        // Let a select or navigation menu dismiss itself first. Escape in the
        // persistent chrome is not a request to discard the current workspace.
        if (active instanceof HTMLElement && (active.matches('select') || active.closest('[role="menu"], [role="listbox"]'))) return;
        if (docked && !(active instanceof Node && frame.contains(active))) return;
        event.preventDefault();
        event.stopPropagation();
        requestClose('escape');
      } else if (event.key === 'Tab' && !docked) {
        const targets = tabbableElements(frame);
        const first = targets[0], last = targets[targets.length - 1];
        const active = document.activeElement;
        if (!first || !last) {
          event.preventDefault();
          focusInside();
        } else if (event.shiftKey && (active === first || !targets.includes(active as HTMLElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !frame.contains(active))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    if (!docked) document.addEventListener('focusin', containFocus);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('focusin', containFocus);
      document.removeEventListener('keydown', onKeyDown);
      restoreBackground();
      restoreScroll();
      requestAnimationFrame(() => {
        // A newly opened task or a deliberate workspace focus owns the next move.
        if (host.isConnected && host.dataset.mode === 'dialog') return;
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body
          && !host.contains(active) && visibleFocusTarget(active)) return;
        const fallback = visibleFocusTarget(fallbackAtEntry) ? fallbackAtEntry
          : Array.from(document.querySelectorAll<HTMLElement>('.studio-brand, .studio-classic-entry button'))
            .find(visibleFocusTarget);
        const target = visibleFocusTarget(returnAtEntry) ? returnAtEntry
          : visibleFocusTarget(opener) ? opener : visibleFocusTarget(fallback) ? fallback : null;
        target?.focus({ preventScroll: true });
      });
    };
  }, [shown, docked, initialFocusRef, returnFocusRef, fallbackFocusRef]);

  // A different task may reuse the same modal owner. Move to its heading without
  // tearing down the modal or allowing a previously selected hidden field to own focus.
  useEffect(() => {
    const previous = previousHeading.current;
    if (shown && previous.modal && (previous.title !== title || previous.titleId !== titleId)) {
      headingRef.current?.focus({ preventScroll: true });
      if (hostRef.current) hostRef.current.scrollTop = 0;
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
    }
    previousHeading.current = { modal: shown, title, titleId };
  }, [shown, title, titleId]);

  return <div id={id} ref={hostRef} className={`studio-task-surface ${className}`.trim()}
    data-mode={mode} data-presentation={docked ? 'docked' : undefined} data-studio-surface="task" hidden={mode === 'hidden'} inert={mode === 'hidden' || undefined}>
    <div className="studio-surface-frame" ref={frameRef} tabIndex={-1}
      role={modal ? 'dialog' : 'region'} aria-modal={modal || undefined}
      aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
      <header className="studio-surface-header" hidden={!shown}>
        <div className="studio-surface-topline">
          <div className="studio-surface-title-group">
            {!docked && eyebrow && <span className="studio-surface-eyebrow">{eyebrow}</span>}
            <h2 id={titleId} className="studio-surface-heading" ref={headingRef} tabIndex={-1}>{title}</h2>
          </div>
          <button type="button" className="studio-surface-button studio-surface-close"
            disabled={closeDisabled} onClick={() => onClose('close')}>
            <span>{closeLabel}</span><X size={17} aria-hidden="true" />
          </button>
        </div>
        <div id={descriptionId} className="studio-surface-description" hidden={!description}>{description}</div>
        <div className="studio-surface-status" hidden={!status && !busy}>
          {status ?? (busy ? <span role="status">Working…</span> : null)}
        </div>
      </header>
      <div className="studio-surface-body" ref={bodyRef} aria-busy={busy || undefined}>{children}</div>
      <footer className="studio-surface-footer" ref={footerRef} hidden={!shown || (!footer && !onBack && !editingAction)}>
        <div className="studio-surface-back" hidden={!onBack}>
          <button type="button" className="studio-surface-button" disabled={busy || closeDisabled}
            onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />{backLabel}</button>
        </div>
        <div className="studio-surface-footer-content">{footer}{shown && editingAction && <StudioTaskPrimaryActions key={editingAction.key} bodyRef={bodyRef} actionKey={editingAction.actionKey} />}</div>
      </footer>
    </div>
  </div>;
}

export interface StudioContextMenuItem {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface StudioContextMenuProps {
  label: string;
  /** A named native button; Radix adds the menu semantics without another button. */
  trigger: ReactElement;
  items: StudioContextMenuItem[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** For a menu inside a modal, portal into that modal's frame. */
  portalContainer?: HTMLElement | null;
}

/** A short action chooser. The old menu closes before the selected task opens. */
export function StudioContextMenu({ label, trigger, items, open, onOpenChange, portalContainer }: StudioContextMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingSelection = useRef<(() => void) | null>(null);
  const menuId = useId();
  const changeOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    if (next) pendingSelection.current = null;
    onOpenChange?.(next);
  };
  return <DropdownMenu.Root open={open ?? internalOpen} onOpenChange={changeOpen} modal={false}>
    <DropdownMenu.Trigger asChild ref={triggerRef}>{trigger}</DropdownMenu.Trigger>
    <DropdownMenu.Portal container={portalContainer}>
      <DropdownMenu.Content className="studio-surface-menu" align="start" sideOffset={8}
        collisionPadding={12} aria-labelledby={menuId}
        onCloseAutoFocus={event => {
          const action = pendingSelection.current;
          if (!action) return;
          pendingSelection.current = null;
          event.preventDefault();
          if (visibleFocusTarget(triggerRef.current)) triggerRef.current.focus({ preventScroll: true });
          // Radix has removed its focus scope before the next surface can take focus.
          requestAnimationFrame(action);
        }}>
        <DropdownMenu.Label id={menuId} className="studio-surface-menu-label">{label}</DropdownMenu.Label>
        {items.map(item => <DropdownMenu.Item key={item.id} className="studio-surface-menu-item"
          disabled={item.disabled} textValue={item.label} onSelect={() => { pendingSelection.current = item.onSelect; }}>
          <span><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</span>
          <ArrowUpRight size={16} aria-hidden="true" />
        </DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

export interface StudioInspectorProps {
  title: string;
  status?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  id?: string;
  className?: string;
}

/** Read-only context and named next actions; no modal behavior or form ownership. */
export function StudioInspector({ title, status, description, children, actions, onClose, id, className = '' }: StudioInspectorProps) {
  const headingId = `studio-inspector-${useId()}`;
  return <section id={id} className={`studio-surface-inspector ${className}`.trim()} aria-labelledby={headingId}>
    <header className="studio-surface-inspector-header">
      <h2 id={headingId}>{title}</h2>
      {onClose && <button type="button" className="studio-surface-button studio-surface-icon-button"
        aria-label={`Close ${title} inspector`} onClick={onClose}><X size={18} aria-hidden="true" /></button>}
    </header>
    {status && <div className="studio-surface-inspector-status">{status}</div>}
    {description && <div className="studio-surface-description">{description}</div>}
    {children && <div className="studio-surface-inspector-body">{children}</div>}
    {actions && <div className="studio-surface-inspector-actions">{actions}</div>}
  </section>;
}

export interface StudioResultCardProps {
  title: string;
  identity?: ReactNode;
  status?: ReactNode;
  summary: ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  id?: string;
  className?: string;
}

/** Presentation only: the caller supplies an actual outcome and its exact next action. */
export function StudioResultCard({ title, identity, status, summary, action, id, className = '' }: StudioResultCardProps) {
  const headingId = `studio-result-${useId()}`;
  return <article id={id} className={`studio-surface-result ${className}`.trim()} aria-labelledby={headingId}>
    <header className="studio-surface-result-header"><h3 id={headingId}>{title}</h3>{status}</header>
    {identity && <div className="studio-surface-result-identity">{identity}</div>}
    <div className="studio-surface-result-summary">{summary}</div>
    {action && <button type="button" className="studio-surface-button studio-surface-primary"
      disabled={action.disabled} onClick={action.onClick}>{action.label}<ArrowUpRight size={16} aria-hidden="true" /></button>}
  </article>;
}
