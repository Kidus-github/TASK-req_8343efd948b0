<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    endSession,
    listMatches,
    recordMatchFromFeature,
    recordMatchFromSource,
    resolveManually,
    startSession
  } from '$lib/services/attendance';
  import type { AttendanceMatch, AttendanceSession, AttendanceSubject } from '$lib/types';
  import { LIMITS } from '$lib/util/constants';
  import { pushToast } from '$lib/stores/toast';
  import {
    deleteSubject,
    enrollSubjectFromImage,
    extractFeatureFromSource,
    isModelLoaded,
    loadFaceModel,
    listSubjects
  } from '$lib/attendance/inference';
  import { passphraseGate } from '$lib/util/passphraseGate';

  let modelReady = isModelLoaded();

  let session: AttendanceSession | null = null;
  let topN = LIMITS.ATTENDANCE_TOP_N_DEFAULT;
  let threshold = LIMITS.ATTENDANCE_THRESHOLD_DEFAULT;
  let mode: 'realtime' | 'batch' = 'realtime';
  let matches: AttendanceMatch[] = [];
  let subjects: AttendanceSubject[] = [];
  let cameraGranted = false;
  let subjectRef = 'subject-local';

  let videoEl: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let enrollLabel = '';

  onMount(async () => {
    modelReady = await loadFaceModel();
    subjects = await listSubjects();
  });

  onDestroy(() => {
    stopCamera();
  });

  async function requestCamera(): Promise<void> {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraGranted = true;
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play().catch(() => {});
      }
      pushToast('success', 'Camera access granted.');
    } catch (err) {
      pushToast('warning', `Camera unavailable: ${(err as Error).message}`);
    }
  }

  function stopCamera(): void {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    cameraGranted = false;
  }

  async function enrollFromCamera(): Promise<void> {
    if (!videoEl || !cameraGranted) {
      pushToast('error', 'Grant camera first.');
      return;
    }
    if (!enrollLabel.trim()) {
      pushToast('error', 'Enrollment label required.');
      return;
    }
    const s = await enrollSubjectFromImage(enrollLabel.trim(), videoEl);
    subjects = await listSubjects();
    enrollLabel = '';
    pushToast('success', `Enrolled subject "${s.label}".`);
  }

  async function enrollFromFile(e: Event): Promise<void> {
    if (!enrollLabel.trim()) {
      pushToast('error', 'Enrollment label required.');
      return;
    }
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;
    for (const f of Array.from(files)) {
      const url = URL.createObjectURL(f);
      try {
        const img = new Image();
        img.src = url;
        await img.decode().catch(() => {});
        const subject = await enrollSubjectFromImage(enrollLabel.trim(), img);
        subjects = await listSubjects();
        pushToast('success', `Enrolled "${subject.label}".`);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    input.value = '';
  }

  async function unenroll(id: string): Promise<void> {
    await deleteSubject(id);
    subjects = await listSubjects();
    pushToast('info', 'Subject removed.');
  }

  async function onStart(): Promise<void> {
    const okGate = await passphraseGate('start attendance');
    if (!okGate) return;
    const res = await startSession(mode, { topN, confidenceThreshold: threshold });
    if (!res.ok) {
      pushToast('error', res.message);
      return;
    }
    session = res.data;
    matches = [];
    pushToast('success', `Attendance session started (${mode}).`);
  }

  async function onStop(): Promise<void> {
    if (!session) return;
    await endSession(session.id);
    pushToast('info', 'Session ended.');
    session = null;
    matches = [];
    stopCamera();
  }

  async function captureAndMatch(): Promise<void> {
    if (!session || !videoEl || !cameraGranted) return;
    const res = await recordMatchFromSource(session.id, subjectRef, videoEl);
    if (!res.ok) {
      pushToast('error', res.message);
      return;
    }
    matches = await listMatches(session.id);
  }

  async function batchMatchFromFile(e: Event): Promise<void> {
    if (!session) return;
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files) return;
    for (const f of Array.from(files)) {
      const url = URL.createObjectURL(f);
      try {
        const img = new Image();
        img.src = url;
        await img.decode().catch(() => {});
        const { feature, kind } = await extractFeatureFromSource(img);
        await recordMatchFromFeature(session.id, f.name, feature, kind);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    matches = await listMatches(session.id);
    input.value = '';
  }

  async function onResolve(id: string, outcome: 'accepted' | 'rejected' | 'unresolved'): Promise<void> {
    await resolveManually(id, outcome);
    if (session) matches = await listMatches(session.id);
  }

  function candidateLabel(ref: string | undefined): string {
    if (!ref) return '—';
    const s = subjects.find((x) => x.id === ref);
    return s ? s.label : ref;
  }
</script>

<div class="stack" style="max-width: 1000px;">
  <h2 style="margin: 0;">Attendance</h2>
  {#if modelReady}
    <div class="pill success" style="margin-bottom: 0.5rem;">
      Face recognition model loaded (face-api.js: TinyFaceDetector + FaceLandmark68 + FaceRecognitionNet). 128-dim neural descriptors, fully offline.
    </div>
  {:else}
    <div class="pill warning" style="margin-bottom: 0.5rem;">
      Face recognition model not available in this environment. Falling back to luminance image-similarity matching. Run <code>npm run prepare-models</code> to bundle the model weights.
    </div>
  {/if}
  <p class="hint">
    On-device attendance. Enrollment captures a face from the camera or an image file. Matching ranks enrolled subjects by face descriptor distance (real model) or luminance feature similarity (fallback). No network, no external model download at runtime.
  </p>

  <div class="card">
    <h4 style="margin-top: 0;">Subjects ({subjects.length})</h4>
    <div class="row" style="gap: 0.5rem; flex-wrap: wrap;">
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Label</span>
        <input bind:value={enrollLabel} placeholder="e.g. Alex Smith" />
      </label>
      <div class="stack" style="gap: 0.2rem;">
        <span class="label">Enroll</span>
        <button on:click={enrollFromCamera} disabled={!cameraGranted || !enrollLabel.trim()}>
          Capture from camera
        </button>
      </div>
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">…or image file</span>
        <input type="file" accept="image/*" multiple on:change={enrollFromFile} />
      </label>
    </div>

    {#if subjects.length > 0}
      <table class="table" style="margin-top: 0.5rem;">
        <thead>
          <tr>
            <th>Label</th>
            <th>Extractor</th>
            <th>Enrolled</th>
            <th style="width: 1%;" />
          </tr>
        </thead>
        <tbody>
          {#each subjects as s (s.id)}
            <tr>
              <td>{s.label}</td>
              <td>
                <span class="pill {s.featureKind === 'face-128' ? 'success' : ''}">
                  {s.featureKind === 'face-128' ? 'neural 128-d' : 'luminance (fallback)'}
                </span>
              </td>
              <td>{new Date(s.createdAt).toLocaleString()}</td>
              <td><button class="danger" on:click={() => unenroll(s.id)}>Remove</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <div class="card">
    <div class="row" style="flex-wrap: wrap; gap: 0.75rem;">
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Mode</span>
        <select bind:value={mode} disabled={!!session}>
          <option value="realtime">Realtime (camera)</option>
          <option value="batch">Batch matching (image files)</option>
        </select>
      </label>
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Top-N ({LIMITS.ATTENDANCE_TOP_N_MIN}..{LIMITS.ATTENDANCE_TOP_N_MAX})</span>
        <input
          type="number"
          min={LIMITS.ATTENDANCE_TOP_N_MIN}
          max={LIMITS.ATTENDANCE_TOP_N_MAX}
          bind:value={topN}
          disabled={!!session}
        />
      </label>
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Threshold (0..1)</span>
        <input
          type="number"
          step="0.01"
          min={LIMITS.ATTENDANCE_THRESHOLD_MIN}
          max={LIMITS.ATTENDANCE_THRESHOLD_MAX}
          bind:value={threshold}
          disabled={!!session}
        />
      </label>
      <div class="stack" style="gap: 0.2rem;">
        <span class="label">&nbsp;</span>
        <button on:click={requestCamera} disabled={cameraGranted || mode !== 'realtime'}>
          {cameraGranted ? 'Camera ready' : 'Request camera'}
        </button>
      </div>
      <div class="stack" style="gap: 0.2rem;">
        <span class="label">&nbsp;</span>
        {#if !session}
          <button class="primary" on:click={onStart}>Start session</button>
        {:else}
          <button class="danger" on:click={onStop}>Stop session</button>
        {/if}
      </div>
    </div>

    {#if session}
      <div class="divider" />
      {#if mode === 'realtime'}
        <div class="row" style="gap: 0.75rem;">
          <video
            bind:this={videoEl}
            autoplay
            muted
            playsinline
            style="width: 240px; border-radius: 8px; background: #000;"
          />
          <div class="stack" style="gap: 0.3rem;">
            <label class="label" for="attendance-subject-ref">Subject reference</label>
            <input id="attendance-subject-ref" bind:value={subjectRef} />
            <button class="primary" on:click={captureAndMatch} disabled={!cameraGranted}>
              Capture &amp; match
            </button>
            <p class="hint">Captures the current video frame, extracts features, and ranks enrolled subjects.</p>
          </div>
        </div>
      {:else}
        <label class="label" for="attendance-batch-files">Batch match from image files</label>
        <input id="attendance-batch-files" type="file" accept="image/*" multiple on:change={batchMatchFromFile} />
        <p class="hint">Each file becomes a subject reference; the engine ranks enrolled subjects against each image.</p>
      {/if}
    {/if}
  </div>

  {#if session && matches.length > 0}
    <div class="card">
      <h4 style="margin-top: 0;">Matches</h4>
      <table class="table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Subject</th>
            <th>Candidate</th>
            <th>Confidence</th>
            <th>Status</th>
            <th style="width: 1%;" />
          </tr>
        </thead>
        <tbody>
          {#each matches as m (m.id)}
            <tr>
              <td>{m.rank}</td>
              <td>{m.subjectRef}</td>
              <td>{candidateLabel(m.candidateRef)}</td>
              <td>{(m.confidence * 100).toFixed(1)}%</td>
              <td>
                <span class="pill {m.finalOutcome === 'auto_accepted' || m.finalOutcome === 'accepted' ? 'success' : m.finalOutcome === 'no_match' || m.finalOutcome === 'rejected' ? 'danger' : 'warning'}">
                  {m.finalOutcome}
                </span>
              </td>
              <td>
                {#if !m.manuallyResolved && m.finalOutcome !== 'auto_accepted'}
                  <button on:click={() => onResolve(m.id, 'accepted')}>Accept</button>
                  <button on:click={() => onResolve(m.id, 'rejected')}>Reject</button>
                  <button on:click={() => onResolve(m.id, 'unresolved')}>Skip</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
