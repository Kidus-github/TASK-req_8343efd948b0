// Global test setup. Installs:
//  - fake-indexeddb for IndexedDB
//  - BroadcastChannel polyfill for jsdom
//  - Blob.arrayBuffer shim (jsdom's Blob lacks it in some versions)
//  - A compact FakeAudioContext that can decode our own encodeWav output so
//    tests of the real export pipeline can run under jsdom.

import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { clearAll, resetDbSingleton } from '../src/lib/db/indexeddb';

// BroadcastChannel polyfill.
if (typeof (globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel === 'undefined') {
  const listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  class FakeChannel {
    constructor(public readonly name: string) {
      if (!listeners.has(name)) listeners.set(name, new Set());
    }
    private _onmessage: ((e: MessageEvent) => void) | null = null;
    private _set: Set<(e: MessageEvent) => void> = listeners.get(this.name)!;
    get onmessage(): ((e: MessageEvent) => void) | null {
      return this._onmessage;
    }
    set onmessage(v: ((e: MessageEvent) => void) | null) {
      if (this._onmessage) this._set.delete(this._onmessage);
      this._onmessage = v;
      if (v) this._set.add(v);
    }
    addEventListener(_type: string, fn: (e: MessageEvent) => void): void {
      this._set.add(fn);
    }
    removeEventListener(_type: string, fn: (e: MessageEvent) => void): void {
      this._set.delete(fn);
    }
    postMessage(data: unknown): void {
      const copy = structuredClone ? structuredClone(data) : JSON.parse(JSON.stringify(data));
      for (const fn of this._set) {
        try {
          fn({ data: copy } as MessageEvent);
        } catch {
          // ignore listener errors
        }
      }
    }
    close(): void {
      if (this._onmessage) this._set.delete(this._onmessage);
    }
  }
  (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = FakeChannel;
}

// Blob.arrayBuffer shim using FileReader for jsdom where the native impl is
// either missing or returns "[object Object]" text. We override unconditionally
// because jsdom's native arrayBuffer is unreliable across versions.
if (typeof Blob !== 'undefined') {
  (Blob.prototype as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = function () {
    const blob = this as Blob;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const r = reader.result;
        if (r instanceof ArrayBuffer) resolve(r);
        else reject(new Error('FileReader.result is not ArrayBuffer'));
      };
      reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
      reader.readAsArrayBuffer(blob);
    });
  };
}

// Fake AudioContext that decodes our own 16-bit PCM WAV output.
// Tests that work with real audio assume WAV-encoded input (encodeWavBytes).
class FakeAudioBuffer {
  sampleRate: number;
  duration: number;
  numberOfChannels: number;
  private data: Float32Array[];
  constructor(channels: Float32Array[], sampleRate: number) {
    this.data = channels;
    this.numberOfChannels = channels.length;
    this.sampleRate = sampleRate;
    this.duration = channels[0].length / sampleRate;
  }
  getChannelData(c: number): Float32Array {
    return this.data[c];
  }
}

class FakeAudioContext {
  sampleRate: number;
  constructor(opts?: { sampleRate?: number }) {
    this.sampleRate = opts?.sampleRate ?? 44100;
  }
  decodeAudioData(
    arr: ArrayBuffer,
    onOk?: (b: FakeAudioBuffer) => void,
    onErr?: (e: Error) => void
  ): Promise<FakeAudioBuffer> {
    try {
      const view = new DataView(arr);
      // Only supports 16-bit PCM WAVs produced by src/lib/util/audio::encodeWavBytes.
      const header = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
      if (header !== 'RIFF') throw new Error('FakeAudioContext only understands WAV');
      const channels = view.getUint16(22, true);
      const sr = view.getUint32(24, true);
      const dataSize = view.getUint32(40, true);
      const samples = dataSize / 2 / channels;
      const chans: Float32Array[] = [];
      for (let c = 0; c < channels; c++) chans.push(new Float32Array(samples));
      for (let i = 0; i < samples; i++) {
        for (let c = 0; c < channels; c++) {
          const off = 44 + (i * channels + c) * 2;
          chans[c][i] = view.getInt16(off, true) / 0x7fff;
        }
      }
      const buf = new FakeAudioBuffer(chans, sr);
      if (onOk) onOk(buf);
      return Promise.resolve(buf);
    } catch (err) {
      if (onErr) onErr(err as Error);
      return Promise.reject(err);
    }
  }
}

if (typeof (globalThis as unknown as { AudioContext?: unknown }).AudioContext === 'undefined') {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
}

// Ensure a clean DB between tests.
beforeEach(async () => {
  resetDbSingleton();
  try {
    await clearAll();
  } catch {
    // First test: DB not yet open. Fine.
  }
});
