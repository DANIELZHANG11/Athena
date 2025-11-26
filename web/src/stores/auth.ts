import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type AuthState = {
  jwt: string | null
  user: { id: string; email: string } | null
  isAuthenticated: boolean
  setToken: (token: string) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      jwt: null,
      user: null,
      isAuthenticated: false,
      setToken: (token) => set({ jwt: token, isAuthenticated: true }),
      clear: () => set({ jwt: null, user: null, isAuthenticated: false })
    }),
    { name: 'athena-auth' }
  )
)
