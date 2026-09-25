<template>
  <NModal :show="show" :mask-closable="true" display-directive="show" @update:show="handleShowChange">
    <div class="variable-picker-modal" role="dialog" aria-modal="true">
      <header class="picker-header">
        <div>
          <NText strong>{{ t('promptEditor.insertVariable') }}</NText>
          <NText depth="3" class="picker-subtitle">
            {{ t('promptEditor.variableCount', { count: totalCount }) }}
          </NText>
        </div>
      </header>

      <div class="picker-body">
        <NInput v-model:value="keyword" size="small" clearable :placeholder="t('promptEditor.searchVariablePlaceholder')"
          @keyup.enter="pendingName && confirmPick(pendingName)">
          <template #prefix><NIcon size="16"><Search /></NIcon></template>
        </NInput>

        <NScrollbar class="picker-list">
          <template v-for="group in groups" :key="group.key">
            <template v-if="group.items.length">
              <NText depth="3" class="picker-group-label">{{ group.label }}</NText>
              <button v-for="item in group.items" :key="`${group.key}:${item.name}`" type="button"
                class="picker-item" :class="{ pending: pendingName === item.name }"
                @click="pendingName = item.name" @dblclick="confirmPick(item.name)">
                <span class="picker-item-main">
                  <NIcon size="16"><Braces /></NIcon>
                  <span class="picker-item-name">{{ item.name }}</span>
                </span>
                <span class="picker-item-meta">{{ item.typeLabel }}</span>
              </button>
            </template>
          </template>
          <NEmpty v-if="!totalCount" size="small" :description="t('promptEditor.noSearchMatch')" class="picker-empty" />
        </NScrollbar>
      </div>

      <footer class="picker-footer">
        <NText depth="3" class="picker-hint">{{ t('promptEditor.pickerHint') }}</NText>
        <div class="picker-actions">
          <NButton size="small" quaternary @click="handleShowChange(false)">{{ t('common.cancel') }}</NButton>
          <NButton size="small" type="primary" :disabled="!pendingName" @click="pendingName && confirmPick(pendingName)">
            {{ t('promptEditor.confirmInsert') }}
          </NButton>
        </div>
      </footer>
    </div>
  </NModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NEmpty, NIcon, NInput, NModal, NScrollbar, NText } from 'naive-ui'
import { Braces, Search } from '@vicons/tabler'
import type { EditablePromptVariable } from '@/lib/utils/prompt-template'
import { matchesVariableKeyword, normalizeVariableType } from '@/lib/utils/prompt-template'

const props = withDefaults(defineProps<{
  show: boolean
  variables: EditablePromptVariable[]
  activeNames?: string[]
  libraryVariables?: EditablePromptVariable[]
}>(), {
  activeNames: () => [],
  libraryVariables: () => [],
})

const emit = defineEmits<{
  'update:show': [value: boolean]
  confirm: [name: string]
}>()

const { t } = useI18n()
const keyword = ref('')
const pendingName = ref('')

watch(() => props.show, show => {
  if (show) {
    keyword.value = ''
    pendingName.value = ''
  }
})

interface PickerItem { name: string; typeLabel: string }

const baseTypeLabels = computed(() => [
  { value: 'text', label: t('promptEditor.typeText') },
  { value: 'textarea', label: t('promptEditor.typeTextarea') },
  { value: 'select', label: t('promptEditor.typeSelect') },
  { value: 'number', label: t('promptEditor.typeNumber') },
  { value: 'boolean', label: t('promptEditor.typeBoolean') },
])

const typeLabel = (type: string) => baseTypeLabels.value
  .find(option => option.value === normalizeVariableType(type))?.label || type

const matchesKeyword = (variable: EditablePromptVariable) =>
  matchesVariableKeyword(variable, keyword.value)

const groups = computed<{ key: string; label: string; items: PickerItem[] }[]>(() => {
  const activeSet = new Set(props.activeNames)
  const promptNames = new Set(props.variables.map(variable => variable.name))
  const toItems = (variables: EditablePromptVariable[]) => variables
    .filter(variable => variable.name && matchesKeyword(variable))
    .map(variable => ({ name: variable.name, typeLabel: typeLabel(variable.type) }))
  const libraryVariables = (props.libraryVariables || [])
    .filter(variable => variable.name && !promptNames.has(variable.name))
  return [
    { key: 'in-use', label: t('promptEditor.inUse'), items: toItems(props.variables.filter(v => activeSet.has(v.name))) },
    { key: 'unused', label: t('promptEditor.unused'), items: toItems(props.variables.filter(v => !activeSet.has(v.name))) },
    { key: 'library', label: t('promptEditor.groupLibraryVariables'), items: toItems(libraryVariables) },
  ]
})

const totalCount = computed(() => groups.value.reduce((sum, group) => sum + group.items.length, 0))

const handleShowChange = (value: boolean) => emit('update:show', value)

const confirmPick = (name: string) => {
  if (!name) return
  emit('confirm', name)
  emit('update:show', false)
}
</script>

<style scoped>
.variable-picker-modal { box-sizing: border-box; width: 400px; max-width: calc(100vw - 48px); border: 1px solid var(--border-default); border-radius: var(--radius-modal); background: var(--surface-primary); box-shadow: var(--shadow-overlay); overflow: hidden; }
.picker-header { min-height: 48px; padding: 10px var(--content-padding); display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-default); background: var(--surface-secondary); }
.picker-subtitle { display: block; margin-top: 2px; font-size: 12px; }
.picker-body { display: flex; flex-direction: column; gap: 8px; padding: var(--compact-padding); }
.picker-list { height: 320px; }
.picker-list :deep(.n-scrollbar-content) { padding: 2px; }
.picker-group-label { display: block; margin: 8px 4px 4px; font-size: 12px; font-weight: var(--font-weight-medium); text-transform: uppercase; letter-spacing: .04em; }
.picker-group-label:first-child { margin-top: 0; }
.picker-item { width: 100%; min-height: 36px; padding: 6px 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 0; border-radius: var(--radius-control); color: var(--content-primary); background: transparent; font: inherit; text-align: left; cursor: pointer; }
.picker-item:hover { background: var(--interactive-hover); }
.picker-item.pending { background: var(--surface-tertiary); font-weight: var(--font-weight-medium); }
.picker-item:focus-visible { outline: 2px solid var(--interactive-focus); outline-offset: 1px; }
.picker-item-main { min-width: 0; display: flex; align-items: center; gap: 6px; }
.picker-item-main :deep(.n-icon) { flex: 0 0 auto; color: var(--accent-primary); }
.picker-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.picker-item-meta { flex: 0 0 auto; color: var(--content-secondary); font-size: 12px; }
.picker-empty { padding: 28px 12px; }
.picker-footer { min-height: 52px; padding: 10px var(--content-padding); display: flex; align-items: center; justify-content: space-between; gap: var(--compact-padding); border-top: 1px solid var(--border-default); background: var(--surface-secondary); }
.picker-hint { font-size: 12px; }
.picker-actions { display: flex; gap: 8px; }
</style>
