<template>
  <NCard size="small" class="variable-inspector">
    <template #header>
      <div class="inspector-header">
        <div>
          <NText strong>{{ t('promptEditor.variables') }}</NText>
          <NText depth="3" class="inspector-subtitle">
            {{ t('promptEditor.variableCount', { count: activeVariables.length }) }}
          </NText>
        </div>
        <NButton size="small" :disabled="readonly" @click="$emit('request-add')">
          <template #icon><NIcon size="16"><Plus /></NIcon></template>
          {{ t('promptEditor.addVariable') }}
        </NButton>
      </div>
    </template>

    <div class="inspector-layout">
      <div class="inspector-directory">
        <NInput v-model:value="searchKeyword" size="small" clearable class="directory-search"
          :placeholder="t('promptEditor.searchVariablePlaceholder')">
          <template #prefix><NIcon size="16"><Search /></NIcon></template>
        </NInput>

        <NScrollbar class="variable-directory">
          <div v-if="filteredActive.length" class="variable-group">
            <NText depth="3" class="group-label">{{ t('promptEditor.inUse') }}</NText>
            <button v-for="variable in filteredActive" :key="variable.name" type="button"
              class="variable-directory-item" :class="{ selected: selectedVariable === variable.name }"
              @click="$emit('select', variable.name)" @dblclick="$emit('request-insert', variable.name)"
              @contextmenu.stop.prevent="openContextMenu($event, variable.name)">
              <span class="variable-directory-main">
                <NIcon size="16"><Braces /></NIcon>
                <span class="variable-directory-name">{{ variable.name }}</span>
              </span>
              <span class="variable-directory-meta">
                <span>{{ typeLabel(variable.type) }}</span>
                <span v-if="occurrences[variable.name]">×{{ occurrences[variable.name] }}</span>
              </span>
            </button>
          </div>

          <div v-if="filteredUnused.length" class="variable-group unused-group">
            <NText depth="3" class="group-label">{{ t('promptEditor.unused') }}</NText>
            <button v-for="variable in filteredUnused" :key="variable.name" type="button"
              class="variable-directory-item unused" :class="{ selected: selectedVariable === variable.name }"
              @click="$emit('select', variable.name)" @dblclick="$emit('request-insert', variable.name)"
              @contextmenu.stop.prevent="openContextMenu($event, variable.name)">
              <span class="variable-directory-main">
                <NIcon size="16"><AlertCircle /></NIcon>
                <span class="variable-directory-name">{{ variable.name }}</span>
              </span>
              <span class="variable-directory-meta">{{ t('promptEditor.notInserted') }}</span>
            </button>
          </div>

          <div v-for="group in libraryGroups" :key="group.key" class="variable-group library-group">
            <button type="button" class="group-toggle" :aria-expanded="!collapsedLibraryGroups.has(group.key)"
              @click="toggleLibraryGroup(group.key)">
              <NIcon size="14" class="group-toggle-chevron"
                :class="{ collapsed: collapsedLibraryGroups.has(group.key) }">
                <ChevronDown />
              </NIcon>
              <span class="group-toggle-label">{{ group.label }}</span>
              <span class="group-toggle-count">{{ group.items.length }}</span>
            </button>
            <NCollapseTransition :show="!collapsedLibraryGroups.has(group.key)">
              <button v-for="definition in group.items" :key="definition.uuid" type="button"
                class="variable-directory-item library"
                :class="{ selected: selectedVariable === definition.name }"
                @click="$emit('select', definition.name)"
                @dblclick="$emit('request-insert', definition.name)">
                <span class="variable-directory-main">
                  <NIcon size="16"><Braces /></NIcon>
                  <span class="variable-directory-name">{{ definition.name }}</span>
                </span>
                <span class="variable-directory-meta">
                  <span>{{ typeLabel(definition.type) }}</span>
                </span>
              </button>
            </NCollapseTransition>
          </div>

          <NEmpty v-if="variables.length && !filteredActive.length && !filteredUnused.length && !libraryGroups.length"
            size="small" :description="t('promptEditor.noSearchMatch')" class="variable-empty" />

          <NEmpty v-if="!variables.length && !libraryGroups.length" size="small"
            :description="t('promptEditor.noVariables')" class="variable-empty">
            <template #extra>
              <NButton size="small" :disabled="readonly" @click="$emit('request-add')">
                {{ t('promptEditor.addFirstVariable') }}
              </NButton>
            </template>
          </NEmpty>
        </NScrollbar>
      </div>

      <div class="inspector-hint">
        <NIcon size="14"><InfoCircle /></NIcon>
        <span>{{ t('promptEditor.variableListHint') }}</span>
      </div>
    </div>

    <NDropdown trigger="manual" :show="contextMenu.show" :x="contextMenu.x" :y="contextMenu.y"
      placement="bottom-start" :options="contextMenuOptions" @select="handleContextMenuSelect"
      @clickoutside="closeContextMenu" />

    <VariableEditModal :show="editModalShow" :variable="editTarget" :variables="variables"
      :occurrence-count="editTarget ? (occurrences[editTarget.name] || 0) : 0" :readonly="readonly" :jinja="jinja"
      :default-rule="editTarget ? (libraryRules?.[editTarget.name] || null) : null"
      @update:show="editModalShow = $event" @save="handleEditSave" @remove="handleEditRemove" />
  </NCard>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NCollapseTransition, NDropdown, NEmpty, NIcon, NInput, NScrollbar, NText } from 'naive-ui'
import { AlertCircle, Braces, ChevronDown, InfoCircle, Plus, Search } from '@vicons/tabler'
import VariableEditModal from './VariableEditModal.vue'
import type { GlobalVariable, VariableDisplayRule } from '@shared/types/database'
import type { EditablePromptVariable } from '@/lib/utils/prompt-template'
import { matchesVariableKeyword, normalizeVariableType } from '@/lib/utils/prompt-template'

const props = withDefaults(defineProps<{
  variables: EditablePromptVariable[]
  activeNames: string[]
  occurrences: Record<string, number>
  selectedVariable?: string
  readonly?: boolean
  jinja?: boolean
  /** 全局变量库的默认显示规则（按变量名索引），供变量编辑弹窗展示「跟随默认」 */
  libraryRules?: Record<string, VariableDisplayRule>
  /** 全局变量库变量（未在正文中使用的那些会按分组列出，可一键插入） */
  libraryVariables?: GlobalVariable[]
  /** 库分组 uuid → 名称路径，用于把库变量归入其分组 */
  libraryGroupPaths?: Map<string, string[]>
}>(), {
  selectedVariable: '',
  readonly: false,
  jinja: false,
  libraryRules: undefined,
  libraryVariables: () => [],
  libraryGroupPaths: () => new Map<string, string[]>(),
})

const emit = defineEmits<{
  select: [name: string]
  'request-add': []
  'request-insert': [name: string]
  'request-remove': [name: string]
  'update-variable': [payload: { previousName: string; variable: EditablePromptVariable }]
}>()

const { t } = useI18n()
const searchKeyword = ref('')
const contextMenu = reactive({ show: false, x: 0, y: 0 })
const contextName = ref('')
const editModalShow = ref(false)
const editTarget = ref<EditablePromptVariable | null>(null)

const activeNameSet = computed(() => new Set(props.activeNames))
const activeVariables = computed(() => props.variables.filter(variable => activeNameSet.value.has(variable.name)))
const unusedVariables = computed(() => props.variables.filter(variable => !activeNameSet.value.has(variable.name)))

const matchesKeyword = (variable: EditablePromptVariable) =>
  matchesVariableKeyword(variable, searchKeyword.value)
const filteredActive = computed(() => activeVariables.value.filter(matchesKeyword))
const filteredUnused = computed(() => unusedVariables.value.filter(matchesKeyword))

/** 正文里已经存在的变量名：库分区不重复列出同名项 */
const localNameSet = computed(() => new Set(props.variables.map(variable => variable.name)))

/**
 * 库变量按分组聚合成有序分区（分组路径 → 变量列表）。
 * 分组间隔沿用 `getGroupTree` 的 sortOrder 顺序，未分组的排在最后。
 */
const libraryGroups = computed(() => {
  const buckets = new Map<string, { label: string; icon?: string; color?: string; items: GlobalVariable[] }>()

  props.libraryVariables
    .filter(definition => definition.name && !localNameSet.value.has(definition.name))
    .filter(definition => matchesVariableKeyword(definition, searchKeyword.value))
    .forEach(definition => {
      const path = definition.groupUuid ? props.libraryGroupPaths.get(definition.groupUuid) : undefined
      const key = path?.length ? path.join('/') : ''
      const bucket = buckets.get(key) ?? {
        label: path?.length ? path.join(' / ') : t('promptEditor.ungroupedVariables'),
        items: [],
      }
      bucket.items.push(definition)
      buckets.set(key, bucket)
    })

  // 有分组的在前（按路径字典序保持树层次稳定），「未分组」垫底
  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([key, bucket]) => ({ key: key || '__ungrouped__', ...bucket }))
})

/** 折叠状态：默认全部展开，用户点过后以自己的选择为准 */
const collapsedLibraryGroups = ref(new Set<string>())
const toggleLibraryGroup = (key: string) => {
  const next = new Set(collapsedLibraryGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedLibraryGroups.value = next
}

const baseTypeOptions = computed(() => [
  { label: t('promptEditor.typeText'), value: 'text' },
  { label: t('promptEditor.typeTextarea'), value: 'textarea' },
  { label: t('promptEditor.typeSelect'), value: 'select' },
  { label: t('promptEditor.typeNumber'), value: 'number' },
  { label: t('promptEditor.typeBoolean'), value: 'boolean' },
])
const typeOptions = computed(() => props.jinja
  ? [
    { label: `${t('promptEditor.typeText')} (str)`, value: 'str' },
    { label: `${t('promptEditor.typeNumber')} (int)`, value: 'int' },
    { label: `${t('promptEditor.typeNumber')} (float)`, value: 'float' },
    { label: `${t('promptEditor.typeBoolean')} (bool)`, value: 'bool' },
    { label: t('promptEditor.typeList'), value: 'list' },
    { label: t('promptEditor.typeDict'), value: 'dict' },
  ]
  : baseTypeOptions.value)
const typeLabel = (type: string) => typeOptions.value.find(option => option.value === type)?.label
  || baseTypeOptions.value.find(option => option.value === normalizeVariableType(type))?.label
  || type

const contextMenuOptions = computed(() => [
  { label: t('promptEditor.contextEdit'), key: 'edit' },
  { label: t('promptEditor.contextInsert'), key: 'insert', disabled: props.readonly },
])

const openContextMenu = (event: MouseEvent, name: string) => {
  contextName.value = name
  contextMenu.x = event.clientX
  contextMenu.y = event.clientY
  contextMenu.show = true
}
const closeContextMenu = () => {
  contextMenu.show = false
}
const handleContextMenuSelect = (key: string) => {
  contextMenu.show = false
  if (key === 'insert') emit('request-insert', contextName.value)
  else if (key === 'edit') openEditModal(contextName.value)
}

const openEditModal = (name: string) => {
  const target = props.variables.find(variable => variable.name === name)
  if (!target) return
  editTarget.value = target
  editModalShow.value = true
}

const handleEditSave = (payload: { previousName: string; variable: EditablePromptVariable }) => {
  emit('update-variable', payload)
}
const handleEditRemove = (name: string) => {
  emit('request-remove', name)
}
</script>

<style scoped>
.variable-inspector { box-sizing: border-box; height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--border-default); background: var(--surface-primary); }
.variable-inspector :deep(> .n-card-header) { flex: 0 0 auto; min-height: 52px; padding: 10px var(--content-padding); border-bottom: 1px solid var(--border-default); background: var(--surface-secondary); }
.variable-inspector :deep(> .n-card__content) { flex: 1 1 0; min-height: 0; padding: 0; overflow: hidden; }
.inspector-header { display: flex; align-items: center; justify-content: space-between; gap: var(--compact-padding); }
.inspector-subtitle { display: block; margin-top: 2px; font-size: 12px; }
.inspector-layout { height: 100%; min-height: 0; display: flex; flex-direction: column; }
.inspector-directory { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: var(--compact-padding); background: var(--surface-secondary); }
.directory-search { flex: 0 0 auto; }
.variable-directory { flex: 1 1 0; min-height: 0; }
.variable-directory :deep(.n-scrollbar-content) { padding: 2px; }
.variable-group + .variable-group { margin-top: var(--content-padding); }
.group-label { display: block; margin: 0 4px 6px; font-size: 12px; font-weight: var(--font-weight-medium); text-transform: uppercase; letter-spacing: .04em; }
/* 库分区折叠头：与 .group-label 同字号同色，整行可点 */
.group-toggle { width: 100%; margin: 0 4px 6px; padding: 0; display: flex; align-items: center; gap: 4px; border: 0; background: transparent; color: var(--content-tertiary); font: inherit; font-size: 12px; font-weight: var(--font-weight-medium); text-transform: uppercase; letter-spacing: .04em; text-align: left; cursor: pointer; }
.group-toggle:hover { color: var(--content-secondary); }
.group-toggle:focus-visible { outline: 2px solid var(--interactive-focus); outline-offset: 1px; }
.group-toggle-chevron { flex: 0 0 auto; transition: transform .15s ease; }
.group-toggle-chevron.collapsed { transform: rotate(-90deg); }
.group-toggle-label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-toggle-count { flex: 0 0 auto; color: var(--content-tertiary); font-weight: var(--font-weight-normal); }
.variable-directory-item { width: 100%; min-height: 36px; padding: 6px 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 0; border-radius: var(--radius-control); color: var(--content-primary); background: transparent; font: inherit; text-align: left; cursor: pointer; }
.variable-directory-item:hover { background: var(--interactive-hover); }
.variable-directory-item.selected { background: var(--surface-tertiary); font-weight: var(--font-weight-medium); }
.variable-directory-item:focus-visible { outline: 2px solid var(--interactive-focus); outline-offset: 1px; }
.variable-directory-item.unused { color: var(--content-secondary); }
/* 库变量：图标改中性色，与正文变量（主色 Braces）区分来源 */
.variable-directory-item.library { color: var(--content-secondary); }
.variable-directory-item.library .variable-directory-main :deep(.n-icon) { color: var(--content-tertiary); }
.variable-directory-main, .variable-directory-meta { display: flex; align-items: center; gap: 6px; min-width: 0; }
.variable-directory-main :deep(.n-icon) { flex: 0 0 auto; color: var(--accent-primary); }
.unused .variable-directory-main :deep(.n-icon) { color: var(--accent-warning); }
.variable-directory-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.variable-directory-meta { flex: 0 0 auto; color: var(--content-secondary); font-size: 12px; font-weight: var(--font-weight-normal); }
.variable-empty { padding: 24px 12px; }
.inspector-hint { flex: 0 0 auto; min-height: 30px; padding: 5px var(--compact-padding); display: flex; align-items: center; gap: 6px; border-top: 1px solid var(--border-default); background: var(--surface-secondary); color: var(--content-secondary); font-size: 12px; }
.inspector-hint :deep(.n-icon) { flex: 0 0 auto; color: var(--content-tertiary); }
</style>
