import { writable } from 'svelte/store';

export interface ConfirmOpts {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface PromptOpts {
  title: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Return null if valid, or an error message string. */
  validate?: (value: string) => string | null;
  /** Set to 'password' to mask the input. */
  inputType?: 'text' | 'password';
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectOpts {
  title: string;
  message?: string;
  options: SelectOption[];
  confirmLabel?: string;
  cancelLabel?: string;
}

type Resolver<T> = (value: T) => void;

interface ConfirmState {
  kind: 'confirm';
  opts: ConfirmOpts;
  resolve: Resolver<boolean>;
}
interface PromptState {
  kind: 'prompt';
  opts: PromptOpts;
  resolve: Resolver<string | null>;
}
interface SelectState {
  kind: 'select';
  opts: SelectOpts;
  resolve: Resolver<string | null>;
}

export type ModalState = ConfirmState | PromptState | SelectState | null;

export const activeModal = writable<ModalState>(null);
// Retained name for backwards compatibility with existing consumers.
export const activeConfirm = activeModal;

export function confirmModal(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    activeModal.set({ kind: 'confirm', opts, resolve });
  });
}

export function promptModal(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => {
    activeModal.set({ kind: 'prompt', opts, resolve });
  });
}

export function selectModal(opts: SelectOpts): Promise<string | null> {
  return new Promise((resolve) => {
    activeModal.set({ kind: 'select', opts, resolve });
  });
}
