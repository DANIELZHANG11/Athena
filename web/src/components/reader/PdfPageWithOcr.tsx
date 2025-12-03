/**
 * PdfPageWithOcr - PDF 页面组件（支持 OCR 文字叠加）
 * 
 * 对于原生 PDF：使用 react-pdf 的 TextLayer
 * 对于图片式 PDF：叠加 OCR 识别的文字层
 * 
 * OCR 数据流：
 * - 父组件（ReaderPage）管理完整的 OCR 数据
 * - 本组件接收当前页的 OCR 区域
 * - 完全本地渲染，无网络请求
 */

import { memo, useState, useCallback } from 'react'
import { Page } from 'react-pdf'
import { OcrTextLayer } from './OcrTextLayer'
import type { OcrRegion } from '@/lib/bookStorage'

interface PdfPageWithOcrProps {
  bookId: string
  pageNumber: number
  width: number
  /** 是否启用 OCR 叠加层（用于图片式 PDF） */
  enableOcrLayer?: boolean
  /** 当前页的 OCR 区域数据 */
  ocrRegions?: OcrRegion[]
  /** OCR 图片尺寸（用于坐标映射） */
  ocrImageWidth?: number
  ocrImageHeight?: number
  /** 是否显示调试边框 */
  debugOcr?: boolean
  /** 页面渲染成功回调 */
  onRenderSuccess?: (page: { pageNumber: number; originalWidth: number; originalHeight: number }) => void
}

export const PdfPageWithOcr = memo(function PdfPageWithOcr({
  bookId,
  pageNumber,
  width,
  enableOcrLayer = false,
  ocrRegions = [],
  ocrImageWidth = 1240,
  ocrImageHeight = 1754,
  debugOcr = false,
  onRenderSuccess,
}: PdfPageWithOcrProps) {
  // 存储页面的渲染尺寸
  const [pageSize, setPageSize] = useState<{
    width: number
    height: number
    originalWidth: number
    originalHeight: number
  } | null>(null)

  const handleRenderSuccess = useCallback((page: { pageNumber: number; originalWidth: number; originalHeight: number }) => {
    // 计算渲染后的高度
    const aspectRatio = page.originalHeight / page.originalWidth
    const renderedHeight = width * aspectRatio
    
    setPageSize({
      width: width,
      height: renderedHeight,
      originalWidth: page.originalWidth,
      originalHeight: page.originalHeight,
    })
    
    // 调用外部回调
    onRenderSuccess?.(page)
  }, [width, onRenderSuccess])

  return (
    <div 
      className="pdf-page-container"
      style={{ 
        position: 'relative',
        display: 'inline-block',
      }}
    >
      {/* PDF 页面渲染 */}
      <Page
        pageNumber={pageNumber}
        // 对于图片式 PDF，原生 TextLayer 是空的，所以我们禁用它
        // 改用 OCR 文字层
        renderTextLayer={!enableOcrLayer}
        renderAnnotationLayer={false}
        width={width}
        onRenderSuccess={handleRenderSuccess}
      />
      
      {/* OCR 文字叠加层 */}
      {enableOcrLayer && pageSize && ocrRegions.length > 0 && (
        <OcrTextLayer
          bookId={bookId}
          pageNumber={pageNumber}
          renderedWidth={pageSize.width}
          renderedHeight={pageSize.height}
          ocrImageWidth={ocrImageWidth}
          ocrImageHeight={ocrImageHeight}
          regions={ocrRegions}
          enabled={true}
          debug={debugOcr}
        />
      )}
    </div>
  )
})

export default PdfPageWithOcr
