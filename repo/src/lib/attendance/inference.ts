// Attendance inference — real bundled face-recognition model.
//
// Production path (models loaded):
//   1. face-api.js TinyFaceDetector locates the face.
//   2. FaceLandmark68Net aligns the face.
//   3. FaceRecognitionNet produces a real 128-dim face descriptor.
//   4. Subjects are compared by Euclidean distance on 128-dim descriptors.
//
// Fallback path (model files absent — e.g. test environment):
//   16x16 luminance feature hash + cosine similarity. This fallback is
//   labeled explicitly in the UI and in subject records.
//
// Model weights live in public/models/ and are served same-origin. They
// were committed to the repo by scripts/prepare-face-models.mjs. At
// runtime the app makes NO external network requests.

import type { AttendanceSubject } from '../types';
import { all, put, del, get } from '../db/indexeddb';
import { newId, nowIso } from '../util/ids';
import { computeDescriptor, DESCRIPTOR_DIM, isModelLoaded, loadFaceModel } from './faceModel';

// ---------- Feature types ----------

export const FEATURE_GRID = 16;
export const FEATURE_DIM = FEATURE_GRID * FEATURE_GRID;

/** Feature kind stored on each subject. */
export type FeatureKind = 'face-128' | 'luminance-full';

// ---------- Model initialization ----------

export { isModelLoaded, loadFaceModel };

// ---------- Luminance-hash fallback (test + legacy) ----------

export function featureFromImageData(img: ImageData): Float32Array {
  const { width, height, data } = img;
  const out = new Float32Array(FEATURE_DIM);
  for (let row = 0; row < FEATURE_GRID; row++) {
    for (let col = 0; col < FEATURE_GRID; col++) {
      const x0 = Math.floor((col * width) / FEATURE_GRID);
      const x1 = Math.floor(((col + 1) * width) / FEATURE_GRID);
      const y0 = Math.floor((row * height) / FEATURE_GRID);
      const y1 = Math.floor(((row + 1) * height) / FEATURE_GRID);
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          sum += luma / 255;
          count++;
        }
      }
      out[row * FEATURE_GRID + col] = count > 0 ? sum / count : 0;
    }
  }
  return normalize(meanSubtract(out));
}

export function featureFromLuminance(luma: Float32Array | number[]): Float32Array {
  if (luma.length !== FEATURE_DIM) {
    throw new Error(`featureFromLuminance: expected ${FEATURE_DIM} values, got ${luma.length}`);
  }
  const copy = new Float32Array(FEATURE_DIM);
  for (let i = 0; i < FEATURE_DIM; i++) copy[i] = luma[i];
  return normalize(meanSubtract(copy));
}

function meanSubtract(v: Float32Array): Float32Array {
  let mean = 0;
  for (let i = 0; i < v.length; i++) mean += v[i];
  mean /= v.length;
  for (let i = 0; i < v.length; i++) v[i] -= mean;
  return v;
}

function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm < 1e-9) return v;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

// ---------- Similarity ----------

/** Euclidean distance (for 128-dim face descriptors). */
export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error('euclideanDistance: length mismatch');
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Cosine similarity in [-1, 1]. Used for luminance fallback. */
export function similarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error('similarity: vector length mismatch');
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Map cosine similarity [-1..1] to confidence [0..1]. */
export function toConfidence(sim: number): number {
  return Math.max(0, Math.min(1, (sim + 1) / 2));
}

/**
 * Map Euclidean distance to confidence [0..1].
 * face-api.js descriptors typically have distance < 0.6 for same person.
 * We map [0..1.4] linearly to [1..0].
 */
export function distanceToConfidence(dist: number): number {
  return Math.max(0, Math.min(1, 1 - dist / 1.4));
}

// ---------- Extraction ----------

export function extractImageData(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  crop?: { x: number; y: number; width: number; height: number }
): ImageData {
  const w =
    'videoWidth' in source && source.videoWidth
      ? source.videoWidth
      : (source as HTMLCanvasElement).width || 128;
  const h =
    'videoHeight' in source && source.videoHeight
      ? source.videoHeight
      : (source as HTMLCanvasElement).height || 128;
  const canvas = document.createElement('canvas');
  const targetW = crop ? Math.max(1, Math.round(crop.width)) : w;
  const targetH = crop ? Math.max(1, Math.round(crop.height)) : h;
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  if (crop) {
    ctx.drawImage(
      source as CanvasImageSource,
      Math.max(0, crop.x),
      Math.max(0, crop.y),
      Math.max(1, crop.width),
      Math.max(1, crop.height),
      0,
      0,
      targetW,
      targetH
    );
  } else {
    ctx.drawImage(source as CanvasImageSource, 0, 0, targetW, targetH);
  }
  return ctx.getImageData(0, 0, targetW, targetH);
}

/**
 * Run the full production pipeline against a media source.
 *
 * When the face-api.js model is loaded, this returns a real 128-dim face
 * descriptor (FeatureKind = 'face-128'). When the model is not available
 * (jsdom tests, first-time run without weights), it falls back to the
 * full-frame luminance hash ('luminance-full').
 */
export async function extractFeatureFromSource(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<{ feature: Float32Array; kind: FeatureKind }> {
  if (isModelLoaded()) {
    const desc = await computeDescriptor(source);
    if (desc) {
      return { feature: desc, kind: 'face-128' };
    }
    // Detection failed (no face in frame) — fall through to luminance.
  }
  // Fallback: luminance hash over the whole frame.
  const img = extractImageData(source);
  return { feature: featureFromImageData(img), kind: 'luminance-full' };
}

// ---------- Ranking ----------

export function rankCandidates(
  query: Float32Array,
  subjects: AttendanceSubject[],
  topN: number,
  queryKind?: FeatureKind
): Array<{ subjectId: string; subjectLabel: string; confidence: number }> {
  const compatible = queryKind
    ? subjects.filter((s) => (s.featureKind ?? 'luminance-full') === queryKind)
    : subjects;
  const scored = compatible.map((s) => {
    const sv = new Float32Array(s.featureVector);
    const kind = (s.featureKind ?? 'luminance-full') as FeatureKind;
    const confidence =
      kind === 'face-128'
        ? distanceToConfidence(euclideanDistance(query, sv))
        : toConfidence(similarity(query, sv));
    return { subjectId: s.id, subjectLabel: s.label, confidence };
  });
  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, topN);
}

// ---------- Subject persistence ----------

export async function enrollSubjectFromFeature(
  label: string,
  feature: Float32Array,
  kind: FeatureKind = 'luminance-full'
): Promise<AttendanceSubject> {
  const subject: AttendanceSubject = {
    id: newId('subj'),
    label,
    createdAt: nowIso(),
    featureVector: Array.from(feature),
    featureKind: kind
  };
  await put('attendanceSubjects', subject);
  return subject;
}

export async function enrollSubjectFromImage(
  label: string,
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<AttendanceSubject> {
  const { feature, kind } = await extractFeatureFromSource(source);
  return enrollSubjectFromFeature(label, feature, kind);
}

export async function listSubjects(): Promise<AttendanceSubject[]> {
  return all<AttendanceSubject>('attendanceSubjects');
}

export async function getSubject(id: string): Promise<AttendanceSubject | undefined> {
  return get<AttendanceSubject>('attendanceSubjects', id);
}

export async function deleteSubject(id: string): Promise<void> {
  await del('attendanceSubjects', id);
}

// ---------- FaceDetector compat (kept for tests) ----------

export function isFaceDetectorAvailable(): boolean {
  return isModelLoaded();
}

export async function detectLargestFace(): Promise<null> {
  return null; // superseded by face-api.js's TinyFaceDetector
}
