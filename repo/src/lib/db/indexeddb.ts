// Thin Promise wrapper over IndexedDB. Compatible with fake-indexeddb
// under test (tests/setup.ts installs the global).

import { DB_NAME, DB_VERSION, STORES } from './schema';

let dbPromise: Promise<IDBDatabase> | null = null;

export function resetDbSingleton(): void {
  dbPromise = null;
}

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s.name)) {
            const store = db.createObjectStore(s.name, { keyPath: s.keyPath });
            for (const idx of s.indexes ?? []) {
              store.createIndex(idx.name, idx.keyPath as string, {
                unique: Boolean(idx.unique)
              });
            }
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexeddb open failed'));
      req.onblocked = () => reject(new Error('indexeddb open blocked'));
    });
  }
  return dbPromise;
}

export async function deleteDb(): Promise<void> {
  resetDbSingleton();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('delete failed'));
    req.onblocked = () => resolve(); // best-effort; other tabs may hold handle
  });
}

type Mode = 'readonly' | 'readwrite';

export async function tx<T>(
  stores: string | string[],
  mode: Mode,
  fn: (stores: IDBObjectStore[]) => Promise<T> | T
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const names = Array.isArray(stores) ? stores : [stores];
    const transaction = db.transaction(names, mode);
    const objStores = names.map((n) => transaction.objectStore(n));
    let result: T;
    let settled = false;
    Promise.resolve()
      .then(() => fn(objStores))
      .then((r) => {
        result = r;
      })
      .catch((err) => {
        settled = true;
        try {
          transaction.abort();
        } catch {}
        reject(err);
      });
    transaction.oncomplete = () => {
      if (!settled) resolve(result);
    };
    transaction.onerror = () => {
      if (!settled) reject(transaction.error ?? new Error('tx error'));
    };
    transaction.onabort = () => {
      if (!settled) reject(transaction.error ?? new Error('tx aborted'));
    };
  });
}

export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('request failed'));
  });
}

export async function put<T>(storeName: string, value: T): Promise<T> {
  return tx([storeName], 'readwrite', async ([s]) => {
    await req(s.put(value as unknown as IDBValidKey | IDBValidKey[] | any));
    return value;
  });
}

export async function get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return tx([storeName], 'readonly', async ([s]) => {
    const v = await req<T>(s.get(key) as IDBRequest<T>);
    return v ?? undefined;
  });
}

export async function del(storeName: string, key: IDBValidKey): Promise<void> {
  return tx([storeName], 'readwrite', async ([s]) => {
    await req(s.delete(key));
  });
}

export async function all<T>(storeName: string): Promise<T[]> {
  return tx([storeName], 'readonly', async ([s]) => {
    return req<T[]>(s.getAll() as IDBRequest<T[]>);
  });
}

export async function allByIndex<T>(
  storeName: string,
  indexName: string,
  key: IDBValidKey | IDBKeyRange
): Promise<T[]> {
  return tx([storeName], 'readonly', async ([s]) => {
    const idx = s.index(indexName);
    return req<T[]>(idx.getAll(key) as IDBRequest<T[]>);
  });
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  const names = Array.from(db.objectStoreNames);
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(names, 'readwrite');
    for (const n of names) t.objectStore(n).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('clear failed'));
    t.onabort = () => reject(t.error ?? new Error('clear aborted'));
  });
}
