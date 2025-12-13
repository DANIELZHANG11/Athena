/**
 * seeder.ts - 开发环境数据填充脚本 (PowerSync 版)
 * 
 * 用于本地开发测试时快速填充测试数据
 * 使用 PowerSync SQLite 作为数据存储
 * 
 * @see 09 - APP-FIRST架构改造计划.md
 * @warning 仅限开发环境使用！
 */

import { getDeviceId } from '@/lib/utils'

// 注意: 这些函数需要在 PowerSync 初始化后调用
// 通过参数传入 db 实例而非直接导入

/**
 * 生成 UUID
 */
function generateId(): string {
  return crypto.randomUUID()
}

/**
 * 填充测试数据
 * 
 * 功能:
 * 1. 清理数据库
 * 2. 预置测试书籍
 * 3. 预置阅读进度
 * 
 * @param db - PowerSync 数据库实例
 * @returns 填充结果
 */
export async function seedTestData(db: any): Promise<{
  success: boolean
  message: string
  data?: {
    bookId: string
    bookTitle: string
  }
}> {
  if (!db) {
    return {
      success: false,
      message: 'PowerSync 数据库未初始化'
    }
  }

  console.log('[Seeder] 🌱 开始填充测试数据...')

  try {
    const now = new Date().toISOString()
    const deviceId = getDeviceId()

    // 1. 清理数据库
    console.log('[Seeder] 🧹 清理现有数据...')
    await db.execute('DELETE FROM books')
    await db.execute('DELETE FROM reading_progress')
    await db.execute('DELETE FROM notes')
    await db.execute('DELETE FROM highlights')
    console.log('[Seeder] ✅ 数据库已清空')

    // 2. 预置测试书籍
    const testBookId = generateId()
    await db.execute(
      `INSERT INTO books (id, user_id, title, author, file_type, file_size, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        testBookId,
        'test-user-id', // 将被 PowerSync RLS 覆盖
        'Offline First 实战指南',
        '雅典娜团队',
        'epub',
        5 * 1024 * 1024, // 5MB
        now,
        now,
      ]
    )
    console.log(`[Seeder] 📚 已创建测试书籍 (ID: ${testBookId})`)

    // 3. 预置阅读进度
    const progressId = generateId()
    await db.execute(
      `INSERT INTO reading_progress (id, user_id, book_id, device_id, progress, last_position, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        progressId,
        'test-user-id',
        testBookId,
        deviceId,
        0.25,
        JSON.stringify({ cfi: 'epubcfi(/6/4!/4/2/1:0)', pageNumber: 1 }),
        now,
      ]
    )
    console.log(`[Seeder] 📖 已创建阅读进度: 25%`)

    // 4. 预置一条测试笔记
    const noteId = generateId()
    await db.execute(
      `INSERT INTO notes (id, user_id, book_id, device_id, content, position_cfi, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        noteId,
        'test-user-id',
        testBookId,
        deviceId,
        '这是一条测试笔记，用于验证 App-First 架构是否正常工作。',
        'epubcfi(/6/4!/4/2/1:50)',
        now,
        now,
      ]
    )
    console.log(`[Seeder] 📝 已创建测试笔记 (ID: ${noteId})`)

    console.log('[Seeder] ✅ 测试数据填充完毕!')
    console.log('[Seeder] 📊 数据概览:')
    console.log(`   - 书籍: 1 本`)
    console.log(`   - 阅读进度: 1 条`)
    console.log(`   - 笔记: 1 条`)

    return {
      success: true,
      message: '测试数据填充成功',
      data: {
        bookId: testBookId,
        bookTitle: 'Offline First 实战指南',
      }
    }
  } catch (error) {
    console.error('[Seeder] ❌ 填充失败:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : '未知错误',
    }
  }
}

/**
 * 清空所有测试数据
 * @param db - PowerSync 数据库实例
 */
export async function clearTestData(db: any): Promise<{ success: boolean; message: string }> {
  if (!db) {
    return { success: false, message: 'PowerSync 数据库未初始化' }
  }

  console.log('[Seeder] 🧹 清空测试数据...')

  try {
    await db.execute('DELETE FROM books')
    await db.execute('DELETE FROM reading_progress')
    await db.execute('DELETE FROM notes')
    await db.execute('DELETE FROM highlights')

    console.log('[Seeder] ✅ 测试数据已清空')
    return { success: true, message: '数据已清空' }
  } catch (error) {
    console.error('[Seeder] ❌ 清空失败:', error)
    return { success: false, message: error instanceof Error ? error.message : '未知错误' }
  }
}

/**
 * 获取数据库统计信息
 * @param db - PowerSync 数据库实例
 */
export async function getDatabaseStats(db: any): Promise<{
  books: number
  progress: number
  notes: number
  highlights: number
}> {
  if (!db) {
    return { books: 0, progress: 0, notes: 0, highlights: 0 }
  }

  try {
    const booksResult = await db.get('SELECT COUNT(*) as count FROM books')
    const progressResult = await db.get('SELECT COUNT(*) as count FROM reading_progress')
    const notesResult = await db.get('SELECT COUNT(*) as count FROM notes')
    const highlightsResult = await db.get('SELECT COUNT(*) as count FROM highlights')

    return {
      books: (booksResult as any)?.count ?? 0,
      progress: (progressResult as any)?.count ?? 0,
      notes: (notesResult as any)?.count ?? 0,
      highlights: (highlightsResult as any)?.count ?? 0,
    }
  } catch (error) {
    console.error('[Seeder] 获取统计失败:', error)
    return { books: 0, progress: 0, notes: 0, highlights: 0 }
  }
}
