/**
 * 书架存储 Stub（App-First 迁移中）
 * TODO: 迁移到 PowerSync useShelvesData
 */

export const addBookToShelf = async (_shelfId: string, _bookId: string) => {
  console.warn('[shelvesStorage] Stub: 待迁移到 PowerSync')
}

export const removeBookFromShelf = async (_shelfId: string, _bookId: string) => {
  console.warn('[shelvesStorage] Stub: 待迁移到 PowerSync')
}

export const getAllShelves = async () => {
  return []
}

export const getBookShelfIds = async (_bookId: string) => {
  return []  
}
