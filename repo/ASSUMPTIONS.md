# Assumptions

Each item pins a decision to the authoritative source so future editors can revisit it.

## 1. Passphrase storage
Convenience gate, not secure authentication. Per-profile random salt + SHA-256 hash; never raw. Sensitive re-entry uses the in-app modal (`src/lib/util/passphraseGate.ts`), not `prompt()`.

## 2. Quiet hours
Heavy jobs (`export`, `normalize`, `silence_scan`, `transcode`) are deferred during quiet hours by default; user opts in via `DeviceProfile.quietHours.allowHeavyJobs`. `waveform` is treated as light and still runs.

## 3. MP3 encoder
`@breezystack/lamejs`. Real MPEG Layer III frames (verified in `tests/unit/mp3.test.ts`).

## 4. Merge operation
`applyOperationsAsync` decodes the partner file and concatenates. When sample rates differ, the partner is linearly resampled. The sync `applyOperations` does NOT handle merge — callers that need a faithful render must use the async variant.

## 5. Attendance: real bundled face-recognition model

The app ships face-api.js with three neural-network model weight sets committed to `public/models/` (~7 MB total):

- **TinyFaceDetector** — lightweight real-time face detection.
- **FaceLandmark68Net** — 68-point facial landmark alignment (needed for best descriptor accuracy).
- **FaceRecognitionNet** — 128-dim face descriptor (the actual recognition model).

Weights are loaded from the app's own origin at runtime (`fetch('/models/...')`). No external CDN, no network egress. `scripts/prepare-face-models.mjs` downloads the weights from the canonical face-api.js GitHub repository as a one-time setup step; thereafter the committed files are part of every build.

- **Production path**: `loadFaceModel()` loads all three nets. `computeDescriptor(source)` returns a real 128-dim Float32Array. Matching uses Euclidean distance mapped to confidence in [0..1]. Enrolled subjects are tagged `featureKind: 'face-128'`.
- **Test-environment fallback (jsdom)**: TensorFlow.js cannot run in jsdom, so `loadFaceModel()` returns false. The pipeline falls back to a 16x16 luminance feature hash (tagged `luminance-full`). `rankCandidates` only compares subjects of matching `featureKind`, so the two paths never cross-contaminate. Tests explicitly cover both the math for 128-dim descriptors and the luminance fallback.

## 6. Role visibility, not security
UI role selection only hides sidebar entries. Any local user can change it.

## 7. Storage ceilings
IndexedDB quotas vary by browser. Storage failures surface `STORAGE_UNAVAILABLE`; auto-save aborts quietly on storage pressure.

## 8. Snapshot atomicity + restore
`createSnapshot` writes → marks valid → prunes. `restoreSnapshot` verifies the checksum, then in one `readwrite` transaction clears the project's live `editOperations` + `markers` via `by_project` cursors and re-writes the saved records. The workspace reloads the timeline via `workspaceRefreshBus` on success.

## 9. Export resume
Queued exports persist in IndexedDB. Mid-render resume is best-effort — the encoder doesn't emit checkpoints — so a partially-rendered job retries as a whole up to `MAX_JOB_ATTEMPTS`.

## 10. Export operation filtering
`processExportJob` uses `listOperationsForFile(projectId, fileId)` + `filter(!previewEnabled)`. Tested by `tests/integration/export-per-file-ops.test.ts`.

## 11. Preview staging model
`EditOperation.previewEnabled === true` flags staged ops. `applyPreviews` promotes; `discardPreviews` deletes. Exports never ship preview ops.

## 12. Duration metadata + estimates
Persisted at import. `addCartItem` attempts a decode backfill if missing. `estimateCart` returns `durationKnown` per item and `hasUnknownDuration` overall; the UI renders explicit "unknown" rather than a misleading zero.

## 13. Report filter correctness
`computeReport` applies `projectId` by joining cart items → source files, `dateFrom/dateTo` by the corresponding export job's `completedAt`, and `exportFormat` on the completed cart item. Format breakdown + failure counts use the filtered set.

## 14. Worker-pool architecture

**Real, in-production path:**
- `poolDispatch.ts` owns the actual UI-demand workers. `dispatchPool(req)` returns a Promise that resolves when a free pool slot completes the job.
- The timeline editor consumes the dispatcher directly for `waveform` and `silence_scan`.
- The engine's `applyOperationsAsync` awaits `normalizeChannels` (pool dispatch) for every committed normalize — preview, playback rebuild, and export.
- Export rendering runs in its own render worker slot, owned by `workerPool.ts`, driven by the IndexedDB job-queue pump. The same pool workers also service any pool-type jobs that arrive through the queue.

**Rating-aware scheduled dispatch:**
- When a scheduled pool-type job (`waveform`, `silence_scan`, `normalize`, `transcode`) arrives in the queue, the tick reads the current `WorkerRuntime` rows, filters to the pool runtimes that are not already assigned, and calls `pickWorker()` to select the highest-rated idle worker. The chosen `workerId` is written to the job and logged in the `pool:start` audit event. Tested by `tests/integration/pool-rating-dispatch.test.ts`.
- `tickScheduledPoolOnce()` exposes a deterministic one-shot scheduler for tests; production uses the interval-driven `tick()`.

**Fallback:**
- When `Worker` is undefined (jsdom, server-side tests), `dispatchPool` explicitly runs the same algorithm inline via `executePoolJob`. This path is deliberate, narrow, and documented; in real browsers with Worker support, nothing calls it.

**What this does NOT mean:**
- Main-thread `computePeaks` / `detectSilenceRegions` / `gainForNormalization` are still exported from `util/audio.ts` because the worker code, the exporter, and some pure unit tests use them. But the UI flow in `TimelineEditor.svelte` and the render engine's normalize path no longer call them directly — they go through the dispatcher.

## 15. Shuffle fairness
`nextShuffleIndex` visits every remaining playable track exactly once before any repeat.

## 16. Playlist blob resolution
A `PlaylistTrack.fileId` is an `ImportedAudioFile.id`, not a blob key. `resolvePlayableBlob(fileId)` in `src/lib/services/playlists.ts` looks up the file record, reads `blobRef`, and returns a Blob — either the native one or a fresh `Blob` built from stored bytes + mime. The UI uses this helper; the old `get('blobs', track.fileId)` path would always miss.

## 17. Daily quota reset
Integration token quotas reset at local midnight via `YYYY-MM-DD` date key.

## 18. Cohort partial-accept default
CSV import defaults to partial accept; strict mode aborts on the first invalid row.

## 19. Docker build vs. runtime
`docker-compose up --build` uses the network for `npm ci`. Runtime inside the container issues no network requests for in-scope operations.

## 20. Blob storage in tests
Imports persist raw `Uint8Array bytes` + `mimeType` next to the Blob. Decode paths prefer bytes when present. `resolvePlayableBlob` assembles a Blob from bytes when a native Blob is not available in the store. Real browsers that preserve Blobs through structured clone take the native-Blob branch.

## 21. Normalization approximation
`estimateLufs` + `gainForNormalization` use a K-free RMS-to-LUFS approximation — good enough for the "normalize toward −14 LUFS" UX and deterministic tests. ITU-R BS.1770 could replace it without changing consumer APIs.

## 22. No `prompt()` in core flows
All passphrase re-entry, merge partner selection, and cohort / integration / attendance prompts use the in-app `activeModal` store (confirm / prompt / select) with validation.

## 23. Project deletion is a full cascade
`deleteProject` walks every dependent store keyed by `projectId` AND every `exportCartItems` row keyed by the project's carts, removing each cart item and its rendered `outputBlobRef` from the `blobs` store. Regression-tested by `tests/integration/project-delete-cascade.test.ts`. The previous version only cascaded the per-project tables and left cart items + rendered output blobs as orphans.

## 24. Test directory labels
Multi-step user-journey tests live in `tests/flow/` and run under jsdom at the service layer — NOT a real-browser e2e. `tests/browser/` holds one real-browser smoke test run via Playwright + `npm run preview`; it is explicitly opt-in (`npm run test:browser`) and not part of `docker compose run --rm test`, which stays offline and does not download browser binaries.

## 25. Import-to-editor reactivity
`src/lib/stores/workspace.ts::importEventsBus` is a Svelte store that `ImportPanel` publishes to via `publishImportCompleted(projectId, acceptedFileIds)` after every successful `importBatch`. `TimelineEditor` subscribes to the same store and, when an event arrives for its project, re-reads files from IndexedDB and either preserves the current selection (if still valid) or selects one of the newly-imported files so it is immediately editable. Tested in `tests/integration/import-to-editor.test.ts`.

## 26. Duplicate-submit protection for export confirmation
Two layers:

- **UI layer** (`ExportPanel.onConfirm`): a local `submitting` flag flips true before the confirmation modal is awaited. The confirm button reads "Submitting…" and is disabled while in flight; the flag only clears in `finally`.
- **Queue layer** (`enqueueJob(..., { dedupeOnInputRef: true })`): if another job with the same `(type, inputRef)` is already in a non-terminal state (queued / deferred_quiet_hours / assigned / running / stalled_candidate / reclaimed / failed_retryable), enqueueJob returns that existing row instead of creating a duplicate. Idempotent by design; sequential double-clicks always resolve to the same job id.

Tested in `tests/integration/export-duplicate-prevent.test.ts`.

## 27. Export job worker lifecycle
Export jobs travel through the same lifecycle as other pool jobs:

- `markAssigned(job.id, 'render-1')` before the encoder runs; `workerId` and `startedAt` are recorded.
- A heartbeat is posted every `LIMITS.WORKER_HEARTBEAT_MS` (2s) while rendering, so `shouldReclaim` sees progress.
- `shouldReclaim` / `reclaimJob` apply uniformly — a stalled export goes back to queued with `stallReclaimed = true` and its `workerId` cleared.
- `completeJob` / `failJob` update the `render-1` `WorkerRuntime` rating the same way pool workers are rated for normalize / waveform / silence jobs.

Tested in `tests/integration/export-worker-lifecycle.test.ts`.
