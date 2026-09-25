<template>
  <NTooltip trigger="hover" placement="bottom" :disabled="!(inline && error)" content-style="max-width: 220px">
    <template #trigger>
      <span ref="rootRef" class="prompt-variable-field" :class="[`type-${normalizedType}`, { inline, error, compact }]"
        :style="fieldStyle"
        :data-variable-field="variable.name" :data-first-occurrence="firstOccurrence ? 'true' : 'false'">
        <span v-if="!inline || normalizedType === 'textarea'" class="field-label">
          <span v-if="labelDecor.icon || labelDecor.image" class="field-label-decor">
            <component v-if="labelDecor.icon" :is="resolveIcon(labelDecor.icon)"
              :theme="labelDecor.iconTheme || 'outline'" :size="14" :fill="labelDecor.color || undefined" />
            <img v-else :src="labelDecor.image" alt="" />
          </span>
          <span>{{ variable.name }}</span>
          <span v-if="variable.required" class="required-mark" aria-hidden="true">*</span>
          <NTag v-if="variable.libraryLinked" size="tiny" :bordered="false" class="library-tag">
            {{ t('promptEditor.libraryLinkedTag') }}
          </NTag>
          <NTooltip v-if="variable.description">
            <template #trigger><NIcon size="14" class="field-help"><InfoCircle /></NIcon></template>
            {{ variable.description }}
          </NTooltip>
        </span>

        <span v-if="normalizedType === 'select'" class="select-field-shell">
          <NSelect size="small" :value="modelValue" :options="options" clearable
            :placeholder="placeholder" :status="error ? 'error' : undefined" :consistent-menu-width="false"
            :input-props="inputProps" :render-label="renderSelectLabel"
            @update:value="$emit('update:modelValue', $event)" @blur="$emit('blur')" />
          <!-- 维度备注：组合列表维度带有备注时展示信息图标，悬停查看 -->
          <NTooltip v-if="dimensionRemarks.length" trigger="hover" placement="top" content-style="max-width: 260px">
            <template #trigger>
              <NIcon size="14" class="remark-help" :aria-label="t('promptEditor.dimensionRemarks')"><InfoCircle /></NIcon>
            </template>
            <span class="remark-lines">
              <span v-for="item in dimensionRemarks" :key="item.name" class="remark-line">
                {{ item.name }}：{{ item.remark }}
              </span>
            </span>
          </NTooltip>
          <!-- 可变图标：随选中组合实时切换的图标/配图，强化所选含义 -->
          <span v-if="selectedMeta.image" class="selected-preview">
            <img :src="selectedMeta.image" alt="" />
          </span>
        </span>
        <NInputNumber v-else-if="normalizedType === 'number'" size="small" :value="numberValue" clearable
          :placeholder="placeholder" :status="error ? 'error' : undefined" :input-props="inputProps"
          @update:value="$emit('update:modelValue', $event)" @blur="$emit('blur')" />
        <span v-else-if="normalizedType === 'boolean'" class="boolean-field">
          <NSwitch size="small" :value="Boolean(modelValue)" :input-props="inputProps"
            @update:value="$emit('update:modelValue', $event)" />
          <span v-if="inline" class="boolean-label">{{ variable.name }}</span>
        </span>
        <NInput v-else size="small" :value="stringValue" :type="normalizedType === 'textarea' ? 'textarea' : 'text'"
          :autosize="normalizedType === 'textarea' ? { minRows: compact ? 2 : 3, maxRows: 7 } : undefined"
          :placeholder="placeholder" :status="error ? 'error' : undefined" :input-props="inputProps"
          @update:value="$emit('update:modelValue', $event)" @blur="$emit('blur')" />

        <!-- Non-inline (grid) fields have their own row, so the message can sit in normal flow.
             Inline fields sit inside running text: a visible message would cover whatever follows,
             so it becomes an on-hover tooltip (trigger above) and stays available to screen readers here. -->
        <span v-if="error && !inline" class="field-error" role="alert">{{ t('promptWorkspace.requiredValue') }}</span>
        <span v-else-if="error && inline" class="sr-only" role="alert">{{ t('promptWorkspace.requiredValue') }}</span>
      </span>
    </template>
    {{ t('promptWorkspace.requiredValue') }}
  </NTooltip>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NIcon, NInput, NInputNumber, NSelect, NSwitch, NTag, NTooltip } from 'naive-ui'
import { InfoCircle } from '@vicons/tabler'
import type { VariableDecor } from '@shared/types/database'
import type { EditablePromptVariable } from '@/lib/utils/prompt-template'
import { normalizeVariableType } from '@/lib/utils/prompt-template'
import { resolveIcon } from '@/lib/utils/icon-registry'

const props = withDefaults(defineProps<{
  variable: EditablePromptVariable
  modelValue: any
  inline?: boolean
  error?: boolean
  firstOccurrence?: boolean
  compact?: boolean
}>(), {
  inline: false,
  error: false,
  firstOccurrence: true,
  compact: false,
})

defineEmits<{
  'update:modelValue': [value: any]
  blur: []
}>()

const { t } = useI18n()
const normalizedType = computed(() => normalizeVariableType(props.variable.type))
const placeholder = computed(() => props.variable.placeholder || props.variable.name)
const stringValue = computed(() => props.modelValue === undefined || props.modelValue === null ? '' : String(props.modelValue))
const numberValue = computed(() => {
  if (props.modelValue === '' || props.modelValue === undefined || props.modelValue === null) return null
  const value = Number(props.modelValue)
  return Number.isFinite(value) ? value : null
})
const options = computed(() => (props.variable.options || []).filter(Boolean).map(option => ({ label: option, value: option })))
const metaByOption = computed(() => props.variable.optionMeta || {})
const metaFor = (option: string) => metaByOption.value[option] || {}
/** 变量级装饰：显示在标签旁，也是列表选项「引用上级」的来源 */
const labelDecor = computed<VariableDecor>(() => props.variable.decor || {})
/** 解析选项装饰：声明「引用上级」且自身未设置时，沿用变量级装饰 */
const resolveMeta = (option: string): VariableDecor => {
  const meta = metaFor(option)
  if (meta.inheritParent && !meta.icon && !meta.image) return labelDecor.value
  return meta
}
const selectedMeta = computed(() => resolveMeta(String(props.modelValue ?? '')))
/** 组合列表中带备注的维度（信息图标悬停展示） */
const dimensionRemarks = computed(() => (props.variable.sku?.dimensions || [])
  .filter(dimension => dimension.remark && dimension.remark.trim())
  .map(dimension => ({ name: dimension.name, remark: dimension.remark!.trim() })))

/** 选项渲染：带图标/配图的选项在菜单和选中态里都有可视化标识 */
const renderSelectLabel = (option: { label?: string; value?: string | number }) => {
  const meta = resolveMeta(String(option.value ?? ''))
  const label = h('span', { class: 'select-option-label' }, String(option.label ?? option.value ?? ''))
  let visual: ReturnType<typeof h> | null = null
  if (meta.icon) {
    const iconComponent = resolveIcon(meta.icon)
    if (iconComponent) {
      visual = h(iconComponent, {
        theme: (meta.iconTheme as any) || 'outline',
        size: 14,
        fill: meta.color || undefined,
        style: { marginRight: '6px', flexShrink: 0 },
      })
    }
  } else if (meta.image) {
    visual = h('img', {
      src: meta.image,
      alt: '',
      style: { width: '16px', height: '16px', objectFit: 'cover', borderRadius: '3px', marginRight: '6px', flexShrink: 0 },
    })
  }
  return visual ? h('span', { class: 'select-option-with-visual' }, [visual, label]) : label
}
const inputProps = computed(() => ({
  'aria-label': props.variable.name,
  tabindex: props.firstOccurrence ? 0 : -1,
}))

// Inline controls size themselves to their content instead of a fixed/viewport-relative width.
// The width is measured from the actual glyphs via canvas `measureText` rather than the CSS `ch`
// unit: `1ch` is the advance of "0", so it badly over-estimates narrow glyphs (`-`, space, `i`)
// and a short value such as `1970S` ends up in a box with a wide empty tail. Measuring with the
// control's own computed font keeps the box hugging the text while staying font-agnostic.
const rootRef = ref<HTMLElement | null>(null)
const controlFont = ref('')
const fontReady = ref(false)
let measureContext: CanvasRenderingContext2D | null = null

/** 首次渲染时真实字体可能尚未就绪，先用与主题接近的兜底字体栈测量 */
const FALLBACK_FONT = '14px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
/** 内容宽度上限（px）：超长值不该把整行撑爆（CSS 侧还有 92vw 兜底） */
const MAX_TEXT_PX = 560

const measureTextPx = (text: string): number => {
  if (!text) return 0
  if (!measureContext && typeof document !== 'undefined') {
    measureContext = document.createElement('canvas').getContext('2d')
  }
  if (!measureContext) return 0
  measureContext.font = controlFont.value || FALLBACK_FONT
  return measureContext.measureText(text).width
}

onMounted(() => {
  const control = rootRef.value?.querySelector('.n-input, .n-select, .n-input-number, .n-base-selection')
  if (control) {
    const style = getComputedStyle(control)
    controlFont.value = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  }
  // 自定义字体加载完成后字宽会变，触发一次重算（否则首帧测量值会一直留着）
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    void document.fonts.ready.then(() => { fontReady.value = true })
  }
})

/** 会跟随内容自适应的内联控件类型（boolean 是开关+标签，不参与） */
const sizedInlineTypes = ['text', 'select', 'number']
const isContentSized = computed(() => props.inline && sizedInlineTypes.includes(normalizedType.value))
// Base the width on the live value first; only when it's empty fall back to the default value /
// placeholder / variable name, so a short selection can actually shrink the box.
const referenceText = computed(() => {
  const current = stringValue.value
  if (current) return current
  return props.variable.defaultValue || placeholder.value || props.variable.name || ''
})
/** 文字实际像素宽度：供各控件类型的 CSS 叠加自身 chrome（内边距/箭头/步进器） */
const referenceTextPx = computed(() => {
  void fontReady.value
  const measured = Math.max(measureTextPx(referenceText.value), measureTextPx(stringValue.value))
  return Math.min(Math.round(measured), MAX_TEXT_PX)
})
const fieldStyle = computed(() => (
  isContentSized.value ? { '--field-text-px': String(referenceTextPx.value) } : undefined
))
</script>

<style scoped>
.prompt-variable-field { position: relative; display: flex; flex-direction: column; gap: 5px; min-width: 0; vertical-align: baseline; }
.prompt-variable-field.inline { display: inline-flex; max-width: 100%; margin: 2px 4px; vertical-align: middle; }
.prompt-variable-field.inline.type-number { min-width: 0; }
.prompt-variable-field.inline.type-select { min-width: 0; width: auto; }
.prompt-variable-field.inline.type-boolean { min-width: 0; }
/* Width tracks content for every inline control: --field-text-px is the measured pixel width of
   the live value (falling back to the default value / placeholder / variable name), recomputed as
   the user types and capped so a long value can't stretch the surrounding line awkwardly.
   Each control adds only the chrome it really owns (padding / arrow / stepper), so short values
   no longer sit in an over-wide box. */
.prompt-variable-field.type-text.inline { width: auto; max-width: 100%; }
/* The upper clamp bound uses vw rather than % because this field's own width is auto (shrink to
   fit), so a plain percentage here has no well-defined containing block to resolve against and
   would silently fall back to the browser's default input width. */
.prompt-variable-field.type-text.inline :deep(.n-input) { width: clamp(64px, calc(var(--field-text-px, 68) * 1px + 26px), 92vw); }
/* Selects reserve room for the arrow; numbers for the stepper. Both keep a floor wide enough to
   stay clickable. */
.prompt-variable-field.type-select.inline :deep(.n-select) { width: clamp(72px, calc(var(--field-text-px, 68) * 1px + 44px), 92vw); }
.prompt-variable-field.type-number.inline :deep(.n-input-number) { width: clamp(76px, calc(var(--field-text-px, 68) * 1px + 48px), 92vw); }
.prompt-variable-field.type-textarea { width: 100%; margin: 10px 0; padding: var(--compact-padding); border-radius: var(--radius-panel); background: var(--surface-secondary); }
.field-label { display: flex; align-items: center; gap: 4px; color: var(--content-secondary); font-size: 13px; font-weight: var(--font-weight-medium); }
/* 变量级图标/图片：变量标签旁的可视标识 */
.field-label-decor { display: inline-flex; align-items: center; flex: 0 0 auto; color: var(--accent-primary); }
.field-label-decor img { width: 16px; height: 16px; object-fit: cover; border-radius: 3px; display: block; }
.required-mark { color: var(--accent-error); }
.library-tag { flex: 0 0 auto; color: var(--accent-primary); background: var(--surface-tertiary); font-size: 11px; }
.field-help { color: var(--content-tertiary); cursor: help; }
.boolean-field { min-height: 34px; display: inline-flex; align-items: center; gap: 7px; }
.boolean-label { color: var(--content-secondary); font-size: 13px; }
.field-error { color: var(--accent-error); font-size: 12px; line-height: 1.3; }
/* Kept off-screen (not display:none) so screen readers still announce the alert; the input's own
   error-status border is the persistent visual cue, and the wrapping NTooltip surfaces the same
   text on hover without covering the text that follows in the sentence. */
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
.prompt-variable-field.compact.inline { min-width: 100px; }
.prompt-variable-field.compact.inline.type-text { min-width: 0; }
.select-field-shell { display: flex; align-items: center; gap: 6px; min-width: 0; }
.select-field-shell .n-select { flex: 0 0 auto; min-width: 0; }
.select-option-with-visual { display: inline-flex; align-items: center; min-width: 0; }
.remark-help { flex: 0 0 auto; color: var(--content-tertiary); cursor: help; }
.remark-lines { display: flex; flex-direction: column; gap: 2px; }
.remark-line { white-space: nowrap; }
.select-option-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.selected-preview { flex: 0 0 auto; display: inline-flex; }
.selected-preview img { width: 28px; height: 28px; object-fit: cover; border-radius: var(--radius-control); border: 1px solid var(--border-default); }
.prompt-variable-field :deep(.n-input) {
  --n-color: var(--surface-primary) !important;
  --n-color-focus: var(--surface-primary) !important;
  --n-color-disabled: var(--surface-secondary) !important;
  --n-border: 1px solid var(--border-default) !important;
}
.prompt-variable-field :deep(.n-base-selection) {
  --n-color: var(--surface-primary) !important;
  --n-color-active: var(--surface-primary) !important;
  --n-color-disabled: var(--surface-secondary) !important;
  --n-border: 1px solid var(--border-default) !important;
}
.prompt-variable-field.type-textarea :deep(.n-input) {
  --n-color: var(--surface-secondary) !important;
  --n-color-focus: var(--surface-secondary) !important;
}
</style>
