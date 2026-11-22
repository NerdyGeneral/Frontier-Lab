'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ArrowRight } from 'lucide-react';

export interface StudioVisibleAction {
  id: string;
  actionKey?: string;
  label: string;
  disabled: boolean;
  reason: string;
}

/** A named task promotes exactly one explicitly bound control. An unavailable,
 * incomplete or duplicated binding must never select another command. */
export function selectStudioPrimaryAction(actions: readonly StudioVisibleAction[], actionKey?: string): StudioVisibleAction | undefined {
  if (!actionKey) return;
  const matches = actions.filter(action => action.actionKey === actionKey);
  return matches.length === 1 ? matches[0] : undefined;
}

function isDisplayed(button: HTMLButtonElement) {
  // Chromium can retain a layout box for content inside a closed disclosure.
  // Such controls are not visible choices, even when getClientRects is nonempty.
  for (let ancestor = button.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open
      && !ancestor.querySelector(':scope > summary')?.contains(button)) return false;
  }
  return button.isConnected && !button.closest('[hidden], [inert], [aria-hidden="true"]')
    && button.getClientRects().length > 0 && getComputedStyle(button).visibility !== 'hidden';
}

/** Mirrors the currently mounted form controls. The original button keeps the
 * payload, validation and submission handler; this footer never constructs a command. */
export function StudioTaskPrimaryActions({ bodyRef, actionKey }: {
  bodyRef: RefObject<HTMLDivElement | null>;
  actionKey?: string;
}) {
  const id = useId();
  const [actions, setActions] = useState<StudioVisibleAction[]>([]);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !actionKey) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const current = new Map<string, HTMLButtonElement>();
      const next: StudioVisibleAction[] = [];
      for (const button of body.querySelectorAll<HTMLButtonElement>('button[data-studio-primary-for]')) {
        if (!isDisplayed(button)) continue;
        const actionId = button.dataset.studioActionId;
        if (!actionId) continue;
        current.set(actionId, button);
        const label = button.textContent?.trim() || 'Schedule action';
        next.push({ id: actionId, actionKey: button.dataset.studioPrimaryFor, label,
          disabled: button.disabled, reason: button.dataset.studioBlockedReason ?? '' });
      }
      buttons.current = current;
      setActions(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new MutationObserver(schedule);
    observer.observe(body, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['disabled', 'hidden', 'inert', 'aria-hidden', 'open', 'class', 'style', 'data-studio-primary-for', 'data-studio-action-id', 'data-studio-blocked-reason'] });
    window.addEventListener('resize', schedule);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
      buttons.current.clear();
    };
  }, [bodyRef, actionKey]);

  const selected = selectStudioPrimaryAction(actions, actionKey);
  if (!selected) return null;
  const displayedReason = selected.reason === 'Wait until this lab is ready to make choices.'
    ? 'Lab is not ready for changes.' : selected.reason;
  return <div className="studio-task-primary-controls">
    <button type="button" className="studio-surface-button studio-surface-primary" disabled={selected.disabled}
      aria-describedby={selected.disabled && selected.reason ? id + '-reason' : undefined}
      onClick={() => {
        const body = bodyRef.current;
        const original = buttons.current.get(selected.id);
        if (!body || !actionKey || !original || !body.contains(original) || !isDisplayed(original)
          || original.disabled || original.dataset.studioPrimaryFor !== actionKey || original.dataset.studioActionId !== selected.id) return;
        // A disclosure can change after the observed render but before this
        // click. Recheck uniqueness without choosing a newly mounted control.
        const current = Array.from(body.querySelectorAll<HTMLButtonElement>('button[data-studio-primary-for]'))
          .filter(button => button.dataset.studioPrimaryFor === actionKey && isDisplayed(button));
        if (current.length === 1 && current[0] === original) original.click();
      }}>{selected.label}<ArrowRight size={16} aria-hidden="true" /></button>
    {selected.disabled && selected.reason && <><span className="studio-task-action-hint" aria-hidden="true">{displayedReason}</span><span className="visually-hidden" id={id + '-reason'}>{selected.reason}</span></>}
  </div>;
}
