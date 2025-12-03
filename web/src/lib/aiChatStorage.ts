/**
 * aiChatStorage.ts
 * AI 对话本地缓存服务 - 使用 IndexedDB 管理 AI 对话历史
 * 
 * 功能:
 * - 缓存对话列表，减少服务器请求
 * - 缓存对话消息，支持离线查看历史
 * - 在有网络时与服务器同步
 * - 离线时显示缓存的对话（只读）
 */

const DB_NAME = 'athena_ai_chat'
const DB_VERSION = 1
const CONVERSATIONS_STORE = 'conversations'
const MESSAGES_STORE = 'messages'

/** 对话记录 */
export interface ConversationRecord {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  mode?: string
  bookIds?: string[]
  lastSyncAt?: number  // 最后同步时间
}

/** 消息记录 */
export interface MessageRecord {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  metadata?: {
    model?: string
    tokens?: number
    bookRefs?: string[]
  }
}

// 打开数据库
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    
    request.onerror = () => {
      console.error('[AIChatStorage] Failed to open database:', request.error)
      reject(request.error)
    }
    
    request.onsuccess = () => {
      resolve(request.result)
    }
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      
      // 对话列表存储
      if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
        const store = db.createObjectStore(CONVERSATIONS_STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
        store.createIndex('lastSyncAt', 'lastSyncAt', { unique: false })
        console.log('[AIChatStorage] Created conversations store')
      }
      
      // 消息存储
      if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
        const store = db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' })
        store.createIndex('conversationId', 'conversationId', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
        console.log('[AIChatStorage] Created messages store')
      }
    }
  })
}

// ============================================================
// 对话操作
// ============================================================

/**
 * 保存对话到本地缓存
 */
export async function saveConversation(conversation: ConversationRecord): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite')
    const store = tx.objectStore(CONVERSATIONS_STORE)
    
    const record: ConversationRecord = {
      ...conversation,
      lastSyncAt: Date.now(),
    }
    
    const request = store.put(record)
    
    request.onsuccess = () => {
      console.log(`[AIChatStorage] Saved conversation ${conversation.id}`)
      resolve()
    }
    
    request.onerror = () => {
      console.error('[AIChatStorage] Failed to save conversation:', request.error)
      reject(request.error)
    }
    
    tx.oncomplete = () => db.close()
  })
}

/**
 * 批量保存对话列表
 */
export async function saveConversations(conversations: ConversationRecord[]): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite')
    const store = tx.objectStore(CONVERSATIONS_STORE)
    const now = Date.now()
    
    for (const conv of conversations) {
      store.put({
        ...conv,
        lastSyncAt: now,
      })
    }
    
    tx.oncomplete = () => {
      console.log(`[AIChatStorage] Saved ${conversations.length} conversations`)
      db.close()
      resolve()
    }
    
    tx.onerror = () => {
      reject(tx.error)
    }
  })
}

/**
 * 获取所有缓存的对话
 */
export async function getCachedConversations(): Promise<ConversationRecord[]> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONVERSATIONS_STORE, 'readonly')
    const store = tx.objectStore(CONVERSATIONS_STORE)
    const index = store.index('updatedAt')
    const request = index.openCursor(null, 'prev')  // 按更新时间倒序
    
    const results: ConversationRecord[] = []
    
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result
      if (cursor) {
        results.push(cursor.value)
        cursor.continue()
      }
    }
    
    tx.oncomplete = () => {
      console.log(`[AIChatStorage] Retrieved ${results.length} cached conversations`)
      db.close()
      resolve(results)
    }
    
    tx.onerror = () => {
      reject(tx.error)
    }
  })
}

/**
 * 获取单个对话
 */
export async function getConversation(id: string): Promise<ConversationRecord | null> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONVERSATIONS_STORE, 'readonly')
    const store = tx.objectStore(CONVERSATIONS_STORE)
    const request = store.get(id)
    
    request.onsuccess = () => {
      resolve(request.result || null)
    }
    
    request.onerror = () => {
      reject(request.error)
    }
    
    tx.oncomplete = () => db.close()
  })
}

/**
 * 删除对话及其消息
 */
export async function deleteConversation(id: string): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction([CONVERSATIONS_STORE, MESSAGES_STORE], 'readwrite')
    
    // 删除对话
    const convStore = tx.objectStore(CONVERSATIONS_STORE)
    convStore.delete(id)
    
    // 删除相关消息
    const msgStore = tx.objectStore(MESSAGES_STORE)
    const index = msgStore.index('conversationId')
    const request = index.openCursor(IDBKeyRange.only(id))
    
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }
    
    tx.oncomplete = () => {
      console.log(`[AIChatStorage] Deleted conversation ${id} and its messages`)
      db.close()
      resolve()
    }
    
    tx.onerror = () => {
      reject(tx.error)
    }
  })
}

// ============================================================
// 消息操作
// ============================================================

/**
 * 保存消息到本地缓存
 */
export async function saveMessage(message: MessageRecord): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MESSAGES_STORE, 'readwrite')
    const store = tx.objectStore(MESSAGES_STORE)
    
    const request = store.put(message)
    
    request.onsuccess = () => {
      console.log(`[AIChatStorage] Saved message ${message.id}`)
      resolve()
    }
    
    request.onerror = () => {
      console.error('[AIChatStorage] Failed to save message:', request.error)
      reject(request.error)
    }
    
    tx.oncomplete = () => db.close()
  })
}

/**
 * 批量保存消息
 */
export async function saveMessages(messages: MessageRecord[]): Promise<void> {
  if (messages.length === 0) return
  
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MESSAGES_STORE, 'readwrite')
    const store = tx.objectStore(MESSAGES_STORE)
    
    for (const msg of messages) {
      store.put(msg)
    }
    
    tx.oncomplete = () => {
      console.log(`[AIChatStorage] Saved ${messages.length} messages`)
      db.close()
      resolve()
    }
    
    tx.onerror = () => {
      reject(tx.error)
    }
  })
}

/**
 * 获取对话的所有消息
 */
export async function getConversationMessages(conversationId: string): Promise<MessageRecord[]> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MESSAGES_STORE, 'readonly')
    const store = tx.objectStore(MESSAGES_STORE)
    const index = store.index('conversationId')
    const request = index.getAll(IDBKeyRange.only(conversationId))
    
    request.onsuccess = () => {
      const messages = (request.result || []).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
      console.log(`[AIChatStorage] Retrieved ${messages.length} messages for conversation ${conversationId}`)
      resolve(messages)
    }
    
    request.onerror = () => {
      reject(request.error)
    }
    
    tx.oncomplete = () => db.close()
  })
}

// ============================================================
// 同步辅助
// ============================================================

/**
 * 获取需要同步的对话（超过指定时间未同步）
 */
export async function getStaleConversations(maxAgeMs: number = 5 * 60 * 1000): Promise<ConversationRecord[]> {
  const cutoff = Date.now() - maxAgeMs
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONVERSATIONS_STORE, 'readonly')
    const store = tx.objectStore(CONVERSATIONS_STORE)
    const index = store.index('lastSyncAt')
    const range = IDBKeyRange.upperBound(cutoff)
    const request = index.getAll(range)
    
    request.onsuccess = () => {
      resolve(request.result || [])
    }
    
    request.onerror = () => {
      reject(request.error)
    }
    
    tx.oncomplete = () => db.close()
  })
}

/**
 * 清理所有缓存（用于登出）
 */
export async function clearAllAIChatCache(): Promise<void> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction([CONVERSATIONS_STORE, MESSAGES_STORE], 'readwrite')
    
    tx.objectStore(CONVERSATIONS_STORE).clear()
    tx.objectStore(MESSAGES_STORE).clear()
    
    tx.oncomplete = () => {
      console.log('[AIChatStorage] Cleared all AI chat cache')
      db.close()
      resolve()
    }
    
    tx.onerror = () => {
      reject(tx.error)
    }
  })
}

/**
 * 获取缓存统计信息
 */
export async function getCacheStats(): Promise<{ conversations: number; messages: number }> {
  const db = await openDB()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction([CONVERSATIONS_STORE, MESSAGES_STORE], 'readonly')
    let conversations = 0
    let messages = 0
    
    const convReq = tx.objectStore(CONVERSATIONS_STORE).count()
    convReq.onsuccess = () => {
      conversations = convReq.result
    }
    
    const msgReq = tx.objectStore(MESSAGES_STORE).count()
    msgReq.onsuccess = () => {
      messages = msgReq.result
    }
    
    tx.oncomplete = () => {
      db.close()
      resolve({ conversations, messages })
    }
    
    tx.onerror = () => {
      reject(tx.error)
    }
  })
}
