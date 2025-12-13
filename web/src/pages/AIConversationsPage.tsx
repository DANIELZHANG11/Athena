/**
 * AI 对话页面
 * 
 * 功能:
 * - 显示对话历史列表
 * - 新建对话
 * - AI 流式问答
 * - 离线支持：缓存对话列表到 IndexedDB
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Plus, Send, WifiOff, MessageSquare, Loader2 } from 'lucide-react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import api from '@/lib/api'
import {
  saveConversations,
  getCachedConversations,
  type ConversationRecord,
} from '@/lib/aiChatStorage'

export default function AIConversationsPage() {
  const { t } = useTranslation('common')
  const { isOnline } = useOnlineStatus()
  const [conversations, setConversations] = useState<ConversationRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [fromCache, setFromCache] = useState(false)
  
  // 当前对话状态
  const [text, setText] = useState('')
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [streaming, setStreaming] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  
  // 从缓存加载
  const loadFromCache = useCallback(async () => {
    try {
      const cached = await getCachedConversations()
      if (cached.length > 0) {
        setConversations(cached)
        setFromCache(true)
        console.log('[AIConversations] Loaded from cache:', cached.length, 'conversations')
        return true
      }
    } catch (error) {
      console.error('[AIConversations] Failed to load from cache:', error)
    }
    return false
  }, [])
  
  // 从服务器获取
  const fetchConversations = useCallback(async () => {
    try {
      const response = await api.get('/ai/conversations')
      const list: ConversationRecord[] = (response.data?.data || []).map((x: any) => ({
        id: x.id,
        title: x.title || t('ai.untitled_conversation', '未命名对话'),
        createdAt: x.created_at,
        updatedAt: x.updated_at || x.created_at,
      }))
      setConversations(list)
      setFromCache(false)
      
      // 缓存到 IndexedDB
      saveConversations(list).catch(err =>
        console.error('[AIConversations] Failed to cache:', err)
      )
      
      return list
    } catch (error) {
      console.error('[AIConversations] Failed to fetch:', error)
      return []
    }
  }, [t])
  
  // 初始加载 - 只在挂载时执行一次
  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await loadFromCache()
      // 使用 navigator.onLine 而不是 isOnline 状态，避免依赖问题
      if (navigator.onLine) {
        await fetchConversations()
      } else {
        console.log('[AIConversations] Offline mode, skipping API call')
      }
      setLoading(false)
    }
    init()
    
    return () => {
      esRef.current?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 只在挂载时执行，避免重复初始化
  
  // 网络恢复时刷新
  useEffect(() => {
    if (isOnline && fromCache) {
      console.log('[AIConversations] Network restored, refreshing...')
      fetchConversations()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]) // 只响应 isOnline 变化
  
  // 发送消息
  const handleSend = () => {
    if (!text.trim() || streaming || !isOnline) return
    
    const userMsg = text.trim()
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setText('')
    setStreaming(true)
    
    esRef.current?.close()
    const token = localStorage.getItem('access_token') || ''
    const url = `/api/v1/ai/stream?prompt=${encodeURIComponent(userMsg)}&access_token=${encodeURIComponent(token)}`
    const es = new EventSource(url)
    esRef.current = es
    
    let assistantContent = ''
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])
    
    es.onmessage = (ev) => {
      const d = ev.data
      if (d === 'BEGIN') return
      if (d === 'END') {
        es.close()
        setStreaming(false)
        return
      }
      assistantContent += d
      setMessages(prev => {
        const newMsgs = [...prev]
        newMsgs[newMsgs.length - 1] = { role: 'assistant', content: assistantContent }
        return newMsgs
      })
    }
    
    es.onerror = () => {
      es.close()
      setStreaming(false)
    }
  }
  
  return (
    <div className="h-full flex flex-col">
      {/* 离线提示 */}
      {!isOnline && (
        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-4 py-2">
          <WifiOff className="h-4 w-4" />
          <span>{t('common.offline_mode', '离线模式 - AI 功能需要联网')}</span>
        </div>
      )}
      
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b border-separator">
        <div className="flex items-center gap-2">
          <Bot className="h-6 w-6 text-system-blue" />
          <h1 className="text-xl font-semibold text-label">{t('ai.title', 'AI 助手')}</h1>
        </div>
      </div>
      
      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 对话列表侧边栏（桌面端） */}
        <div className="hidden md:flex w-64 flex-col border-r border-separator bg-secondary-background">
          <div className="p-3">
            <button
              onClick={() => {
                setSelectedId(null)
                setMessages([])
              }}
              disabled={!isOnline}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-system-blue text-white hover:bg-system-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="h-4 w-4" />
              <span>{t('ai.new_conversation', '新对话')}</span>
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-secondary-label" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-8 text-secondary-label text-sm">
                {t('ai.no_conversations', '暂无对话')}
              </div>
            ) : (
              conversations.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedId(conv.id)}
                  className={`w-full text-left px-3 py-2 border-b border-separator/50 hover:bg-tertiary-background transition-colors ${
                    selectedId === conv.id ? 'bg-tertiary-background' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-secondary-label flex-shrink-0" />
                    <span className="text-sm text-label truncate">{conv.title}</span>
                  </div>
                  <div className="text-xs text-tertiary-label mt-1 ml-6">
                    {new Date(conv.created_at || conv.createdAt).toLocaleDateString()}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
        
        {/* 对话区域 */}
        <div className="flex-1 flex flex-col">
          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-secondary-label">
                <Bot className="h-16 w-16 mb-4 opacity-50" />
                <p className="text-lg">{t('ai.welcome', '有什么我可以帮助你的？')}</p>
                <p className="text-sm mt-2">{t('ai.hint', '试着问我关于你书籍的问题')}</p>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                      msg.role === 'user'
                        ? 'bg-system-blue text-white'
                        : 'bg-secondary-background text-label'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content || (streaming && msg.role === 'assistant' ? '...' : '')}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          
          {/* 输入区域 */}
          <div className="p-4 border-t border-separator">
            <div className="flex items-center gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder={isOnline ? t('ai.prompt', '输入你的问题...') : t('ai.offline_hint', '联网后可使用 AI 功能')}
                disabled={!isOnline || streaming}
                className="flex-1 px-4 py-2 rounded-full bg-secondary-background text-label placeholder-tertiary-label focus:outline-none focus:ring-2 focus:ring-system-blue disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!text.trim() || !isOnline || streaming}
                className="p-2 rounded-full bg-system-blue text-white hover:bg-system-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {streaming ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}