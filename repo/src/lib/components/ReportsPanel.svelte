<script lang="ts">
  import { onMount } from 'svelte';
  import { computeReport, reportToCsv, type ReportFilters } from '$lib/services/reports';
  import { listProjects } from '$lib/services/projects';
  import type { Project, ReportMetrics } from '$lib/types';
  import { pushToast } from '$lib/stores/toast';

  let metrics: ReportMetrics | null = null;
  let dateFrom = '';
  let dateTo = '';
  let exportFormat: '' | 'mp3' | 'wav' = '';
  let projectId = '';
  let projects: Project[] = [];

  onMount(async () => {
    projects = await listProjects();
    await run();
  });

  function buildFilters(): ReportFilters {
    return {
      dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
      dateTo: dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : undefined,
      exportFormat: exportFormat || undefined,
      projectId: projectId || undefined
    };
  }

  async function run(): Promise<void> {
    metrics = await computeReport(buildFilters());
  }

  function downloadCsv(): void {
    if (!metrics) return;
    const csv = reportToCsv(metrics, buildFilters());
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cleanwave-report-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast('success', 'CSV report downloaded.');
  }
</script>

<div class="stack" style="max-width: 1000px;">
  <h2 style="margin: 0;">Reports</h2>

  <div class="card">
    <div class="row" style="gap: 0.75rem; flex-wrap: wrap;">
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Project</span>
        <select bind:value={projectId}>
          <option value="">All projects</option>
          {#each projects as p (p.id)}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
      </label>
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Date from</span>
        <input type="date" bind:value={dateFrom} />
      </label>
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Date to</span>
        <input type="date" bind:value={dateTo} />
      </label>
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Export format</span>
        <select bind:value={exportFormat}>
          <option value="">Any</option>
          <option value="mp3">MP3</option>
          <option value="wav">WAV</option>
        </select>
      </label>
      <div class="stack" style="gap: 0.2rem;">
        <span class="label">&nbsp;</span>
        <button class="primary" on:click={run}>Apply filters</button>
      </div>
      <div class="stack" style="gap: 0.2rem;">
        <span class="label">&nbsp;</span>
        <button on:click={downloadCsv} disabled={!metrics}>Export CSV</button>
      </div>
    </div>
  </div>

  {#if metrics}
    <div class="card">
      <h4 style="margin-top: 0;">Counts</h4>
      <table class="table">
        <tr><td>Imported</td><td>{metrics.importedCount}</td></tr>
        <tr><td>Rejected</td><td>{metrics.rejectedCount}</td></tr>
        <tr><td>Edited</td><td>{metrics.editedCount}</td></tr>
        <tr><td>Exported</td><td>{metrics.exportedCount}</td></tr>
      </table>
    </div>

    <div class="card">
      <h4 style="margin-top: 0;">Conversions</h4>
      <table class="table">
        <tr><td>Import to edit</td><td>{(metrics.conversionImportToEdit * 100).toFixed(1)}%</td></tr>
        <tr><td>Edit to export</td><td>{(metrics.conversionEditToExport * 100).toFixed(1)}%</td></tr>
      </table>
    </div>

    <div class="card">
      <h4 style="margin-top: 0;">Processing</h4>
      <table class="table">
        <tr><td>Average processing time (ms)</td><td>{metrics.avgProcessingTimeMs}</td></tr>
        <tr><td>Median processing time (ms)</td><td>{metrics.medianProcessingTimeMs}</td></tr>
      </table>
    </div>

    <div class="card">
      <h4 style="margin-top: 0;">Export format breakdown</h4>
      {#if Object.keys(metrics.exportFormatBreakdown).length === 0}
        <p class="muted">None.</p>
      {:else}
        <table class="table">
          {#each Object.entries(metrics.exportFormatBreakdown) as [k, v]}
            <tr><td>{k}</td><td>{v}</td></tr>
          {/each}
        </table>
      {/if}
    </div>
  {:else}
    <p class="muted">Run to load metrics.</p>
  {/if}
</div>
