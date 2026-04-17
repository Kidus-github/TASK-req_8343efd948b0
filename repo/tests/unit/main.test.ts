import { beforeEach, describe, expect, it, vi } from 'vitest';

const appCtor = vi.fn();

vi.mock('../../src/App.svelte', () => ({
  default: class MockApp {
    constructor(opts: unknown) {
      appCtor(opts);
    }
  }
}));

describe('main bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    appCtor.mockClear();
    document.body.innerHTML = '';
  });

  it('mounts App into #app', async () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);

    await import('../../src/main.ts');

    expect(appCtor).toHaveBeenCalledTimes(1);
    expect(appCtor).toHaveBeenCalledWith({ target: root });
  });

  it('throws when the #app root is missing', async () => {
    await expect(import('../../src/main.ts')).rejects.toThrow('Missing #app root');
    expect(appCtor).not.toHaveBeenCalled();
  });
});
