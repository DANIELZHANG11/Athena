/**
 * AI 聊天存储 Stub（App-First 迁移中）
 * TODO: 迁移到 PowerSync
 * (Verified for CI)
 */

export interface ConversationRecord {
  id: string
  title: string
  mode?: 'chat' | 'qa'
  book_ids?: string[]
  created_at: string
  updated_at: string
  createdAt: string  // 兼容旧字段
  updatedAt: string  // 兼容旧字段
}

export interface MessageRecord {
  id: string
  conversationId: string
  conversation_id?: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  createdAt?: string
  metadata?: any
}

export const saveConversations = async (_conversations: ConversationRecord[]) => {
  console.warn('[aiChatStorage] Stub: 待迁移到 PowerSync')
}

export const saveMessages = async (_messages: MessageRecord[]) => {
  console.warn('[aiChatStorage] Stub: 待迁移到 PowerSync')
}

export const getCachedConversations = async () => {
  return [] as ConversationRecord[]
}

export const getConversationMessages = async (_conversationId: string) => {
  return [] as MessageRecord[]
}

export const deleteConversation = async (_id: string) => {
  console.warn('[aiChatStorage] Stub: 待迁移到 PowerSync')
}
