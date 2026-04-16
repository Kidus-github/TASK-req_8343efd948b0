import type { Project, ProjectStatus, Result } from '../types';
import { all, allByIndex, del, get, put, tx } from '../db/indexeddb';
import { newId, nowIso } from '../util/ids';
import { ErrorCodes, fail, ok } from '../util/errors';
import { logAudit } from './audit';
import { LIMITS } from '../util/constants';

export async function listProjects(filter?: { status?: ProjectStatus }): Promise<Project[]> {
  const all_ = await all<Project>('projects');
  const filtered = filter?.status ? all_.filter((p) => p.status === filter.status) : all_;
  return filtered.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getProject(id: string): Promise<Project | undefined> {
  return get<Project>('projects', id);
}

export async function createProject(name: string): Promise<Result<Project>> {
  const trimmed = name.trim();
  if (!trimmed) return fail(ErrorCodes.PROJECT_INVALID_STATE, 'Project name is required.');
  const existing = await all<Project>('projects');
  if (existing.some((p) => p.name === trimmed && p.status !== 'deleted')) {
    return fail(
      ErrorCodes.PROJECT_NAME_CONFLICT,
      `A project named "${trimmed}" already exists.`
    );
  }
  const p: Project = {
    id: newId('proj'),
    name: trimmed,
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    activeTab: 'edit',
    settings: {
      silenceThresholdDb: LIMITS.SILENCE_THRESHOLD_DB,
      silenceMinDurationSec: LIMITS.SILENCE_MIN_DURATION_SEC,
      normalizationLufs: LIMITS.NORMALIZATION_LUFS,
      defaultFadeSec: 1.0
    },
    versionCounter: 1
  };
  await put('projects', p);
  await logAudit('project', p.id, 'create');
  return ok(p);
}

export async function archiveProject(id: string): Promise<Result<Project>> {
  return transitionStatus(id, 'archived');
}

export async function restoreProject(id: string): Promise<Result<Project>> {
  return transitionStatus(id, 'active');
}

export async function deleteProject(id: string): Promise<Result<true>> {
  const p = await getProject(id);
  if (!p) return fail(ErrorCodes.PROJECT_NOT_FOUND, 'Project not found.');
  // Cascade delete ALL dependent records, including export cart items and
  // their rendered-output blobs. The previous version only removed export
  // carts (keyed by project) but left behind exportCartItems (keyed by cart)
  // and their output blobs — deletion appeared successful in the UI while
  // rendered MP3/WAV blobs stayed resident in IndexedDB.
  const dependents = [
    'importedAudio',
    'importBatches',
    'editOperations',
    'markers',
    'snapshots',
    'exportCarts',
    'exportCartItems',
    'jobs'
  ];
  await tx(['projects', ...dependents, 'blobs'], 'readwrite', async (stores) => {
    const [
      projects,
      importedAudio,
      importBatches,
      editOps,
      markers,
      snapshots,
      exportCarts,
      exportCartItems,
      jobs,
      blobs
    ] = stores;
    projects.delete(id);

    const removeByProject = async (
      store: IDBObjectStore,
      onRecord?: (rec: Record<string, unknown>) => void
    ): Promise<void> => {
      const idx = store.index('by_project');
      const req = idx.openCursor(IDBKeyRange.only(id));
      await new Promise<void>((resolve, reject) => {
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const rec = cursor.value as { blobRef?: string };
            if (rec.blobRef) blobs.delete(rec.blobRef);
            onRecord?.(cursor.value as Record<string, unknown>);
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error ?? new Error('cursor error'));
      });
    };

    // Collect cart ids as we delete them so we can also delete their items.
    const cartIds: string[] = [];
    await removeByProject(exportCarts, (rec) => {
      if (typeof rec.id === 'string') cartIds.push(rec.id);
    });

    // For each cart, walk its items and delete them + any rendered output
    // blob they reference.
    for (const cartId of cartIds) {
      const idx = exportCartItems.index('by_cart');
      const req = idx.openCursor(IDBKeyRange.only(cartId));
      await new Promise<void>((resolve, reject) => {
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const item = cursor.value as { outputBlobRef?: string };
            if (item.outputBlobRef) blobs.delete(item.outputBlobRef);
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error ?? new Error('cursor error'));
      });
    }

    await removeByProject(importedAudio);
    await removeByProject(importBatches);
    await removeByProject(editOps);
    await removeByProject(markers);
    await removeByProject(snapshots);
    await removeByProject(jobs);
  });
  await logAudit('project', id, 'delete');
  return ok(true);
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<Project, 'id' | 'createdAt'>>
): Promise<Result<Project>> {
  const p = await getProject(id);
  if (!p) return fail(ErrorCodes.PROJECT_NOT_FOUND, 'Project not found.');
  const updated: Project = {
    ...p,
    ...patch,
    updatedAt: nowIso(),
    versionCounter: p.versionCounter + 1
  };
  await put('projects', updated);
  return ok(updated);
}

async function transitionStatus(id: string, target: ProjectStatus): Promise<Result<Project>> {
  const p = await getProject(id);
  if (!p) return fail(ErrorCodes.PROJECT_NOT_FOUND, 'Project not found.');
  if (!allowedTransition(p.status, target)) {
    return fail(
      ErrorCodes.PROJECT_INVALID_STATE,
      `Cannot transition ${p.status} → ${target}.`
    );
  }
  const updated: Project = {
    ...p,
    status: target,
    updatedAt: nowIso(),
    versionCounter: p.versionCounter + 1
  };
  await put('projects', updated);
  await logAudit('project', id, `transition:${target}`);
  return ok(updated);
}

export function allowedTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  const t: Record<ProjectStatus, ProjectStatus[]> = {
    draft: ['active', 'archived', 'deleted'],
    active: ['archived', 'deleted'],
    archived: ['active', 'deleted'],
    deleted: []
  };
  return t[from].includes(to);
}
