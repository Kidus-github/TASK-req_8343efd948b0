<script lang="ts">
  import { exportCohortCsv, importCohortCsv, type CohortEntity } from '$lib/services/cohorts';
  import { pushToast } from '$lib/stores/toast';
  import { passphraseGate } from '$lib/util/passphraseGate';

  let entity: CohortEntity = 'organizations';
  let csvText = '';
  let strict = false;
  let rejections: Array<{ rowIndex: number; errors: Array<{ code: string; message: string }> }> = [];
  let lastAccepted = 0;

  async function onImport(): Promise<void> {
    const ok = await passphraseGate('import cohort CSV');
    if (!ok) return;
    const res = await importCohortCsv(entity, csvText, { strict });
    if (!res.ok) {
      pushToast('error', res.message);
      if (res.details && typeof res.details === 'object' && 'rejections' in (res.details as object)) {
        rejections = (res.details as { rejections: typeof rejections }).rejections ?? [];
      }
      return;
    }
    rejections = res.data.rejections;
    lastAccepted = res.data.accepted;
    pushToast('success', `Imported ${res.data.accepted} row(s); rejected ${res.data.rejected}.`);
  }

  async function onExport(): Promise<void> {
    const ok = await passphraseGate('export cohort CSV');
    if (!ok) return;
    const csv = await exportCohortCsv(entity);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cohort-${entity}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast('success', 'CSV downloaded.');
  }
</script>

<div class="stack" style="max-width: 1000px;">
  <h2 style="margin: 0;">Cohorts</h2>
  <p class="hint">
    Bulk import/export cohort records. Default mode is partial accept: invalid rows are
    reported row-by-row. Strict mode aborts on the first invalid row.
  </p>

  <div class="card">
    <div class="row" style="gap: 0.75rem; flex-wrap: wrap;">
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Entity</span>
        <select bind:value={entity}>
          <option value="organizations">Organizations</option>
          <option value="programs">Programs</option>
          <option value="classGroups">Class groups</option>
          <option value="rolePositions">Role positions</option>
          <option value="cohortWindows">Cohort windows</option>
          <option value="cohortMemberships">Cohort memberships</option>
        </select>
      </label>
      <label class="row" style="align-self: flex-end; gap: 0.3rem;">
        <input type="checkbox" bind:checked={strict} />
        <span>Strict</span>
      </label>
      <div class="grow" />
      <button on:click={onExport}>Export {entity} CSV</button>
    </div>

    <label class="label" style="margin-top: 0.75rem;">CSV text</label>
    <textarea
      bind:value={csvText}
      rows="8"
      style="width: 100%; font-family: monospace;"
      placeholder={"canonicalId,name\nacme,Acme Inc\n"}
    />
    <div class="row" style="justify-content: flex-end; margin-top: 0.5rem;">
      <button class="primary" on:click={onImport} disabled={!csvText.trim()}>Import</button>
    </div>
    <p class="hint">Last accepted: {lastAccepted}</p>
  </div>

  {#if rejections.length > 0}
    <div class="card">
      <h4 style="margin-top: 0;">Row errors</h4>
      <table class="table">
        <thead>
          <tr>
            <th>Row</th>
            <th>Errors</th>
          </tr>
        </thead>
        <tbody>
          {#each rejections as r}
            <tr>
              <td>{r.rowIndex}</td>
              <td>
                {#each r.errors as e}
                  <div><span class="pill danger">{e.code}</span> {e.message}</div>
                {/each}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
