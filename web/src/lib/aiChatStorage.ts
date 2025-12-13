/**
 * AI 聊天存储 Stub（App-First 迁移中）
 * TODO: 迁移到 PowerSync
 */

export interface ConversationRecord {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface MessageRecord {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export const saveMessages = async () => {
  // Stub
}

export const getCachedConversations = async () => {
  return []
}

export const getConversationMessages = async () => {
  return []
}

export const deleteConversation = async () => {
  // Stub
}
