<template>
  <NCard :title="t('settings.editorBehavior.title')" size="small" class="settings-card">
    <div class="setting-row">
      <div class="setting-info">
        <NText>{{ t('settings.editorBehavior.skuSwitchRemind') }}</NText>
        <NText depth="3" class="setting-desc">{{ t('settings.editorBehavior.skuSwitchRemindDesc') }}</NText>
      </div>
      <NSwitch :value="remindEnabled" :loading="saving" size="small"
        @update:value="toggleRemind" />
    </div>
  </NCard>
</template>

<script setup lang="ts">
/**
 * 编辑器行为设置：简单/组合列表切换清空提醒的开关（与 SkuModeSwitch 共用同一设置键）
 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NCard, NSwitch, NText, useMessage } from 'naive-ui'
import { AppSettingsService } from '~/lib/services/app-settings.service'

const SETTING_KEY = 'variables.skuSwitchRemindDisabled'

const { t } = useI18n()
const message = useMessage()

const remindEnabled = ref(true)
const saving = ref(false)

onMounted(async () => {
  try {
    const setting = await AppSettingsService.getInstance().getSettingByKey(SETTING_KEY)
    remindEnabled.value = !(setting?.value === true || setting?.value === 'true')
  } catch {
    remindEnabled.value = true
  }
})

const toggleRemind = async (value: boolean) => {
  saving.value = true
  try {
    await AppSettingsService.getInstance().setBooleanValue(SETTING_KEY, !value)
    remindEnabled.value = value
  } catch {
    message.error(t('common.unknownError'))
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.settings-card { margin-bottom: 12px; }
.setting-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.setting-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.setting-desc { font-size: 12px; }
</style>
