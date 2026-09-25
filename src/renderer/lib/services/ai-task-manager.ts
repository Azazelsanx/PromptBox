import { reactive } from 'vue'

export type AiTaskStatus = 'running' | 'success' | 'failed' | 'cancelled'

export interface AiTaskRecord {
    /** 任务 id，同时作为主进程 AbortController 的 key */
    id: string
    /** 任务类型，如 'reverse'（图片逆向提示词） */
    type: string
    /** 展示标题，如 Bot 名称 */
    title: string
    model?: string
    status: AiTaskStatus
    startedAt: number
    endedAt?: number
    /** 秒级可读耗时 */
    durationText?: string
    error?: string
    /** 流式生成中：模型已书写出的部分提示词（仅 running 任务实时更新） */
    partial?: string
}

const HISTORY_KEY = 'promptbox.ai-task-logs'
const HISTORY_LIMIT = 100

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    const seconds = ms / 1000
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    const minutes = Math.floor(seconds / 60)
    const rest = Math.round(seconds % 60)
    return `${minutes}m ${rest}s`
}

/**
 * AI 任务管理器（渲染层单例）
 *
 * - running：进行中的任务（reactive，组件可直接 computed 派生进度提示）
 * - history：最近任务日志（localStorage 持久化，跨会话可查）
 * - 取消链路：cancel() 触发 AbortController.abort()，由页面调用
 *   `window.electronAPI.ai.cancelReverseTask(id)` 通知主进程中止推理
 */
class AiTaskManager {
    readonly state = reactive<{
        running: AiTaskRecord[]
        history: AiTaskRecord[]
    }>({ running: [], history: [] })

    private controllers = new Map<string, AbortController>()
    /** 已取消的任务 id（closeTask 会清 controllers，取消判断需独立记录） */
    private cancelledIds = new Set<string>()

    constructor() {
        this.state.history = this.loadHistory()
    }

    /** 登记新任务，返回任务 id 与 AbortSignal（signal 留在渲染层，不跨 IPC） */
    start(input: { type: string; title: string; model?: string }): { id: string; signal: AbortSignal } {
        const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const record: AiTaskRecord = {
            id,
            type: input.type,
            title: input.title,
            model: input.model,
            status: 'running',
            startedAt: Date.now()
        }
        const controller = new AbortController()
        this.controllers.set(id, controller)
        this.state.running.unshift(record)
        return { id, signal: controller.signal }
    }

    /** 流式进展：更新 running 任务已书写的部分提示词 */
    updatePartial(id: string, partial: string) {
        const running = this.state.running.find(task => task.id === id)
        if (running) {
            running.partial = partial
        }
    }

    finish(id: string) {
        this.closeTask(id, 'success')
    }

    fail(id: string, error?: string) {
        this.closeTask(id, 'failed', error)
    }

    /** 取消：中止渲染层信号并返回，由页面负责通知主进程 */
    cancel(id: string): boolean {
        const controller = this.controllers.get(id)
        if (controller) {
            controller.abort()
        }
        const running = this.state.running.find(task => task.id === id)
        if (!running) return false
        this.cancelledIds.add(id)
        if (this.cancelledIds.size > 200) {
            const oldest = this.cancelledIds.values().next().value
            if (oldest !== undefined) this.cancelledIds.delete(oldest)
        }
        this.closeTask(id, 'cancelled')
        return true
    }

    isCancelled(id: string): boolean {
        return this.cancelledIds.has(id)
    }

    clearHistory() {
        this.state.history = []
        this.persist()
    }

    private closeTask(id: string, status: Exclude<AiTaskStatus, 'running'>, error?: string) {
        const index = this.state.running.findIndex(task => task.id === id)
        if (index === -1) return
        const [record] = this.state.running.splice(index, 1)
        const endedAt = Date.now()
        this.state.history.unshift({
            ...record,
            status,
            endedAt,
            durationText: formatDuration(endedAt - record.startedAt),
            error
        })
        if (this.state.history.length > HISTORY_LIMIT) {
            this.state.history.length = HISTORY_LIMIT
        }
        this.controllers.delete(id)
        this.persist()
    }

    private persist() {
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(this.state.history))
        } catch (error) {
            console.warn('任务日志持久化失败:', error)
        }
    }

    private loadHistory(): AiTaskRecord[] {
        try {
            const raw = localStorage.getItem(HISTORY_KEY)
            const parsed = raw ? JSON.parse(raw) : []
            return Array.isArray(parsed) ? parsed : []
        } catch {
            return []
        }
    }
}

export const aiTaskManager = new AiTaskManager()
export { formatDuration as formatTaskDuration }
