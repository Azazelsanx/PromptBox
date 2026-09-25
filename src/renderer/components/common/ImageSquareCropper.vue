<template>
  <NModal :show="show" display-directive="show" @update:show="value => !value && emit('cancel')">
    <div class="cropper-modal" role="dialog" aria-modal="true">
      <header class="cropper-header">
        <NText strong>{{ t('decorPicker.cropTitle') }}</NText>
      </header>
      <div class="cropper-body">
        <div ref="stageRef" class="crop-stage">
          <img v-if="imageEl" :src="image" class="stage-img" draggable="false"
            :style="imgStyle" alt="" />
          <!-- 1:1 裁切框：拖动定位，右下角手柄等比缩放（恒为正方形） -->
          <div v-if="imageEl" class="crop-frame" :style="frameStyle"
            @pointerdown="onMoveStart" @pointermove="onPointerMove"
            @pointerup="onPointerUp" @pointercancel="onPointerUp">
            <span class="crop-grid" aria-hidden="true" />
            <span class="crop-handle" @pointerdown.stop.prevent="onResizeStart"
              @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp" />
          </div>
        </div>
        <NText v-if="imageEl" depth="3" class="cropper-hint">{{ t('decorPicker.cropHint') }}</NText>
      </div>
      <footer class="cropper-footer">
        <NButton size="small" quaternary @click="emit('cancel')">{{ t('common.cancel') }}</NButton>
        <NButton size="small" type="primary" :disabled="!imageEl" @click="confirmCrop">
          {{ t('decorPicker.cropConfirm') }}
        </NButton>
      </footer>
    </div>
  </NModal>
</template>

<script setup lang="ts">
/**
 * 1:1 方形裁切弹窗：图片按原比例完整展示（contain，不拉伸不默认裁边），
 * 上面浮一个正方形裁切框——拖动定位、右下角手柄等比缩放，确认输出 256×256 dataURL。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NModal, NText } from 'naive-ui'

const props = defineProps<{
  show: boolean
  image: string
}>()

const emit = defineEmits<{
  confirm: [dataUrl: string]
  cancel: []
}>()

const { t } = useI18n()
const stageRef = ref<HTMLElement | null>(null)
const imageEl = ref<HTMLImageElement | null>(null)

/** 舞台固定尺寸，图片 contain 居中 */
const STAGE_W = 520
const STAGE_H = 400
const OUTPUT_SIZE = 256
const MIN_FRAME = 48

/** 图片在舞台内的显示矩形（保持原比例） */
const imgRect = ref({ x: 0, y: 0, w: 0, h: 0 })
/** 裁切框（正方形，舞台坐标） */
const frame = ref({ x: 0, y: 0, size: 0 })

const imgStyle = computed(() => ({
  left: `${imgRect.value.x}px`,
  top: `${imgRect.value.y}px`,
  width: `${imgRect.value.w}px`,
  height: `${imgRect.value.h}px`,
}))

const frameStyle = computed(() => ({
  left: `${frame.value.x}px`,
  top: `${frame.value.y}px`,
  width: `${frame.value.size}px`,
  height: `${frame.value.size}px`,
}))

const clampFrame = () => {
  const { x, y, w, h } = imgRect.value
  frame.value.size = Math.min(Math.max(MIN_FRAME, frame.value.size), Math.round(Math.min(w, h)))
  frame.value.x = Math.min(Math.max(x, frame.value.x), x + w - frame.value.size)
  frame.value.y = Math.min(Math.max(y, frame.value.y), y + h - frame.value.size)
}

watch(() => [props.show, props.image] as const, ([show, image]) => {
  if (!show || !image) {
    imageEl.value = null
    return
  }
  const element = new Image()
  element.onload = () => {
    imageEl.value = element
    // contain：完整显示图片，不改变比例
    const scale = Math.min(STAGE_W / element.width, STAGE_H / element.height)
    const w = Math.round(element.width * scale)
    const h = Math.round(element.height * scale)
    imgRect.value = { x: Math.round((STAGE_W - w) / 2), y: Math.round((STAGE_H - h) / 2), w, h }
    // 初始裁切框：图片内最大内接正方形的 80%，居中
    frame.value.size = Math.round(Math.min(w, h) * 0.8)
    frame.value.x = imgRect.value.x + Math.round((w - frame.value.size) / 2)
    frame.value.y = imgRect.value.y + Math.round((h - frame.value.size) / 2)
  }
  element.src = image
}, { immediate: true })

let mode: 'move' | 'resize' | null = null
let lastX = 0
let lastY = 0

const onMoveStart = (event: PointerEvent) => {
  mode = 'move'
  lastX = event.clientX
  lastY = event.clientY
  ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
}

const onResizeStart = (event: PointerEvent) => {
  mode = 'resize'
  lastX = event.clientX
  lastY = event.clientY
  ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
}

const onPointerMove = (event: PointerEvent) => {
  if (!mode) return
  const dx = event.clientX - lastX
  const dy = event.clientY - lastY
  lastX = event.clientX
  lastY = event.clientY
  if (mode === 'move') {
    frame.value.x += dx
    frame.value.y += dy
  } else {
    // 右下角手柄：取较大位移保证等比扩大/缩小，恒为正方形
    frame.value.size += Math.max(dx, dy)
  }
  clampFrame()
}

const onPointerUp = () => {
  mode = null
}

const confirmCrop = () => {
  const image = imageEl.value
  if (!image) return
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  // 舞台坐标 → 图片原始坐标
  const scale = image.width / imgRect.value.w
  ctx.drawImage(
    image,
    (frame.value.x - imgRect.value.x) * scale,
    (frame.value.y - imgRect.value.y) * scale,
    frame.value.size * scale,
    frame.value.size * scale,
    0, 0, OUTPUT_SIZE, OUTPUT_SIZE,
  )
  emit('confirm', canvas.toDataURL('image/png'))
}
</script>

<style scoped>
.cropper-modal { box-sizing: border-box; width: 568px; max-width: calc(100vw - 48px); border: 1px solid var(--border-default); border-radius: var(--radius-modal); background: var(--surface-primary); box-shadow: var(--shadow-overlay); overflow: hidden; }
.cropper-header { min-height: 44px; padding: 8px var(--content-padding); display: flex; align-items: center; border-bottom: 1px solid var(--border-default); background: var(--surface-secondary); }
.cropper-body { padding: var(--content-padding); display: flex; flex-direction: column; gap: 10px; align-items: center; }
.crop-stage { position: relative; width: 520px; max-width: 100%; height: 400px; border: 1px solid var(--border-default); border-radius: var(--radius-control); overflow: hidden; background:
  repeating-conic-gradient(var(--surface-tertiary) 0% 25%, var(--surface-secondary) 0% 50%) 0 0 / 16px 16px; }
.stage-img { position: absolute; user-select: none; -webkit-user-drag: none; }
.crop-frame { position: absolute; box-sizing: border-box; border: 1.5px solid #fff; --crop-mask-shadow: 0 0 0 9999px rgb(0 0 0 / 45%); box-shadow: var(--crop-mask-shadow); cursor: grab; touch-action: none; }
.crop-frame:active { cursor: grabbing; }
.crop-grid { position: absolute; inset: 0; pointer-events: none;
  background:
    linear-gradient(to right, transparent calc(33.33% - 0.5px), rgb(255 255 255 / 40%) 33.33%, transparent calc(33.33% + 0.5px)),
    linear-gradient(to right, transparent calc(66.66% - 0.5px), rgb(255 255 255 / 40%) 66.66%, transparent calc(66.66% + 0.5px)),
    linear-gradient(to bottom, transparent calc(33.33% - 0.5px), rgb(255 255 255 / 40%) 33.33%, transparent calc(33.33% + 0.5px)),
    linear-gradient(to bottom, transparent calc(66.66% - 0.5px), rgb(255 255 255 / 40%) 66.66%, transparent calc(66.66% + 0.5px)); }
.crop-handle { position: absolute; right: -7px; bottom: -7px; width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 1.5px solid var(--primary-default, #3b81e9); cursor: nwse-resize; touch-action: none; }
.cropper-hint { font-size: 12px; align-self: flex-start; }
.cropper-footer { min-height: 48px; padding: 8px var(--content-padding); display: flex; align-items: center; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--border-default); background: var(--surface-secondary); }
</style>
