import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useNotesData } from './useNotesData'

// Mocks
const mockExecute = vi.fn()
const mockDb = { execute: mockExecute }

// Mock PowerSync hooks
vi.mock('@/lib/powersync', () => ({
    usePowerSyncDatabase: () => mockDb,
    usePowerSyncState: () => ({ isInitialized: true })
}))

// Mock @powersync/react useQuery
const mockUseQuery = vi.fn()
vi.mock('@powersync/react', () => ({
    useQuery: (...args: any[]) => mockUseQuery(...args)
}))

// Mock Auth Store
vi.mock('@/stores/auth', () => ({
    useAuthStore: {
        getState: () => ({ user: { id: 'user-123' } })
    }
}))

// Mock Utils
vi.mock('@/lib/utils', () => ({
    generateUUID: () => 'uuid-123',
    getDeviceId: () => 'device-123'
}))

describe('useNotesData', () => {
    const mockNotes = [
        {
            id: 'note-1',
            book_id: 'book-1',
            content: 'test content',
            created_at: '2023-01-01',
            updated_at: '2023-01-01'
        }
    ]
    const mockBooks = [
        { id: 'book-1', title: 'Test Book' }
    ]

    beforeEach(() => {
        vi.clearAllMocks()

        // Default mock implementation for useQuery
        mockUseQuery.mockImplementation((sql: string) => {
            if (sql.includes('FROM notes')) {
                return { data: mockNotes, isLoading: false }
            }
            if (sql.includes('FROM books')) {
                return { data: mockBooks, isLoading: false }
            }
            return { data: [], isLoading: false }
        })
    })

    it('should fetch notes and map book titles', () => {
        const { result } = renderHook(() => useNotesData({ bookId: 'book-1' }))

        // Check fetched data
        expect(result.current.notes).toHaveLength(1)
        expect(result.current.notes[0].bookTitle).toBe('Test Book')
        expect(result.current.notes[0].content).toBe('test content')

        // Check SQL generation
        expect(mockUseQuery).toHaveBeenCalledTimes(2) // notes + books
        const notesCall = mockUseQuery.mock.calls.find(call => call[0].includes('FROM notes'))
        expect(notesCall[0]).toContain('book_id = ?')
        expect(notesCall[0]).toContain('WHERE deleted_at IS NULL')
        expect(notesCall[1]).toEqual(['book-1'])
    })

    it('should add note with correct parameters', async () => {
        const { result } = renderHook(() => useNotesData())

        await act(async () => {
            await result.current.addNote({
                bookId: 'book-1',
                content: 'new note',
                cfiRange: 'cfi-123'
            })
        })

        expect(mockExecute).toHaveBeenCalledTimes(1)
        const [sql, params] = mockExecute.mock.calls[0]

        expect(sql).toContain('INSERT INTO notes')
        expect(params[0]).toBe('uuid-123') // id (mocked)
        expect(params[1]).toBe('user-123') // user_id
        expect(params[2]).toBe('device-123') // device_id
        expect(params[3]).toBe('book-1')
        expect(params[6]).toBe('new note')
    })

    it('should update note', async () => {
        const { result } = renderHook(() => useNotesData())

        await act(async () => {
            await result.current.updateNote('note-1', 'updated content', 'red')
        })

        expect(mockExecute).toHaveBeenCalledTimes(1)
        const [sql, params] = mockExecute.mock.calls[0]

        expect(sql).toContain('UPDATE notes SET')
        expect(sql).toContain('content = ?')
        expect(sql).toContain('color = ?')
        expect(params[0]).toBe('updated content')
        expect(params[2]).toBe('red')
        expect(params[params.length - 1]).toBe('note-1') // where id = ?
    })

    it('should delete note (soft delete)', async () => {
        const { result } = renderHook(() => useNotesData())

        await act(async () => {
            await result.current.deleteNote('note-1')
        })

        expect(mockExecute).toHaveBeenCalledTimes(1)
        const [sql, params] = mockExecute.mock.calls[0]

        expect(sql).toContain('UPDATE notes SET deleted_at = ?')
        expect(params[2]).toBe('note-1')
    })
})
