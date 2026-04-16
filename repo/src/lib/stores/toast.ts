import { writable } from 'svelte/store';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  durationMs: number;
}

export const toasts = writable<Toast[]>([]);

let counter = 0;

export function pushToast(kind: ToastKind, message: string, durationMs = 3500): void {
  const t: Toast = { id: `t-${Date.now()}-${counter++}`, kind, message, durationMs };
  toasts.update((list) => [...list, t]);
  setTimeout(() => {
    toasts.update((list) => list.filter((x) => x.id !== t.id));
  }, durationMs);
}
