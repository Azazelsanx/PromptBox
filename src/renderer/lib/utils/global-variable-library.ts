import { ref, type Ref } from 'vue'
import type { GlobalVariable } from '@shared/types/database'
import { onDataChange } from '@/lib/services/data-change-events'
import { VariableService } from '@/lib/services/variable.service'

/**
 * 全局变量库的响应式快照（模块级单例）。
 *
 * 填充链路（PromptFillCanvas / PromptUseWorkspace）与编辑器右键菜单
 * 都通过这里取库变量：首次调用加载一次，之后监听 globalVariables /
 * variableGroups 的数据变更事件自动刷新，库内改动即时反映到所有引用面。
 */
const libraryVariables: Ref<GlobalVariable[]> = ref([])
/** 分组 uuid → 从根到该分组的名称路径（如 ["人物主体", "基本特征", "年龄阶段"]） */
const libraryGroupPaths: Ref<Map<string, string[]>> = ref(new Map())
let loadPromise: Promise<void> | null = null
let subscribed = false

const reload = (): Promise<void> => {
  loadPromise = VariableService.getInstance()
    .getGroupTree()
    .then(tree => {
      const pathMap = new Map<string, string[]>()
      const walk = (nodes: typeof tree) => {
        nodes.forEach(node => {
          pathMap.set(node.uuid, node.path)
          if (node.children?.length) walk(node.children)
        })
      }
      walk(tree)
      libraryGroupPaths.value = pathMap
      return VariableService.getInstance().getAllVariables()
    })
    .then(variables => {
      libraryVariables.value = variables
    })
    .catch(error => {
      console.error('加载全局变量库失败:', error)
    })
  return loadPromise
}

export function useGlobalVariableLibrary(): {
  libraryVariables: Ref<GlobalVariable[]>
  libraryGroupPaths: Ref<Map<string, string[]>>
  reload: () => Promise<void>
} {
  if (!loadPromise) void reload()
  if (!subscribed) {
    subscribed = true
    onDataChange(['globalVariables', 'variableGroups'], () => {
      void reload()
    })
  }
  return { libraryVariables, libraryGroupPaths, reload }
}
