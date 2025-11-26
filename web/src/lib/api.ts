import axios from 'axios'
import { useAuthStore } from '@/stores/auth'

const api = axios.create({
    baseURL: '/api/v1',
    headers: {
        'Content-Type': 'application/json',
    },
})

// 请求拦截器：自动携带 Token
api.interceptors.request.use((config) => {
    const token = useAuthStore.getState().jwt
    if (token) {
        config.headers.Authorization = `Bearer ${token}`
    }
    return config
})

// 响应拦截器：统一处理错误
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            useAuthStore.getState().clear()
            window.location.href = '/login'
        }
        return Promise.reject(error)
    }
)

export default api
