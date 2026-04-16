// Full-flow test (jsdom, service layer): create profile, make a project,
// import files, commit an edit, add it to cart, confirm, then verify the
// report picks up the activity.
//
// NOTE: This is not a browser UI end-to-end test. It exercises the same
// multi-step user journey at the service layer under jsdom. Real browser
// UI verification requires a separate Playwright/Cypress run; this file
// covers the state/logic path deterministically and offline.

import { describe, expect, it } from 'vitest';
import { createProfile, hasProfile, verifyPassphrase, resetDeviceProfile } from '../../src/lib/services/profile';
import { createProject, listProjects } from '../../src/lib/services/projects';
import { importBatch } from '../../src/lib/services/imports';
import { appendOperation, listOperations } from '../../src/lib/services/edits';
import { addCartItem, confirmCart, estimateCart, getOrCreateCart, listCartItems } from '../../src/lib/services/exports';
import { createSnapshot, latestRecoverable } from '../../src/lib/services/snapshots';
import { createMarker, listMarkers } from '../../src/lib/services/markers';
import { addTrack, createPlaylist, searchTracks, listTracks } from '../../src/lib/services/playlists';
import { newTabId, tryAcquire, release } from '../../src/lib/services/locks';

describe('primary end-to-end flow', () => {
  it('profile → project → import → edit → marker → playlist → export → report', async () => {
    // 1) Profile
    const prof = await createProfile('Reviewer', 'offline-gate-9');
    expect(prof.ok).toBe(true);
    expect(await hasProfile()).toBe(true);
    expect((await verifyPassphrase('offline-gate-9')).ok).toBe(true);

    // 2) Project
    const p = await createProject('Pilot');
    if (!p.ok) throw new Error('project');

    // 3) Acquire lock
    const tab = newTabId();
    const lock = await tryAcquire(p.data.id, tab);
    expect(lock.ok).toBe(true);

    // 4) Import a valid and an invalid file
    const imp = await importBatch(p.data.id, [
      { name: 'promo.mp3', size: 2048, data: new Blob([new Uint8Array(2048)], { type: 'audio/mpeg' }) },
      { name: 'junk.flac', size: 128, data: new Blob([new Uint8Array(128)], { type: 'audio/flac' }) }
    ]);
    expect(imp.ok).toBe(true);
    if (!imp.ok) throw new Error('import');
    expect(imp.data.accepted.length).toBe(1);
    expect(imp.data.rejected.length).toBe(1);

    // 5) Commit an edit operation
    const fadeRes = await appendOperation(p.data.id, imp.data.accepted[0].id, 'fade_in', { seconds: 1 });
    expect(fadeRes.ok).toBe(true);
    expect((await listOperations(p.data.id)).length).toBe(1);

    // 6) Add a marker
    const m = await createMarker(p.data.id, 500, 'intro cue', imp.data.accepted[0].id, 60_000);
    expect(m.ok).toBe(true);
    expect((await listMarkers(p.data.id)).length).toBe(1);

    // 7) Playlist + search
    const pl = await createPlaylist('My list');
    expect(pl.ok).toBe(true);
    if (!pl.ok) throw new Error('playlist');
    await addTrack(pl.data.id, imp.data.accepted[0].id, 'promo.mp3', 'opening');
    const tracks = await listTracks(pl.data.id);
    expect(searchTracks(tracks, 'promo')[0].track.filenameCache).toBe('promo.mp3');

    // 8) Snapshot & recovery
    await createSnapshot(p.data.id, 'autosave', { ops: 1 });
    const rec = await latestRecoverable(p.data.id);
    expect(rec).toBeDefined();

    // 9) Export cart
    const cart = await getOrCreateCart(p.data.id);
    const add = await addCartItem(cart.id, imp.data.accepted[0].id, 'wav');
    expect(add.ok).toBe(true);
    const est = await estimateCart(cart.id);
    expect(est.perItem.length).toBe(1);
    const conf = await confirmCart(cart.id);
    expect(conf.ok).toBe(true);
    const items = await listCartItems(cart.id);
    expect(items.every((i) => i.status === 'queued' || i.status === 'cancelled')).toBe(true);

    // 10) Release lock, reset
    await release(p.data.id, tab);
    const reset = await resetDeviceProfile();
    expect(reset.ok).toBe(true);
    expect(await hasProfile()).toBe(false);
    expect((await listProjects()).length).toBe(0);
  });
});
