// Signal stores for cross-component workspace events. Subscribers bump the
// counter; components watching it re-read the authoritative state from
// IndexedDB. Keeping this as a plain Svelte store avoids ad-hoc refresh
// callbacks strung through props.

import { writable } from 'svelte/store';

/** Project-wide state was rewritten (e.g., snapshot restore). */
export const workspaceRefreshBus = writable<number>(0);

/**
 * Payload for import events. Monotonic counter + the project id whose import
 * batch just completed. Subscribers that care about a specific project match
 * on `projectId` so unrelated projects don't churn.
 */
export interface ImportEvent {
  counter: number;
  projectId: string;
  acceptedFileIds: string[];
}

/** Bumped on every successful ImportBatch. */
export const importEventsBus = writable<ImportEvent | null>(null);

let importCounter = 0;
export function publishImportCompleted(projectId: string, acceptedFileIds: string[]): void {
  importCounter += 1;
  importEventsBus.set({ counter: importCounter, projectId, acceptedFileIds });
}
