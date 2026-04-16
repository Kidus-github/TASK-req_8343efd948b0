# Sample CSV templates

These files demonstrate the expected column layout for the cohort bulk-import feature. Import them via the Cohorts panel → pick the matching entity from the dropdown → paste the CSV contents into the textarea → click **Import**.

| File | Entity | Required columns |
| --- | --- | --- |
| `organizations.sample.csv` | `organizations` | `canonicalId`, `name` |
| `programs.sample.csv` | `programs` | `canonicalId`, `organizationId`, `name` |
| `cohortWindows.sample.csv` | `cohortWindows` | `classGroupId`, `startDate`, `endDate` |

Notes:

- Additional columns (e.g. `id`) are preserved when present; otherwise a generated `id` is assigned.
- Dates are ISO-8601 (`YYYY-MM-DD`). The cohort-window validator rejects rows where `startDate > endDate`.
- `canonicalId` is expected to be unique within each entity type (indexed in IndexedDB).
- Run in strict mode to abort on the first invalid row; default is partial-accept with per-row error reports.
