/**
 * CitationModal - AI对话引用弹窗组件
 * 
 * 功能：
 * - 显示引用的书籍内容预览
 * - 提供"在阅读器中打开"按钮跳转到完整阅读器
 * - 支持内嵌轻量阅读器（如果书籍已缓存）
 * 
 * @see 06 - UIUX设计系统.md
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { X, BookOpen, ExternalLink, Loader2, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { getBookFile } from '@/lib/bookStorage'

export interface Citation {
  index: number
  book_id: string
  book_title: string
  page?: number | null
  chapter?: string | null
  section_index?: number | null  // EPUB 章节索引，用于精确跳转
  section_filename?: string | null  // EPUB 章节文件名
  chunk_index?: number | null
  preview: string
  score: number
}

interface CitationModalProps {
  citation: Citation
  isOpen: boolean
  onClose: () => void
}

/**
 * 引用预览弹窗
 * 显示引用内容，并提供跳转到阅读器的选项
 */
export function CitationModal({ citation, isOpen, onClose }: CitationModalProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [bookCached, setBookCached] = useState(false)
  const [expandedContent, setExpandedContent] = useState<string>('')
  const contentRef = useRef<HTMLDivElement>(null)

  // 检查书籍是否已缓存
  const checkBookCache = useCallback(async () => {
    if (!citation.book_id) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const cached = await getBookFile(citation.book_id)
      setBookCached(!!cached)

      // 如果已缓存，尝试提取更多上下文（简化版本，只使用预览）
      // 完整的EPUB解析需要jszip依赖，这里先使用预览内容
      setExpandedContent(citation.preview)
    } catch (err) {
      console.error('[CitationModal] Cache check failed:', err)
      setBookCached(false)
    } finally {
      setLoading(false)
    }
  }, [citation.book_id, citation.preview])

  useEffect(() => {
    if (isOpen && citation.book_id) {
      checkBookCache()
    }
  }, [isOpen, citation.book_id, checkBookCache])

  // 跳转到阅读器
  const openInReader = () => {
    onClose()
    // 跳转到阅读器，传递定位参数
    let readerUrl = `/app/read/${citation.book_id}`
    const params = new URLSearchParams()

    // 优先使用 section_index（EPUB精确跳转）
    if (citation.section_index !== null && citation.section_index !== undefined) {
      params.set('section', String(citation.section_index))
    }
    // PDF 使用页码
    if (citation.page) {
      params.set('page', String(citation.page))
    }
    if (citation.chunk_index !== null && citation.chunk_index !== undefined) {
      params.set('chunk', String(citation.chunk_index))
    }
    // 提取预览内容的前30个字符作为搜索关键词，帮助用户定位
    if (citation.preview) {
      const searchText = citation.preview.slice(0, 50).replace(/[\n\r]/g, ' ').trim()
      params.set('search', searchText)
    }
    if (params.toString()) {
      readerUrl += '?' + params.toString()
    }
    navigate(readerUrl)
  }

  if (!isOpen) return null

  return (
    <>
      {/* 遮罩层 */}
      <div
        className="fixed inset-0 bg-black/50 z-[200] animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* 弹窗 - 使用白色背景80%不透明度，确保文字可见 */}
      <div className="fixed inset-x-4 top-[10%] bottom-[10%] md:inset-x-[15%] lg:inset-x-[25%]
        bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl
        border border-gray-200 dark:border-gray-700
        rounded-2xl shadow-2xl z-[201] flex flex-col overflow-hidden
        animate-in zoom-in-95 fade-in duration-300">

        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-separator bg-secondary-background">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-system-purple/10 flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5 text-system-purple" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-label truncate">
                {citation.book_title}
              </h3>
              <p className="text-xs text-secondary-label">
                {/* 【修复 2026-01-15】优先显示 chapter_title（真实章节标题），section_index 仅用于跳转 */}
                {/* PDF: 显示页码; EPUB: 优先显示章节标题，兜底显示引用内容 */}
                {citation.page
                  ? t('ai.citation_page', '第 {{page}} 页', { page: citation.page })
                  : citation.chapter
                    ? citation.chapter  // 优先使用真实章节标题（如 "第六章 产品经理的胜任力"）
                    : t('ai.citation_reference', '引用内容')
                }
                {' · '}
                {t('ai.citation_reference', '引用内容')} [{citation.index}]
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-tertiary-background transition-colors flex-shrink-0"
            title={t('common.close', '关闭')}
          >
            <X className="w-5 h-5 text-secondary-label" />
          </button>
        </div>

        {/* 内容区域 */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto p-6"
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="w-8 h-8 text-system-purple animate-spin" />
              <p className="text-secondary-label">{t('ai.citation_loading', '加载中...')}</p>
            </div>
          ) : (
            <div className="max-w-prose mx-auto">
              {/* 引用标记 */}
              <div className="flex items-center gap-2 mb-4 pb-4 border-b border-separator">
                <FileText className="w-4 h-4 text-system-purple" />
                <span className="text-sm font-medium text-system-purple">
                  {t('ai.original_citation', '书籍原文引用')}
                </span>
                {/* 【2026-01-16 行业最佳实践】隐藏分数显示 */}
                {/* 90%+产品（Perplexity/ChatGPT/Bing）不显示原始分数 */}
                {/* Rerank分数(0.001-0.3)对用户无意义，排名本身已说明相关度 */}
              </div>

              {/* 引用内容 */}
              <blockquote className="relative pl-4 border-l-4 border-system-purple/30">
                <p className="text-label leading-relaxed whitespace-pre-wrap text-base">
                  {expandedContent || citation.preview}
                </p>
              </blockquote>

              {/* 提示信息 */}
              <p className="mt-6 text-sm text-secondary-label text-center">
                {bookCached
                  ? t('ai.view_context_hint', '点击下方按钮在阅读器中查看完整上下文')
                  : t('ai.book_not_cached_hint', '书籍未缓存，请先在书库中下载该书籍')
                }
              </p>
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="px-4 py-3 border-t border-separator bg-secondary-background flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-secondary-label 
              hover:text-label hover:bg-tertiary-background rounded-lg transition-colors"
          >
            {t('common.close', '关闭')}
          </button>
          <button
            onClick={openInReader}
            disabled={!bookCached}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium
              bg-system-purple rounded-lg hover:opacity-90 transition-all
              disabled:bg-gray-300 disabled:cursor-not-allowed"
            style={{ color: !bookCached ? '#666666' : '#ffffff' }}
          >
            <ExternalLink className="w-4 h-4" />
            {t('ai.view_original', '查看原书')}
          </button>
        </div>
      </div>
    </>
  )
}

export default CitationModal
