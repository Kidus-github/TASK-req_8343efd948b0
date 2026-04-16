# CleanWave Offline Audio Prep — Design Questions

## Authentication & Security

**Question:** Is the local profile gate real authentication or only a device-local convenience barrier?
**Assumption:** The PRD defines the profile gate as convenience-only and explicitly says there is no backend, no real authentication, and no server-side identity.
**Solution:** Treat the profile gate as a local UX guard only. Label it clearly in the UI and documentation as non-security-grade. Do not market it as account security. Enforce only local validation, session unlock, and friction for sensitive actions.

## Authentication & Security

**Question:** How should the passphrase be stored and validated?
**Assumption:** The PRD requires that raw passphrases are never persisted and only a local hash is stored.
**Solution:** Store a salted hash derived with Web Crypto using PBKDF2 or Argon2 WASM if bundled locally. Persist only the salt, algorithm metadata, and derived hash in IndexedDB or LocalStorage-safe profile metadata. Perform validation entirely offline.

## Authentication & Security

**Question:** Are there any secrets in the system beyond the local passphrase hash?
**Assumption:** There are no API keys, backend tokens, or remote credentials because the application is fully offline and local-only.
**Solution:** Define the secret inventory as empty except for passphrase-derived local verification material. Document that no runtime secrets are required, `.env` contains only non-secret config, and no external credentials are supported.

## Authentication & Security

**Question:** Can a local user inspect or modify stored data through browser DevTools?
**Assumption:** Yes. The app runs entirely in the browser and has no trusted execution boundary against the device owner.
**Solution:** State explicitly that IndexedDB, LocalStorage, and in-memory state are user-accessible on the local device. Do not rely on client-side obfuscation for security decisions. Use checksums and audit metadata only for tamper evidence, not tamper prevention.

## Authentication & Security

**Question:** Should IndexedDB data be encrypted or plaintext?
**Assumption:** The PRD does not require strong encryption and positions the app as convenience-only rather than secure local vaulting.
**Solution:** Store operational data in plaintext IndexedDB, with optional minimal obfuscation for highly sensitive convenience-gated records if desired. Keep the architecture honest: encryption at rest is not guaranteed unless a future phase introduces user-managed encryption keys.

## Authentication & Security

**Question:** How should sensitive local actions be gated if roles are UI-only?
**Assumption:** Roles are not true authorization boundaries. The PRD requires passphrase re-entry for device reset, attendance launch, cohort bulk operations, and Open Platform Kit artifact generation.
**Solution:** Require recent passphrase re-entry for these sensitive actions and expire the elevated local session after a short timeout, such as 10 minutes of inactivity. Log all gated actions as audit events.

## Authentication & Security

**Question:** Are Editor, Reviewer, and Operations roles enforceable security boundaries?
**Assumption:** No. The PRD explicitly says these are UI visibility defaults only.
**Solution:** Implement roles as menu presets and view restrictions only. Add a clear note in preferences/help that roles do not secure access to data in the same browser profile.

## Authentication & Security

**Question:** What is the exact threat model for this product?
**Assumption:** The main risks are accidental misuse, accidental deletion, concurrent local tabs, device sharing, storage corruption, quota exhaustion, and privacy leakage from optional camera-based attendance. The device owner is not an adversary the app can fully defend against.
**Solution:** Document the threat model explicitly: protect against accidental actions and inconsistent local state, not against a determined local user with device access. Emphasize integrity, recoverability, auditability, and explicit privacy disclosures over strong secrecy guarantees.

## Authentication & Security

**Question:** How should face-recognition data be isolated from normal audio-editing data?
**Assumption:** Attendance workflows are optional and privacy-sensitive.
**Solution:** Store attendance sessions, embeddings, match outcomes, and optional image artifacts in separate IndexedDB stores with separate repository modules, separate retention controls, and explicit delete-by-session or full-reset operations. Never mix attendance data into general project stores.

## Authentication & Security

**Question:** What isolation applies to File System Access exports?
**Assumption:** External files written through File System Access API leave app-controlled storage.
**Solution:** Treat external artifact folders as user-owned destinations. Store only metadata, checksums, and chosen folder handles locally. Never assume exported files can be deleted or updated unless explicit permission is still available.

## Authentication & Security

**Question:** How should audit events be protected from silent mutation?
**Assumption:** Audit logs are local-only and may be editable by a local device owner.
**Solution:** Make audit events append-only at the application layer, include UTC timestamps and stable event types, and optionally chain event checksums by previous hash to improve tamper evidence. Do not claim this prevents deletion or editing by a privileged local user.

## Data Storage & Encryption

**Question:** What is the exact IndexedDB schema needed for implementation readiness?
**Assumption:** The PRD defines entities but not object stores or indexes.
**Solution:** Define object stores for `deviceProfiles`, `projects`, `audioFiles`, `audioChunks`, `importBatches`, `editSessions`, `editOperations`, `markers`, `projectSnapshots`, `playlists`, `playlistTracks`, `exportCarts`, `exportCartItems`, `jobs`, `workers`, `reportSnapshots`, `integrationQuotas`, `generatedArtifacts`, `organizations`, `programs`, `classGroups`, `rolePositions`, `cohortWindows`, `cohortMemberships`, `attendanceSessions`, `attendanceMatches`, `attendanceEmbeddings`, and `auditEvents`. Add indexes on `projectId`, `createdAt`, `updatedAt`, `status`, and any query-critical foreign keys.

## Data Storage & Encryption

**Question:** How should imported audio blobs be stored: full blob, chunked blob, or streamed?
**Assumption:** The PRD allows blob or chunked blob reference and supports files up to large batch sizes.
**Solution:** Store small and medium audio files as full blobs by default. Switch to chunked storage for large files above a defined threshold, such as 50 MB, to reduce write failures and improve partial recovery. Keep a manifest per file with chunk ordering, checksums, and total size.

## Data Storage & Encryption

**Question:** What should happen when browser storage quota is exceeded?
**Assumption:** Storage ceilings vary by environment and the PRD requires clear surfacing with remediation guidance.
**Solution:** Fail the specific write atomically, show a blocking error with current action context, and offer remediation: delete old snapshots, delete projects, reduce import batch size, or export-and-remove artifacts. Never leave a half-written audio file or snapshot committed.

## Data Storage & Encryption

**Question:** Should project snapshots be stored as full copies or diffs?
**Assumption:** The PRD requires atomic snapshots, integrity verification, last-three retention, and recoverability.
**Solution:** Store snapshots as full serialized project-state copies for correctness and auditability. Reserve diff snapshots as a future optimization only if replay and recovery remain deterministic and fully tested.

## Data Storage & Encryption

**Question:** When are snapshots triggered?
**Assumption:** The PRD mentions autosave every 30 seconds while dirty and includes snapshot reasons `autosave`, `manual`, `pre-export`, and `recovery`.
**Solution:** Trigger snapshots on three classes of events: timed autosave while dirty, explicit manual save, and mandatory pre-export checkpoint. Mark recovery snapshots when reopening after abnormal exit and validating previous recoverable state.

## Data Storage & Encryption

**Question:** What data must be deleted on project deletion?
**Assumption:** The PRD says deleting a project deletes dependent blobs, markers, snapshots, jobs, and report metadata.
**Solution:** Cascade delete all project-owned rows and blobs, including audio chunks, operations, edit sessions, export carts, export items, temporary render outputs, markers, snapshots, and linked reports. Log one project delete audit event with counts of deleted dependent entities.

## Data Storage & Encryption

**Question:** What data must be deleted on profile reset?
**Assumption:** The PRD requires reset to remove profile, preferences, projects, playlists, blobs, snapshots, reports, cohorts, attendance data, and quotas.
**Solution:** Perform a full database wipe plus LocalStorage preference purge, then verify emptiness before returning to first-launch state. Refuse partial success; if any store fails to clear, surface the error and keep the user in reset remediation flow.

## Data Storage & Encryption

**Question:** How should checksums be used for snapshots and artifacts?
**Assumption:** The PRD requires per-snapshot checksum and generated artifact checksum for tamper evidence.
**Solution:** Compute SHA-256 over normalized serialized payloads and store alongside metadata. Validate snapshot checksums before marking a snapshot usable. Include checksum mismatch as explicit corrupt-state telemetry in local audit logs.

## State Management

**Question:** What state management approach should be used in the Svelte SPA?
**Assumption:** The PRD specifies Svelte + TypeScript but not the exact state pattern.
**Solution:** Use Svelte stores with a domain-oriented architecture: persistent stores for project, queue, playlists, reports, cohorts, and attendance; transient UI stores for dialogs, toasts, hover state, and selection state; derived stores for permissions, dirty state, and export estimates.

## State Management

**Question:** How should state be partitioned between persistent and transient domains?
**Assumption:** Some state belongs in IndexedDB, some only in memory.
**Solution:** Persist long-lived domain state such as projects, edits, markers, jobs, reports, quotas, and attendance outcomes. Keep transient playback head position, drag selection, modal visibility, keyboard focus, and temporary preview state in memory unless the PRD explicitly requires restoration.

## State Management

**Question:** What are the critical state domains?
**Assumption:** The user asked specifically for project, playback, and worker queue domains.
**Solution:** Define domain stores for `profileState`, `projectState`, `timelineState`, `playbackState`, `markerState`, `playlistState`, `exportState`, `workerQueueState`, `reportState`, `cohortState`, `attendanceState`, `lockState`, and `uiShellState`. Each domain owns its reducers/actions and repository synchronization rules.

## State Management

**Question:** How should dirty-state tracking work for autosave and navigation guards?
**Assumption:** Autosave only runs when unsaved changes exist.
**Solution:** Track a monotonic `versionCounter`, `lastCommittedVersion`, and `lastSnapshotVersion`. A project is dirty when `versionCounter > max(lastCommittedVersion, lastSnapshotVersion)` or when transient edits have been confirmed but not yet snapshotted.

## State Management

**Question:** How should effect preview state differ from committed edit state?
**Assumption:** The PRD requires preview rendering that does not mutate committed edit state until confirmed.
**Solution:** Keep preview operations in a separate ephemeral preview stack and render pipeline branch. On confirm, append a canonical edit operation to the operation log; on cancel, discard preview state with no mutation to committed project history.

## State Management

**Question:** How should routing interact with persisted state?
**Assumption:** The app has sidebar navigation and main tabs such as Edit, Export, and Reports.
**Solution:** Use route parameters for high-level navigation such as selected project and active module, but source truth for domain state from stores synchronized with IndexedDB. Route changes should never directly mutate persistent data without explicit actions.

## State Management

**Question:** How should state rehydration work on startup?
**Assumption:** The app is offline-first and must resume from local state.
**Solution:** Initialize storage, load profile, check for active locks and recoverable snapshots, then hydrate route and domain stores in a deterministic order: profile, projects, selected project, locks, recoverable snapshot, jobs, then UI preferences. Show loading shell until required stores are consistent.

## Edge Cases

**Question:** What happens if a batch import includes 200 valid files plus one invalid extra file?
**Assumption:** The batch cap is 200 files maximum.
**Solution:** Reject the entire selection before ingest if the selected file count exceeds 200, because the cap applies before heavy parsing. Show a single batch-level error rather than attempting partial import in an over-limit batch.

## Edge Cases

**Question:** What happens if the total selected batch size is just under 2 GB but decoded processing needs exceed storage capacity?
**Assumption:** Validation checks selected file sizes before heavy parsing, but additional derived data like waveforms and snapshots consume storage too.
**Solution:** Accept the batch only if selected input size is within limit, but continuously monitor storage pressure during ingest and waveform generation. If quota becomes constrained, pause further derived writes and prompt the user before continuing.

## Edge Cases

**Question:** How should duplicate filenames be handled in search and export?
**Assumption:** Duplicate filenames are allowed within a project.
**Solution:** Keep user-visible filenames unchanged, but all internal references must use stable IDs. In tables and search results, display filename plus import timestamp or short ID suffix when duplicates exist.

## Edge Cases

**Question:** What happens if a marker becomes ambiguous after edits shift timeline positions?
**Assumption:** The PRD requires deterministic remap when possible and `needs_review` otherwise.
**Solution:** Attempt marker remapping using operation-log segment lineage. If a marker’s original region was deleted, split into multiple valid regions, or cannot be mapped deterministically, preserve the original marker, set `needs_review`, and surface it prominently in the marker list.

## Edge Cases

**Question:** How should merge behave when input files have different sample rates or channel layouts?
**Assumption:** The PRD allows internal normalization/transcoding before merge or explicit failure.
**Solution:** Normalize inputs in a worker to a common internal PCM format before merge when feasible. If transcoding fails or the media is corrupt, fail the merge with a detailed compatibility reason and no partial commit.

## Edge Cases

**Question:** What happens if autosave fires while a long edit worker is still generating results?
**Assumption:** Heavy processing is asynchronous and autosave should remain reliable.
**Solution:** Snapshot only committed state plus references to in-flight jobs, not incomplete worker buffers. On recovery, requeue incomplete retryable jobs instead of serializing unstable intermediate worker memory.

## Edge Cases

**Question:** What happens if a snapshot write succeeds but pruning older snapshots fails?
**Assumption:** Snapshot creation must be atomic and corrupt snapshots must not replace the last known good version.
**Solution:** Mark the new snapshot valid once checksum verification passes, but treat prune failure as non-fatal. Defer pruning to a cleanup task and surface storage pressure warnings if retention exceeds the target window.

## Edge Cases

**Question:** What should happen when a recoverable snapshot exists but references missing blobs?
**Assumption:** Local storage corruption or partial deletion is possible.
**Solution:** Reject automatic recovery of that snapshot, mark it corrupt, preserve the last known good valid snapshot, and show the user a recovery error with fallback choices.

## Edge Cases

**Question:** What happens if export naming collisions occur repeatedly?
**Assumption:** Default collision policy is incrementing suffixes.
**Solution:** Apply `_1`, `_2`, and so on deterministically against the target directory contents known at export time. If a collision still occurs during actual file write, retry with the next suffix before failing.

## Concurrency & Multi-User Behavior

**Question:** What is the locking model when the same project is opened in multiple tabs?
**Assumption:** The PRD requires only one writable tab and optional read-only second tab.
**Solution:** Use a soft local lock with heartbeat-backed ownership recorded in IndexedDB and coordinated by BroadcastChannel. First tab obtains write lock; second tab may only open read-only or cancel.

## Concurrency & Multi-User Behavior

**Question:** How should lock acquisition and renewal work?
**Assumption:** The lock owner posts heartbeats and the lock expires after 45 seconds of missing heartbeats.
**Solution:** Store `lockOwnerTabId`, `lastHeartbeatAt`, `projectId`, and `versionCounterAtLock` in a lock record. Renew heartbeat every 2 seconds while the tab is active. On loss of visibility or unload, attempt release immediately; otherwise allow timeout-based expiry.

## Concurrency & Multi-User Behavior

**Question:** Is this system multi-user in any real sense?
**Assumption:** No. Multiple people on the same device/profile are not isolated users.
**Solution:** Document that the system is effectively single-profile, single-device, multi-tab only. Shared-device use is unsupported from a security perspective.

## Concurrency & Multi-User Behavior

**Question:** What is the conflict strategy if two tabs somehow mutate state concurrently?
**Assumption:** The intended design prevents this, but race conditions may still occur during lock expiry or abrupt crashes.
**Solution:** Use optimistic version checks on every commit. If the current stored `versionCounter` does not match the tab’s expected version, reject the commit, reload latest state, and force read-only conflict resolution rather than last-write-wins.

## Concurrency & Multi-User Behavior

**Question:** How should queued jobs behave when a project becomes read-only in a secondary tab?
**Assumption:** Read-only tabs cannot mutate edit or export-cart state.
**Solution:** Allow read-only tabs to observe queue progress and reports but prevent enqueue, cancel, reorder, or confirm actions. Job status remains visible but non-interactive.

## Concurrency & Multi-User Behavior

**Question:** What happens if a writable tab crashes while holding the lock and in-flight export jobs exist?
**Assumption:** Lock expiry is 45 seconds and queue persistence exists.
**Solution:** On restart, release stale lock after expiry, mark previously running jobs `failed_retryable` unless checkpointed, and prompt the user to recover project state and optionally resume export-related work.

## Offline Behavior

**Question:** What does fully offline-capable mean in practice?
**Assumption:** After app assets are available locally, no runtime network dependencies are allowed.
**Solution:** Bundle all JS, CSS, WASM, models, templates, and local documentation into the build. Forbid runtime fetches except same-origin asset retrieval already cached locally by the browser or service worker.

## Offline Behavior

**Question:** How should the app behave if opened without internet before assets were ever cached locally?
**Assumption:** Initial install/build still requires asset availability at least once.
**Solution:** Show an offline bootstrap error indicating that first-time asset load was incomplete and the app must be loaded once successfully online or from the packaged local deployment environment. After successful first load, runtime use must be offline-safe.

## Offline Behavior

**Question:** Can workers, reports, and exports continue when the browser loses connectivity mid-session?
**Assumption:** Yes, because none of these features require the network.
**Solution:** Make offline status irrelevant to in-scope features after initial asset availability. Connectivity changes should not alter queue behavior, storage writes, or export logic.

## Offline Behavior

**Question:** How should the Open Platform Kit behave offline?
**Assumption:** It generates example artifacts only and never transmits them.
**Solution:** Generate all REST-style, GraphQL-style, and webhook-like payloads from local templates with deterministic timestamps and sample IDs. Never attempt validation against remote endpoints.

## Offline Behavior

**Question:** How should the attendance module work offline?
**Assumption:** The model must be bundled and no runtime downloads are allowed.
**Solution:** Package the model with app assets, verify its presence during build or startup diagnostics, and refuse to open the attendance module if required local assets are missing or corrupted.

## Error Handling

**Question:** What is the global error envelope for local service modules?
**Assumption:** The PRD defines a deterministic `Result<T>` success/failure envelope.
**Solution:** Enforce this envelope consistently across repositories, worker bridges, validators, estimators, and export services. Convert all thrown exceptions into typed errors with stable codes and user-safe messages.

## Error Handling

**Question:** How should worker errors be surfaced to users?
**Assumption:** Long-running jobs must show row/item status without blocking UI.
**Solution:** Expose worker failures at three levels: job row status, toast summary, and detailed error drawer. Include retry availability, attempt count, and whether the failure is retryable or terminal.

## Error Handling

**Question:** What happens if a worker stalls but later reports progress?
**Assumption:** Stalled candidate status is entered after runtime exceeds 2× estimate and reclaim window conditions are met.
**Solution:** Do not reclaim immediately on threshold breach. Mark `stalled_candidate`, wait for the reclaim window, and only reclaim if heartbeat/progress conditions remain unsatisfied. If progress resumes, return the job to `running` without duplicate execution.

## Error Handling

**Question:** How should partial import failures be presented?
**Assumption:** Invalid rows do not block valid rows unless zero valid files remain.
**Solution:** Show a persistent import result table with accepted and rejected rows, row-level error messages, and summary counts. Preserve the table long enough for review and CSV export of validation errors if supported.

## Error Handling

**Question:** How should export partial failures be handled?
**Assumption:** Export cart lifecycle includes `partial_failed`.
**Solution:** Mark successful items complete, failed items with actionable error details, and keep the cart recoverable for retrying only failed items. Do not roll back successful outputs.

## Error Handling

**Question:** How should quota-exhaustion errors be handled in Open Platform Kit generation?
**Assumption:** Quotas are enforced locally by token and date key.
**Solution:** Block generation before file writes begin, show current usage and next reset time in local timezone, and log a quota exhaustion audit event.

## Error Handling

**Question:** What happens if Browser APIs required by a module are unavailable?
**Assumption:** Some environments may lack File System Access API, BroadcastChannel, or camera support.
**Solution:** Detect capability at startup and at module entry. Disable unsupported modules with explicit guidance. Provide fallback UX where practical, such as download-based export when File System Access is unavailable, if that remains within scope.

## Error Handling

**Question:** How should corruption be handled for stored audio, snapshots, or attendance assets?
**Assumption:** Local data may become corrupted through quota pressure or browser issues.
**Solution:** Validate checksums and required metadata before use. Quarantine corrupt records, exclude them from normal workflows, and offer deletion or retry options. Never silently substitute incomplete data.

## Performance & Limits

**Question:** What is the maximum worker count?
**Assumption:** The PRD defines `maxWorkers` in queue policy but not a value.
**Solution:** Default `maxWorkers` to `min(4, max(1, navigator.hardwareConcurrency - 1))`, with a hard cap of 6 and a floor of 1. Allow local override in preferences within safe bounds.

## Performance & Limits

**Question:** How should short versus long tasks be classified?
**Assumption:** The PRD refers to `taskShortnessThresholdMs` but does not define the value.
**Solution:** Define short tasks as those with `initialEstimateMs <= 3000` and long tasks as anything above that. Revisit this threshold only if profiling data shows poor scheduler behavior.

## Performance & Limits

**Question:** What exact scheduler priority algorithm should be used?
**Assumption:** The PRD says shorter tasks first and higher-rated workers preferred for similar job classes.
**Solution:** Compute priority by sorting queued jobs on: deferred eligibility, explicit user priority, estimated runtime ascending, retry count ascending, created time ascending. Assign eligible jobs to the highest-rated available worker capable of that job class.

## Performance & Limits

**Question:** How should the initial job estimate be computed?
**Assumption:** A deterministic estimate is required but not specified.
**Solution:** Use formula-based estimates per job type. Example: waveform generation estimate = `baseOverhead + durationMs * channels * coefficient`; silence scan = `durationMs * scanCoefficient`; normalization = `durationMs * normalizationCoefficient`; export = `decodeCost + processCost + encodeCost` based on duration, target format, bitrate, and observed local benchmark constants.

## Performance & Limits

**Question:** When exactly is a task considered stalled?
**Assumption:** Runtime exceeding 2× estimate plus missing heartbeat or no progress updates for one reclaim window.
**Solution:** Mark `stalled_candidate` when `runtimeMs > 2 * initialEstimateMs`. Reclaim only if two conditions remain true for 10 additional seconds: missing required heartbeat cadence or no measurable progress delta. Record reclaim cause in the audit log.

## Performance & Limits

**Question:** How should worker rating be calculated and updated?
**Assumption:** Rating is `successCount / max(1, successCount + failureCount)`.
**Solution:** Update rating only after terminal completion or terminal failure, not on assignment or retry. Keep separate job-class counters if scheduler specialization becomes necessary, but maintain the authoritative overall rating defined in the PRD.

## Performance & Limits

**Question:** Should exports run in parallel or sequentially?
**Assumption:** The PRD does not specify.
**Solution:** Allow bounded parallelism up to `min(2, availableHeavyWorkers)` for encode-heavy jobs to reduce memory spikes and thermal pressure. Process large WAV exports sequentially when projected memory exceeds a safe threshold.

## Performance & Limits

**Question:** What should the export time estimate formula be?
**Assumption:** The PRD requires estimated processing time and per-item size before confirmation.
**Solution:** Estimate per item as `decodeEstimate + processingEstimate + encodeEstimate`, where processingEstimate includes committed edit operations and normalization/transcoding complexity. Sum items, then divide by effective parallelism factor with safety overhead, such as `total / max(1, concurrentWorkers * 0.8)`.

## Performance & Limits

**Question:** How should waveform resolution be chosen for large files?
**Assumption:** Waveform rendering must remain responsive and worker-based.
**Solution:** Precompute multi-resolution peaks in workers. Store overview resolution for full-track display and finer resolutions for zoomed ranges. Render only the visible segment at the required level of detail.

## Performance & Limits

**Question:** How should audio edits be modeled: destructive or non-destructive?
**Assumption:** The PRD explicitly defines an append-only reversible operation log until export or flattening.
**Solution:** Keep editing fully non-destructive within the project by storing base media plus ordered edit operations. Flatten only for export or explicit optimization jobs, never as silent mutation of the source.

## Performance & Limits

**Question:** What silence detection algorithm details should be fixed for implementation?
**Assumption:** The PRD defines threshold and minimum duration but not the signal method.
**Solution:** Use RMS-based windowed analysis with a 50 ms window and 25 ms hop size for stability. Flag silence when window RMS stays below -35 dB for at least 600 ms cumulatively.

## Performance & Limits

**Question:** What loudness normalization standard should be used?
**Assumption:** The PRD specifies a target of -14 LUFS but not the exact variant.
**Solution:** Use integrated LUFS according to EBU R128-style measurement adapted for offline local processing. Document that short-term LUFS is not the authoritative target for normalization commits.

## Performance & Limits

**Question:** What fade curve should be used?
**Assumption:** The PRD gives a duration range but not a curve.
**Solution:** Use equal-power or exponential-style perceptual fades by default to avoid audible abruptness, while keeping duration control linear in the UI. Use the same default across preview and committed export paths for determinism.

## Performance & Limits

**Question:** How should balance adjustment be interpreted: gain or pan law?
**Assumption:** The PRD expresses balance from full left to full right with neutral center.
**Solution:** Implement balance as pan with equal-power pan law rather than naive single-channel gain reduction. This preserves perceived loudness more consistently across stereo material.

## Performance & Limits

**Question:** What are the hard operational limits that must be enforced everywhere?
**Assumption:** The PRD defines max 200 files per batch, 2 GB total import size, 50 markers per project, 20 export cart items, 1,000 playlist tracks, Top-N 1 to 10, threshold 0.00 to 1.00, and fade 0.1s to 10.0s.
**Solution:** Centralize these limits in a shared constants/validation module used by UI forms, service validators, repositories, and tests. Never duplicate limit values across modules.

## Performance & Limits

**Question:** How should large-project performance remain acceptable while the UI stays interactive?
**Assumption:** The PRD requires main-thread responsiveness during heavy jobs.
**Solution:** Move waveform generation, silence detection, normalization, export rendering, and heavy merge normalization into workers; virtualize large tables; debounce search; use derived store memoization; and avoid loading all audio blobs into memory at once.

## Offline Behavior

**Question:** How should queue persistence work across tab close or crash?
**Assumption:** The PRD says queued and deferred jobs are recoverable, and running jobs become retryable unless checkpoint recoverable.
**Solution:** Persist queue state transitions atomically in IndexedDB. On restart, reload queued/deferred jobs as-is, convert running jobs to `failed_retryable` or resume from checkpoint if supported, and record one recovery audit event per affected job.

## Error Handling

**Question:** How should failures in `run_test.sh` and Docker-based test execution be reflected in the developer and reviewer experience?
**Assumption:** The user asked for repo self-sufficiency and deterministic test execution in the extended PRD.
**Solution:** Ensure `run_test.sh` exits non-zero on first failure, logs failing suite names, and remains offline-safe. In Docker, the `test` service must surface stdout/stderr directly and not swallow exit codes.

## State Management

**Question:** How should requirement-to-implementation discoverability be preserved for reviewers?
**Assumption:** The user wants audit readiness and coverage mapping.
**Solution:** Add stable module naming and a predictable directory structure such as `src/features/<domain>`, `src/lib/storage`, `src/lib/workers`, `src/lib/audio`, and `tests/<type>/<domain>`. Cross-link PRD requirement IDs to code comments and test names where possible.

## Edge Cases

**Question:** What should happen if BroadcastChannel is unsupported or broken in a browser?
**Assumption:** Multi-tab coordination still matters.
**Solution:** Fall back to IndexedDB-based lock polling every few seconds for lock detection and heartbeat validation. Reduce UX richness but preserve single-writer enforcement.

## Authentication & Security

**Question:** How should privacy messaging be handled for the attendance module?
**Assumption:** Face recognition is optional, local-only, and sensitive.
**Solution:** Show a mandatory privacy notice before first use explaining camera access, local processing, storage of embeddings/matches, retention options, and deletion controls. Require explicit acknowledgment and passphrase re-entry before activation.

## Data Storage & Encryption

**Question:** How should attendance embeddings be stored?
**Assumption:** Embeddings are needed for batch matching and privacy-sensitive.
**Solution:** Store embeddings in a dedicated `attendanceEmbeddings` store keyed by subject reference and model version, along with checksum, createdAt, and deletion status. Do not export embeddings in standard attendance CSV outputs.

## Performance & Limits

**Question:** What hardware assumptions should the face-recognition module make?
**Assumption:** Hardware capabilities vary and the PRD does not define minimums.
**Solution:** Set baseline support to modern desktop browsers with camera access, WebAssembly support, and adequate memory. Run a startup capability check and block entry if model load time, memory, or camera APIs do not meet minimum thresholds.

## Error Handling

**Question:** How should model-load failures in attendance be handled?
**Assumption:** The model is bundled and should not be fetched dynamically.
**Solution:** Fail closed. Do not open the attendance workflow if the bundled model is missing, corrupt, or incompatible. Provide a clear local-remediation message and log the failure.

## Concurrency & Multi-User Behavior

**Question:** How should queue actions behave across multiple tabs when only one is writable?
**Assumption:** One tab holds the authoritative mutable context.
**Solution:** Bind all queue mutation actions to the writable owner tab only. Secondary tabs may display a stale-safe replicated view via BroadcastChannel updates but cannot affect queue order, retries, or cancellation.

## Offline Behavior

**Question:** Should analytics be event-based or computed?
**Assumption:** The PRD defines reports from IndexedDB operational records and job logs.
**Solution:** Treat analytics as computed metrics derived from persisted events and domain records rather than telemetry-style emitted counters. This keeps metrics recomputable, auditable, and resilient to state rebuilds.

## Error Handling

**Question:** How should CSV import strict mode versus partial accept be handled in cohorts?
**Assumption:** Default is partial accept; strict mode is optional.
**Solution:** In default mode, commit valid rows and present invalid rows with downloadable error report. In strict mode, validate all rows first and commit nothing if any row fails. Log the chosen mode in audit events.

## Performance & Limits

**Question:** How should time tracking for analytics be defined?
**Assumption:** The PRD defines average processing time based on completed jobs but not broader activity time.
**Solution:** Define processing time as `completedAt - startedAt` for completed jobs only. Define edit-session time separately as `endedAt - startedAt` for user sessions. Do not mix job runtime with editor dwell time in the same KPI.

## State Management

**Question:** How should startup flow traceability be designed for static audit readiness?
**Assumption:** Reviewers need to discover storage, routing, workers, and processing logic easily.
**Solution:** Make startup flow explicit in one bootstrap module that calls: environment checks, storage init, profile load, lock recovery, project selection, queue recovery, and route mount. Add inline references to the relevant repositories and worker bridges.

## Error Handling

**Question:** How should unknown unexpected errors be handled globally?
**Assumption:** Even with typed error envelopes, uncaught exceptions may still occur.
**Solution:** Install a global error boundary for the SPA shell and worker bridge. Convert uncaught exceptions into a visible fatal error screen or recoverable toast depending on context, persist a local crash record, and prompt recovery on next launch when appropriate.
