<template>
  <NRadioGroup :value="value" size="small" class="sku-mode-switch" @update:value="onAsk">
    <NRadioButton value="simple">{{ t('skuEditor.modeSimple') }}</NRadioButton>
    <NRadioButton value="sku">{{ t('skuEditor.modeSku') }}</NRadioButton>
  </NRadioGroup>

  <!-- 切换确认：默认「否」保留为草稿不启用；确认清空需二次确认，可勾选不再提醒（设置中可开关） -->
  <NModal :show="ask.show" :mask-closable="false" display-directive="show" @update:show="ask.show = $event">
    <div class="sku-switch-modal" role="dialog" aria-modal="true">
      <header class="switch-header">
        <NText strong>{{ t('skuEditor.switchTitle') }}</NText>
      </header>
      <div class="switch-body">
        <template v-if="!ask.confirming">
          <NText>{{ t('skuEditor.switchAsk', { mode: ask.target === 'sku' ? t('skuEditor.modeSimple') : t('skuEditor.modeSku') }) }}</NText>
          <div class="switch-actions">
            <NButton size="small" type="primary" @click="decline">{{ t('skuEditor.switchKeepDraft') }}</NButton>
            <NButton size="small" type="error" secondary @click="ask.confirming = true">
              {{ t('skuEditor.switchYes') }}
            </NButton>
          </div>
        </template>
        <template v-else>
          <NText>{{ t('skuEditor.switchClearConfirm') }}</NText>
          <NCheckbox v-model:checked="ask.skipRemind" size="small">{{ t('skuEditor.switchSkipRemind') }}</NCheckbox>
          <div class="switch-actions">
            <NButton size="small" @click="ask.confirming = false">{{ t('common.cancel') }}</NButton>
            <NButton size="small" type="error" @click="confirm">{{ t('skuEditor.switchClear') }}</NButton>
          </div>
        </template>
      </div>
    </div>
  </NModal>
</template>

<script setup lang="ts">
/**
 * 简单列表/组合列表互斥模式切换（含确认流程）：
 * - 离开模式无内容 → 直接切换
 * - 有内容且未关闭提醒 → 询问是否清空（默认否）；「是」再二次确认，可勾选不再提醒
 * - 用户选择后上抛 change(target, clearLeft)，清空与保留逻辑由父级执行
 */
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NCheckbox, NModal, NRadioButton, NRadioGroup, NText } from 'naive-ui'
import { AppSettingsService } from '~/lib/services/app-settings.service'

const SETTING_KEY = 'variables.skuSwitchRemindDisabled'

const props = defineProps<{
  value: 'simple' | 'sku'
  /** 当前模式下是否已有内容（决定是否弹确认） */
  hasContent: (mode: 'simple' | 'sku') => boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:value': [value: 'simple' | 'sku']
  change: [target: 'simple' | 'sku', clearLeft: boolean]
}>()

const { t } = useI18n()

const remindDisabled = ref(false)
const ask = reactive({
  show: false,
  target: 'simple' as 'simple' | 'sku',
  confirming: false,
  skipRemind: false,
})

onMounted(async () => {
  try {
    const setting = await AppSettingsService.getInstance().getSettingByKey(SETTING_KEY)
    remindDisabled.value = setting?.value === true || setting?.value === 'true'
  } catch {
    remindDisabled.value = false
  }
})

const persistRemindDisabled = async () => {
  try {
    await AppSettingsService.getInstance().setBooleanValue(SETTING_KEY, remindDisabled.value)
  } catch {
    // 持久化失败不阻塞
  }
}

const onAsk = (target: 'simple' | 'sku') => {
  if (target === props.value || props.disabled) return
  const leaving = props.hasContent(props.value)
  if (remindDisabled.value || !leaving) {
    emit('update:value', target)
    emit('change', target, false)
    return
  }
  ask.target = target
  ask.confirming = false
  ask.skipRemind = false
  ask.show = true
}

/** 默认「否」：仍可切换，原模式数据保留在草稿中不启用 */
const decline = () => {
  ask.show = false
  emit('update:value', ask.target)
  emit('change', ask.target, false)
}

const confirm = () => {
  ask.show = false
  if (ask.skipRemind) {
    remindDisabled.value = true
    void persistRemindDisabled()
  }
  emit('update:value', ask.target)
  emit('change', ask.target, true)
}
</script>

<style scoped>
.sku-mode-switch { width: 100%; }
.sku-mode-switch :deep(.n-radio-button) { flex: 1; text-align: center; }
.sku-switch-modal { box-sizing: border-box; width: 400px; max-width: calc(100vw - 48px); border: 1px solid var(--border-default); border-radius: var(--radius-modal); background: var(--surface-primary); box-shadow: var(--shadow-overlay); overflow: hidden; }
.switch-header { min-height: 44px; padding: 10px var(--content-padding); display: flex; align-items: center; border-bottom: 1px solid var(--border-default); background: var(--surface-secondary); }
.switch-body { padding: var(--content-padding); display: flex; flex-direction: column; gap: 12px; }
.switch-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
