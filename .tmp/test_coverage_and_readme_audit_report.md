# Test Coverage Audit

## Scope And Project Type

- Declared project type: `web`.
- Evidence:
  - `README.md:1` declares `<!-- project-type: web -->`.
  - `README.md:4` declares `**Project Type: web**`.
  - `README.md:6` states "Fully browser-only, fully offline. No backend, no server-side API endpoints, no server-side authentication."
  - `package.json` describes a Svelte + TypeScript SPA with Vite, Vitest, and Playwright only.

## Backend Endpoint Inventory

- No backend/API endpoints were detected.
- Evidence:
  - `README.md:6` explicitly states there is no backend and no server-side API endpoint surface.
  - Static search across `src/`, `tests/`, `README.md`, and `package.json` found no Express/Fastify/Koa/Hono route definitions, no `app.get/post/...`, no `supertest`, and no HTTP server bootstrap.

### Backend Endpoint Inventory

| Endpoint | Status | Evidence |
|---|---|---|
| None detected | N/A | `README.md:6`; no router/server code in `src/` |

### API Test Mapping Table

| Endpoint | Covered | Test Type | Test Files | Evidence |
|---|---|---|---|---|
| None detected | N/A | N/A | N/A | No backend route handlers exist to map |

## API Test Classification

1. True No-Mock HTTP API tests: none found.
2. HTTP with Mocking API tests: none found.
3. Non-HTTP tests: all visible tests fall here for API-audit purposes.

Evidence:
- `tests/browser/smoke.spec.ts`, `tests/browser/export-download.spec.ts`, and `tests/browser/profile-persistence.spec.ts` are real browser tests against the SPA, not backend/API route tests.
- `tests/flow/primary-flow.test.ts`, test `profile … project … import … edit … marker … playlist … export … report`, explicitly states it is "not a browser UI end-to-end test."

## Mock Detection

### Detected Mocking / Overrides

| What is mocked or overridden | Where | Classification impact |
|---|---|---|
| `BroadcastChannel`, `Blob.arrayBuffer`, `AudioContext` test-environment shims | `tests/setup.ts` | Non-HTTP environment substitution |
| `App.svelte` constructor is mocked | `tests/unit/main.test.ts`, `describe('main bootstrap')` | Unit/bootstrap test is not no-mock |
| `poolWorker.executePoolJob` is spied on | `tests/integration/timeline-worker-path.test.ts`, `describe('smartDispatch creates real IndexedDB jobs')` | This integration file is not no-mock for that execution path |
| `document.createElement` is spied on and anchor click is replaced | `tests/integration/export-pipeline.test.ts`, `it('downloadCompletedItem triggers a real anchor download')` | Partial DOM mocking |
| `document.createElement` is spied on and anchor click is replaced | `tests/flow/export-download-flow.test.ts`, `it('produces a real downloadable file and reports one completed export')` | Partial DOM mocking |

Assessment:
- Mocking exists, but it is limited and localized.
- No HTTP transport mocking was found because no HTTP/API route layer exists.

## Coverage Summary

- Total endpoints: `0`
- Endpoints with HTTP tests: `0`
- Endpoints with TRUE no-mock HTTP tests: `0`
- HTTP coverage %: `N/A`
- True API coverage %: `N/A`

Interpretation:
- API coverage is not missing; it is not applicable because the project has no backend/API route surface.

## Unit Test Analysis

### Backend Unit Tests

- Backend unit test files: none.
- Backend modules covered:
  - controllers: none detected
  - services: none detected in a backend/server sense
  - repositories: none detected in a backend/server sense
  - auth/guards/middleware: none detected
- Important backend modules NOT tested: none applicable because no backend modules were detected.

### Frontend Unit Tests

- **Frontend unit tests: PRESENT**

Strict detection evidence:
- Identifiable frontend test files exist:
  - `tests/unit/main.test.ts`
  - `tests/component/App.test.ts`
  - `tests/component/ProfileGate.test.ts`
  - `tests/component/Workspace.test.ts`
  - `tests/browser/smoke.spec.ts`
- Tests target frontend logic/components:
  - `tests/component/App.test.ts` renders `../../src/App.svelte`
  - `tests/component/ProfileGate.test.ts` renders `../../src/lib/components/ProfileGate.svelte`
  - `tests/unit/main.test.ts` imports `../../src/main.ts`
  - `tests/browser/smoke.spec.ts` drives visible UI workflow in the browser
- Frameworks/tools are directly evident:
  - `vitest` in `package.json`
  - `@testing-library/svelte` in component tests
  - `Playwright` in browser specs
- Tests import or render actual frontend modules/components:
  - `tests/component/App.test.ts`
  - `tests/component/ProfileGate.test.ts`
  - `tests/unit/main.test.ts`
  - many other component tests under `tests/component/`

Frontend test files detected:
- Identifiable test/spec files under `tests/`: `73`
- `tests/unit`: `12`
- `tests/integration`: `35`
- `tests/component`: `16`
- `tests/flow`: `4`
- `tests/browser`: `6`

Frameworks/tools detected:
- `Vitest`
- `@testing-library/svelte`
- `jsdom`
- `Playwright`
- `fake-indexeddb`

Components/modules covered:
- App shell and bootstrap:
  - `src/App.svelte` via `tests/component/App.test.ts`
  - `src/main.ts` via `tests/unit/main.test.ts`
- Core Svelte components:
  - `ProfileGate`, `ProjectsPanel`, `Workspace`, `ImportPanel`, `TimelineEditor`, `ExportPanel`, `ReportsPanel`, `PlaylistsPanel`, `Sidebar`, `PreferencesPanel`, `AttendancePanel`, `CohortsPanel`, `IntegrationPanel`, `ConfirmModal`, `ToastHost`
- Frontend services/business logic:
  - `profile`, `projects`, `imports`, `edits`, `exports`, `queue`, `reports`, `markers`, `playlists`, `locks`, `snapshots`, `cohorts`, `integration`, `attendance`
- Frontend support modules:
  - IndexedDB wrapper, preferences, stores, audio engine/utilities, attendance inference/model helpers

Important frontend components/modules NOT directly tested:
- `src/app.css` has no direct test evidence.
- No major primary Svelte UI component gap was found.

### Cross-Layer Observation

- This is a single-layer web SPA, not a backend/frontend split system.
- Testing is frontend-heavy by design and correctly aligned with the codebase shape.

## API Observability Check

- API observability: not applicable because no API endpoint tests exist.
- Browser/UI observability is strong:
  - `tests/browser/smoke.spec.ts`, test `profile -> project -> import -> marker -> export -> reports -> playlist search`, shows concrete user actions and visible outcomes.
  - `tests/browser/export-download.spec.ts`, test `import -> export -> download updates the report and produces a browser download`, shows input, UI transitions, download event, and report assertions.
  - `tests/browser/profile-persistence.spec.ts`, test `reload requires unlock, restores the last open project, and supports device reset`, shows persistence/reset behavior through visible UI.
- Flow-service observability is acceptable but explicitly non-browser:
  - `tests/flow/primary-flow.test.ts` states it is not a browser UI end-to-end test.

## Test Quality & Sufficiency

### Strengths

- Broad and layered frontend coverage:
  - `12` unit test files
  - `16` component test files
  - `35` integration test files
  - `4` flow test files
  - `6` browser specs
- Browser-backed user journeys are materially stronger than before:
  - `tests/browser/smoke.spec.ts` now covers profile creation, project creation, import, marker creation, export, reports, and playlist workflow.
  - `tests/browser/export-download.spec.ts` now verifies report updates and a real browser download event.
  - `tests/browser/profile-persistence.spec.ts` adds reload/unlock/restore/reset coverage.
- Bootstrap coverage now exists for `src/main.ts`:
  - `tests/unit/main.test.ts`, tests `mounts App into #app` and `throws when the #app root is missing`.
- `run_tests.sh` no longer performs `npm ci`; it only invokes the test scripts.

### Weaknesses

- No API/backend route coverage exists because no API/backend exists.
- Some high-level jsdom tests remain partially mocked:
  - `tests/integration/export-pipeline.test.ts`, test `downloadCompletedItem triggers a real anchor download`
  - `tests/flow/export-download-flow.test.ts`, test `produces a real downloadable file and reports one completed export`
- `tests/integration/timeline-worker-path.test.ts` uses a spy on `executePoolJob`, so that file is not a strict no-mock integration path.
- Several browser specs still duplicate setup fixture logic instead of fully reusing helpers, which is a maintainability issue but not a coverage failure.

### run_tests.sh Check

- Result: Docker-based test path exists and the runner no longer installs dependencies during execution.
- Evidence:
  - `docker-compose.yml:13-21` runs `./run_tests.sh` inside the `test` service.
  - `run_tests.sh:4-14` runs `test:unit`, `test:integration`, `test:component`, and `test:flow` only.

## End-to-End Expectations

- For a `web` project, real browser/UI coverage is expected.
- Present evidence:
  - `tests/browser/smoke.spec.ts`
  - `tests/browser/export-download.spec.ts`
  - `tests/browser/profile-persistence.spec.ts`
  - `tests/browser/waveform.spec.ts`
  - `tests/browser/multitab.spec.ts`
  - `tests/browser/attendance.spec.ts`
- Assessment:
  - Real browser coverage is now strong enough to materially compensate for the fact that `tests/flow/*.test.ts` are jsdom/service-layer tests rather than browser E2E.

## Tests Check

- Backend endpoint coverage: not applicable; no endpoints exist.
- Frontend unit tests: present.
- Frontend component tests: present and broad.
- Frontend browser tests: present and materially stronger than the prior state.
- Over-mocking: limited, but still present in selected integration/flow tests.
- Test depth: strong for a browser-only SPA.

## Test Coverage Score (0–100)

- **92/100**

## Score Rationale

- Positive scoring factors:
  - No backend/API exists, so missing endpoint tests are not a deduction.
  - Frontend unit, component, integration, flow, and browser layers are all present.
  - `src/main.ts` now has direct bootstrap coverage.
  - Browser coverage now validates deeper, user-visible workflows rather than only shallow smoke checks.
  - `run_tests.sh` no longer does dependency installation during test execution.
- Deductions retained:
  - Some high-level jsdom tests still use DOM spies/mocks.
  - Some "e2e"/"flow" naming still overstates realism because those files are not browser-driven.
  - No direct evidence exists for CSS-level behavior or visual regression coverage.

## Key Gaps

- The remaining high-level mocked download assertions in:
  - `tests/integration/export-pipeline.test.ts`
  - `tests/flow/export-download-flow.test.ts`
- `tests/integration/timeline-worker-path.test.ts` still relies on a spy for worker-path confirmation.
- `src/app.css` has no direct test coverage.

## Confidence & Assumptions

- Confidence: high.
- Assumptions:
  - Static inspection only; no code, tests, scripts, containers, or builds were run for this audit.
  - If a backend/API existed, its route surface would be visible in the repository code inspected.
  - File counts are based on currently visible `*.test.ts` and `*.spec.ts` files.

# README Audit

## README Location

- `README.md` exists at repo root.

## Hard Gate Review

### Formatting

- Pass.
- Evidence:
  - `README.md` is clearly sectioned and readable.

### Startup Instructions

- Pass for `web`.
- Evidence:
  - `README.md:20` includes `docker-compose up --build`.

### Access Method

- Pass.
- Evidence:
  - `README.md:25` provides `http://localhost:5173`.

### Verification Method

- Pass.
- Evidence:
  - `README.md:52` begins a step-by-step browser verification flow.

### Environment Rules

- Partial concern, but not a hard-gate failure from README content alone.
- README does not instruct the user to run host-side `npm install`, `pip install`, `apt-get`, or manual DB setup.
- However, the repository implementation still includes container-side installation steps:
  - `Dockerfile` runs `npm ci`
  - `Dockerfile.browser-test` runs `npm ci`
  - `Dockerfile.browser-test` runs `npx playwright install --with-deps chromium`
  - `docker-compose.yml:30` runs `npx playwright test` in the browser test container

### Demo Credentials / Authentication

- Pass.
- Evidence:
  - `README.md:33` explicitly states `No authentication required.`
  - `README.md:35` explains there is no backend/server auth surface.

## High Priority Issues

- README test inventory is materially incorrect.
  - `README.md:86` claims `53 test files`.
  - Current identifiable `*.test.ts` / `*.spec.ts` count is `73`.
- README category counts are materially incorrect.
  - `README.md:115` claims `component/ 3 files`; current component test count is `16`.
  - `README.md:117` claims `browser/ 5 files`; current browser spec count is `6`.
  - Current unit test count is `12`, not `11`.
- README browser-spec inventory is outdated.
  - `README.md:91-99` describes 5 browser specs.
  - Current browser specs also include `tests/browser/profile-persistence.spec.ts`.

## Medium Priority Issues

- `README.md:13` says `No other runtime dependencies required.` That wording is too broad given container build/test images still install dependencies.
- `README.md:156` says host-side commands removed, including `npx playwright install`, but `Dockerfile.browser-test` still performs `npx playwright install --with-deps chromium`. That is container-contained, but the phrasing is imprecise and easy to misread.
- The "Required Repo Changes for Full Compliance" table is historical/status language, not clean operator documentation. It mixes documentation with self-attestation.

## Low Priority Issues

- The README architecture section is acceptable, but it does not reflect the now-expanded browser test coverage.
- The README test layout should distinguish identifiable test/spec files from helper/support files under `tests/`.

## Hard Gate Failures

- None conclusively identified from README text alone.

## README Verdict

- **PARTIAL PASS**

## README Verdict Rationale

- The README passes the primary operational gates for a `web` project:
  - startup command present
  - access URL/port present
  - verification flow present
  - authentication state explicitly declared
- It fails documentation accuracy/compliance quality expectations because the testing sections are now substantially outdated relative to the repository state.

## Final Verdicts

- Test Coverage Audit: **PASS**
- README Audit: **PARTIAL PASS**
