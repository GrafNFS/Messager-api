import { openDB, type IDBPDatabase } from 'idb';

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB('ig-messenger-crypto', 1, {
      upgrade(db) {
        db.createObjectStore('crypto_keys', { keyPath: 'key' });
      },
    });
  }
  return dbPromise;
}

// Универсальные методы
export async function put(store: string, value: any) {
  const db = await getDB();
  await db.put(store, value);
}

export async function get(store: string, key: any) {
  const db = await getDB();
  return db.get(store, key);
}

export async function del(store: string, key: any) {
  const db = await getDB();
  await db.delete(store, key);
}

export async function all(store: string) {
  const db = await getDB();
  return db.getAll(store);
}

export function toBase64(u8: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}