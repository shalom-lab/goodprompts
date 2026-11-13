import type { PromptItem } from '../types/prompt'

const DB_NAME = 'goodprompts'
const DB_VERSION = 1
/** Local selection cart — full PromptItem rows, keyPath prompt_id */
const STORE_SELECTED = 'selected-prompts'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_SELECTED)) {
        db.createObjectStore(STORE_SELECTED, { keyPath: 'prompt_id' })
      }
    }
  })
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDb()
  try {
    const tx = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)
    const result = await fn(store)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB tx failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB tx aborted'))
    })
    return result
  } finally {
    db.close()
  }
}

export async function getAllSelectedPrompts(): Promise<PromptItem[]> {
  return withStore(STORE_SELECTED, 'readonly', async (store) => {
    const rows = await idbReq(store.getAll())
    return Array.isArray(rows) ? (rows as PromptItem[]) : []
  })
}

export async function putSelectedPrompt(prompt: PromptItem): Promise<void> {
  await withStore(STORE_SELECTED, 'readwrite', async (store) => {
    await idbReq(store.put(prompt))
  })
}

export async function removeSelectedPrompt(promptId: string): Promise<void> {
  await withStore(STORE_SELECTED, 'readwrite', async (store) => {
    await idbReq(store.delete(promptId))
  })
}

export async function clearSelectedPrompts(): Promise<void> {
  await withStore(STORE_SELECTED, 'readwrite', async (store) => {
    await idbReq(store.clear())
  })
}
