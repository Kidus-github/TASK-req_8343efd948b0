import { describe, expect, it } from 'vitest';
import { importBatch, listProjectFiles } from '../../src/lib/services/imports';
import { createProject } from '../../src/lib/services/projects';
import { LIMITS } from '../../src/lib/util/constants';

function blobOf(size: number, type = 'audio/mpeg'): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

describe('import pipeline', () => {
  it('accepts valid rows and rejects invalid ones with row-level errors', async () => {
    const p = await createProject('ImportTest');
    if (!p.ok) throw new Error('setup');
    const res = await importBatch(p.data.id, [
      { name: 'ok.mp3', size: 1024, mimeType: 'audio/mpeg', data: blobOf(1024) },
      { name: 'bad.flac', size: 1024, mimeType: 'audio/flac', data: blobOf(1024) },
      { name: '', size: 10, data: blobOf(10) },
      { name: 'zero.wav', size: 0, data: blobOf(0, 'audio/wav') }
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.accepted.length).toBe(1);
    expect(res.data.rejected.length).toBe(3);
    expect(res.data.batch.status).toBe('accepted_partial');

    const files = await listProjectFiles(p.data.id);
    expect(files.length).toBe(1);
    expect(files[0].originalFilename).toBe('ok.mp3');
  });

  it('fails batch with more than the file cap', async () => {
    const p = await createProject('CapTest');
    if (!p.ok) throw new Error('setup');
    const many = Array.from({ length: LIMITS.MAX_FILES_PER_BATCH + 1 }, (_, i) => ({
      name: `f${i}.mp3`,
      size: 100,
      data: blobOf(100)
    }));
    const res = await importBatch(p.data.id, many);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('IMPORT_TOO_MANY_FILES');
  });

  it('fails batch with total size > 2GB', async () => {
    const p = await createProject('SizeTest');
    if (!p.ok) throw new Error('setup');
    const res = await importBatch(p.data.id, [
      { name: 'huge.wav', size: LIMITS.MAX_BATCH_BYTES + 1, data: blobOf(0, 'audio/wav') }
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('IMPORT_SIZE_LIMIT_EXCEEDED');
  });

  it('fails batch if no valid file', async () => {
    const p = await createProject('AllBadTest');
    if (!p.ok) throw new Error('setup');
    const res = await importBatch(p.data.id, [
      { name: 'a.flac', size: 100, data: blobOf(100) },
      { name: 'b.aac', size: 100, data: blobOf(100) }
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('IMPORT_BATCH_EMPTY');
  });
});
