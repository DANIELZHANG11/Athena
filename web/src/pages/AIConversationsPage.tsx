/**
 * AI 对话页面 (Gemini 风格) - 完全重写
 *
 * 设计参考: F:\reader\Athena\GEMINI对话视图效果
 *
 * 功能:
 * - 全屏沉浸式体验 (隐藏底部导航栏)
 * - 左上角汉堡菜单 (侧边抽屉: 新建对话 + 历史搜索)
 * - 右上角主页按钮 (返回个人主页 /home)
 * - 底部工具栏: 输入框在上, 四个图标在下
 * - 书籍/书架多选 (支持搜索过滤)
 * - AI 模型选择
 * - 普通聊天/书籍对话模式切换
 * - 动效: 所有交互都有平滑动画
 *
 * @see 06 - UIUX设计系统.md
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import {
  Menu,
  Home,
  Plus,
  Send,
  WifiOff,
  Loader2,
  Search,
  Trash2,
  StopCircle,
  Sparkles,
  Library,
  Book,
  MessageCircle,
  Check,
  X,
  Cpu,
  BookOpen,
  MessagesSquare,
  Copy,
  RefreshCw,
  Pencil,
} from 'lucide-react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import api, { getFullApiUrl } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import {
  saveConversations,
  getCachedConversations,
} from '@/lib/aiChatStorage'
import { CitationModal, type Citation } from '@/components/ai'
import { toast } from 'sonner'

// ============================================================================
// Types
// ============================================================================

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at?: string
  citations?: Citation[]  // QA模式下的引用信息
}

interface Conversation {
  id: string
  title: string
  mode: 'chat' | 'qa'
  book_ids: string[]
  shelf_ids: string[]
  model_id?: string
  created_at?: string
  updated_at?: string
  messages?: Message[]
}

interface BookItem {
  id: string
  title: string
  author?: string
}

interface ShelfItem {
  id: string
  name: string
  book_count?: number
}

interface AIModel {
  id: string
  name: string
  display_name: string
  provider: string
}

// ============================================================================
// Animation Styles
// ============================================================================

const animations = {
  fadeIn: 'animate-in fade-in duration-300',
  slideUp: 'animate-in slide-in-from-bottom-4 duration-300',
  slideLeft: 'animate-in slide-in-from-left duration-300',
  scaleIn: 'animate-in zoom-in-95 duration-200',
}

// ============================================================================
// Sub Components
// ============================================================================

/**
 * 消息气泡组件
 * 按照 06号设计文档规范:
 * - AI 消息: 左侧显示雅典娜 Logo + 紫色背景
 * - 用户消息: 右侧显示蓝色背景白色文字
 * - 加载中: AI 头像有旋转动效
 * - AI回复支持复制、重新生成功能
 * - 用户消息支持编辑功能
 */
function MessageBubble({
  message,
  isStreaming,
  isLastAssistant,
  onCitationClick,
  onRegenerate,
  onEditMessage,
}: {
  message: Message
  isStreaming?: boolean
  isLastAssistant?: boolean // 是否是最后一条AI消息
  onCitationClick?: (citation: Citation) => void
  onRegenerate?: () => void // 重新生成回调
  onEditMessage?: (messageId: string, newContent: string) => void // 编辑消息回调
}) {
  const { t } = useTranslation()
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)

  // 复制消息内容
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      toast.success(t('ai.copied'))
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
      toast.error(t('ai.copy_failed'))
    }
  }

  // 提交编辑
  const handleSubmitEdit = () => {
    if (editContent.trim() && editContent !== message.content) {
      onEditMessage?.(message.id, editContent.trim())
    }
    setIsEditing(false)
  }

  // 取消编辑
  const handleCancelEdit = () => {
    setEditContent(message.content)
    setIsEditing(false)
  }

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} group ${animations.fadeIn}`}
    >
      {/* AI 头像 - 使用雅典娜 Logo */}
      {!isUser && (
        <div className="shrink-0 mr-3 transition-transform duration-200 group-hover:scale-110">
          <div className={`w-8 h-8 rounded-full bg-linear-to-br from-system-purple to-system-blue 
            flex items-center justify-center shadow-lg overflow-hidden
            ${isStreaming ? 'animate-pulse ring-2 ring-system-purple ring-offset-2' : ''}`}
          >
            <img
              src="/logosvg.png"
              alt="Athena"
              className="w-6 h-6 object-contain"
              onError={(e) => {
                // 回退到 Sparkles 图标
                e.currentTarget.style.display = 'none'
                e.currentTarget.nextElementSibling?.classList.remove('hidden')
              }}
            />
            <Sparkles className="w-4 h-4 text-primary-foreground hidden" />
          </div>
        </div>
      )}

      {/* 消息内容 */}
      <div className="flex flex-col max-w-[80%]">
        <div
          className={`rounded-2xl px-4 py-3 transition-all duration-200 hover:shadow-md ${isUser
            ? 'bg-system-blue shadow-md'
            : 'bg-secondary-background'
            }`}
        >
          {isUser ? (
            isEditing ? (
              /* 用户消息编辑模式 */
              <div className="flex flex-col gap-2">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full min-h-16 bg-system-blue/20 text-primary-foreground rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-system-blue/50"
                  autoFocus
                  aria-label={t('ai.edit_message')}
                  placeholder={t('ai.edit_message_placeholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSubmitEdit()
                    } else if (e.key === 'Escape') {
                      handleCancelEdit()
                    }
                  }}
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={handleCancelEdit}
                    className="px-3 py-1 text-xs text-primary-foreground/70 hover:text-primary-foreground rounded-lg transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleSubmitEdit}
                    className="px-3 py-1 text-xs bg-system-blue/30 hover:bg-system-blue/40 text-primary-foreground rounded-lg transition-colors"
                  >
                    {t('ai.save_and_resubmit')}
                  </button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-primary-foreground">{message.content}</p>
            )
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none text-label 
              prose-headings:text-label prose-p:text-label prose-strong:text-label
              prose-code:text-system-purple prose-code:bg-tertiary-background prose-code:px-1 prose-code:py-0.5 prose-code:rounded
              prose-pre:bg-tertiary-background prose-pre:border prose-pre:border-separator
              prose-table:border-collapse prose-th:bg-tertiary-background prose-th:border prose-th:border-separator prose-th:px-3 prose-th:py-2
              prose-td:border prose-td:border-separator prose-td:px-3 prose-td:py-2
              prose-a:text-system-purple prose-a:no-underline hover:prose-a:underline">
              {message.content ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    // 自定义代码块渲染
                    pre: ({ children, ...props }) => (
                      <pre className="relative overflow-x-auto" {...props}>
                        {children}
                      </pre>
                    ),
                    // 自定义链接在新标签页打开
                    a: ({ children, ...props }) => (
                      <a target="_blank" rel="noopener noreferrer" {...props}>
                        {children}
                      </a>
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              ) : isStreaming ? (
                /* 等待响应时的加载状态 */
                <div className="flex items-center gap-2 text-secondary-label">
                  <Loader2 className="w-4 h-4 animate-spin text-system-purple" />
                  <span>{t('ai.thinking')}</span>
                </div>
              ) : null}
              {/* 流式响应时的闪烁光标 */}
              {isStreaming && message.content && (
                <span className="inline-block w-2 h-4 ml-1 bg-system-purple animate-pulse rounded-sm" />
              )}
            </div>
          )}
        </div>

        {/* 来源引用卡片 (Card Style) */}
        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="mt-4 pt-3 border-t border-separator">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-system-purple" />
              <span className="text-xs font-medium text-secondary-label">{t('ai.sources')}</span>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {message.citations.slice(0, 5).map((citation) => (
                <div
                  key={citation.index}
                  onClick={() => onCitationClick?.(citation)}
                  className="bg-tertiary-background hover:bg-secondary-background 
                    border border-transparent hover:border-system-purple/30
                    rounded-xl p-3 cursor-pointer transition-all duration-200 group/card
                    hover:shadow-md hover:scale-[1.01] active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="flex items-center justify-center w-4 h-4 rounded-full bg-system-purple/10 text-[10px] font-bold text-system-purple">
                          {citation.index}
                        </span>
                        <h4 className="text-sm font-medium text-label truncate">
                          {citation.book_title || t('ai.unknown_book')}
                        </h4>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-secondary-label">
                        {citation.chapter && (
                          <span className="truncate max-w-[120px]" title={citation.chapter}>
                            {citation.chapter}
                          </span>
                        )}
                        {citation.page && (
                          <>
                            <span className="w-0.5 h-0.5 rounded-full bg-secondary-label" />
                            <span>{t('ai.page_num', { num: citation.page })}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 引用预览文摘 */}
                  {citation.preview && (
                    <div className="mt-2 text-xs text-secondary-label line-clamp-2 leading-relaxed opacity-80 group-hover/card:opacity-100 transition-opacity">
                      {citation.preview}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI 消息操作按钮栏 - 始终可见 */}
        {!isUser && message.content && !isStreaming && (
          <div className="flex items-center gap-1 mt-2 justify-end">
            {/* 复制按钮 */}
            <button
              onClick={handleCopy}
              className="p-1.5 text-secondary-label hover:text-label hover:bg-secondary-background rounded-lg transition-all"
              title={t('ai.copy')}
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-system-green" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
            {/* 重新生成按钮 - 仅对最后一条AI消息显示 */}
            {isLastAssistant && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="p-1.5 text-secondary-label hover:text-label hover:bg-secondary-background rounded-lg transition-all"
                title={t('ai.regenerate')}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* 用户消息操作按钮栏 - 始终可见 */}
        {isUser && !isEditing && onEditMessage && (
          <div className="flex items-center gap-1 mt-2 justify-end">
            <button
              onClick={() => setIsEditing(true)}
              className="p-1.5 text-primary-foreground/60 hover:text-primary-foreground hover:bg-system-blue/20 rounded-lg transition-all"
              title={t('ai.edit_message')}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 侧边抽屉组件 (汉堡菜单)
 */
function SideDrawer({
  isOpen,
  onClose,
  conversations,
  selectedId,
  onSelect,
  onNewChat,
  onDelete,
}: {
  isOpen: boolean
  onClose: () => void
  conversations: Conversation[]
  selectedId: string | null
  onSelect: (id: string) => void
  onNewChat: () => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations
    const q = searchQuery.toLowerCase()
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages?.some((m) => m.content.toLowerCase().includes(q))
    )
  }, [conversations, searchQuery])

  // 按日期分组
  const groupedConversations = useMemo(() => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const thisWeek = new Date(today)
    thisWeek.setDate(thisWeek.getDate() - 7)

    const groups: { label: string; items: Conversation[] }[] = [
      { label: t('ai.today'), items: [] },
      { label: t('ai.yesterday'), items: [] },
      { label: t('ai.this_week'), items: [] },
      { label: t('ai.earlier'), items: [] },
    ]

    filteredConversations.forEach((c) => {
      const date = new Date(c.updated_at || c.created_at || '')
      if (date.toDateString() === today.toDateString()) {
        groups[0].items.push(c)
      } else if (date.toDateString() === yesterday.toDateString()) {
        groups[1].items.push(c)
      } else if (date > thisWeek) {
        groups[2].items.push(c)
      } else {
        groups[3].items.push(c)
      }
    })

    return groups.filter((g) => g.items.length > 0)
  }, [filteredConversations, t])

  if (!isOpen) return null

  return (
    <>
      {/* 遮罩层 - 轻微半透明，不遮挡主内容 */}
      <div
        className={`fixed inset-0 bg-black/10 z-40 ${animations.fadeIn}`}
        onClick={onClose}
      />

      {/* 抽屉 - 白色毛玻璃效果 + 右侧圆角 */}
      <div
        className={`fixed left-0 top-0 bottom-0 w-80 bg-tertiary-background/80 backdrop-blur-xl 
          border-r border-separator shadow-2xl z-50 rounded-r-2xl ${animations.slideLeft}`}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-separator">
          <h2 className="text-lg font-semibold text-label">
            {t('ai.conversations')}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-secondary-background transition-colors"
            title={t('common.close')}
          >
            <X className="w-5 h-5 text-secondary-label" />
          </button>
        </div>

        {/* 新建对话按钮 */}
        <div className="p-4">
          <button
            onClick={() => {
              onNewChat()
              onClose()
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 
              bg-system-purple rounded-full font-medium
              hover:opacity-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]
              shadow-lg hover:shadow-xl"
          >
            <Plus className="w-5 h-5 text-primary-foreground" />
            <span className="text-primary-foreground">{t('ai.new_conversation')}</span>
          </button>
        </div>

        {/* 搜索框 */}
        <div className="px-4 pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-label" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('ai.search_conversations')}
              className="w-full pl-10 pr-4 py-2.5 bg-tertiary-background rounded-xl
                border-none outline-none text-label placeholder:text-secondary-label
                focus:ring-2 ring-system-purple/50 transition-all duration-200"
            />
          </div>
        </div>

        {/* 对话列表 */}
        <div className="flex-1 overflow-y-auto px-2">
          {groupedConversations.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="px-2 py-1 text-xs font-medium text-secondary-label uppercase tracking-wider">
                {group.label}
              </div>
              {group.items.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => {
                    onSelect(conv.id)
                    onClose()
                  }}
                  className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer
                    transition-all duration-200 hover:bg-secondary-background
                    ${selectedId === conv.id ? 'bg-system-purple/10' : ''}`}
                >
                  <MessageCircle className="w-4 h-4 text-secondary-label shrink-0" />
                  <span className="flex-1 text-sm text-label truncate">
                    {conv.title || t('ai.untitled')}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(conv.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full 
                      hover:bg-system-red/10 transition-all duration-200"
                    title={t('common.delete')}
                  >
                    <Trash2 className="w-4 h-4 text-system-red" />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

/**
 * 选择器下拉菜单 (书籍/书架/模型)
 * 自动检测视口边界，智能调整位置避免超出屏幕
 */
function SelectorDropdown<T extends { id: string }>({
  isOpen,
  onClose,
  items,
  selectedIds,
  onToggle,
  searchPlaceholder,
  renderItem,
  multiSelect = true,
  position = 'bottom',
}: {
  isOpen: boolean
  onClose: () => void
  items: T[]
  selectedIds: string[]
  onToggle: (id: string) => void
  searchPlaceholder: string
  renderItem: (item: T) => React.ReactNode
  multiSelect?: boolean
  position?: 'bottom' | 'top'
}) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [adjustedPosition, setAdjustedPosition] = useState<{
    vertical: 'top' | 'bottom'
    horizontal: 'left' | 'right' | 'center'
  }>({ vertical: position === 'top' ? 'top' : 'bottom', horizontal: 'left' })

  const filteredItems = useMemo(() => {
    // 确保 items 是数组
    const safeItems = Array.isArray(items) ? items : []
    if (!searchQuery.trim()) return safeItems
    const q = searchQuery.toLowerCase()
    return safeItems.filter((item) =>
      JSON.stringify(item).toLowerCase().includes(q)
    )
  }, [items, searchQuery])

  // 智能检测位置并调整
  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const padding = 16 // 距离边缘的安全距离

      let newHorizontal: 'left' | 'right' | 'center' = 'left'
      let newVertical: 'top' | 'bottom' = position === 'top' ? 'top' : 'bottom'

      // 检测水平方向溢出
      if (rect.right > viewportWidth - padding) {
        // 右侧溢出，改为右对齐
        newHorizontal = 'right'
      } else if (rect.left < padding) {
        // 左侧溢出，改为居中或左对齐
        newHorizontal = 'center'
      }

      // 检测垂直方向溢出
      if (position === 'top' && rect.top < padding) {
        // 上方空间不足，改为向下展开
        newVertical = 'bottom'
      } else if (position === 'bottom' && rect.bottom > viewportHeight - padding) {
        // 下方空间不足，改为向上展开
        newVertical = 'top'
      }

      setAdjustedPosition({ vertical: newVertical, horizontal: newHorizontal })
    }
  }, [isOpen, position])

  useEffect(() => {
    if (isOpen) {
      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as HTMLElement
        // 如果点击的是下拉菜单内的元素，不关闭
        if (target.closest('[data-dropdown-item]')) {
          return
        }
        if (
          dropdownRef.current &&
          !dropdownRef.current.contains(target)
        ) {
          onClose()
        }
      }
      // 使用 setTimeout 延迟添加监听器，避免立即触发
      const timer = setTimeout(() => {
        document.addEventListener('click', handleClickOutside)
      }, 0)
      return () => {
        clearTimeout(timer)
        document.removeEventListener('click', handleClickOutside)
      }
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  // 根据调整后的位置计算样式类
  const getPositionClasses = () => {
    const classes: string[] = []
    
    // 垂直定位
    if (adjustedPosition.vertical === 'top') {
      classes.push('bottom-full mb-2')
    } else {
      classes.push('top-full mt-2')
    }
    
    // 水平定位
    if (adjustedPosition.horizontal === 'right') {
      classes.push('right-0')
    } else if (adjustedPosition.horizontal === 'center') {
      classes.push('left-1/2 -translate-x-1/2')
    } else {
      classes.push('left-0')
    }
    
    return classes.join(' ')
  }

  return (
    <div
      ref={dropdownRef}
      data-dropdown-item="true"
      className={`absolute ${getPositionClasses()} w-72 max-h-64
        bg-tertiary-background/80 backdrop-blur-xl border border-separator
        shadow-2xl overflow-hidden z-100 rounded-2xl ${animations.scaleIn}`}
    >
      {/* 搜索框 */}
      <div className="p-3 border-b border-separator" data-dropdown-item="true">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-label" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-10 pr-4 py-2 bg-tertiary-background rounded-lg
              border-none outline-none text-sm text-label placeholder:text-secondary-label
              focus:ring-2 ring-system-purple/50 transition-all duration-200"
            autoFocus
            data-dropdown-item="true"
          />
        </div>
      </div>

      {/* 列表 */}
      <div className="max-h-60 overflow-y-auto" data-dropdown-item="true">
        {filteredItems.length === 0 ? (
          <div className="p-4 text-center text-secondary-label text-sm">
            {t('ai.no_match')}
          </div>
        ) : (
          filteredItems.map((item) => {
            const isSelected = selectedIds.includes(item.id)
            return (
              <div
                key={item.id}
                data-dropdown-item="true"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onToggle(item.id)
                  if (!multiSelect) onClose()
                }}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none
                  transition-all duration-150 hover:bg-secondary-background
                  ${isSelected ? 'bg-system-purple/10' : ''}`}
              >
                {multiSelect && (
                  <div
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center
                    transition-all duration-200
                    ${isSelected ? 'bg-system-purple border-system-purple' : 'border-secondary-label'}`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                  </div>
                )}
                <div className="flex-1">{renderItem(item)}</div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/**
 * 工具栏按钮
 */
function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  isActive,
  badge,
  disabled,
}: {
  icon: React.ElementType
  label: string
  onClick: () => void
  isActive?: boolean
  badge?: number
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium
        transition-all duration-200 hover:scale-105 active:scale-95
        ${isActive
          ? 'bg-system-purple/15 text-system-purple'
          : 'bg-secondary-background text-secondary-label hover:text-label'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      title={label}
    >
      <Icon className="w-4 h-4" />
      <span className="hidden sm:inline">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1.5 
          bg-system-purple text-primary-foreground text-xs font-bold rounded-full
          flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export default function AIConversationsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isOnline = useOnlineStatus()
  const { accessToken, user } = useAuthStore()

  // 从 URL 参数获取初始模式和书籍 ID（来自阅读器的跳转）
  const initialMode = searchParams.get('mode') as 'chat' | 'qa' | null
  const initialBookId = searchParams.get('bookId')

  // UI 状态
  const [sideDrawerOpen, setSideDrawerOpen] = useState(false)
  const [bookSelectorOpen, setBookSelectorOpen] = useState(false)
  const [shelfSelectorOpen, setShelfSelectorOpen] = useState(false)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)

  // 引用弹窗状态
  const [citationModalOpen, setCitationModalOpen] = useState(false)
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null)

  // 对话状态
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)

  // 选择状态 - 根据 URL 参数初始化
  const [chatMode, setChatMode] = useState<'chat' | 'qa'>(initialMode || 'chat')
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>(initialBookId ? [initialBookId] : [])
  const [selectedShelfIds, setSelectedShelfIds] = useState<string[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string>('deepseek-v3')

  // 数据
  const [books, setBooks] = useState<BookItem[]>([])
  const [shelves, setShelves] = useState<ShelfItem[]>([])
  const [models] = useState<AIModel[]>([
    { id: 'deepseek-v3', name: 'DeepSeek V3.2', display_name: 'DeepSeek V3.2', provider: 'siliconflow' },
    { id: 'hunyuan-mt', name: 'Hunyuan MT 7B', display_name: 'Hunyuan MT 7B', provider: 'siliconflow' },
  ])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // 获取当前对话标题
  const currentTitle = useMemo(() => {
    if (!selectedId) {
      return t('ai.athena_title')
    }
    const conv = conversations.find((c) => c.id === selectedId)
    return conv?.title || t('ai.athena_title')
  }, [selectedId, conversations, t])

  // 获取选中的模型名称
  const selectedModelName = useMemo(() => {
    const model = models.find((m) => m.id === selectedModelId)
    return model?.display_name || 'AI'
  }, [selectedModelId, models])

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // 加载对话列表
  const fetchConversations = useCallback(async () => {
    try {
      const cached = await getCachedConversations()
      if (cached.length > 0) {
        setConversations(
          cached.map((c) => ({
            id: c.id,
            title: c.title || '',
            mode: 'chat' as const,
            book_ids: [],
            shelf_ids: [],
            created_at: c.created_at,
            updated_at: c.updated_at,
          }))
        )
      }

      if (isOnline) {
        const response = await api.get('/ai/conversations')
        const data = response.data?.data || []
        setConversations(data)
        saveConversations(
          data.map((c: Conversation) => ({
            id: c.id,
            title: c.title,
            mode: c.mode,
            book_ids: c.book_ids,
            created_at: c.created_at || new Date().toISOString(),
            updated_at: c.updated_at || new Date().toISOString(),
            createdAt: c.created_at || new Date().toISOString(),
            updatedAt: c.updated_at || new Date().toISOString(),
          }))
        )
      }
    } catch (error) {
      console.error('[AI] Failed to fetch conversations:', error)
    }
  }, [isOnline])



  // 加载可用模型 - 暂时注释掉，使用固定列表
  // const fetchModels = useCallback(async () => {
  //   try {
  //     const response = await api.get('/ai/models')
  //     if (response.data?.data?.length > 0) {
  //       setModels(response.data.data)
  //       setSelectedModelId(response.data.data[0].id)
  //     }
  //   } catch (error) {
  //     console.error('[AI] Failed to fetch models:', error)
  //   }
  // }, [])

  // 初始化加载 - 只在组件挂载时执行一次
  useEffect(() => {
    const init = async () => {
      try {
        // 尝试从缓存加载对话
        const cached = await getCachedConversations()
        if (cached.length > 0) {
          setConversations(
            cached.map((c) => ({
              id: c.id,
              title: c.title || '',
              mode: (c.mode as 'chat' | 'qa') || 'chat',
              book_ids: c.book_ids || [],
              shelf_ids: [],
              created_at: c.created_at,
              updated_at: c.updated_at,
            }))
          )
        }

        // 如果在线，从服务器获取最新数据
        if (isOnline) {
          const [convRes, booksRes, shelvesRes] = await Promise.all([
            api.get('/ai/conversations').catch(() => ({ data: { data: [] } })),
            api.get('/books/?limit=100').catch(() => ({ data: { data: [] } })),
            api.get('/shelves/').catch(() => ({ data: { data: [] } })),
          ])

          const convData = convRes.data?.data || []
          setConversations(Array.isArray(convData) ? convData : [])

          const booksPayload = booksRes.data?.data
          const booksData = Array.isArray(booksPayload) ? booksPayload : (booksPayload?.items || [])
          setBooks(Array.isArray(booksData) ? booksData : [])

          const shelvesPayload = shelvesRes.data?.data
          const shelvesData = Array.isArray(shelvesPayload) ? shelvesPayload : (shelvesPayload?.items || [])
          setShelves(Array.isArray(shelvesData) ? shelvesData : [])

          // 缓存对话
          if (convData.length > 0) {
            saveConversations(
              convData.map((c: Conversation) => ({
                id: c.id,
                title: c.title,
                mode: c.mode,
                book_ids: c.book_ids,
                created_at: c.created_at || new Date().toISOString(),
                updated_at: c.updated_at || new Date().toISOString(),
                createdAt: c.created_at || new Date().toISOString(),
                updatedAt: c.updated_at || new Date().toISOString(),
              }))
            )
          }

          // 处理从阅读器跳转来的 URL 参数（mode 和 bookId）
          const urlMode = searchParams.get('mode') as 'chat' | 'qa' | null
          const urlBookId = searchParams.get('bookId')
          
          if (urlMode === 'qa' && urlBookId) {
            // 验证书籍是否存在于用户的书库中
            const bookExists = booksData.some((b: BookItem) => b.id === urlBookId)
            if (bookExists) {
              setChatMode('qa')
              setSelectedBookIds([urlBookId])
              console.log('[AI] Initialized from reader with book QA mode, bookId:', urlBookId)
            }
            // 清除 URL 参数，避免刷新时重复设置
            setSearchParams({}, { replace: true })
          }
        }
      } catch (error) {
        console.error('[AI] Init failed:', error)
      }
    }

    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 空依赖：只在挂载时执行一次

  // 加载对话消息
  const fetchMessages = useCallback(
    async (conversationId: string) => {
      try {
        const response = await api.get(`/ai/conversations/${conversationId}`)
        const data = response.data?.data
        if (data?.messages) {
          setMessages(data.messages)
        }
        if (data?.mode) {
          setChatMode(data.mode)
        }
        if (data?.book_ids) {
          setSelectedBookIds(data.book_ids)
        }
      } catch (error) {
        console.error('[AI] Failed to fetch messages:', error)
      }
    },
    []
  )

  // 标记是否是刚刚创建的新对话，避免立即拉取消息覆盖本地状态
  const isNewConversationRef = useRef(false)

  useEffect(() => {
    if (selectedId) {
      // 如果是刚刚创建的新对话，不要拉取消息，因为消息已经在本地状态中
      if (isNewConversationRef.current) {
        isNewConversationRef.current = false
        return
      }
      fetchMessages(selectedId)
    } else {
      setMessages([])
    }
  }, [selectedId, fetchMessages])

  // 新建对话
  const handleNewChat = useCallback(() => {
    setSelectedId(null)
    setMessages([])
    setChatMode('chat')
    setSelectedBookIds([])
    setSelectedShelfIds([])
    inputRef.current?.focus()
  }, [])

  // 删除对话
  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await api.delete(`/ai/conversations/${id}`)
        setConversations((prev) => prev.filter((c) => c.id !== id))
        if (selectedId === id) {
          handleNewChat()
        }
      } catch (error) {
        console.error('[AI] Failed to delete conversation:', error)
      }
    },
    [selectedId, handleNewChat]
  )

  // 切换书籍选择
  const handleToggleBook = useCallback((bookId: string) => {
    setSelectedBookIds((prev) =>
      prev.includes(bookId)
        ? prev.filter((id) => id !== bookId)
        : [...prev, bookId]
    )
  }, [])

  // 切换书架选择
  const handleToggleShelf = useCallback((shelfId: string) => {
    setSelectedShelfIds((prev) =>
      prev.includes(shelfId)
        ? prev.filter((id) => id !== shelfId)
        : [...prev, shelfId]
    )
  }, [])

  // 切换模式
  const handleToggleMode = useCallback(() => {
    setChatMode((prev) => (prev === 'chat' ? 'qa' : 'chat'))
  }, [])

  // 发送消息
  const handleSend = useCallback(async () => {
    if (!input.trim() || streaming || !isOnline) return

    let conversationId = selectedId

    // 创建新对话
    if (!conversationId) {
      try {
        const response = await api.post('/ai/conversations', {
          title: '',
          mode: chatMode,
          book_ids: selectedBookIds,
          shelf_ids: selectedShelfIds,
          model_id: selectedModelId,
        })
        conversationId = response.data?.data?.id
        if (conversationId) {
          // 标记为新对话，避免 useEffect 立即拉取消息覆盖本地状态
          isNewConversationRef.current = true
          setSelectedId(conversationId)
          // 后台刷新对话列表，不 await 避免阻塞消息发送
          fetchConversations()
        }
      } catch (error) {
        console.error('[AI] Failed to create conversation:', error)
        return
      }
    }

    if (!conversationId) return

    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: input.trim(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    console.log('[AI SSE] Setting streaming to true')
    setStreaming(true)

    // 创建 AI 消息占位
    const assistantMessage: Message = {
      id: `temp-assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
    }
    setMessages((prev) => [...prev, assistantMessage])

    // SSE 流式请求
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      const url = getFullApiUrl(`/api/v1/ai/conversations/${conversationId}/messages`)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          content: userMessage.content,
          mode: chatMode,
          book_ids: selectedBookIds,
          shelf_ids: selectedShelfIds,
          model_id: selectedModelId,
        }),
        signal: abortController.signal,
      })

      console.log('[AI SSE] Fetch response:', { ok: response.ok, status: response.status, headers: Object.fromEntries(response.headers.entries()) })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''
      let assistantCitations: Citation[] = []
      let sseBuffer = '' // 用于处理SSE消息被切断的情况

      console.log('[AI SSE] Starting to read stream, reader:', !!reader)

      if (reader) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read()
          console.log('[AI SSE] Read chunk:', { done, hasValue: !!value, valueLength: value?.length })
          if (done) break

          const text = decoder.decode(value, { stream: true })
          console.log('[AI SSE] Decoded text:', text.substring(0, 200))
          sseBuffer += text

          // SSE消息以 \n\n 分隔
          const messages = sseBuffer.split('\n\n')
          // 最后一个可能是不完整的消息，保留在缓冲区
          sseBuffer = messages.pop() || ''
          console.log('[AI SSE] Split messages count:', messages.length)

          for (const message of messages) {
            const lines = message.split('\n')
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue

              try {
                const data = JSON.parse(line.slice(6))

                if (data.type === 'delta' && data.content) {
                  assistantContent += data.content
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessage.id
                        ? { ...m, content: assistantContent }
                        : m
                    )
                  )
                }

                // 处理引用信息（QA模式）
                if (data.type === 'citations' && data.citations) {
                  assistantCitations = data.citations
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessage.id
                        ? { ...m, citations: assistantCitations }
                        : m
                    )
                  )
                }

                if (data.type === 'done') {
                  // 更新对话标题（如果是新对话）
                  if (data.title) {
                    setConversations((prev) =>
                      prev.map((c) =>
                        c.id === conversationId ? { ...c, title: data.title } : c
                      )
                    )
                  }
                }
              } catch {
                // 忽略解析错误，可能是不完整的JSON
              }
            }
          }
        }
      }
    } catch (error: unknown) {
      if ((error as Error).name !== 'AbortError') {
        console.error('[AI SSE] Streaming failed:', error)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessage.id
              ? { ...m, content: t('ai.error_occurred') }
              : m
          )
        )
      }
    } finally {
      console.log('[AI SSE] Stream finished, setting streaming to false')
      setStreaming(false)
      abortControllerRef.current = null
    }
  }, [
    input,
    streaming,
    isOnline,
    selectedId,
    chatMode,
    selectedBookIds,
    selectedShelfIds,
    selectedModelId,
    accessToken,
    fetchConversations,
    t,
  ])

  // 停止生成
  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort()
    setStreaming(false)
  }, [])

  // 重新生成最后一条AI回复
  const handleRegenerate = useCallback(async () => {
    if (streaming || !isOnline || !selectedId || messages.length < 2) return

    // 找到最后一条用户消息
    let lastUserMessageIndex = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMessageIndex = i
        break
      }
    }

    if (lastUserMessageIndex === -1) return

    const lastUserMessage = messages[lastUserMessageIndex]
    
    // 移除最后一条AI消息
    setMessages((prev) => {
      const newMessages = [...prev]
      // 从最后一条用户消息之后的所有消息都删除
      return newMessages.slice(0, lastUserMessageIndex + 1)
    })

    // 重新发送用户消息
    setStreaming(true)

    const assistantMessage: Message = {
      id: `temp-assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
    }
    setMessages((prev) => [...prev, assistantMessage])

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      const url = getFullApiUrl(`/api/v1/ai/conversations/${selectedId}/messages`)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          content: lastUserMessage.content,
          mode: chatMode,
          book_ids: selectedBookIds,
          shelf_ids: selectedShelfIds,
          model_id: selectedModelId,
          regenerate: true, // 标记为重新生成
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''
      let assistantCitations: Citation[] = []
      let sseBuffer = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = decoder.decode(value, { stream: true })
          sseBuffer += text

          const sseMessages = sseBuffer.split('\n\n')
          sseBuffer = sseMessages.pop() || ''

          for (const message of sseMessages) {
            const lines = message.split('\n')
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue

              try {
                const data = JSON.parse(line.slice(6))

                if (data.type === 'delta' && data.content) {
                  assistantContent += data.content
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessage.id
                        ? { ...m, content: assistantContent }
                        : m
                    )
                  )
                }

                if (data.type === 'citations' && data.citations) {
                  assistantCitations = data.citations
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessage.id
                        ? { ...m, citations: assistantCitations }
                        : m
                    )
                  )
                }
              } catch {
                // 忽略解析错误
              }
            }
          }
        }
      }
    } catch (error: unknown) {
      if ((error as Error).name !== 'AbortError') {
        console.error('[AI] Regenerate failed:', error)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessage.id
              ? { ...m, content: t('ai.error_occurred') }
              : m
          )
        )
      }
    } finally {
      setStreaming(false)
      abortControllerRef.current = null
    }
  }, [
    streaming,
    isOnline,
    selectedId,
    messages,
    chatMode,
    selectedBookIds,
    selectedShelfIds,
    selectedModelId,
    accessToken,
    t,
  ])

  // 编辑用户消息并重新提问
  const handleEditMessage = useCallback(async (messageId: string, newContent: string) => {
    if (streaming || !isOnline || !selectedId) return

    // 找到要编辑的消息索引
    const messageIndex = messages.findIndex((m) => m.id === messageId)
    if (messageIndex === -1) return

    // 截断该消息之后的所有消息，并更新该消息内容
    setMessages((prev) => {
      const newMessages = prev.slice(0, messageIndex)
      newMessages.push({
        ...prev[messageIndex],
        content: newContent,
      })
      return newMessages
    })

    // 发送编辑后的消息
    setStreaming(true)

    const assistantMessage: Message = {
      id: `temp-assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
    }
    setMessages((prev) => [...prev, assistantMessage])

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      const url = getFullApiUrl(`/api/v1/ai/conversations/${selectedId}/messages`)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          content: newContent,
          mode: chatMode,
          book_ids: selectedBookIds,
          shelf_ids: selectedShelfIds,
          model_id: selectedModelId,
          edit_message_id: messageId, // 标记为编辑消息
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''
      let assistantCitations: Citation[] = []
      let sseBuffer = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = decoder.decode(value, { stream: true })
          sseBuffer += text

          const sseMessages = sseBuffer.split('\n\n')
          sseBuffer = sseMessages.pop() || ''

          for (const message of sseMessages) {
            const lines = message.split('\n')
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue

              try {
                const data = JSON.parse(line.slice(6))

                if (data.type === 'delta' && data.content) {
                  assistantContent += data.content
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessage.id
                        ? { ...m, content: assistantContent }
                        : m
                    )
                  )
                }

                if (data.type === 'citations' && data.citations) {
                  assistantCitations = data.citations
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessage.id
                        ? { ...m, citations: assistantCitations }
                        : m
                    )
                  )
                }
              } catch {
                // 忽略解析错误
              }
            }
          }
        }
      }
    } catch (error: unknown) {
      if ((error as Error).name !== 'AbortError') {
        console.error('[AI] Edit message failed:', error)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessage.id
              ? { ...m, content: t('ai.error_occurred') }
              : m
          )
        )
      }
    } finally {
      setStreaming(false)
      abortControllerRef.current = null
    }
  }, [
    streaming,
    isOnline,
    selectedId,
    messages,
    chatMode,
    selectedBookIds,
    selectedShelfIds,
    selectedModelId,
    accessToken,
    t,
  ])

  // 键盘事件
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  // 是否显示书籍/书架选择器
  const showBookSelectors = chatMode === 'qa'

  return (
    <div className="fixed inset-0 bg-system-background flex flex-col z-[100]">
      {/* 顶部栏 */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-separator bg-system-background/80 backdrop-blur-xl">
        {/* 左侧: 汉堡菜单 */}
        <button
          onClick={() => setSideDrawerOpen(true)}
          className="p-2 rounded-full hover:bg-secondary-background transition-all duration-200 hover:scale-110"
          title={t('ai.menu')}
        >
          <Menu className="w-6 h-6 text-label" />
        </button>

        {/* 中间: 标题 */}
        <h1 className="text-lg font-semibold text-label">{currentTitle}</h1>

        {/* 右侧: 主页按钮 - 返回个人主页 /home */}
        <button
          onClick={() => navigate('/app/home')}
          className="p-2 rounded-full hover:bg-secondary-background transition-all duration-200 hover:scale-110"
          title={t('common.home')}
        >
          <Home className="w-6 h-6 text-label" />
        </button>
      </header>

      {/* 离线提示 */}
      {!isOnline && (
        <div className={`flex items-center gap-2 px-4 py-2 bg-system-yellow/10 text-system-yellow ${animations.slideUp}`}>
          <WifiOff className="w-4 h-4" />
          <span className="text-sm">{t('ai.offline_notice')}</span>
        </div>
      )}

      {/* 对话区域 */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 ? (
          <div className={`flex flex-col items-center justify-center h-full text-center ${animations.fadeIn}`}>
            {/* 雅典娜 Logo */}
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-system-purple to-system-blue 
              flex items-center justify-center mb-6 shadow-2xl overflow-hidden">
              <img
                src="/logosvg.png"
                alt="Athena"
                className="w-16 h-16 object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  e.currentTarget.nextElementSibling?.classList.remove('hidden')
                }}
              />
              <Sparkles className="w-12 h-12 text-primary-foreground hidden" />
            </div>

            {/* 个性化欢迎语 */}
            <h2 className="text-2xl font-bold text-label mb-3">
              {user?.display_name
                ? t('ai.welcome_personalized', { name: user.display_name })
                : t('ai.welcome_hello')
              }
            </h2>
            <p className="text-lg text-secondary-label mb-4">
              {t('ai.what_can_i_help')}
            </p>

            {/* 模式提示 */}
            <p className="text-sm text-tertiary-label max-w-md px-4">
              {t('ai.mode_hint')}
            </p>
          </div>
        ) : (
          <div className="space-y-4 max-w-4xl mx-auto">
            {messages.map((msg, idx) => {
              // 判断是否是最后一条 AI 消息
              const isLastAssistant = msg.role === 'assistant' && 
                idx === messages.length - 1 || 
                (idx === messages.length - 2 && messages[messages.length - 1]?.role === 'user')

              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isStreaming={streaming && idx === messages.length - 1 && msg.role === 'assistant'}
                  isLastAssistant={!streaming && msg.role === 'assistant' && isLastAssistant}
                  onCitationClick={(citation) => {
                    setSelectedCitation(citation)
                    setCitationModalOpen(true)
                  }}
                  onRegenerate={handleRegenerate}
                  onEditMessage={handleEditMessage}
                />
              )
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 底部工具栏 */}
      <div className="border-t border-separator bg-system-background/80 backdrop-blur-xl p-4 relative z-50 overflow-visible">
        <div className="max-w-4xl mx-auto space-y-3 overflow-visible">
          {/* 输入框 (在上方) */}
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('ai.input_placeholder')}
                disabled={!isOnline}
                rows={1}
                className="w-full px-4 py-3 pr-12 bg-tertiary-background rounded-2xl
                  border-none outline-none text-label placeholder:text-secondary-label
                  focus:ring-2 ring-system-purple/50 resize-none
                  transition-all duration-200 disabled:opacity-50
                  min-h-[48px] max-h-32 h-auto"
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height = Math.min(target.scrollHeight, 128) + 'px'
                }}
              />
            </div>

            {/* 发送/停止按钮 */}
            {streaming ? (
              <button
                onClick={handleStop}
                className="shrink-0 w-12 h-12 flex items-center justify-center rounded-full bg-system-red
                  shadow-lg hover:shadow-xl hover:opacity-90 transition-all duration-200 hover:scale-110 active:scale-95"
                title={t('ai.stop')}
              >
                <StopCircle className="w-5 h-5 text-primary-foreground" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() || !isOnline}
                className="shrink-0 w-12 h-12 flex items-center justify-center rounded-full bg-system-purple
                  shadow-lg hover:shadow-xl hover:opacity-90 transition-all duration-200 hover:scale-110 active:scale-95
                  disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
                title={t('ai.send')}
              >
                <Send className="w-5 h-5 text-primary-foreground" />
              </button>
            )}
          </div>

          {/* 工具按钮 (在下方) */}
          <div className="flex items-center justify-between overflow-visible">
            {/* 左侧: 书架和书籍选择器 */}
            <div className="flex items-center gap-2">
              {showBookSelectors && (
                <>
                  {/* 书架选择器 */}
                  <div className="relative">
                    <ToolbarButton
                      icon={Library}
                      label={t('ai.shelf')}
                      onClick={() => {
                        setShelfSelectorOpen(!shelfSelectorOpen)
                        setBookSelectorOpen(false)
                      }}
                      isActive={selectedShelfIds.length > 0}
                      badge={selectedShelfIds.length}
                    />
                    <SelectorDropdown
                      isOpen={shelfSelectorOpen}
                      onClose={() => setShelfSelectorOpen(false)}
                      items={shelves}
                      selectedIds={selectedShelfIds}
                      onToggle={handleToggleShelf}
                      searchPlaceholder={t('ai.search_shelf')}
                      renderItem={(shelf) => (
                        <div>
                          <div className="text-sm font-medium text-label">{shelf.name}</div>
                          {shelf.book_count !== undefined && (
                            <div className="text-xs text-secondary-label">
                              {t('shelf.book_count', '{{count}} books', { count: shelf.book_count })}
                            </div>
                          )}
                        </div>
                      )}
                      position="top"
                    />
                  </div>

                  {/* 书籍选择器 */}
                  <div className="relative">
                    <ToolbarButton
                      icon={Book}
                      label={t('ai.book')}
                      onClick={() => {
                        setBookSelectorOpen(!bookSelectorOpen)
                        setShelfSelectorOpen(false)
                      }}
                      isActive={selectedBookIds.length > 0}
                      badge={selectedBookIds.length}
                    />
                    <SelectorDropdown
                      isOpen={bookSelectorOpen}
                      onClose={() => setBookSelectorOpen(false)}
                      items={books}
                      selectedIds={selectedBookIds}
                      onToggle={handleToggleBook}
                      searchPlaceholder={t('ai.search_book')}
                      renderItem={(book) => (
                        <div>
                          <div className="text-sm font-medium text-label truncate">{book.title}</div>
                          {book.author && (
                            <div className="text-xs text-secondary-label truncate">{book.author}</div>
                          )}
                        </div>
                      )}
                      position="top"
                    />
                  </div>
                </>
              )}
            </div>

            {/* 右侧: 模型选择和模式切换 */}
            <div className="flex items-center gap-2">
              {/* 模型选择器 */}
              <div className="relative">
                <ToolbarButton
                  icon={Cpu}
                  label={selectedModelName}
                  onClick={() => {
                    setModelSelectorOpen(!modelSelectorOpen)
                    setBookSelectorOpen(false)
                    setShelfSelectorOpen(false)
                  }}
                  isActive={modelSelectorOpen}
                />
                <SelectorDropdown
                  isOpen={modelSelectorOpen}
                  onClose={() => setModelSelectorOpen(false)}
                  items={models}
                  selectedIds={[selectedModelId]}
                  onToggle={(id) => setSelectedModelId(id)}
                  searchPlaceholder={t('ai.search_model')}
                  renderItem={(model) => (
                    <div className="text-sm font-medium text-label">{model.display_name}</div>
                  )}
                  multiSelect={false}
                  position="top"
                />
              </div>

              {/* 模式切换 - 使用明显不同的图标 */}
              <ToolbarButton
                icon={chatMode === 'chat' ? MessagesSquare : BookOpen}
                label={chatMode === 'chat'
                  ? t('ai.mode_chat')
                  : t('ai.mode_qa')}
                onClick={handleToggleMode}
                isActive={chatMode === 'qa'}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 侧边抽屉 */}
      <SideDrawer
        isOpen={sideDrawerOpen}
        onClose={() => setSideDrawerOpen(false)}
        conversations={conversations}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onNewChat={handleNewChat}
        onDelete={handleDelete}
      />

      {/* 引用弹窗 */}
      {selectedCitation && (
        <CitationModal
          citation={selectedCitation}
          isOpen={citationModalOpen}
          onClose={() => {
            setCitationModalOpen(false)
            setSelectedCitation(null)
          }}
        />
      )}
    </div>
  )
}
