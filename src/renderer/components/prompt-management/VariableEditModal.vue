<template>
  <NModal :show="show" :mask-closable="false" display-directive="show" @update:show="handleShowChange">
    <div class="variable-edit-modal" role="dialog" aria-modal="true">
      <header class="edit-modal-header">
        <NText strong>{{ t('promptEditor.editVariableTitle') }}</NText>
      </header>

      <div class="edit-modal-body">
        <NForm label-placement="top" size="small" class="edit-modal-form" :show-feedback="false">
          <NFormItem :label="t('promptManagement.variableName')"
            :validation-status="nameError ? 'error' : undefined" :feedback="nameErrorText">
            <div class="name-decor-row">
              <!-- 变量级图标/图片：所有类型均可用；列表选项可在面板里选「引用上级」 -->
              <DecorPicker :meta="draft.decor" :readonly="readonly" @update:meta="draft.decor = $event" />
              <NInput v-model:value="draft.name" :disabled="readonly" @blur="validateDraftName" />
            </div>
          </NFormItem>

          <div class="edit-modal-row">
            <NFormItem :label="t('promptManagement.variableType')">
              <NSelect v-model:value="draft.type" :options="typeOptions" :disabled="readonly" />
            </NFormItem>
            <NFormItem :label="t('promptManagement.variableRequired')" class="required-field">
              <NSwitch v-model:value="draft.required" :disabled="readonly" />
            </NFormItem>
          </div>

          <NFormItem :label="t('promptManagement.variableDefault')">
            <NSwitch v-if="normalizedType === 'boolean'" :value="draft.defaultValue === 'true'" :disabled="readonly"
              @update:value="draft.defaultValue = $event ? 'true' : 'false'" />
            <NInputNumber v-else-if="normalizedType === 'number'" :value="numberDefault" clearable
              :disabled="readonly" style="width: 100%" @update:value="updateNumberDefault" />
            <NSelect v-else-if="normalizedType === 'select'" :value="draft.defaultValue || null"
              :options="defaultSelectOptions" clearable :disabled="readonly"
              @update:value="draft.defaultValue = $event || ''" />
            <NInput v-else :value="draft.defaultValue || ''" :disabled="readonly"
              :type="normalizedType === 'textarea' ? 'textarea' : 'text'"
              @update:value="draft.defaultValue = $event" />
          </NFormItem>

          <template v-if="normalizedType === 'select'">
            <NFormItem :label="t('promptManagement.variableOptions')">
              <SkuModeSwitch :value="skuMode" :disabled="readonly"
                :has-content="mode => mode === 'simple' ? draft.options.length > 0
                  : !!draft.sku && draft.sku.dimensions.some(dimension => dimension.values.length > 0)"
                @change="applySkuModeSwitch" />
            </NFormItem>
            <NFormItem v-if="skuMode === 'simple'"
              :validation-status="cleanedOptions.length ? undefined : 'error'"
              :feedback="cleanedOptions.length ? undefined : t('promptEditor.selectNeedsOption')">
              <OptionListEditor :options="draft.options" :option-meta="draft.optionMeta"
                :parent-decor="draft.decor" :readonly="readonly"
                @update:options="draft.options = $event" @update:option-meta="draft.optionMeta = $event || {}" />
            </NFormItem>
            <NFormItem v-else
              :validation-status="skuOptions.length ? undefined : 'error'"
              :feedback="skuOptions.length ? undefined : t('skuEditor.needsDimension')">
              <SkuComboEditor :sku="draft.sku" :option-meta="draft.optionMeta"
                :parent-decor="draft.decor" :readonly="readonly"
                @update:sku="draft.sku = $event" @update:option-meta="draft.optionMeta = $event" />
            </NFormItem>
          </template>

          <NFormItem :label="t('displayRule.title')">
            <div class="display-rule-field">
              <VariableDisplayRuleEditor :value="effectiveDisplayRule" :variable-name="draft.name"
                :is-select="normalizedType === 'select'" :readonly="readonly" :sample-value="displaySample"
                @update:value="draft.displayRule = $event" />
              <NButton v-if="draft.displayRule" text size="tiny" class="rule-reset" :disabled="readonly"
                @click="draft.displayRule = null">
                {{ t('displayRule.reset') }}
              </NButton>
              <NText v-else depth="3" class="rule-following">{{ defaultRuleHint }}</NText>
            </div>
          </NFormItem>

          <NFormItem :label="t('promptEditor.inputPlaceholder')">
            <NInput v-model:value="draft.placeholder" :disabled="readonly"
              :placeholder="t('promptEditor.inputPlaceholderHint')" />
          </NFormItem>

          <NFormItem :label="t('promptEditor.description')">
            <NInput v-model:value="draft.description" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }"
              :disabled="readonly" :placeholder="t('promptEditor.descriptionHint')" />
          </NFormItem>
        </NForm>
      </div>

      <footer class="edit-modal-footer">
        <NPopconfirm :positive-text="t('common.delete')" :negative-text="t('common.cancel')"
          @positive-click="handleRemove">
          <template #trigger>
            <NButton size="small" quaternary type="error" :disabled="readonly"
              :aria-label="t('promptEditor.deleteVariable')">
              <template #icon><NIcon size="16"><Trash /></NIcon></template>
            </NButton>
          </template>
          {{ deleteConfirmText }}
        </NPopconfirm>
        <div class="edit-modal-actions">
          <NButton size="small" quaternary @click="handleShowChange(false)">{{ t('common.cancel') }}</NButton>
          <NButton size="small" type="primary" @click="handleSave">{{ t('common.save') }}</NButton>
        </div>
      </footer>
    </div>
  </NModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton, NForm, NFormItem, NIcon, NInput, NInputNumber,
  NModal, NPopconfirm, NSelect, NSwitch, NText,
} from 'naive-ui'
import { Trash } from '@vicons/tabler'
import type { VariableDecor, VariableDisplayRule, VariableOptionMeta, VariableSkuConfig } from '@shared/types/database'
import type { EditablePromptVariable } from '@/lib/utils/prompt-template'
import {
  enabledSkuCombos, normalizeVariableType, pruneOptionMeta, validateVariableName,
} from '@/lib/utils/prompt-template'
import SkuComboEditor from './SkuComboEditor.vue'
import OptionListEditor from './OptionListEditor.vue'
import SkuModeSwitch from './SkuModeSwitch.vue'
import VariableDisplayRuleEditor from './VariableDisplayRuleEditor.vue'
import DecorPicker from '@/components/common/DecorPicker.vue'

const props = withDefaults(defineProps<{
  show: boolean
  variable: EditablePromptVariable | null
  variables: EditablePromptVariable[]
  occurrenceCount?: number
  readonly?: boolean
  jinja?: boolean
  /** 全局变量库给该变量的默认显示规则（本提示词未覆盖时生效） */
  defaultRule?: VariableDisplayRule | null
}>(), {
  occurrenceCount: 0,
  readonly: false,
  jinja: false,
  defaultRule: null,
})

const emit = defineEmits<{
  'update:show': [value: boolean]
  save: [payload: { previousName: string; variable: EditablePromptVariable }]
  remove: [name: string]
}>()

const { t } = useI18n()
const draft = reactive({
  name: '',
  type: 'select',
  required: true,
  defaultValue: '',
  options: [] as string[],
  optionMeta: {} as Record<string, VariableOptionMeta>,
  decor: {} as VariableDecor,
  sku: null as VariableSkuConfig | null,
  /** 提示词内显示规则；null = 未覆盖，跟随全局变量库默认 */
  displayRule: null as VariableDisplayRule | null,
  placeholder: '',
  description: '',
})
const skuMode = ref<'simple' | 'sku'>('simple')
const nameError = ref<string | null>(null)

/** 生效的显示规则：本提示词覆盖优先，否则用库默认；都没有时展示内置默认 */
const effectiveDisplayRule = computed(() => draft.displayRule || props.defaultRule || null)
const displaySample = computed(() => {
  if (!draft.displayRule && !props.defaultRule) return ''
  const first = cleanedOptions.value[0] || draft.defaultValue || ''
  return first
})
const defaultRuleHint = computed(() => (props.defaultRule
  ? t('displayRule.followingLibrary')
  : t('displayRule.followingDefault')))

/** 简单/组合列表切换（确认流程在 SkuModeSwitch 内）：clearLeft 时清空被离开模式的全部选项 */
const applySkuModeSwitch = (target: 'simple' | 'sku', clearLeft: boolean) => {
  skuMode.value = target
  if (!clearLeft) return
  if (target === 'sku') {
    draft.options = []
    draft.optionMeta = {}
  } else {
    draft.sku = null
  }
}

watch(() => [props.show, props.variable] as const, ([show, variable]) => {
  if (!show || !variable) return
  draft.name = variable.name
  draft.type = variable.type
  draft.required = variable.required !== false
  draft.defaultValue = variable.defaultValue || ''
  draft.options = [...(variable.options || [])]
  draft.optionMeta = Object.fromEntries(Object.entries(variable.optionMeta || {}).map(([key, meta]) => [key, { ...meta }]))
  draft.sku = variable.sku
    ? { ...variable.sku, dimensions: variable.sku.dimensions.map(dimension => ({ ...dimension, values: [...dimension.values] })), enabled: variable.sku.enabled ? [...variable.sku.enabled] : undefined }
    : null
  skuMode.value = variable.sku ? 'sku' : 'simple'
  draft.decor = variable.decor ? { ...variable.decor } : {}
  draft.displayRule = variable.displayRule ? { ...variable.displayRule } : null
  draft.placeholder = variable.placeholder || ''
  draft.description = variable.description || ''
  nameError.value = null
}, { immediate: true })

const normalizedType = computed(() => normalizeVariableType(draft.type))
watch(normalizedType, type => {
  if (type === 'select' && !draft.options.length) draft.options = ['', '']
  if (type !== 'select') {
    draft.options = []
    draft.sku = null
    draft.optionMeta = {}
  }
}, { immediate: true })

const numberDefault = computed(() => {
  if (!draft.defaultValue) return null
  const value = Number(draft.defaultValue)
  return Number.isFinite(value) ? value : null
})
const updateNumberDefault = (value: number | null) => {
  draft.defaultValue = value === null ? '' : String(value)
}

const cleanedOptions = computed(() => draft.options.map(option => (option || '').trim()).filter(Boolean))
/** SKU 组合模式下由启用的组合生成选项；简单模式用手工列表 */
const skuOptions = computed(() => skuMode.value === 'sku' && draft.sku
  ? enabledSkuCombos(draft.sku).map(combo => combo.label)
  : [])
const defaultSelectOptions = computed(() => (
  skuMode.value === 'sku' ? skuOptions.value : cleanedOptions.value
).map(option => ({ label: option, value: option })))

const typeOptions = computed(() => props.jinja
  ? [
    { label: `${t('promptEditor.typeText')} (str)`, value: 'str' },
    { label: `${t('promptEditor.typeNumber')} (int)`, value: 'int' },
    { label: `${t('promptEditor.typeNumber')} (float)`, value: 'float' },
    { label: `${t('promptEditor.typeBoolean')} (bool)`, value: 'bool' },
    { label: t('promptEditor.typeList'), value: 'list' },
    { label: t('promptEditor.typeDict'), value: 'dict' },
  ]
  : [
    { label: t('promptEditor.typeText'), value: 'text' },
    { label: t('promptEditor.typeTextarea'), value: 'textarea' },
    { label: t('promptEditor.typeSelect'), value: 'select' },
    { label: t('promptEditor.typeNumber'), value: 'number' },
    { label: t('promptEditor.typeBoolean'), value: 'boolean' },
  ])

const nameErrorText = computed(() => {
  if (nameError.value === 'required') return t('promptEditor.variableNameRequired')
  if (nameError.value === 'invalid') return t('promptEditor.variableNameInvalid')
  if (nameError.value === 'duplicate') return t('promptEditor.variableNameDuplicate')
  return undefined
})

const validateDraftName = () => {
  nameError.value = validateVariableName(draft.name.trim(), props.variables, props.variable?.name)
}

const deleteConfirmText = computed(() => props.jinja
  ? t('promptEditor.confirmDeleteJinja')
  : props.occurrenceCount > 0
    ? t('promptEditor.confirmDeleteVariable', { count: props.occurrenceCount })
    : t('promptEditor.confirmDeleteUnused'))

const handleShowChange = (value: boolean) => emit('update:show', value)

const handleSave = () => {
  if (!props.variable) return
  const name = draft.name.trim()
  nameError.value = validateVariableName(name, props.variables, props.variable.name)
  if (nameError.value) return
  const isSelect = normalizedType.value === 'select'
  const isSku = isSelect && skuMode.value === 'sku'
  const comboLabels = skuOptions.value
  // SKU 模式下没有任何可用组合时阻断保存，避免静默清空已有配置
  if (isSku && !comboLabels.length) return
  const labels = isSku ? comboLabels : cleanedOptions.value
  const next: EditablePromptVariable = {
    ...props.variable,
    name,
    type: draft.type,
    required: draft.required,
    defaultValue: draft.defaultValue,
    placeholder: draft.placeholder,
    description: draft.description,
    options: isSelect ? [...draft.options] : [],
    sku: isSku && draft.sku
      ? {
        ...draft.sku,
        dimensions: draft.sku.dimensions.map(dimension => ({ ...dimension, values: [...dimension.values] })),
        enabled: draft.sku.enabled ? [...draft.sku.enabled] : undefined,
        comboOrder: draft.sku.comboOrder ? [...draft.sku.comboOrder] : undefined,
      }
      : undefined,
    // 变量级装饰：所有类型均可保留（列表选项的「引用上级」指向这里）
    decor: Object.keys(draft.decor).length ? { ...draft.decor } : undefined,
    // 显示规则：只存「本提示词内」的覆盖，未设置时回落到全局库默认
    displayRule: draft.displayRule ? { ...draft.displayRule } : undefined,
    // 模式互斥：只保留当前模式的选项元数据，并修剪失效键
    optionMeta: isSelect ? pruneOptionMeta(draft.optionMeta, labels) : undefined,
  }
  if (isSku) next.options = [...comboLabels]
  emit('save', { previousName: props.variable.name, variable: next })
  handleShowChange(false)
}

const handleRemove = () => {
  if (!props.variable) return
  emit('remove', props.variable.name)
  handleShowChange(false)
}
</script>

<style scoped>
.variable-edit-modal { box-sizing: border-box; width: 420px; max-width: calc(100vw - 48px); border: 1px solid var(--border-default); border-radius: var(--radius-modal); background: var(--surface-primary); box-shadow: var(--shadow-overlay); overflow: hidden; }
.edit-modal-header { min-height: 48px; padding: 10px var(--content-padding); display: flex; align-items: center; border-bottom: 1px solid var(--border-default); background: var(--surface-secondary); }
.edit-modal-body { max-height: min(56vh, 480px); overflow-y: auto; padding: var(--content-padding); }
.edit-modal-form :deep(.n-form-item) { margin-bottom: 12px; }
.name-decor-row { display: flex; align-items: center; gap: 6px; width: 100%; }
.name-decor-row :deep(.n-input) { flex: 1 1 auto; min-width: 0; }
.edit-modal-row { display: grid; grid-template-columns: minmax(0, 1fr) 88px; gap: var(--compact-padding); }
.display-rule-field { display: flex; flex-direction: column; gap: 4px; width: 100%; }
.rule-reset { align-self: flex-start; }
.rule-following { font-size: 12px; }
.options-mode-switch :deep(.n-radio-button) { flex: 1; text-align: center; }
.required-field :deep(.n-form-item-blank) { align-items: center; }
.edit-modal-footer { min-height: 52px; padding: 10px var(--content-padding); display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border-default); background: var(--surface-secondary); }
.edit-modal-actions { display: flex; gap: 8px; }
</style>
