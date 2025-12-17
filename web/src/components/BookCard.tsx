/**
 * BookCard 组件 - 向后兼容导出
 * 
 * 此文件保留用于向后兼容，实际实现已迁移至 BookCard/ 目录
 * 
 * @deprecated 建议直接从 '@/components/BookCard' 导入（会解析到 BookCard/index.tsx）
 */

// 重新导出 BookCard 目录中的所有内容
// 注意：必须使用完整路径避免循环导入
export { default } from './BookCard/index'
export * from './BookCard/index'
export type { BookCardProps, BookStatus } from './BookCard/types'
