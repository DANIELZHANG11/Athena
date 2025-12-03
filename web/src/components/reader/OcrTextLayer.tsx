/**
 * OcrTextLayer - OCR 文字叠加层组件
 * 
 * 在 PDF 页面上渲染透明的 OCR 识别文字，
 * 使用户可以选择、复制和高亮图片式 PDF 中的文字。
 * 
 * 工作原理：
 * 1. 从 IndexedDB 读取本地缓存的 OCR 数据
 * 2. 将 OCR 坐标映射到 PDF 渲染尺寸
 * 3. 使用绝对定位在 PDF 图片上方叠加透明文字
 * 
 * 数据流：
 * - 服务器 → 一次性下载 → IndexedDB → 内存缓存 → 渲染
 * - 完全本地化，无需每页请求服务器
 */

import { memo, useMemo } from 'react'
import type { OcrRegion } from '@/lib/bookStorage'

interface OcrTextLayerProps {
  /** 书籍 ID */
  bookId: string
  /** 页码（从 1 开始） */
  pageNumber: number
  /** PDF 页面的渲染尺寸 */
  renderedWidth: number
  renderedHeight: number
  /** OCR 识别时的图片尺寸（用于坐标映射） */
  ocrImageWidth?: number
  ocrImageHeight?: number
  /** 当前页的 OCR 区域（从父组件传入，避免重复读取） */
  regions: OcrRegion[]
  /** 是否启用 */
  enabled?: boolean
  /** 调试模式（显示边框） */
  debug?: boolean
}

/**
 * 单个 OCR 文字区域
 */
const OcrTextRegion = memo(function OcrTextRegion({
  region,
  scaleX,
  scaleY,
  debug,
}: {
  region: OcrRegion
  scaleX: number
  scaleY: number
  debug?: boolean
}) {
  // 如果没有坐标信息，跳过
  if (!region.bbox && !region.polygon) return null
  
  // 优先使用 bbox（边界框）
  const bbox = region.bbox
  if (!bbox) return null
  
  const [x1, y1, x2, y2] = bbox
  
  // 映射到渲染尺寸
  const left = x1 * scaleX
  const top = y1 * scaleY
  const width = (x2 - x1) * scaleX
  const height = (y2 - y1) * scaleY
  
  // 估算字体大小（基于区域高度）
  const fontSize = Math.max(8, Math.min(height * 0.8, 24))
  
  return (
    <span
      style={{
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        fontSize: `${fontSize}px`,
        lineHeight: `${height}px`,
        color: 'transparent',
        // 保持文字可选择
        userSelect: 'text',
        cursor: 'text',
        // 调试模式显示边框
        ...(debug ? {
          border: '1px solid rgba(255, 0, 0, 0.3)',
          backgroundColor: 'rgba(255, 255, 0, 0.1)',
          color: 'rgba(0, 0, 255, 0.5)',
        } : {}),
        // 文字样式
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'clip',
        fontFamily: 'sans-serif',
      }}
      data-text={region.text}
      data-confidence={region.confidence}
    >
      {region.text}
    </span>
  )
})

/**
 * OCR 文字叠加层
 */
export const OcrTextLayer = memo(function OcrTextLayer({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  bookId: _bookId,  // Reserved for future analytics
  pageNumber,
  renderedWidth,
  renderedHeight,
  ocrImageWidth = 1240,
  ocrImageHeight = 1754,
  regions,
  enabled = true,
  debug = false,
}: OcrTextLayerProps) {
  // 计算坐标映射比例
  const { scaleX, scaleY } = useMemo(() => {
    return {
      scaleX: renderedWidth / ocrImageWidth,
      scaleY: renderedHeight / ocrImageHeight,
    }
  }, [renderedWidth, renderedHeight, ocrImageWidth, ocrImageHeight])

  // 没有数据或未启用
  if (!enabled || regions.length === 0) {
    return null
  }

  return (
    <div
      className="ocr-text-layer"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${renderedWidth}px`,
        height: `${renderedHeight}px`,
        pointerEvents: 'auto',
        zIndex: 10,
        // 确保文字可选择
        userSelect: 'text',
      }}
      // 阻止事件冒泡，避免干扰 PDF 交互
      onMouseDown={(e) => e.stopPropagation()}
    >
      {regions.map((region, index) => (
        <OcrTextRegion
          key={`${pageNumber}-${index}`}
          region={region}
          scaleX={scaleX}
          scaleY={scaleY}
          debug={debug}
        />
      ))}
      
      {/* 调试信息 */}
      {debug && (
        <div
          style={{
            position: 'absolute',
            bottom: 4,
            right: 4,
            padding: '2px 6px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            fontSize: '10px',
            borderRadius: '4px',
            zIndex: 100,
          }}
        >
          OCR: {regions.length} regions
        </div>
      )}
    </div>
  )
})

export default OcrTextLayer
