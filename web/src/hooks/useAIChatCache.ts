/**
 * AI 对话缓存管理 Hook
 *
 * 说明：
 * - 对话与消息采用“缓存优先、在线更新”策略
 * - 在线时同步服务端并写入 IndexedDB；离线时使用本地只读缓存
 * - 提供删除与新消息缓存接口，便于流式对话持久化
 */
/**
 * useAIChatCache.ts
 * 
 * AI 对话缓存管理 Hook
 * 提供对话列表和消息的缓存优先加载策略
 */

import { useState, useCallback, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth'
import {
  saveConversations,
  saveMessages,
  getCachedConversations,
  getConversationMessages,
  deleteConversation as deleteCachedConversation,
  type ConversationRecord,
  type MessageRecord,
} from '@/lib/aiChatStorage'

interface UseAIChatCacheOptions {
  /** 是否自动加载对话列表 */
  autoLoad?: boolean
  /** 缓存过期时间（毫秒） */
  staleTime?: number
}

interface UseAIChatCacheReturn {
  /** 对话列表 */
  conversations: ConversationRecord[]
  /** 加载状态 */
  loading: boolean
  /** 错误信息 */
  error: string | null
  /** 是否来自缓存 */
  fromCache: boolean
  /** 刷新对话列表 */
  refreshConversations: () => Promise<void>
  /** 获取对话消息（缓存优先） */
  getMessages: (conversationId: string) => Promise<MessageRecord[]>
  /** 删除对话 */
  deleteConversation: (id: string) => Promise<void>
  /** 缓存新消息（流式响应后调用） */
  cacheNewMessage: (message: MessageRecord) => Promise<void>
}

/**
 * AI 对话缓存管理 Hook
 */
export function useAIChatCache(options: UseAIChatCacheOptions = {}): UseAIChatCacheReturn {
  const { autoLoad = true, staleTime = 5 * 60 * 1000 } = options
  const [conversations, setConversations] = useState<ConversationRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [lastFetchTime, setLastFetchTime] = useState<number>(0)

  // 从服务器加载对话列表
  const fetchFromServer = useCallback(async (): Promise<ConversationRecord[]> => {
    const token = useAuthStore.getState().accessToken
    if (!token) throw new Error('Not authenticated')

    const res = await fetch('/api/v1/ai/conversations', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error('Failed to fetch conversations')

    const data = await res.json()
    return (data.items || data.data || []).map((item: any) => ({
      id: item.id,
      title: item.title,
      createdAt: item.created_at || item.createdAt,
      updatedAt: item.updated_at || item.updatedAt || item.created_at || item.createdAt,
      mode: item.mode,
      bookIds: item.book_ids || item.bookIds,
    }))
  }, [])

  // 加载对话列表（缓存优先策略）
  const refreshConversations = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // 1. 先尝试从缓存加载
      const cached = await getCachedConversations()
      if (cached.length > 0) {
        setConversations(cached)
        setFromCache(true)
        console.log('[useAIChatCache] Loaded from cache:', cached.length)
      }

      // 2. 检查是否需要从服务器刷新
      const now = Date.now()
      const shouldFetch = now - lastFetchTime > staleTime || cached.length === 0

      if (shouldFetch && navigator.onLine) {
        try {
          const serverData = await fetchFromServer()
          setConversations(serverData)
          setFromCache(false)
          setLastFetchTime(now)
          
          // 3. 更新缓存
          await saveConversations(serverData)
          console.log('[useAIChatCache] Synced from server:', serverData.length)
        } catch (fetchError) {
          console.warn('[useAIChatCache] Server fetch failed, using cache:', fetchError)
          // 如果服务器请求失败但有缓存，继续使用缓存
          if (cached.length === 0) {
            throw fetchError
          }
        }
      }
    } catch (e: any) {
      setError(e.message)
      console.error('[useAIChatCache] Error:', e)
    } finally {
      setLoading(false)
    }
  }, [fetchFromServer, lastFetchTime, staleTime])

  // 获取对话消息（缓存优先）
  const getMessages = useCallback(async (conversationId: string): Promise<MessageRecord[]> => {
    // 1. 先尝试从缓存加载
    const cached = await getConversationMessages(conversationId)
    
    // 2. 如果有网络，从服务器获取最新消息
    if (navigator.onLine) {
      try {
        const token = useAuthStore.getState().accessToken
        const res = await fetch(`/api/v1/ai/conversations/${conversationId}/messages`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const data = await res.json()
          const messages: MessageRecord[] = (data.items || data.data || data.messages || []).map((m: any) => ({
            id: m.id,
            conversationId,
            role: m.role,
            content: m.content,
            createdAt: m.created_at || m.createdAt,
            metadata: m.metadata,
          }))
          
          // 更新缓存
          if (messages.length > 0) {
            await saveMessages(messages)
          }
          return messages
        }
      } catch (e) {
        console.warn('[useAIChatCache] Failed to fetch messages from server:', e)
      }
    }
    
    return cached
  }, [])

  // 删除对话
  const deleteConversation = useCallback(async (id: string) => {
    // 先从服务器删除
    if (navigator.onLine) {
      const token = useAuthStore.getState().accessToken
      const res = await fetch(`/api/v1/ai/conversations/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        throw new Error('Failed to delete conversation')
      }
    }
    
    // 从缓存删除
    await deleteCachedConversation(id)
    
    // 更新状态
    setConversations(prev => prev.filter(c => c.id !== id))
  }, [])

  // 缓存新消息
  const cacheNewMessage = useCallback(async (message: MessageRecord) => {
    await saveMessages([message])
  }, [])

  // 自动加载
  useEffect(() => {
    if (autoLoad) {
      refreshConversations()
    }
  }, [autoLoad, refreshConversations])

  return {
    conversations,
    loading,
    error,
    fromCache,
    refreshConversations,
    getMessages,
    deleteConversation,
    cacheNewMessage,
  }
}
