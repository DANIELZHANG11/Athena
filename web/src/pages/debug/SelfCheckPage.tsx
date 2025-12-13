/**
 * SelfCheckPage.tsx - 系统自检页面 (PowerSync 版)
 * 
 * App-First 架构已完成，此页面提供简化的 PowerSync 连接状态检查
 * 
 * @see 09 - APP-FIRST架构改造计划.md
 * @warning 仅限开发/测试环境使用！
 */

import { useNavigate } from 'react-router-dom'
import { usePowerSyncState } from '@/lib/powersync'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowLeft,
  Database,
  Cloud,
  RefreshCw,
} from 'lucide-react'

export default function SelfCheckPage() {
  const navigate = useNavigate()
  const { 
    isInitialized, 
    isConnected, 
    isSyncing, 
    lastSyncedAt, 
    error,
    triggerSync,
    reconnect
  } = usePowerSyncState()

  // 仅在开发环境显示
  if (import.meta.env.PROD) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">此页面仅在开发环境可用</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-2xl font-bold">🔍 PowerSync 状态检查</h1>
        </div>

        {/* 架构说明 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="w-5 h-5" />
              App-First 架构
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <p>✅ 数据源: PowerSync + SQLite (本地优先)</p>
            <p>✅ 同步引擎: PowerSync Service (实时双向同步)</p>
            <p>✅ 文件存储: IndexedDB (OPFS)</p>
            <p>❌ 已移除: Dexie, Heartbeat, SyncQueue</p>
          </CardContent>
        </Card>

        {/* 连接状态 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Cloud className="w-5 h-5" />
              连接状态
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">初始化:</span>
                {isInitialized ? (
                  <Badge variant="default" className="bg-green-500">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    已完成
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    进行中
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">连接:</span>
                {isConnected ? (
                  <Badge variant="default" className="bg-green-500">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    已连接
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <XCircle className="w-3 h-3 mr-1" />
                    未连接
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">同步:</span>
                {isSyncing ? (
                  <Badge variant="secondary">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    同步中
                  </Badge>
                ) : (
                  <Badge variant="outline">空闲</Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">最后同步:</span>
                <span className="text-xs">
                  {lastSyncedAt ? lastSyncedAt.toLocaleString() : '从未'}
                </span>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm text-red-600 dark:text-red-400">
                <strong>错误:</strong> {error.message}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-2 pt-2">
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => triggerSync()}
                disabled={!isConnected || isSyncing}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                手动同步
              </Button>

              {!isConnected && (
                <Button 
                  size="sm" 
                  variant="default"
                  onClick={() => reconnect()}
                >
                  <Cloud className="w-4 h-4 mr-2" />
                  重新连接
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 提示 */}
        <p className="text-xs text-center text-gray-400">
          App-First 架构已完成 • PowerSync + SQLite • 离线优先
        </p>
      </div>
    </div>
  )
}
