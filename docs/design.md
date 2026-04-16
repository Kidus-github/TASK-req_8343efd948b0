# CleanWave Offline Audio Prep -- Design Document

## 1. Overview

CleanWave is an offline-first, browser-only single-page application for batch audio cleanup, editing, packaging, playlist review, reporting, and optional on-device attendance matching. It is built with Svelte 4 + TypeScript, bundled by Vite, and served as a static SPA. There is no backend, no server-side API, and no network dependency at runtime.

### Design goals

- Run entirely in the browser with zero network calls after initial page load.
- Process audio locally using Web Workers so the main thread stays responsive.
- Persist all state in IndexedDB (authoritative store) and LocalStorage (lightweight preferences).
- Support multi-tab coordination via BroadcastChannel + IndexedDB-backed write locks.
- Keep the codebase testable: pure service/util layers with minimal UI coupling.

---

## 2. Architecture

### 2.1 Layer diagram

```
+---------------------------------------------------------------+
|  Browser tab                                                  |
|  +----------------------------------------------------------+ |
|  | Svelte components (UI)                                   | |
|  |   App.svelte -> ProfileGate | Sidebar + Workspace        | |
|  |   Workspace -> ImportPanel, TimelineEditor, ExportPanel,  | |
|  |                ReportsPanel, PlaylistsPanel, Cohorts, ... | |
|  +---------------------------+------------------------------+ |
|                              |                                |
|  +---------------------------v------------------------------+ |
|  | Svelte stores (reactive state)                           | |
|  |   session, toast, modal, workspace (refresh + import bus)| |
|  +---------------------------+------------------------------+ |
|                              |                                |
|  +---------------------------v------------------------------+ |
|  | Service layer (business logic)                           | |
|  |   profile, projects, imports, edits, exports, markers,   | |
|  |   playlists, snapshots, queue, reports, locks, audit,    | |
|  |   cohorts, integration, attendance                       | |
|  +---------------------------+------------------------------+ |
|                              |                                |
|  +---------------------------v------------------------------+ |
|  | Persistence layer                                        | |
|  |   db/indexeddb.ts  (IndexedDB CRUD)                      | |
|  |   db/prefs.ts      (LocalStorage prefs)                  | |
|  |   db/schema.ts     (store definitions, version 2)        | |
|  +----------------------------------------------------------+ |
|                                                               |
|  +----------------------------------------------------------+ |
|  | Audio processing layer (Web Workers)                     | |
|  |   engine.ts          decode, cache, applyOperations      | |
|  |   smartDispatch.ts   enqueue -> IndexedDB queue -> wait  | |
|  |   workerPool.ts      scheduler tick, render slot         | |
|  |   poolDispatch.ts    slot-level worker FIFO              | |
|  |   poolWorker.ts      waveform, silence, normalize        | |
|  |   renderWorker.ts    MP3/WAV encode (@breezystack/lamejs)| |
|  |   exportProcessor.ts per-item render + persist           | |
|  +----------------------------------------------------------+ |
|                                                               |
|  +----------------------------------------------------------+ |
|  | Attendance layer                                         | |
|  |   faceModel.ts      face-api.js (TinyFaceDetector +     | |
|  |                      FaceLandmark68 + FaceRecognitionNet)| |
|  |   inference.ts       feature extraction + ranking        | |
|  +----------------------------------------------------------+ |
+---------------------------------------------------------------+
```

### 2.2 Key design decisions

| Decision | Rationale |
|----------|-----------|
| IndexedDB as single source of truth | Survives page reload; supports large blobs; transactional |
| LocalStorage for prefs only | Fast synchronous reads for theme, speed, quiet hours |
| Web Workers for heavy ops | Prevents main-thread jank during encode/decode |
| IndexedDB-backed job queue | Persists across tab close; enables quiet-hours deferral, rating, reclaim |
| BroadcastChannel for multi-tab | Low-overhead cross-tab signaling without server |
| face-api.js with bundled weights | Real neural face recognition offline; ~7 MB committed to `public/models/` |
| Svelte 4 (not 5) | Stable compiler; broad ecosystem compatibility |

---

## 3. Data Model

### 3.1 IndexedDB schema (version 2)

| Store | Key | Notable indexes | Purpose |
|-------|-----|-----------------|---------|
| `deviceProfile` | `id` | -- | Single active local profile |
| `projects` | `id` | `by_status`, `by_name` (unique), `by_updatedAt` | Project metadata |
| `importedAudio` | `id` | `by_project` | Imported file records |
| `importBatches` | `id` | `by_project` | Batch-level import metadata |
| `blobs` | `id` | -- | Raw audio bytes + mime |
| `editOperations` | `id` | `by_project`, `by_file`, `by_sequence` | Append-only edit operation log |
| `markers` | `id` | `by_project` | Timestamped annotations |
| `snapshots` | `id` | `by_project`, `by_ordinal` | Recoverable project state |
| `playlists` | `id` | -- | Playlist metadata |
| `playlistTracks` | `id` | `by_playlist`, `by_sort` | Ordered track references |
| `exportCarts` | `id` | `by_project` | Export cart metadata |
| `exportCartItems` | `id` | `by_cart` | Per-item export spec + rendered output |
| `jobs` | `id` | `by_status`, `by_project` | Queued/running/completed work items |
| `workers` | `id` | -- | Worker runtime stats + rating |
| `reports` | `id` | -- | Report snapshots |
| `quotas` | `id` | `by_token_date` (unique) | Integration daily quotas |
| `artifacts` | `id` | -- | Generated integration payloads |
| `organizations` | `id` | `by_canonical` (unique) | Cohort orgs |
| `programs` | `id` | `by_canonical` (unique) | Cohort programs |
| `classGroups` | `id` | `by_canonical` (unique) | Cohort class groups |
| `rolePositions` | `id` | `by_canonical` (unique) | Cohort role positions |
| `cohortWindows` | `id` | -- | Cohort time windows |
| `cohortMemberships` | `id` | -- | Cohort membership records |
| `attendanceSessions` | `id` | -- | Attendance session metadata |
| `attendanceMatches` | `id` | `by_session` | Per-match results |
| `attendanceSubjects` | `id` | -- | Enrolled subject feature vectors |
| `auditEvents` | `id` | `by_timestamp` | Immutable audit log |
| `locks` | `projectId` | -- | Per-project write locks |

### 3.2 Core entity relationships

```
DeviceProfile (1)
  |
  +-- Project (*)
        |
        +-- ImportedAudioFile (*) ---> Blob (1)
        +-- ImportBatch (*)
        +-- EditOperation (*) -----> fileId
        +-- Marker (*)
        +-- ProjectSnapshot (*)
        +-- ExportCart (*)
        |     +-- ExportCartItem (*) ---> sourceRef (fileId), outputBlobRef
        +-- Job (*)
        +-- ProjectLock (0..1)
  |
  +-- Playlist (*)
        +-- PlaylistTrack (*) -----> fileId

AttendanceSession (*)
  +-- AttendanceMatch (*)
AttendanceSubject (*)
```

### 3.3 Key state machines

**Project lifecycle:**
```
draft -> active -> archived -> deleted
                -> deleted
         active <- archived
```

**Job lifecycle:**
```
queued -> deferred_quiet_hours -> queued
queued -> assigned -> running -> completed
                              -> failed_retryable -> queued (up to 3 attempts)
                              -> stalled_candidate -> reclaimed -> queued
                              -> cancelled
                   failed_retryable -> failed_terminal
```

**ExportCart lifecycle:**
```
draft -> estimated -> confirmed -> rendering -> completed
                                             -> partial_failed -> completed
                                             -> failed
      -> cancelled
```

---

## 4. Audio Processing Pipeline

### 4.1 Decode path

```
ImportedAudioFile.blobRef
  -> IndexedDB blobs store (raw bytes + Blob)
  -> AudioContext.decodeAudioData (main thread, cached per fileId)
  -> PcmBuffer { sampleRate, channels: Float32Array[], durationMs }
```

### 4.2 Edit operation model

Edit operations are an append-only log per (project, file). Each operation has a `previewEnabled` flag:

- `previewEnabled = false` -- committed; affects playback, export, and snapshots.
- `previewEnabled = true` -- staged; only audible in Preview mode; never exported.

The `applyOperationsAsync(base, ops)` function applies committed ops in sequence. It dispatches merge and normalize through the smart scheduler; all others run synchronously on the main thread.

| Operation | Engine behavior |
|-----------|----------------|
| `cut` | Remove [startMs..endMs] from buffer |
| `split` | Truncate buffer to [0..atMs]; editor creates new file for remainder |
| `merge` | Decode partner file, resample if needed, concatenate |
| `fade_in` | Linear ramp from 0 over fadeSec |
| `fade_out` | Linear ramp to 0 over fadeSec |
| `balance_adjust` | Per-channel gain: left = 1-b, right = 1+b (b in [-1,1]) |
| `normalize_lufs` | Estimate LUFS via RMS proxy, apply gain (dispatched to worker) |
| `silence_flag` | Non-destructive; analysis overlay only |

### 4.3 Worker pool + smart scheduler

```
UI action (e.g. refreshState in TimelineEditor)
  |
  v
smartDispatch.ts
  |-- enqueueJob() into IndexedDB (real Job row)
  |-- return Promise (resolver stored in memory map)
  |
  v
workerPool.ts tick() (every 800ms)
  |-- reads queued jobs from IndexedDB
  |-- filters by quiet-hours policy
  |-- picks highest-rated idle pool worker (pickWorker)
  |-- markAssigned + heartbeat
  |-- dispatches to poolDispatch -> real Web Worker
  |-- on complete: completeJob + resolveSmartJob (resolves caller's promise)
  |-- on failure: failJob + rejectSmartJob (up to MAX_JOB_ATTEMPTS)
  |-- stalled jobs (runtime > 2x estimate, no heartbeat for 10s): reclaimed
```

### 4.4 Export rendering

```
ExportPanel -> confirmCart -> enqueueJob(type: 'export', dedupeOnInputRef: true)
  |
  v
workerPool tick() -> runRenderJob (dedicated render slot)
  |-- markAssigned('render-1')
  |-- heartbeat loop every 2s
  |-- processExportJob:
  |     pcmForFile -> applyOperationsAsync (per-file ops only, no preview)
  |     renderWorker: encodeWavBytes or encodeMp3Bytes
  |     persist output blob + update ExportCartItem status
  |-- completeJob / failJob
  |-- toast notification
```

---

## 5. Component Architecture

### 5.1 Component tree

```
App.svelte
  |-- ProfileGate (mode: create | unlock)
  |-- Sidebar (role-based visibility)
  |-- [no project open]:
  |     ProjectsPanel | PlaylistsPanel | ReportsPanel |
  |     CohortsPanel | IntegrationPanel | AttendancePanel |
  |     PreferencesPanel
  |-- [project open]:
        Workspace
          |-- tab: Edit
          |     ImportPanel
          |     TimelineEditor
          |-- tab: Export
          |     ExportPanel (cart drawer)
          |-- tab: Reports
                ReportsPanel
```

### 5.2 Cross-component communication

| Mechanism | Purpose |
|-----------|---------|
| `session` store (writable) | Current profile, project, sidebar key, tab, read-only flag |
| `toast` store | Push notifications from any service |
| `modal` store | Confirm / prompt / select modals (confirm, promptModal, selectModal) |
| `workspaceRefreshBus` store | Snapshot restore triggers timeline reload |
| `importEventsBus` store | Import completion triggers timeline file-list refresh |
| BroadcastChannel `cleanwave.locks` | Multi-tab lock acquired/released/takeover events |

---

## 6. Multi-Tab Coordination

```
Tab A opens project -> tryAcquire(projectId, tabId)
  |-- writes ProjectLock { projectId, tabId, acquiredAt, lastHeartbeatAt }
  |-- emits BroadcastChannel 'acquired'
  |-- starts heartbeat interval (every 5s)

Tab B opens same project -> tryAcquire fails (lock exists, not stale)
  |-- offers "Open read-only" modal
  |-- subscribeLockEvents: listens for 'acquired' / 'released' / 'takeover_request'

Lock expiry: if heartbeat is older than 45s, lock is considered stale and can be overwritten.
```

---

## 7. Attendance Module

### 7.1 Production path (face-api.js loaded)

```
loadFaceModel() -> loads TinyFaceDetector + FaceLandmark68 + FaceRecognitionNet
                   from /models/ (same-origin, ~7 MB committed weights)

enrollSubjectFromImage(label, source)
  -> faceapi.detectSingleFace().withFaceLandmarks().withFaceDescriptor()
  -> 128-dim Float32Array stored as featureKind: 'face-128'

recordMatchFromSource(sessionId, subjectRef, source)
  -> computeDescriptor(source) -> 128-dim descriptor
  -> rankCandidates: Euclidean distance -> confidence [0..1]
  -> auto_accepted if #1 > threshold; else 'suggested' -> manual review
```

### 7.2 Test fallback (jsdom, no TFJS)

```
loadFaceModel() -> returns false
extractFeatureFromSource -> luminance-hash 16x16 -> 256-dim, featureKind: 'luminance-full'
rankCandidates: cosine similarity (like-with-like only)
```

---

## 8. Persistence Strategy

| Data | Store | Reason |
|------|-------|--------|
| Theme, playback speed, quiet hours, UI role | LocalStorage | Fast sync read at startup |
| Profile, projects, files, blobs, ops, markers, snapshots, playlists, carts, jobs, quotas, cohorts, attendance, audit log, locks | IndexedDB | Transactional, large-value support, survives reload |
| Decoded audio buffers | In-memory Map (engine cache) | Avoid redundant decodes; invalidated on edit |
| Smart-dispatch resolvers | In-memory Map | Ephemeral; lost on tab close (jobs persist in IDB) |

### Auto-save

- Runs every 30 seconds when the project has unsaved changes.
- Creates a `ProjectSnapshot` with SHA-256 checksum.
- Keeps the last 3 recoverable versions; prunes older ones.
- On next open after crash, offers recovery from the most recent valid snapshot.
- `restoreSnapshot` writes saved operations + markers back into live IndexedDB stores in a single `readwrite` transaction.

---

## 9. Security Model

This app has **no server-side security**. All data is local to the browser.

| Concern | Approach |
|---------|----------|
| Profile passphrase | Salted SHA-256 hash in IndexedDB; convenience gate only |
| Sensitive actions (reset, attendance, cohort bulk, integration export) | Passphrase re-entry via in-app modal |
| Raw passphrase | Never persisted; only the hash + salt are stored |
| Network isolation | Zero runtime network requests; enforced by a test spy on `fetch` |
| Camera/filesystem | Requested only on explicit user action |

---

## 10. Build + Deployment

```
Dockerfile (Alpine Node 20):
  npm ci -> npm run build (Vite) -> npm run preview (Vite preview server)

docker-compose.yml services:
  app          serves built SPA on :5173
  test         runs run_tests.sh (unit + integration + component + flow)
  test-browser runs Playwright specs in a Chromium container
```

The built SPA in `dist/` is a static bundle:
- `index.html` + `index-*.js` (~200 KB) + `face-api-*.js` (~638 KB) + `lamejs-*.js` (~169 KB)
- `poolWorker-*.js` + `renderWorker-*.js` (ES module workers)
- `public/models/` (~7 MB face-api.js weights, served as static files)

---

## 11. Testing Strategy

| Layer | Tool | Count | What it covers |
|-------|------|-------|----------------|
| Unit | Vitest + jsdom | 11 files | Validators, audio math, queue logic, CSV, MP3, state transitions |
| Integration | Vitest + jsdom + fake-indexeddb | 35 files | Cross-service flows, IndexedDB round-trips, snapshot restore, merge/split/export/queue |
| Component | Vitest + @testing-library/svelte | 3 files | Real Svelte component render: ProfileGate, ConfirmModal, ProjectsPanel |
| Flow | Vitest + jsdom + fake-indexeddb | 4 files | Multi-step user journeys (profile -> project -> import -> edit -> export -> download) |
| Browser | Playwright + Chromium | 5 files | Real browser: smoke, waveform, export-download, multi-tab, attendance |

Test environment polyfills (`tests/setup.ts`):
- `fake-indexeddb/auto` for IndexedDB
- BroadcastChannel polyfill (in-process message delivery)
- Blob.arrayBuffer shim (jsdom compatibility)
- FakeAudioContext that decodes WAV files produced by the app's own encoder

---

## 12. Business Rules (Authoritative Constants)

| Rule | Value |
|------|-------|
| Max files per import batch | 200 |
| Max batch size | 2 GB |
| Allowed extensions | mp3, wav, ogg |
| Fade range | 0.1 -- 10.0 seconds (0.1 step) |
| Silence threshold | -35 dB |
| Silence min duration | 0.6 seconds |
| Normalization target | -14 LUFS |
| Balance range | -100 to +100 (integer) |
| Playback speed | 0.5x -- 2.0x (0.1 step) |
| Seek step | 15 seconds |
| Max markers per project | 50 |
| Marker note max length | 500 characters |
| Max playlist tracks | 1000 |
| Max export cart items | 20 |
| MP3 bitrates | 128, 192, 320 kbps |
| WAV sample rate | 44100 Hz |
| Auto-save interval | 30 seconds |
| Recoverable snapshots | 3 per project |
| Job stall multiplier | 2x initial estimate |
| Reclaim window | 10 seconds after stall |
| Max job attempts | 3 |
| Lock expiry | 45 seconds |
| Lock heartbeat | 5 seconds |
| Attendance Top-N range | 1 -- 10 |
| Attendance threshold | 0.00 -- 1.00 (default 0.75) |
| Integration daily quota | 100 per token |
