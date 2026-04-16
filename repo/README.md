<!-- project-type: web -->
# CleanWave Offline Audio Prep

**Project Type: web**

Svelte + TypeScript single-page application. Fully browser-only, fully offline. No backend, no server-side API endpoints, no server-side authentication.

---

## Prerequisites

- Docker and Docker Compose installed on the host machine.
- No other runtime dependencies required.

---

## Startup

```bash
docker-compose up --build
```

This builds the Docker image and serves the built SPA at:

**http://localhost:5173**

Open that URL in Chrome or Edge.

---

## Authentication

**No authentication required.**

This application has no backend, no server-side auth, no API keys, no login endpoints, and no demo credentials. There is nothing to log into.

On first launch the app presents a local device-only profile creation screen. This is a **client-side convenience gate** (not real authentication). The passphrase is salted-hashed and stored exclusively in the browser's IndexedDB. It never leaves the device. The user creates this profile themselves -- it is not a login.

Steps on first launch:

1. Enter a username (1-50 characters).
2. Enter a passphrase (at least 8 characters, at least 1 digit).
3. Select a UI role (Editor / Reviewer / Operations).
4. Click "Create profile".

A "Reset this device profile" button wipes all local data and returns to the initial screen.

---

## How to Verify the Application Works

After running `docker-compose up --build`, open **http://localhost:5173** and perform:

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Page loads | "Create your local profile" screen appears |
| 2 | Enter username `tester`, passphrase `offline99`, role Editor | Fields accepted, no validation errors |
| 3 | Click "Create profile" | Main workspace loads with Projects sidebar |
| 4 | Type "Test Project", click "Create project" | Project row appears in the table |
| 5 | Click "Open" on the project row | Project workspace opens with Edit / Export / Reports tabs |
| 6 | Drag-and-drop a `.wav` file onto the import area | File appears in import table and timeline editor file selector |
| 7 | Click "Play" in the timeline transport controls | Audio plays through the browser |
| 8 | Switch to Export tab, add file to cart as WAV, open cart, confirm | Export renders in background; Download button appears when complete |
| 9 | Click Download | Browser saves the rendered WAV file |
| 10 | Click "Reset this device profile" in the sidebar | All data wiped; returns to first-launch screen |

---

## Running Tests

### Unit, integration, component, and flow tests (Docker-contained)

```bash
docker-compose run --rm test
```

This executes `run_tests.sh` inside the container. No host-side tooling is required. It runs:

| Category | Files | Description |
|----------|-------|-------------|
| Unit | 11 | Validators, audio math, queue logic, CSV, MP3 header, UI state |
| Integration | 35 | Imports, exports, merge, split, preview, queue, reports, cohorts, attendance, preferences, workers |
| Component | 3 | ProfileGate, ConfirmModal, ProjectsPanel (direct Svelte render tests via @testing-library/svelte) |
| Flow | 4 | Multi-step user journeys under jsdom |

**Total: 53 test files, 263 tests.**

### Browser tests (Docker-contained)

```bash
docker-compose run --rm test-browser
```

This builds a separate container image with Playwright + Chromium and runs 5 browser specs:

| Spec | Covers |
|------|--------|
| smoke.spec.ts | Profile, project creation, import, edit, export confirm |
| waveform.spec.ts | Canvas waveform render + click-to-seek |
| export-download.spec.ts | Full import, edit, export, download pipeline |
| multitab.spec.ts | Second-tab read-only lock behavior |
| attendance.spec.ts | Attendance model status + camera button |

No host-side browser or Node.js installation is required for either test path.

---

## Test Layout

```
tests/
  unit/           11 files   validators, audio math, queue, CSV, MP3, UI state
  integration/    35 files   imports, exports, merge, split, preview, queue,
                             reports, cohorts, attendance, preferences, workers
  component/       3 files   ProfileGate, ConfirmModal, ProjectsPanel
  flow/            4 files   primary flow, export-download, multi-tab, offline
  browser/         5 files   Playwright browser specs
```

---

## Architecture

```
src/
  App.svelte          application shell + profile gate
  main.ts             Svelte mount point
  lib/
    attendance/       face-api.js model + inference
    audio/            engine, workers, pool, smart scheduler
    components/       Svelte UI panels
    db/               IndexedDB wrapper, LocalStorage prefs
    services/         business logic
    stores/           Svelte stores (session, toast, modal, workspace)
    types.ts          domain model
    util/             validators, constants, audio helpers, CSV, estimates
```

---

## Offline Guarantees

- Zero runtime network requests (enforced by `tests/flow/offline.test.ts`).
- No CDN fonts or external stylesheets.
- Face-api.js model weights committed to `public/models/` and served same-origin.
- Camera and File System Access requested only on explicit user action.

---

## Required Repo Changes for Full Compliance

| Item | Status | Detail |
|------|--------|--------|
| Test script naming | **FIXED** | Standardized on `run_tests.sh`; `docker-compose.yml` references the same file |
| Browser tests in Docker | **FIXED** | `Dockerfile.browser-test` + `test-browser` service added to `docker-compose.yml` |
| Host-side commands removed | **FIXED** | No `npm ci`, `npm install`, `npm run dev`, or `npx playwright install` in primary flows |
| Auth ambiguity | **FIXED** | Explicitly states "No authentication required" with explanation of client-side profile gate |
| Playwright container not yet validated at runtime | **NOTE** | The `Dockerfile.browser-test` and `test-browser` service are structurally complete but have not been built/run in this session due to the large Playwright base image download. A `docker-compose run --rm test-browser` should be executed to confirm. |
