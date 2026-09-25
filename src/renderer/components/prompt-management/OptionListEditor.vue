<template>
  <div class="option-list-editor">
    <div class="option-chips" @dragover.prevent @drop.prevent="onDrop">
      <span v-for="(option, index) in draft.options" :key="`${index}:${option}`" class="option-chip"
        :draggable="canDrag" :class="{ dragging: dragFrom === index, selected: selectionMode && isSelected(option) }"
        @dragstart="dragFrom = index" @dragend="dragFrom = null"
        @pointerdown="onPressStart(option, $event)" @pointerup="onPressEnd"
        @pointerleave="onPressEnd" @pointermove="onPressMove"
        @click="onChipClick(option, index)">
        <!-- 装饰触发按钮置前：当前图标/小图或 + 占位，避免与删除按钮相邻误点 -->
        <DecorPicker :meta="metaFor(option)" :parent-meta="parentDecor" allow-inherit
          :readonly="readonly || selectionMode"
          @update:meta="patchMeta(option, $event)" />
        <span class="chip-text" :title="option">{{ option }}</span>
        <NIcon v-if="!readonly && !selectionMode" size="11" class="chip-remove" :aria-label="t('common.delete')"
          @click.stop="removeOption(index)"><X /></NIcon>
      </span>
      <NInput v-if="!selectionMode" v-model:value="batchText" size="tiny" :disabled="readonly" class="batch-input"
        :placeholder="t('skuEditor.optionBatchPlaceholder')" @keydown.enter.prevent="batchAdd" @blur="batchAdd" />
    </div>
    <div v-if="draft.options.length > 1 || selectionMode" class="option-toolbar">
      <!-- 多选模式：一键删除所选 + 取消 -->
      <template v-if="selectionMode">
        <NPopconfirm :show-arrow="false" @positive-click="removeSelected">
          <template #trigger>
            <NButton size="tiny" type="error" secondary :disabled="!selected.length">
              {{ t('skuEditor.deleteSelected', { count: selected.length }) }}
            </NButton>
          </template>
          {{ t('skuEditor.deleteSelectedConfirm', { count: selected.length }) }}
        </NPopconfirm>
        <NButton size="tiny" quaternary @click="exitSelection">{{ t('common.cancel') }}</NButton>
      </template>
      <NButtonGroup v-else size="tiny">
        <NButton quaternary size="tiny" :disabled="readonly" :title="t('skuEditor.sortAsc')"
          :aria-label="t('skuEditor.sortAsc')" @click="sortOptions(1)">
          <template #icon><NIcon size="13"><SortAscending /></NIcon></template>
        </NButton>
        <NButton quaternary size="tiny" :disabled="readonly" :title="t('skuEditor.sortDesc')"
          :aria-label="t('skuEditor.sortDesc')" @click="sortOptions(-1)">
          <template #icon><NIcon size="13"><SortDescending /></NIcon></template>
        </NButton>
      </NButtonGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NButtonGroup, NIcon, NInput, NPopconfirm } from 'naive-ui'
import { SortAscending, SortDescending, X } from '@vicons/tabler'
import type { VariableDecor, VariableOptionMeta } from '@shared/types/database'
import { pruneOptionMeta, splitBatchValues } from '@/lib/utils/prompt-template'
import { useLongPressSelection } from '@/composables/useLongPressSelection'
import DecorPicker from '@/components/common/DecorPicker.vue'

const props = withDefaults(defineProps<{
  options: string[]
  optionMeta?: Record<string, VariableOptionMeta>
  /** 变量级装饰：供选项「引用上级」 */
  parentDecor?: VariableDecor
  readonly?: boolean
}>(), {
  optionMeta: () => ({}),
  parentDecor: () => ({}),
  readonly: false,
})

const emit = defineEmits<{
  'update:options': [options: string[]]
  'update:optionMeta': [meta: Record<string, VariableOptionMeta> | undefined]
}>()

const { t } = useI18n()

const draft = reactive<{ options: string[] }>({ options: [] })
const batchText = ref('')
const dragFrom = ref<number | null>(null)
let lastEmitted: string | null = null

// ---------------------------------------------------------------- 长按多选 + 一键删除
const { selectionMode, selected, startPress, cancelPress, handleClick, isSelected, exitSelection } =
  useLongPressSelection(() => props.readonly)

/** 长按期间轻微位移即取消（避免误入多选） */
let pressStart: { x: number; y: number } | null = null
const onPressStart = (option: string, event: PointerEvent) => {
  pressStart = { x: event.clientX, y: event.clientY }
  startPress(option)
}
const onPressEnd = () => {
  pressStart = null
  cancelPress()
}
const onPressMove = (event: PointerEvent) => {
  if (!pressStart) return
  if (Math.abs(event.clientX - pressStart.x) > 6 || Math.abs(event.clientY - pressStart.y) > 6) {
    onPressEnd()
  }
}

const onChipClick = (option: string, index: number) => {
  if (handleClick(option)) {
    if (!selected.value.length) exitSelection()
    return
  }
  // 普通模式无点击行为（删除用 X，排序用拖拽）
  void index
}

const removeSelected = () => {
  const doomed = new Set(selected.value)
  draft.options = draft.options.filter(option => !doomed.has(option))
  commit()
  exitSelection()
}

const canDrag = computed(() => !props.readonly && !selectionMode.value)

watch(() => props.options, options => {
  const incoming = JSON.stringify(options ?? null)
  if (incoming === lastEmitted) return
  draft.options = [...(options || [])]
}, { immediate: true })

const commit = () => {
  const next = [...draft.options]
  lastEmitted = JSON.stringify(next)
  emit('update:options', next)
  // 同步修剪失效的选项元数据
  emit('update:optionMeta', pruneOptionMeta(props.optionMeta, next))
}

const batchAdd = () => {
  if (!batchText.value.trim()) return
  const additions = splitBatchValues(batchText.value).filter(value => !draft.options.includes(value))
  draft.options.push(...additions)
  batchText.value = ''
  commit()
}

const removeOption = (index: number) => {
  draft.options.splice(index, 1)
  commit()
}

const sortOptions = (direction: 1 | -1) => {
  draft.options = [...draft.options].sort((a, b) =>
    direction * a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))
  commit()
}

const onDrop = () => {
  const from = dragFrom.value
  dragFrom.value = null
  if (from === null) return
  // 拖到批输入框附近时落到末尾
  const target = draft.options.length - 1
  if (from === target) return
  const [moved] = draft.options.splice(from, 1)
  draft.options.splice(target, 0, moved)
  commit()
}

// ---------------------------------------------------------------- 逐项图标/配图（统一 DecorPicker）
const metaFor = (option: string): VariableOptionMeta => props.optionMeta?.[option] || {}

const patchMeta = (option: string, meta: VariableOptionMeta) => {
  const next: Record<string, VariableOptionMeta> = { ...(props.optionMeta || {}) }
  if (!meta || Object.keys(meta).length === 0) delete next[option]
  else next[option] = meta
  emit('update:optionMeta', next)
}
</script>

<style scoped>
.option-list-editor { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.option-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px; min-height: 30px; border: 1px solid var(--border-default); border-radius: var(--radius-control); background: var(--surface-secondary); }
.option-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 220px; padding: 2px 6px; border: 1px solid var(--border-default); border-radius: 999px; background: var(--surface-primary); font-size: 12px; cursor: grab; user-select: none; }
.option-chip.dragging { opacity: 0.4; }
.option-chip.selected { border-color: var(--accent-primary, #3b81e9); background: color-mix(in srgb, var(--accent-primary, #3b81e9) 12%, var(--surface-primary)); }
.chip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-remove { color: var(--content-tertiary); cursor: pointer; flex: 0 0 auto; }
.chip-remove:hover { color: var(--error-color, #d33); }
.batch-input { flex: 1 1 130px; min-width: 130px; }
.option-toolbar { display: flex; justify-content: flex-end; gap: 6px; }
</style>
