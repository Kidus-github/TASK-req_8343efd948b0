#!/usr/bin/env node
// Fetch face-api.js model weights so they can be bundled with the built SPA
// and served same-origin at runtime. This is a one-off setup step; once the
// files are in public/models/ and committed, the app does NOT need network
// at build time or runtime.
//
// Usage:
//   npm run prepare-models
//
// Safe to re-run — existing files are skipped unless --force is passed.

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const modelsDir = resolve(repoRoot, 'public', 'models');
const force = process.argv.includes('--force');

// Canonical locations for face-api.js's public model weights.
const BASE = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';

const FILES = [
  // TinyFaceDetector: real-time face detection, ~190KB.
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  // FaceLandmark68Net: 68-point facial landmarks, ~350KB. Needed to align
  // faces before the recognition net for best results.
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  // FaceRecognitionNet: 128-dim descriptor, ~6MB. This IS the face
  // recognition model — real neural embeddings, not a luminance hash.
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2'
];

async function downloadIfMissing(file) {
  const dest = resolve(modelsDir, file);
  if (!force && existsSync(dest)) {
    const s = await stat(dest);
    if (s.size > 0) {
      console.log(`  skip  ${file}  (already present, ${s.size} bytes)`);
      return;
    }
  }
  const url = `${BASE}/${file}`;
  console.log(`  fetch ${file}  <- ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed: ${file} -> HTTP ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`  saved ${file}  (${buf.byteLength} bytes)`);
}

async function main() {
  console.log(`Preparing face-api.js models in ${modelsDir}`);
  await mkdir(modelsDir, { recursive: true });
  for (const f of FILES) {
    try {
      await downloadIfMissing(f);
    } catch (err) {
      console.error(`ERROR downloading ${f}:`, err.message);
      process.exit(1);
    }
  }
  console.log('All model weights ready.');
}

main();
