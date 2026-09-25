<template>
  <div class="sku-combo-editor">
    <!-- 维度卡片 -->
    <div class="sku-dimensions">
      <div v-for="(dimension, dIndex) in draft.dimensions" :key="dimension.uid" class="sku-dimension"
        :class="{ dragging: dragState?.type === 'dimension' && dragState.from === dIndex }"
        @dragover.prevent="onDimensionDragOver(dIndex)" @drop.prevent="onDimensionDrop(dIndex)">
        <div class="dimension-head">
          <NIcon size="13" class="drag-handle" :title="t('common.sort')"><GripVertical /></NIcon>
          <NInput v-model:value="dimension.name" size="small" :placeholder="t('skuEditor.dimensionName')"
            :disabled="readonly" class="dimension-name" @update:value="commit" />
          <NButtonGroup size="tiny" class="dimension-actions">
            <NButton quaternary size="tiny" :disabled="readonly || dIndex === 0" :title="t('skuEditor.moveUp')"
              :aria-label="t('skuEditor.moveUp')" @click="moveDimension(dIndex, -1)">
              <template #icon><NIcon size="13"><ArrowUp /></NIcon></template>
            </NButton>
            <NButton quaternary size="tiny" :disabled="readonly || dIndex === draft.dimensions.length - 1"
              :title="t('skuEditor.moveDown')" :aria-label="t('skuEditor.moveDown')"
              @click="moveDimension(dIndex, 1)">
              <template #icon><NIcon size="13"><ArrowDown /></NIcon></template>
            </NButton>
            <NButton quaternary size="tiny" :disabled="readonly" :title="t('skuEditor.sortAsc')"
              :aria-label="t('skuEditor.sortAsc')" @click="sortDimensionValues(dIndex, 1)">
              <template #icon><NIcon size="13"><SortAscending /></NIcon></template>
            </NButton>
            <NButton quaternary size="tiny" :disabled="readonly" :title="t('skuEditor.sortDesc')"
              :aria-label="t('skuEditor.sortDesc')" @click="sortDimensionValues(dIndex, -1)">
              <template #icon><NIcon size="13"><SortDescending /></NIcon></template>
            </NButton>
            <NButton quaternary size="tiny" type="error" :disabled="readonly" :title="t('skuEditor.removeDimension')"
              :aria-label="t('skuEditor.removeDimension')" @click="removeDimension(dIndex)">
              <template #icon><NIcon size="13"><Trash /></NIcon></template>
            </NButton>
          </NButtonGroup>
        </div>

        <!-- 维度备注：悬停展示在提示词编辑，帮助理解维度含义 -->
        <NInput v-model:value="dimension.remark" size="tiny" :disabled="readonly"
          class="dimension-remark" :placeholder="t('skuEditor.remarkPlaceholder')"
          @update:value="commit" />

        <!-- 取值 chips：拖拽排序 + 删除 -->
        <div class="dimension-values">
          <span v-for="(value, vIndex) in dimension.values" :key="`${dimension.uid}:${vIndex}`"
            class="value-chip" draggable="true"
            :class="{ dragging: isValueDragging(dIndex, vIndex) }"
            @dragstart="onValueDragStart(dIndex, vIndex)" @dragend="clearDrag"
            @dragover.prevent @drop.prevent="onValueDrop(dIndex, vIndex)">
            {{ value }}
            <NIcon v-if="!readonly" size="11" class="chip-remove" :aria-label="t('common.delete')"
              @click.stop="removeValue(dIndex, vIndex)"><X /></NIcon>
          </span>
          <NInput v-model:value="dimension.batchText" size="tiny" :disabled="readonly"
            class="batch-input" :placeholder="t('skuEditor.batchAddPlaceholder')"
            @keydown.enter.prevent="batchAdd(dIndex)" @blur="batchAdd(dIndex)" />
        </div>
      </div>

      <NButton v-if="draft.dimensions.length < MAX_DIMENSIONS" dashed size="small" :disabled="readonly"
        @click="addDimension">
        <template #icon><NIcon size="14"><Plus /></NIcon></template>
        {{ t('skuEditor.addDimension') }}
      </NButton>
    </div>

    <!-- 拼接符 + 组合统计 -->
    <div class="sku-meta-row">
      <span class="sku-separator-field">
        <span class="meta-label">{{ t('skuEditor.separator') }}</span>
        <NInput v-model:value="draft.separator" size="small" :disabled="readonly" class="separator-input"
          :placeholder="DEFAULT_SKU_SEPARATOR" @update:value="commit" />
      </span>
      <NText depth="3" class="combo-stats" :type="comboCount > 100 ? 'warning' : undefined">
        {{ t('skuEditor.comboStats', { total: comboCount, enabled: enabledCount }) }}
      </NText>
      <NButtonGroup v-if="comboCount > 1" size="tiny">
        <NButton quaternary size="tiny" :disabled="readonly" :title="t('skuEditor.sortAsc')"
          :aria-label="t('skuEditor.sortAsc')" @click="sortCombos(1)">
          <template #icon><NIcon size="13"><SortAscending /></NIcon></template>
        </NButton>
        <NButton quaternary size="tiny" :disabled="readonly" :title="t('skuEditor.sortDesc')"
          :aria-label="t('skuEditor.sortDesc')" @click="sortCombos(-1)">
          <template #icon><NIcon size="13"><SortDescending /></NIcon></template>
        </NButton>
      </NButtonGroup>
    </div>
    <NText v-if="comboCount > 100" depth="3" type="warning" class="combo-warning">
      {{ t('skuEditor.tooManyCombos') }}
    </NText>

    <!-- 组合列表：启用开关 + 拖拽排序 + 图标/配图；长按进入多选批量删除 -->
    <div v-if="combos.length" class="sku-combos">
      <div v-for="(combo, cIndex) in combos" :key="combo.key" class="sku-combo-row"
        :class="{ off: !isEnabled(combo), dragging: dragState?.type === 'combo' && dragState.from === cIndex, selected: comboSelectionMode && isSelected(combo.key) }"
        :draggable="comboCanDrag" @dragstart="onComboDragStart(cIndex)" @dragend="clearDrag"
        @dragover.prevent @drop.prevent="onComboDrop(cIndex)"
        @pointerdown="onRowPressStart(combo.key, $event)" @pointerup="onRowPressEnd"
        @pointerleave="onRowPressEnd" @pointermove="onRowPressMove"
        @click="onRowClick(combo.key)">
        <NIcon size="12" class="drag-handle" :title="t('skuEditor.dragSort')"><GripVertical /></NIcon>
        <NCheckbox size="small" :checked="isEnabled(combo)" :disabled="readonly || comboSelectionMode"
          @update:checked="toggleCombo(combo, $event)" />
        <!-- 装饰触发按钮置前：当前图标/小图或 + 占位，避免与右侧操作相邻误点 -->
        <DecorPicker :meta="comboMeta(combo)" :parent-meta="parentDecor" allow-inherit
          :readonly="readonly || comboSelectionMode"
          @update:meta="patchComboMeta(combo.label, $event)" />
        <span class="combo-label" :title="combo.label">{{ combo.label }}</span>
      </div>
    </div>
    <div v-if="comboSelectionMode" class="combo-selection-toolbar">
      <NPopconfirm :show-arrow="false" @positive-click="removeSelectedCombos">
        <template #trigger>
          <NButton size="tiny" type="error" secondary :disabled="!selectedCombos.length">
            {{ t('skuEditor.deleteSelected', { count: selectedCombos.length }) }}
          </NButton>
        </template>
        {{ t('skuEditor.deleteSelectedConfirm', { count: selectedCombos.length }) }}
      </NPopconfirm>
      <NButton size="tiny" quaternary @click="exitComboSelection">{{ t('common.cancel') }}</NButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton, NButtonGroup, NCheckbox, NIcon, NInput, NPopconfirm, NText,
} from 'naive-ui'
import {
  ArrowDown, ArrowUp, GripVertical, Plus, SortAscending, SortDescending, Trash, X,
} from '@vicons/tabler'
import type { VariableDecor, VariableOptionMeta, VariableSkuConfig } from '@shared/types/database'
import { DEFAULT_SKU_SEPARATOR, skuCombos, splitBatchValues } from '@/lib/utils/prompt-template'
import type { SkuCombo } from '@/lib/utils/prompt-template'
import { useLongPressSelection } from '@/composables/useLongPressSelection'
import DecorPicker from '@/components/common/DecorPicker.vue'

const MAX_DIMENSIONS = 4

interface DimensionDraft {
  uid: number
  name: string
  remark: string
  values: string[]
  batchText: string
}

const props = withDefaults(defineProps<{
  sku: VariableSkuConfig | null
  optionMeta?: Record<string, VariableOptionMeta>
  /** 变量级装饰：供组合「引用上级」 */
  parentDecor?: VariableDecor
  readonly?: boolean
}>(), {
  optionMeta: () => ({}),
  parentDecor: () => ({}),
  readonly: false,
})

const emit = defineEmits<{
  'update:sku': [sku: VariableSkuConfig | null]
  'update:optionMeta': [meta: Record<string, VariableOptionMeta>]
}>()

const { t } = useI18n()

// ---------------------------------------------------------------- 状态同步（lastEmitted 对比，杜绝回写竞态）
const draft = reactive<{ dimensions: DimensionDraft[]; separator: string }>({
  dimensions: [],
  separator: '',
})
let uidSeed = 0
let lastEmitted: string | null = null

const toDraftDimensions = (sku: VariableSkuConfig | null): DimensionDraft[] =>
  (sku?.dimensions || []).map(dimension => ({
    uid: ++uidSeed,
    name: dimension.name,
    remark: dimension.remark || '',
    values: [...dimension.values],
    batchText: '',
  }))

watch(() => props.sku, sku => {
  const incoming = JSON.stringify(sku ?? null)
  if (incoming === lastEmitted) return
  draft.dimensions = toDraftDimensions(sku)
  draft.separator = sku?.separator || ''
}, { immediate: true })

/** 提交当前草稿（空维度 → 发出 null；否则发出完整配置） */
const commit = () => {
  const dimensions = draft.dimensions
    .map(dimension => ({
      name: dimension.name.trim(),
      remark: dimension.remark.trim() || undefined,
      values: [...dimension.values],
    }))
    .filter(dimension => dimension.name || dimension.values.length > 0)
  const valid = dimensions.filter(dimension => dimension.values.length > 0)
  if (!valid.length) {
    lastEmitted = JSON.stringify(null)
    emit('update:sku', null)
    return
  }
  const next: VariableSkuConfig = {
    dimensions,
    separator: draft.separator || undefined,
    enabled: props.sku?.enabled,
    comboOrder: props.sku?.comboOrder,
  }
  lastEmitted = JSON.stringify(next)
  emit('update:sku', next)
}

// ---------------------------------------------------------------- 维度操作
const addDimension = () => {
  draft.dimensions.push({ uid: ++uidSeed, name: '', remark: '', values: [], batchText: '' })
  commit()
}

const removeDimension = (index: number) => {
  draft.dimensions.splice(index, 1)
  commit()
}

const moveDimension = (index: number, delta: number) => {
  const target = index + delta
  if (target < 0 || target >= draft.dimensions.length) return
  const [moved] = draft.dimensions.splice(index, 1)
  draft.dimensions.splice(target, 0, moved)
  commit()
}

const sortDimensionValues = (index: number, direction: 1 | -1) => {
  const dimension = draft.dimensions[index]
  if (!dimension) return
  dimension.values = [...dimension.values].sort((a, b) =>
    direction * a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))
  commit()
}

const removeValue = (dIndex: number, vIndex: number) => {
  draft.dimensions[dIndex]?.values.splice(vIndex, 1)
  commit()
}

/** 批量添加：回车/失焦时按常见分隔符拆分追加 */
const batchAdd = (dIndex: number) => {
  const dimension = draft.dimensions[dIndex]
  if (!dimension || !dimension.batchText.trim()) return
  const additions = splitBatchValues(dimension.batchText).filter(value => !dimension.values.includes(value))
  dimension.values.push(...additions)
  dimension.batchText = ''
  commit()
}

// ---------------------------------------------------------------- 拖拽排序（维度卡片 / 取值 chips / 组合行）
type DragState =
  | { type: 'dimension'; from: number }
  | { type: 'value'; fromDimension: number; fromIndex: number }
  | { type: 'combo'; from: number }

const dragState = ref<DragState | null>(null)
const clearDrag = () => { dragState.value = null }

const onDimensionDragOver = (_index: number) => {}
const onDimensionDrop = (target: number) => {
  const state = dragState.value
  if (state?.type !== 'dimension' || state.from === target) return clearDrag()
  const [moved] = draft.dimensions.splice(state.from, 1)
  draft.dimensions.splice(target, 0, moved)
  clearDrag()
  commit()
}

const isValueDragging = (dIndex: number, vIndex: number) =>
  dragState.value?.type === 'value' && dragState.value.fromDimension === dIndex && dragState.value.fromIndex === vIndex

const onValueDragStart = (dIndex: number, vIndex: number) => {
  dragState.value = { type: 'value', fromDimension: dIndex, fromIndex: vIndex }
}
const onValueDrop = (dIndex: number, vIndex: number) => {
  const state = dragState.value
  clearDrag()
  if (state?.type !== 'value' || state.fromDimension !== dIndex || state.fromIndex === vIndex) return
  const values = draft.dimensions[dIndex]?.values
  if (!values) return
  const [moved] = values.splice(state.fromIndex, 1)
  values.splice(vIndex, 0, moved)
  commit()
}

const onComboDragStart = (index: number) => {
  dragState.value = { type: 'combo', from: index }
}
const onComboDrop = (target: number) => {
  const state = dragState.value
  clearDrag()
  if (state?.type !== 'combo' || state.from === target) return
  const keys = combos.value.map(combo => combo.key)
  const [moved] = keys.splice(state.from, 1)
  keys.splice(target, 0, moved)
  emit('update:sku', {
    dimensions: currentDimensions(),
    separator: draft.separator || undefined,
    enabled: props.sku?.enabled,
    comboOrder: keys,
  })
  lastEmitted = JSON.stringify({ dimensions: currentDimensions(), separator: draft.separator || undefined, enabled: props.sku?.enabled, comboOrder: keys })
}

const sortCombos = (direction: 1 | -1) => {
  const keys = [...combos.value]
    .sort((a, b) => direction * a.label.localeCompare(b.label, 'zh-Hans-CN', { numeric: true }))
    .map(combo => combo.key)
  emit('update:sku', {
    dimensions: currentDimensions(),
    separator: draft.separator || undefined,
    enabled: props.sku?.enabled,
    comboOrder: keys,
  })
  lastEmitted = JSON.stringify({ dimensions: currentDimensions(), separator: draft.separator || undefined, enabled: props.sku?.enabled, comboOrder: keys })
}

// ---------------------------------------------------------------- 组合派生
const currentDimensions = (): VariableSkuConfig['dimensions'] =>
  draft.dimensions
    .map(dimension => ({
      name: dimension.name.trim(),
      remark: dimension.remark.trim() || undefined,
      values: [...dimension.values],
    }))
    .filter(dimension => dimension.values.length > 0)

const combos = computed<SkuCombo[]>(() => skuCombos({
  dimensions: currentDimensions(),
  separator: draft.separator || undefined,
  enabled: props.sku?.enabled,
  comboOrder: props.sku?.comboOrder,
}))

const comboCount = computed(() => combos.value.length)
const enabledCount = computed(() => props.sku?.enabled ? props.sku.enabled.length : comboCount.value)

const isEnabled = (combo: SkuCombo) => !props.sku?.enabled || props.sku.enabled.includes(combo.key)

const toggleCombo = (combo: SkuCombo, checked: boolean) => {
  const allKeys = combos.value.map(item => item.key)
  const current = new Set(props.sku?.enabled ? [...props.sku.enabled] : allKeys)
  if (checked) current.add(combo.key)
  else current.delete(combo.key)
  const enabled = allKeys.filter(key => current.has(key))
  const next: VariableSkuConfig = {
    dimensions: currentDimensions(),
    separator: draft.separator || undefined,
    enabled: enabled.length === allKeys.length ? undefined : enabled,
    comboOrder: props.sku?.comboOrder,
  }
  lastEmitted = JSON.stringify(next)
  emit('update:sku', next)
}

// ---------------------------------------------------------------- 组合长按多选 + 批量移除
const { selectionMode: comboSelectionMode, selected: selectedCombos, startPress, cancelPress, handleClick, isSelected, exitSelection: exitComboSelection } =
  useLongPressSelection(() => props.readonly)

let rowPressStart: { x: number; y: number } | null = null
const onRowPressStart = (key: string, event: PointerEvent) => {
  rowPressStart = { x: event.clientX, y: event.clientY }
  startPress(key)
}
const onRowPressEnd = () => {
  rowPressStart = null
  cancelPress()
}
const onRowPressMove = (event: PointerEvent) => {
  if (!rowPressStart) return
  if (Math.abs(event.clientX - rowPressStart.x) > 6 || Math.abs(event.clientY - rowPressStart.y) > 6) {
    onRowPressEnd()
  }
}
const onRowClick = (key: string) => {
  if (handleClick(key) && !selectedCombos.value.length) exitComboSelection()
}

const comboCanDrag = computed(() => !props.readonly && !comboSelectionMode.value)

/** 批量移除 = 从启用集合剔除（组合由维度派生，不可物理删除单个组合） */
const removeSelectedCombos = () => {
  const doomed = new Set(selectedCombos.value)
  const allKeys = combos.value.map(item => item.key)
  const remaining = allKeys.filter(key => !doomed.has(key) && isEnabled({ key } as SkuCombo))
  const next: VariableSkuConfig = {
    dimensions: currentDimensions(),
    separator: draft.separator || undefined,
    enabled: remaining.length === allKeys.length ? undefined : remaining,
    comboOrder: props.sku?.comboOrder,
  }
  lastEmitted = JSON.stringify(next)
  emit('update:sku', next)
  exitComboSelection()
}

// ---------------------------------------------------------------- 组合图标/配图（统一 DecorPicker）
const comboMeta = (combo: SkuCombo): VariableOptionMeta => props.optionMeta?.[combo.label] || {}

const patchComboMeta = (label: string, meta: VariableOptionMeta) => {
  const next: Record<string, VariableOptionMeta> = { ...(props.optionMeta || {}) }
  if (!meta || Object.keys(meta).length === 0) delete next[label]
  else next[label] = meta
  emit('update:optionMeta', next)
}
</script>

<style scoped>
.sku-combo-editor { display: flex; flex-direction: column; gap: 10px; }
.sku-dimensions { display: flex; flex-direction: column; gap: 8px; }
.sku-dimension { padding: 8px; border: 1px solid var(--border-default); border-radius: var(--radius-control); background: var(--surface-secondary); display: flex; flex-direction: column; gap: 6px; }
.sku-dimension.dragging { opacity: 0.5; }
.dimension-head { display: flex; align-items: center; gap: 4px; }
.drag-handle { color: var(--content-tertiary); cursor: grab; flex: 0 0 auto; }
.dimension-name { flex: 1 1 auto; }
.dimension-name :deep(.n-input__input-el) { font-weight: var(--font-weight-medium); }
.dimension-remark :deep(.n-input__input-el) { font-size: 12px; color: var(--content-secondary); }
.dimension-actions { flex: 0 0 auto; }
.dimension-values { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-height: 24px; }
.value-chip { display: inline-flex; align-items: center; gap: 3px; max-width: 160px; padding: 2px 6px; border: 1px solid var(--border-default); border-radius: 999px; background: var(--surface-primary); font-size: 12px; cursor: grab; user-select: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.value-chip.dragging { opacity: 0.4; }
.chip-remove { flex: 0 0 auto; color: var(--content-tertiary); cursor: pointer; }
.chip-remove:hover { color: var(--error-color, #d33); }
.batch-input { flex: 1 1 120px; min-width: 120px; }
.sku-meta-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sku-separator-field { display: inline-flex; align-items: center; gap: 6px; }
.meta-label { color: var(--content-secondary); font-size: 12px; white-space: nowrap; }
.separator-input { width: 72px; }
.combo-stats { font-size: 12px; font-variant-numeric: tabular-nums; margin-left: auto; }
.combo-warning { font-size: 12px; }
.sku-combos { max-height: 220px; overflow-y: auto; border: 1px solid var(--border-default); border-radius: var(--radius-control); background: var(--surface-secondary); }
.sku-combo-row { display: flex; align-items: center; gap: 6px; min-height: 32px; padding: 2px 8px; cursor: grab; }
.sku-combo-row + .sku-combo-row { border-top: 1px solid var(--border-default); }
.sku-combo-row.dragging { opacity: 0.4; }
.sku-combo-row.selected { background: color-mix(in srgb, var(--accent-primary, #3b81e9) 12%, var(--surface-primary)); }
.sku-combo-row.off .combo-label { color: var(--content-tertiary); text-decoration: line-through; }
.combo-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.combo-selection-toolbar { display: flex; justify-content: flex-end; gap: 6px; }
</style>
