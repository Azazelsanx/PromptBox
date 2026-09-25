<template>
  <!-- 已有图片：悬停触发按钮即出大图预览 -->
  <NPopover trigger="hover" placement="top" :show-arrow="false" :disabled="!effective.image || readonly">
    <template #trigger>
      <NPopover trigger="click" placement="bottom-start" :show-arrow="false" :disabled="readonly"
        @update:show="value => !value && (panelRequested = false)">
        <template #trigger>
          <button type="button" class="decor-trigger" :class="{ active: hasDecor, inherited: inherited }"
            :title="triggerTitle" :aria-label="t('decorPicker.title')" @click.stop>
            <component v-if="effective.icon" :is="iconComponent" :theme="effective.iconTheme || 'outline'" :size="12"
              :fill="effective.color || undefined" />
            <img v-else-if="effective.image" :src="effective.image" class="decor-trigger-thumb" alt="" />
            <NIcon v-else size="11" class="decor-placeholder"><Plus /></NIcon>
          </button>
        </template>
        <div class="decor-panel" @click.stop>
          <!-- 已有图片：先出大图预览 + 操作菜单，编辑/替换再进入完整面板 -->
          <template v-if="meta.image && !panelRequested">
            <img :src="meta.image" class="decor-menu-preview" alt="" :title="t('decorPicker.zoomHint')"
              @click="zoomed = true" />
            <div class="decor-menu-actions">
              <NButton size="small" @click="panelRequested = true">{{ t('decorPicker.menuEdit') }}</NButton>
              <NButton size="small" @click="startReplace">{{ t('decorPicker.menuReplace') }}</NButton>
              <NButton size="small" type="error" quaternary :disabled="readonly" @click="setImage('')">
                {{ t('common.delete') }}
              </NButton>
            </div>
          </template>
          <!-- 完整选择面板：图标/图片 + 可选「引用上级」 -->
          <template v-else>
            <NRadioGroup v-model:value="mode" size="small" class="decor-mode">
              <NRadioButton value="icon">{{ t('decorPicker.modeIcon') }}</NRadioButton>
              <NRadioButton value="image">{{ t('decorPicker.modeImage') }}</NRadioButton>
              <NRadioButton v-if="canInherit" value="inherit">{{ t('decorPicker.inheritParent') }}</NRadioButton>
            </NRadioGroup>

            <!-- 图标模式：与变量分组图标一致的 IconPalettePicker 体验（搜索 + 线性/面性 + 色板） -->
            <IconPalettePicker v-if="mode === 'icon'" v-model:icon="iconModel" v-model:icon-theme="themeModel"
              v-model:color="colorModel" />

            <!-- 图片模式：上传 或 链接（主进程下载转本地 dataURL），1:1 圆角小图 -->
            <template v-else-if="mode === 'image'">
              <div class="decor-image-actions">
                <NButton size="small" :disabled="readonly" @click="fileInput?.click()">
                  {{ t('decorPicker.uploadImage') }}
                </NButton>
                <NInput v-model:value="urlText" size="small" clearable :disabled="readonly"
                  :placeholder="t('decorPicker.imageUrl')" @keydown.enter.prevent="applyUrl" />
                <NButton size="small" type="primary" :loading="importing" :disabled="readonly" @click="applyUrl">
                  {{ t('decorPicker.apply') }}
                </NButton>
              </div>
              <input ref="fileInput" type="file" accept="image/*" class="decor-file" @change="onFileChange" />
              <div v-if="meta.image" class="decor-preview-row">
                <NPopover trigger="hover" placement="right" :show-arrow="false">
                  <template #trigger>
                    <img :src="meta.image" class="decor-thumb" alt="" :title="t('decorPicker.zoomHint')"
                      @click="zoomed = true" />
                  </template>
                  <img :src="meta.image" class="decor-zoom-pop" alt="" />
                </NPopover>
                <NButton quaternary size="tiny" type="error" :disabled="readonly" @click="setImage('')">
                  {{ t('common.delete') }}
                </NButton>
              </div>
              <NText v-if="statusText" depth="3" class="decor-status" :type="statusType">{{ statusText }}</NText>
            </template>

            <!-- 引用上级：跟随所属变量（上级）的图标/图片，改上级即同步 -->
            <div v-else class="decor-inherit">
              <div class="decor-inherit-preview">
                <component v-if="parentDecor.icon" :is="parentIconComponent"
                  :theme="parentDecor.iconTheme || 'outline'" :size="22" :fill="parentDecor.color || undefined" />
                <img v-else-if="parentDecor.image" :src="parentDecor.image" class="decor-thumb" alt="" />
              </div>
              <NText depth="3" class="decor-status">{{ t('decorPicker.inheritHint') }}</NText>
            </div>
          </template>
        </div>
      </NPopover>
    </template>
    <img :src="effective.image" class="decor-hover-zoom" alt="" />
  </NPopover>

  <!-- 点击小图放大查看，点击遮罩关闭 -->
  <Teleport to="body">
    <div v-if="zoomed" class="decor-zoom-overlay" @click="zoomed = false">
      <img :src="effective.image" alt="" />
    </div>
  </Teleport>

  <ImageSquareCropper :show="cropSrc !== null" :image="cropSrc || ''"
    @confirm="onCropConfirm" @cancel="cropSrc = null" />
</template>

<script setup lang="ts">
/**
 * 统一的"图标 / 图片"装饰选择器：变量级装饰、简单列表选项与 SKU 组合行共用，一处改处处改。
 * - 触发按钮：置于条目前部，展示当前装饰（图标/小图）或 + 占位；避免与删除按钮相邻误点
 * - 图标模式：IconPalettePicker（全库搜索 + 线性/面性 + 色板），与变量分组图标同款体验
 * - 图片模式：本地上传 / URL（主进程下载转本地 dataURL，失败提醒）；1:1 圆角小图，非 1:1 先裁切
 * - 引用上级：选项级可选，跟随所属变量（上级）的装饰，自身不存图标/图片
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { NButton, NIcon, NInput, NPopover, NRadioButton, NRadioGroup, NText } from 'naive-ui'
import { Plus } from '@vicons/tabler'
import type { VariableDecor, VariableOptionMeta } from '@shared/types/database'
import { resolveIcon } from '@/lib/utils/icon-registry'
import IconPalettePicker from '@/components/common/IconPalettePicker.vue'
import ImageSquareCropper from '@/components/common/ImageSquareCropper.vue'

const props = withDefaults(defineProps<{
  meta?: VariableOptionMeta
  /** 上级（所属变量）装饰：allowInherit 时可供选项引用 */
  parentMeta?: VariableDecor
  /** 是否允许「引用上级」模式（变量级装饰自身不传） */
  allowInherit?: boolean
  readonly?: boolean
}>(), {
  meta: () => ({}),
  parentMeta: () => ({}),
  allowInherit: false,
  readonly: false,
})

const emit = defineEmits<{
  'update:meta': [meta: VariableOptionMeta]
}>()

const { t } = useI18n()
const message = useMessage()

const meta = computed<VariableOptionMeta>(() => props.meta || {})
const parentDecor = computed<VariableDecor>(() => props.parentMeta || {})
const hasParentDecor = computed(() => Boolean(parentDecor.value.icon || parentDecor.value.image))
/** 选项声明「引用上级」且上级确有装饰时，按钮展示上级装饰 */
const inherited = computed(() => Boolean(meta.value.inheritParent && hasParentDecor.value))
const effective = computed<VariableDecor>(() => inherited.value ? parentDecor.value : meta.value)
const hasDecor = computed(() => Boolean(effective.value.icon || effective.value.image))
const iconComponent = computed(() => resolveIcon(effective.value.icon))
const parentIconComponent = computed(() => resolveIcon(parentDecor.value.icon))
const canInherit = computed(() => props.allowInherit && hasParentDecor.value)
const triggerTitle = computed(() => inherited.value
  ? `${t('decorPicker.title')} · ${t('decorPicker.inheritParent')}`
  : t('decorPicker.title'))

/** 全量替换当前装饰；空对象时上抛 {} 由父级删除该键。图标与图片互斥。 */
const replaceMeta = (next: VariableOptionMeta) => {
  if (next.inheritParent) {
    emit('update:meta', { inheritParent: true })
    return
  }
  const cleaned: VariableOptionMeta = {}
  if (next.icon) cleaned.icon = next.icon
  if (next.iconTheme) cleaned.iconTheme = next.iconTheme
  if (next.color) cleaned.color = next.color
  if (next.image) cleaned.image = next.image
  emit('update:meta', cleaned)
}

const patch = (partial: VariableOptionMeta) => {
  replaceMeta({ ...meta.value, ...partial })
}

// ---------------------------------------------------------------- 模式：图标 / 图片 / 引用上级
const mode = ref<'icon' | 'image' | 'inherit'>(
  meta.value.inheritParent && canInherit.value ? 'inherit' : meta.value.image ? 'image' : 'icon'
)
/** 切到「引用上级」即刻声明；图标/图片模式等用户选定具体值再写入 */
watch(mode, value => {
  if (value === 'inherit') replaceMeta({ inheritParent: true })
})
watch(() => [meta.value.inheritParent, meta.value.image] as const, () => {
  if (meta.value.inheritParent && canInherit.value) mode.value = 'inherit'
  else if (meta.value.image) mode.value = 'image'
})

/** 已有图片时点击先出菜单；编辑/替换才进入完整面板 */
const panelRequested = ref(false)

const startReplace = () => {
  mode.value = 'image'
  panelRequested.value = true
}

const iconModel = computed({
  get: () => meta.value.icon || '',
  set: value => patch({ icon: value || undefined, image: undefined, inheritParent: false }),
})
const themeModel = computed({
  get: () => (meta.value.iconTheme as 'outline' | 'filled') || 'outline',
  set: value => patch({ iconTheme: value }),
})
const colorModel = computed({
  get: () => meta.value.color || '',
  set: value => patch({ color: value || undefined }),
})

// ---------------------------------------------------------------- 图片模式
const fileInput = ref<HTMLInputElement | null>(null)
const urlText = ref('')
const importing = ref(false)
const cropSrc = ref<string | null>(null)
const zoomed = ref(false)
const statusText = ref('')
const statusType = ref<'default' | 'success' | 'error'>('default')

const setStatus = (text: string, type: 'default' | 'success' | 'error' = 'default') => {
  statusText.value = text
  statusType.value = type
}

/** 选择图片后统一进入裁切，保证 1:1 小图 */
const openCropper = (dataUrl: string) => {
  const image = new Image()
  image.onload = () => {
    if (image.width === image.height) {
      // 已是 1:1：仅当过大时压一遍，避免 dataURL 无限膨胀
      if (image.width <= 256) {
        setImage(dataUrl)
        return
      }
    }
    cropSrc.value = dataUrl
  }
  image.onerror = () => message.warning(t('decorPicker.imageInvalid'))
  image.src = dataUrl
}

const onFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    setStatus(t('decorPicker.imageInvalid'), 'error')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    setStatus('')
    openCropper(String(reader.result || ''))
  }
  reader.onerror = () => setStatus(t('decorPicker.imageInvalid'), 'error')
  reader.readAsDataURL(file)
}

const applyUrl = async () => {
  const url = urlText.value.trim()
  if (!url) return
  if (!/^https?:\/\//i.test(url)) {
    setStatus(t('decorPicker.urlInvalid'), 'error')
    return
  }
  importing.value = true
  setStatus(t('decorPicker.downloading'))
  try {
    const result = await (window as any).electronAPI?.invoke('images:fetch-data-url', url) as
      { ok: boolean; dataUrl?: string; error?: string } | undefined
    if (result?.ok && result.dataUrl) {
      urlText.value = ''
      setStatus(t('decorPicker.urlDownloaded'), 'success')
      openCropper(result.dataUrl)
    } else {
      // 链接不可用时提醒用户，可改用上传图片（本地加载不依赖网络）
      setStatus(t('decorPicker.urlFailed', { reason: result?.error || 'unknown' }), 'error')
      message.warning(t('decorPicker.urlFailedHint'))
    }
  } catch {
    setStatus(t('decorPicker.urlFailed', { reason: 'ipc' }), 'error')
    message.warning(t('decorPicker.urlFailedHint'))
  } finally {
    importing.value = false
  }
}

const onCropConfirm = (dataUrl: string) => {
  cropSrc.value = null
  setImage(dataUrl)
}

/** 写入图片（1:1 dataURL），与图标互斥 */
const setImage = (dataUrl: string) => {
  if (!dataUrl) {
    replaceMeta({})
    return
  }
  replaceMeta({ image: dataUrl })
}
</script>

<style scoped>
.decor-trigger { width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; padding: 0; border: 1px dashed var(--border-default); border-radius: 4px; background: var(--surface-primary); color: var(--content-tertiary); cursor: pointer; overflow: hidden; transition: border-color .12s ease, color .12s ease; }
.decor-trigger:hover { border-color: var(--content-primary); color: var(--content-primary); }
.decor-trigger.active { border-style: solid; border-color: var(--content-primary); }
.decor-trigger.inherited { border-color: var(--accent-primary, #3b81e9); }
.decor-placeholder { display: block; }
.decor-trigger-thumb { width: 100%; height: 100%; object-fit: cover; }
.decor-panel { display: flex; flex-direction: column; gap: 10px; width: 300px; }
.decor-mode :deep(.n-radio-button) { flex: 1; text-align: center; }
.decor-image-actions { display: flex; gap: 6px; }
.decor-image-actions .n-input { flex: 1 1 auto; min-width: 0; }
.decor-file { display: none; }
.decor-preview-row { display: flex; align-items: center; gap: 8px; }
.decor-inherit { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.decor-inherit-preview { display: inline-flex; align-items: center; }
/* 点击菜单：大图预览 + 操作按钮行 */
.decor-menu-preview { width: 100%; max-height: 200px; object-fit: contain; border-radius: var(--radius-control); border: 1px solid var(--border-default); cursor: zoom-in; }
.decor-menu-actions { display: flex; gap: 6px; justify-content: flex-end; }
/* 悬停触发按钮的大图预览 */
.decor-hover-zoom { max-width: 220px; max-height: 220px; border-radius: var(--radius-control); display: block; }
/* 1:1 圆角小图，与图标触发行等高 */
.decor-thumb { width: 32px; height: 32px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border-default); cursor: zoom-in; flex: 0 0 auto; }
.decor-zoom-pop { max-width: 240px; max-height: 240px; border-radius: var(--radius-control); display: block; }
.decor-status { font-size: 12px; }
.decor-zoom-overlay { position: fixed; inset: 0; z-index: 3000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, .6); cursor: zoom-out; }
.decor-zoom-overlay img { max-width: 70vw; max-height: 70vh; border-radius: var(--radius-panel); box-shadow: var(--shadow-overlay); }
</style>
