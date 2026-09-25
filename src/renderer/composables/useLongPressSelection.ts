import { ref } from 'vue'

/**
 * 长按进入多选的选项选择状态：
 * - 长按（500ms，位移 ≤6px）某一项进入选择模式并选中它
 * - 选择模式下点击切换选中；普通模式点击返回 false（caller 保留原行为）
 * - exitSelection 退出并清空
 */
export function useLongPressSelection(readonly: () => boolean) {
  const selectionMode = ref(false)
  const selected = ref<string[]>([])
  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let pressCancelled = false

  const startPress = (key: string) => {
    if (readonly()) return
    pressCancelled = false
    pressTimer = setTimeout(() => {
      pressTimer = null
      if (pressCancelled) return
      selectionMode.value = true
      selected.value = [key]
    }, 500)
  }

  const cancelPress = () => {
    pressCancelled = true
    if (pressTimer !== null) {
      clearTimeout(pressTimer)
      pressTimer = null
    }
  }

  /** 选择模式下点击切换选中；返回是否已消费该点击 */
  const handleClick = (key: string): boolean => {
    if (!selectionMode.value) return false
    const index = selected.value.indexOf(key)
    if (index >= 0) selected.value.splice(index, 1)
    else selected.value.push(key)
    return true
  }

  const isSelected = (key: string) => selected.value.includes(key)

  const exitSelection = () => {
    selectionMode.value = false
    selected.value = []
    cancelPress()
  }

  return { selectionMode, selected, startPress, cancelPress, handleClick, isSelected, exitSelection }
}
