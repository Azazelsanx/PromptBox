<template>
  <div class="display-rule-editor">
    <div class="rule-row">
      <NSelect :value="prefix" size="small" :options="slotOptions" :disabled="readonly"
        :aria-label="t('displayRule.prefix')" @update:value="patch('prefix', $event)" />
      <NInput v-if="needsSeparator" :value="separator" size="small" class="rule-separator" :disabled="readonly"
        :placeholder="t('displayRule.separatorPlaceholder')" :aria-label="t('displayRule.separator')"
        @update:value="patch('separator', $event ?? '')" />
      <NSelect :value="suffix" size="small" :options="slotOptions" :disabled="readonly"
        :aria-label="t('displayRule.suffix')" @update:value="patch('suffix', $event)" />
    </div>
    <p class="rule-preview">
      <span class="rule-preview-label">{{ t('displayRule.preview') }}</span>
      <code>{{ preview }}</code>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NInput, NSelect } from 'naive-ui'
import type { VariableDisplayRule, VariableDisplaySlot } from '@shared/types/database'
import { renderVariableOutput, resolveDisplayRule } from '@/lib/utils/prompt-template'

const props = withDefaults(defineProps<{
  /** 变量显示规则；空 = 默认（只输出值） */
  value?: VariableDisplayRule | null
  variableName?: string
  /** 列表类型：值槽位展示为「选项名」 */
  isSelect?: boolean
  /** 预览用的示例值（缺省按类型给示例文案） */
  sampleValue?: string
  readonly?: boolean
}>(), {
  value: null,
  variableName: '',
  isSelect: false,
  sampleValue: '',
  readonly: false,
})

const emit = defineEmits<{
  'update:value': [value: VariableDisplayRule]
}>()

const { t } = useI18n()
const resolved = computed(() => resolveDisplayRule(props.value))
const prefix = computed(() => resolved.value.prefix)
const suffix = computed(() => resolved.value.suffix)
const separator = computed(() => resolved.value.separator)
/** 连接符只在前后缀同时有内容时才参与输出，此时才需要让用户看见并编辑 */
const needsSeparator = computed(() => resolved.value.prefix !== 'none' && resolved.value.suffix !== 'none')

const slotOptions = computed(() => [
  { label: t('displayRule.slotNone'), value: 'none' },
  { label: t('displayRule.slotName'), value: 'name' },
  { label: props.isSelect ? t('displayRule.slotOption') : t('displayRule.slotValue'), value: 'value' },
])

const previewName = computed(() => props.variableName.trim() || t('displayRule.sampleName'))
const previewValue = computed(() => props.sampleValue
  || (props.isSelect ? t('displayRule.sampleOption') : t('displayRule.sampleValue')))
const preview = computed(() => renderVariableOutput(props.value, previewName.value, previewValue.value))

const patch = (key: 'prefix' | 'suffix' | 'separator', slot: VariableDisplaySlot | string) => {
  const next = { ...resolved.value, [key]: slot } as VariableDisplayRule
  emit('update:value', next)
}
</script>

<style scoped>
.display-rule-editor { display: flex; flex-direction: column; gap: 6px; }
.rule-row { display: flex; align-items: center; gap: 6px; }
.rule-row > :deep(.n-select) { flex: 1 1 0; min-width: 0; }
.rule-separator { flex: 0 0 76px; }
.rule-preview { margin: 0; display: flex; align-items: baseline; gap: 6px; font-size: 12px; color: var(--content-secondary); }
.rule-preview-label { flex: 0 0 auto; }
.rule-preview code { padding: 1px 5px; border-radius: var(--radius-control); background: var(--surface-tertiary); color: var(--content-primary); font-family: var(--font-prompt); word-break: break-all; }
</style>
