/**
 * 表单草稿持久化（localStorage）：编辑器实时自动保存，保存成功后清除。
 * 图片 Blob 等不可序列化字段由 caller 自行裁剪。
 */
const PREFIX = 'promptbox:form-draft:'

export interface DraftRecord<T> {
  data: T
  savedAt: number
}

export function loadDraft<T>(key: string): DraftRecord<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftRecord<T>
    if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveDraft<T>(key: string, data: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt: Date.now() }))
  } catch {
    // 容量超限等场景静默失败，草稿属尽力而为
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    // ignore
  }
}
