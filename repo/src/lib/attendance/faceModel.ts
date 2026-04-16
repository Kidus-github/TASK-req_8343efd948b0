// Real bundled face-recognition model powered by face-api.js.
//
// At runtime the model weights are loaded from `/models/` which is the
// app's own origin (same-origin fetch, NOT external network). The weights
// were committed to `public/models/` by `scripts/prepare-face-models.mjs`.
//
// This module exposes two operations:
//   - `loadFaceModel(): Promise<boolean>`  — load the three nets once.
//   - `computeDescriptor(source): Promise<Float32Array | null>`
//       → runs TinyFaceDetector + FaceLandmark68 + FaceRecognitionNet
//       → returns a real 128-dim face descriptor, or null when no face found.
//
// When model files are absent (test environment, first checkout before
// running prepare-models), `loadFaceModel` returns false and the caller
// is expected to fall back to the heuristic luminance matcher.

import * as faceapi from 'face-api.js';

let loaded = false;
let loadFailed = false;

export function isModelLoaded(): boolean {
  return loaded;
}

export async function loadFaceModel(): Promise<boolean> {
  if (loaded) return true;
  if (loadFailed) return false;
  try {
    const uri = '/models';
    await faceapi.nets.tinyFaceDetector.loadFromUri(uri);
    await faceapi.nets.faceLandmark68Net.loadFromUri(uri);
    await faceapi.nets.faceRecognitionNet.loadFromUri(uri);
    loaded = true;
    return true;
  } catch (err) {
    console.warn('face-api.js model load failed (heuristic fallback active):', err);
    loadFailed = false; // allow retry
    return false;
  }
}

/**
 * Detect the largest face in a video/image/canvas source and return its
 * 128-dim face descriptor. Returns null when no face is found or when the
 * model is not yet loaded.
 */
export async function computeDescriptor(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<Float32Array | null> {
  if (!loaded) return null;
  // face-api expects an HTMLVideoElement | HTMLImageElement | HTMLCanvasElement.
  const detection = await faceapi
    .detectSingleFace(source, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection) return null;
  return detection.descriptor;
}

export const DESCRIPTOR_DIM = 128;
