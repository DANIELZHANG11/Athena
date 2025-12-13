/**
 * PdfPageWithOcr - PDF 页面组件（简化版）
 * 
 * **架构重构说明 (2025-12-09)**：
 * - 旧方案：前端渲染透明 DOM 叠加层（存在严重的文字对齐问题）
 * - 新方案：后端生成双层 PDF (Invisible Text Layer)，前端直接使用 react-pdf 渲染
 * 
 * 现在这个组件只是 react-pdf Page 的简单封装：
 * - 始终启用 renderTextLayer={true}，让 react-pdf 渲染 PDF 自带的透明文字层
 * - 对于经过 OCR 处理的图片式 PDF，文字层已经由后端嵌入到 PDF 中
 * - 文字选择功能由 PDF 引擎原生支持，完美对齐
 * 
 * @see App-First改造计划.md - OCR 架构重构
 */

import { memo, useCallback } from 'react'
import { Page } from 'react-pdf'

interface PdfPageWithOcrProps {
  /** 书籍 ID（保留接口兼容性，但不再使用） */
  bookId?: string
  /** 页码（从 1 开始） */
  pageNumber: number
  /** 页面宽度 */
  width: number
  /** 是否启用 OCR 叠加层（已废弃，保留接口兼容性） */
  enableOcrLayer?: boolean
  /** 当前页的 OCR 区域数据（已废弃，保留接口兼容性） */
  ocrRegions?: unknown[]
  /** OCR 图片尺寸（已废弃，保留接口兼容性） */
  ocrImageWidth?: number
  ocrImageHeight?: number
  /** 是否显示调试边框（已废弃，保留接口兼容性） */
  debugOcr?: boolean
  /** 页面渲染成功回调 */
  onRenderSuccess?: (page: { pageNumber: number; originalWidth: number; originalHeight: number }) => void
}

/**
 * PDF 页面组件
 * 
 * 使用 react-pdf 渲染 PDF 页面，始终启用文字层。
 * 对于双层 PDF（后端 OCR 处理后生成），文字层已嵌入，可直接选择。
 */
export const PdfPageWithOcr = memo(function PdfPageWithOcr({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  bookId: _bookId,  // 保留接口兼容性
  pageNumber,
  width,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  enableOcrLayer: _enableOcrLayer,  // 已废弃：双层 PDF 不需要前端 OCR 层
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ocrRegions: _ocrRegions,  // 已废弃
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ocrImageWidth: _ocrImageWidth,  // 已废弃
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ocrImageHeight: _ocrImageHeight,  // 已废弃
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debugOcr: _debugOcr,  // 已废弃
  onRenderSuccess,
}: PdfPageWithOcrProps) {

  const handleRenderSuccess = useCallback((page: { pageNumber: number; originalWidth: number; originalHeight: number }) => {
    // 调用外部回调
    onRenderSuccess?.(page)
  }, [onRenderSuccess])

  return (
    <div
      className="pdf-page-container"
      style={{
        position: 'relative',
        display: 'inline-block',
      }}
    >
      {/* PDF 页面渲染 - 始终启用文字层 */}
      <Page
        pageNumber={pageNumber}
        // 【关键】始终启用 TextLayer，让 react-pdf 渲染 PDF 自带的透明文字
        // 对于双层 PDF，文字层已由后端嵌入，可直接选择
        renderTextLayer={true}
        renderAnnotationLayer={false}
        width={width}
        onRenderSuccess={handleRenderSuccess}
      />
    </div>
  )
})

export default PdfPageWithOcr
