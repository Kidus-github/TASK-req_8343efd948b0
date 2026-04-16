// Operations reports computed from the actual IndexedDB records. All numbers
// come from the primary records, not a separate analytics store.

import type {
  EditOperation,
  ExportCartItem,
  ImportBatch,
  ImportedAudioFile,
  Job,
  ReportMetrics
} from '../types';
import { all } from '../db/indexeddb';
import { stringifyCsv } from '../util/csv';

export interface ReportFilters {
  dateFrom?: string; // ISO
  dateTo?: string; // ISO
  projectId?: string;
  exportFormat?: 'mp3' | 'wav';
}

export async function computeReport(filters: ReportFilters = {}): Promise<ReportMetrics> {
  const [batches, files, ops, cartItems, jobs] = await Promise.all([
    all<ImportBatch>('importBatches'),
    all<ImportedAudioFile>('importedAudio'),
    all<EditOperation>('editOperations'),
    all<ExportCartItem>('exportCartItems'),
    all<Job>('jobs')
  ]);

  const inWindow = (iso?: string): boolean => {
    if (!iso) return true;
    if (filters.dateFrom && iso < filters.dateFrom) return false;
    if (filters.dateTo && iso > filters.dateTo) return false;
    return true;
  };

  const byProject = (p?: string): boolean => !filters.projectId || p === filters.projectId;

  const fileProjectById = new Map<string, string | undefined>();
  for (const f of files) fileProjectById.set(f.id, f.projectId);

  const importedCount = files.filter(
    (f) => f.importStatus === 'accepted' && byProject(f.projectId) && inWindow(f.createdAt)
  ).length;

  const rejectedCount = batches
    .filter((b) => byProject(b.projectId) && inWindow(b.completedAt ?? b.startedAt))
    .reduce((n, b) => n + b.rejectedCount, 0);

  const editedFileIds = new Set(
    ops
      .filter((o) => byProject(o.projectId) && inWindow(o.createdAt) && !o.previewEnabled)
      .map((o) => o.fileId)
  );
  const editedCount = editedFileIds.size;

  // Join completed cart items with the export job that produced them so we
  // have a completedAt timestamp for date filtering. The job's `resultRef`
  // contains the output filename; match on inputRef (== cart item id).
  const exportJobsByItem = new Map<string, Job>();
  for (const j of jobs) {
    if (j.type === 'export') exportJobsByItem.set(j.inputRef, j);
  }

  const completedExports = cartItems.filter((i) => i.status === 'completed').filter((i) => {
    if (filters.exportFormat && i.format !== filters.exportFormat) return false;
    const itemProject = fileProjectById.get(i.sourceRef);
    if (!byProject(itemProject)) return false;
    const job = exportJobsByItem.get(i.id);
    const completedAt = job?.completedAt ?? job?.startedAt;
    if (!inWindow(completedAt)) return false;
    return true;
  });

  const exportedCount = completedExports.length;
  const formatBreakdown: Record<string, number> = {};
  for (const i of completedExports) {
    const key =
      i.format === 'mp3' ? `mp3-${i.bitrate ?? 192}kbps` : `wav-${i.sampleRate ?? 44100}hz`;
    formatBreakdown[key] = (formatBreakdown[key] ?? 0) + 1;
  }

  const completedJobs = jobs.filter(
    (j) =>
      j.status === 'completed' &&
      inWindow(j.completedAt) &&
      (!filters.projectId || j.projectId === filters.projectId)
  );
  const times = completedJobs.map((j) => j.runtimeMs || 0).filter((n) => n > 0);
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  const median = medianOf(times);

  const failureCountsByJobType: Record<string, number> = {};
  for (const j of jobs.filter(
    (j) =>
      j.status === 'failed_terminal' &&
      inWindow(j.completedAt ?? j.startedAt) &&
      (!filters.projectId || j.projectId === filters.projectId)
  )) {
    failureCountsByJobType[j.type] = (failureCountsByJobType[j.type] ?? 0) + 1;
  }

  return {
    importedCount,
    rejectedCount,
    editedCount,
    exportedCount,
    conversionImportToEdit: importedCount === 0 ? 0 : editedCount / importedCount,
    conversionEditToExport: editedCount === 0 ? 0 : exportedCount / Math.max(1, editedCount),
    avgProcessingTimeMs: Math.round(avg),
    medianProcessingTimeMs: Math.round(median),
    exportFormatBreakdown: formatBreakdown,
    failureCountsByJobType
  };
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function reportToCsv(metrics: ReportMetrics, filters: ReportFilters): string {
  const generatedAt = new Date().toISOString();
  const preamble =
    `# CleanWave operations report\n` +
    `# generatedAt=${generatedAt}\n` +
    `# dateFrom=${filters.dateFrom ?? ''}\n` +
    `# dateTo=${filters.dateTo ?? ''}\n` +
    `# projectId=${filters.projectId ?? ''}\n` +
    `# exportFormat=${filters.exportFormat ?? ''}\n`;
  const rows: Array<Record<string, unknown>> = [
    { metric: 'importedCount', value: metrics.importedCount },
    { metric: 'rejectedCount', value: metrics.rejectedCount },
    { metric: 'editedCount', value: metrics.editedCount },
    { metric: 'exportedCount', value: metrics.exportedCount },
    { metric: 'conversionImportToEdit', value: round4(metrics.conversionImportToEdit) },
    { metric: 'conversionEditToExport', value: round4(metrics.conversionEditToExport) },
    { metric: 'avgProcessingTimeMs', value: metrics.avgProcessingTimeMs },
    { metric: 'medianProcessingTimeMs', value: metrics.medianProcessingTimeMs }
  ];
  for (const [k, v] of Object.entries(metrics.exportFormatBreakdown)) {
    rows.push({ metric: `export.${k}`, value: v });
  }
  for (const [k, v] of Object.entries(metrics.failureCountsByJobType)) {
    rows.push({ metric: `failures.${k}`, value: v });
  }
  return preamble + stringifyCsv(rows, ['metric', 'value']);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
