<template>
    <div class="icon-palette">
        <div class="palette-row">
            <div class="palette-field trigger-field">
                <label class="palette-label">{{ iconLabel }}</label>
                <div class="trigger-row">
                    <button type="button" class="icon-trigger" :class="{ active: !!iconValue }"
                        :title="iconValue ? `${iconValue} · ${t('iconPicker.triggerTitle')}` : t('iconPicker.triggerTitle')"
                        :aria-label="t('iconPicker.triggerTitle')" @click="expanded = !expanded">
                        <component :is="resolveIcon(iconValue)" v-if="iconValue" :theme="themeValue" :size="18"
                            :fill="colorValue || undefined" />
                        <component :is="ICON_REGISTRY.Add" v-else class="trigger-placeholder" :theme="'outline'"
                            :size="16" />
                    </button>
                    <NRadioGroup v-model:value="themeValue" size="small" class="palette-theme">
                        <NRadioButton value="outline">{{ t('iconPicker.themeOutline') }}</NRadioButton>
                        <NRadioButton value="filled">{{ t('iconPicker.themeFilled') }}</NRadioButton>
                    </NRadioGroup>
                </div>
            </div>
            <div class="palette-slot">
                <slot />
            </div>
        </div>
        <div v-if="expanded" class="palette-panel">
            <NInput v-model:value="searchQuery" size="small" clearable class="palette-search"
                :placeholder="t('iconPicker.searchPlaceholder')" @focus="onSearchFocus" />
            <div v-if="isSearchMode && !iconLibraryReady" class="search-hint">
                {{ t('iconPicker.libraryLoading') }}
            </div>
            <div v-else-if="isSearchMode" class="icon-strip search-results">
                <button v-for="hit in searchResults" :key="hit.name" type="button" class="icon-cell"
                    :class="{ active: hit.name === iconValue }" :title="`${hit.title}（${hit.categoryCN}）`"
                    :aria-label="`${hit.name} ${hit.title}`" @click="selectIcon(hit.name)">
                    <component :is="resolveIcon(hit.name)" :theme="themeValue" :size="17"
                        :fill="colorValue || undefined" />
                </button>
                <div v-if="searchResults.length === 0" class="search-hint">{{ t('iconPicker.noMatch') }}</div>
            </div>
            <div v-else class="icon-strip">
                <button v-for="name in iconNames" :key="name" type="button" class="icon-cell"
                    :class="{ active: name === iconValue }"
                    :aria-label="name" @click="selectIcon(name)">
                    <component :is="ICON_REGISTRY[name]" :theme="themeValue" :size="17"
                        :fill="colorValue || undefined" />
                </button>
            </div>
            <div class="palette-field">
                <label class="palette-label">{{ colorLabel }}</label>
                <div class="color-strip">
                    <button v-for="c in REFERENCE_PALETTE" :key="c" type="button" class="color-dot"
                        :class="{ active: c === colorValue }" :style="{ backgroundColor: c }"
                        :aria-label="c" @click="selectColor(c)" />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * 内联"图标 + 颜色"选择器（参考钉钉工作区编辑弹窗设计）
 * - 触发行：图标预览框（实时反馈，点击展开/收起面板）+ 线性/面性切换；默认插槽放名称字段实现"图标左、名称右"一行布局
 * - 面板：IconPark 全库搜索（2658 个，中英文）+ 精选网格 + 8 色圆点行；懒加载不进首屏包
 * - 线性/面性由 IconPark theme prop 切换，一次选择两种风格均可用
 */
import { computed, ref } from 'vue'
import { NInput, NRadioGroup, NRadioButton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import {
    ICON_REGISTRY, REFERENCE_PALETTE, ensureIconLibrary, resolveIcon,
    iconLibraryReady, searchIcons, type IconTheme,
} from '@/lib/utils/icon-registry'

const props = withDefaults(defineProps<{
    icon: string
    iconTheme?: IconTheme
    color?: string
    iconLabel?: string
    colorLabel?: string
}>(), {
    iconTheme: 'outline',
    color: '',
    iconLabel: '',
    colorLabel: ''
})

const emit = defineEmits<{
    (e: 'update:icon', value: string): void
    (e: 'update:iconTheme', value: IconTheme): void
    (e: 'update:color', value: string): void
}>()

const { t } = useI18n()

const iconValue = computed(() => props.icon)
const themeValue = computed({
    get: () => props.iconTheme,
    set: (value: IconTheme) => emit('update:iconTheme', value)
})
const colorValue = computed(() => props.color)

const iconNames = Object.keys(ICON_REGISTRY)

const expanded = ref(false)
const searchQuery = ref('')
const isSearchMode = computed(() => searchQuery.value.trim().length > 0)
const searchResults = computed(() => {
    if (!isSearchMode.value || !iconLibraryReady.value) return []
    return searchIcons(searchQuery.value, 80)
})

// 聚焦搜索框时才懒加载全量图标库（本地 chunk，一次加载后缓存）
const onSearchFocus = () => {
    void ensureIconLibrary()
}

const selectIcon = (name: string) => {
    emit('update:icon', props.icon === name ? '' : name)
}

const selectColor = (color: string) => {
    emit('update:color', props.color === color ? '' : color)
}

defineExpose({
    /** 打开表单时若已有图标可直接展开面板 */
    open: () => { expanded.value = true },
    close: () => { expanded.value = false }
})
</script>

<style scoped>
.icon-palette {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.palette-row {
    display: flex;
    align-items: flex-start;
    gap: 16px;
}

.palette-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.trigger-field {
    flex: 0 0 auto;
}

.palette-slot {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.palette-label {
    font-size: 12px;
    color: var(--content-secondary);
}

.trigger-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.icon-trigger {
    width: 34px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--border-default);
    border-radius: var(--radius-control);
    background: var(--surface-secondary, transparent);
    color: var(--content-tertiary, var(--content-secondary));
    cursor: pointer;
    padding: 0;
    transition: border-color .12s ease, background-color .12s ease;
}

.icon-trigger:hover {
    border-color: var(--content-primary);
    background: var(--interactive-hover);
}

.icon-trigger.active {
    border-style: solid;
    border-color: var(--content-primary);
    background: var(--surface-tertiary);
    color: inherit;
}

.trigger-placeholder {
    opacity: .6;
}

.palette-theme :deep(.n-radio-button) {
    font-size: 12px;
}

.palette-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-control);
    background: var(--surface-secondary, transparent);
}

.palette-search {
    font-size: 12px;
}

.icon-strip {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(32px, 1fr));
    gap: 4px;
    max-height: 76px;
    overflow-y: auto;
    padding: 2px;
}

.icon-strip.search-results {
    max-height: 160px;
}

.search-hint {
    font-size: 12px;
    color: var(--content-tertiary, var(--content-secondary));
    padding: 4px 2px;
}

.icon-cell {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--content-secondary);
    cursor: pointer;
    padding: 0;
    transition: background-color .12s ease, border-color .12s ease;
}

.icon-cell:hover {
    background: var(--interactive-hover);
}

.icon-cell.active {
    border-color: var(--content-primary);
    color: var(--content-primary);
    background: var(--surface-tertiary);
}

.color-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: 2px;
}

.color-dot {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: none;
    padding: 0;
    cursor: pointer;
    flex: 0 0 auto;
    transition: transform .12s ease, box-shadow .12s ease;
}

.color-dot:hover {
    transform: scale(1.12);
}

.color-dot.active {
    /* 选中环：token 化存储，避免裸数值阴影 */
    --dot-ring: 0 0 0 2px var(--surface-primary, #fff), 0 0 0 3.5px var(--content-primary);
    box-shadow: var(--dot-ring);
}
</style>
