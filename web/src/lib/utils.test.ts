import { describe, it, expect, beforeEach, vi } from 'vitest'
import { cn, generateUUID, formatFileSize, formatMinutes, getDeviceId } from './utils'

describe('cn (Tailwind Class Merger)', () => {
    it('should merge classes correctly', () => {
        expect(cn('p-4', 'm-2')).toBe('p-4 m-2')
        expect(cn('p-4', undefined, 'm-2')).toBe('p-4 m-2')
        expect(cn('p-4', { 'hidden': true, 'flex': false })).toBe('p-4 hidden')
    })

    it('should handle tailwind conflicts', () => {
        // p-4 should be overwritten by p-8
        expect(cn('p-4', 'p-8')).toBe('p-8')
        // text-red-500 should be overwritten by text-blue-500
        expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
    })
})

describe('generateUUID', () => {
    it('should generate a valid UUID v4 format', () => {
        const uuid = generateUUID()
        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    })

    it('should fallback if crypto is not available', () => {
        // Mock global crypto to be undefined
        vi.stubGlobal('crypto', undefined)

        const uuid = generateUUID()
        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)

        vi.unstubAllGlobals()
    })
})

describe('formatFileSize', () => {
    it('should format bytes to human readable string', () => {
        expect(formatFileSize(0)).toBe('0 B')
        expect(formatFileSize(1024)).toBe('1 KB')
        expect(formatFileSize(1024 * 1024)).toBe('1 MB')
        expect(formatFileSize(1024 * 1024 * 1.5)).toBe('1.5 MB')
        expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB')
    })
})

describe('formatMinutes', () => {
    it('should format minutes correctly', () => {
        expect(formatMinutes(30)).toBe('30min')
        expect(formatMinutes(60)).toBe('1h')
        expect(formatMinutes(90)).toBe('1h 30min')
        expect(formatMinutes(120)).toBe('2h')
    })
})

describe('getDeviceId', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('should generate a new device id if not exists', () => {
        const id = getDeviceId()
        expect(id).toMatch(/^web_/)
        expect(localStorage.getItem('athena_device_id')).toBe(id)
    })

    it('should return existing device id', () => {
        localStorage.setItem('athena_device_id', 'existing_id')
        expect(getDeviceId()).toBe('existing_id')
    })

    it('should handle navigator properties', () => {
        // Mock userAgent if possible, but jsdom has default
        const id = getDeviceId()
        expect(id).toContain('web_')
    })
})
