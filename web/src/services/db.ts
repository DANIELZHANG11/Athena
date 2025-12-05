/**
 * 简易 IndexedDB 封装
 *
 * 说明：
 * - 使用数据库 `athena` 与对象仓库 `kv`
 * - 提供 `dbSet` 与 `dbGet` 两个简单的 KV 接口
 */
export async function openDB() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('athena', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * 写入 KV
 * @param key 键
 * @param value 值（可序列化）
 */
export async function dbSet(key: string, value: any) {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * 读取 KV
 * @param key 键
 */
export async function dbGet<T = any>(key: string) {
  const db = await openDB()
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly')
    const req = tx.objectStore('kv').get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}
