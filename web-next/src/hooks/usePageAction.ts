import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Module-level slot registry: AppShell registers its slot DOM node; pages
// portal their action into it. Using a Portal instead of React state +
// outlet-context avoids the JSX-identity effect loop (every render creates
// a new ReactNode, which would trigger useEffect, which would trigger a
// parent state update, which would re-render the page, etc.).

let slotNode: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function registerPageActionSlot(el: HTMLElement | null): void {
  slotNode = el;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSlot(): HTMLElement | null {
  return slotNode;
}

export function PageAction({ children }: { children: ReactNode }) {
  const node = useSyncExternalStore(subscribe, getSlot, () => null);
  return node ? createPortal(children, node) : null;
}
