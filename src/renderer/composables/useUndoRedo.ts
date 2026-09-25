import { ref } from 'vue'

/**
 * 通用撤销/恢复栈：按快照字符串比较，合并窗口内连续变更只记一步。
 * 适用于表单编辑器：caller 提供 serialize/apply，watch 里调 scheduleChange。
 */
export interface UndoRedoOptions {
  /** 当前状态快照（建议 JSON.stringify） */
  serialize: () => string
  /** 应用快照到表单（需防止触发回写竞态，caller 自行置 suppress 标记） */
  apply: (snapshot: string) => void
  /** 变更合并窗口 ms，窗口内连续修改只记一步 */
  delay?: number
  /** 栈深上限 */
  limit?: number
}

export function useUndoRedo(options: UndoRedoOptions) {
  const delay = options.delay ?? 500
  const limit = options.limit ?? 100

  const canUndo = ref(false)
  const canRedo = ref(false)

  let undoStack: string[] = []
  let redoStack: string[] = []
  let lastSnapshot: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  /** apply 回放期间暂停记录，防止恢复操作被当成新变更 */
  let replaying = false

  const updateFlags = () => {
    canUndo.value = undoStack.length > 0
    canRedo.value = redoStack.length > 0
  }

  const commitPush = () => {
    timer = null
    if (replaying) return
    const snapshot = options.serialize()
    if (snapshot === lastSnapshot) return
    if (lastSnapshot !== null) {
      undoStack.push(lastSnapshot)
      if (undoStack.length > limit) undoStack.shift()
    }
    lastSnapshot = snapshot
    redoStack = []
    updateFlags()
  }

  /** 状态变化时调用：合并窗口内连续变更只记一步 */
  const scheduleChange = () => {
    if (replaying || timer !== null) return
    timer = setTimeout(commitPush, delay)
  }

  /** 立即落栈（保存/关闭前调用，避免窗口丢失） */
  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer)
      commitPush()
    }
  }

  const reset = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    undoStack = []
    redoStack = []
    lastSnapshot = options.serialize()
    updateFlags()
  }

  const undo = () => {
    const previous = undoStack.pop()
    if (previous === undefined) return
    flush()
    if (lastSnapshot !== null) redoStack.push(lastSnapshot)
    replaying = true
    try {
      options.apply(previous)
      lastSnapshot = options.serialize()
    } finally {
      replaying = false
    }
    updateFlags()
  }

  const redo = () => {
    const next = redoStack.pop()
    if (next === undefined) return
    flush()
    if (lastSnapshot !== null) undoStack.push(lastSnapshot)
    replaying = true
    try {
      options.apply(next)
      lastSnapshot = options.serialize()
    } finally {
      replaying = false
    }
    updateFlags()
  }

  return { canUndo, canRedo, scheduleChange, undo, redo, reset, flush }
}
