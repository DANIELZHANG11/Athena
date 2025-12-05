/**
 * ReadNowPage - 立即阅读欢迎页
 *
 * 用途：
 * - 展示欢迎文案与进入阅读的入口（占位内容）
 *
 * 说明：仅新增注释，不改动渲染内容与样式
 */
export default function ReadNowPage() {
    return (
        <div className="flex items-center justify-center min-h-screen bg-system-background">
            <div className="text-center p-8">
                <h1 className="text-4xl font-bold text-label mb-4">Welcome to Athena</h1>
                <p className="text-xl text-secondary-label">Your reading journey starts here.</p>
            </div>
        </div>
    )
}
