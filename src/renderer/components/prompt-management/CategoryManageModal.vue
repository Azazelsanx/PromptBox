<template>
    <CommonModal ref="modalRef" :show="show" @update:show="$emit('update:show', $event)" @close="handleClose">
        <!-- 顶部固定区域 -->
        <template #header>
            <NText strong class="modal-title">{{ t('promptManagement.categoryManageTitle') }}</NText>
            <NText depth="3" class="modal-subtitle">{{ t('promptManagement.categoryManageDesc') }}</NText>
        </template>

        <!-- 中间可操作区域：统一的单页分类列表管理 -->
        <template #content="{ contentHeight }">
            <div class="category-manage" :style="{ height: `${contentHeight}px` }">
                <div class="category-manage-toolbar ui-toolbar">
                    <NText depth="3" class="category-manage-count">
                        {{ t('promptManagement.totalCategories', { count: categories.length }) }}
                    </NText>
                    <NButton type="primary" size="small" :disabled="formShow"
                        @click="openFormCreate">
                        <template #icon><NIcon size="16"><Plus /></NIcon></template>
                        {{ t('promptManagement.categoryFormCreateTitle') }}
                    </NButton>
                </div>

                <NScrollbar class="category-manage-scroll">
                    <div class="category-manage-list">
                        <!-- 现有分类：拖拽排序 + 编辑/删除（编辑走表单弹窗） -->
                        <div v-for="category in orderedCategories" :key="category.id" class="category-order-item"
                            :class="{
                                dragging: draggingCategoryId === category.id,
                                'drop-before': dropTargetCategoryId === category.id && dropPosition === 'before',
                                'drop-after': dropTargetCategoryId === category.id && dropPosition === 'after',
                            }" @dragover.prevent="handleCategoryDragOver($event, category)"
                            @drop.prevent="handleCategoryDrop(category)">
                            <div class="category-row">
                                <NButton size="small" quaternary circle class="category-drag-handle"
                                    :draggable="orderedCategories.length > 1 && !reordering && !formShow"
                                    :aria-label="t('promptManagement.categoryDragHandle', { name: category.name })"
                                    :disabled="orderedCategories.length < 2 || reordering || formShow"
                                    @dragstart="handleCategoryDragStart($event, category)"
                                    @dragend="handleCategoryDragEnd">
                                    <template #icon><NIcon size="16"><GripVertical /></NIcon></template>
                                </NButton>

                                <!-- 图标优先；未设置图标回退到色点 -->
                                <component v-if="resolveIcon(category.icon)" :is="resolveIcon(category.icon)"
                                    class="category-row-icon" :theme="category.iconTheme || 'outline'" :size="18"
                                    :fill="category.color || undefined" />
                                <span v-else class="category-color-dot"
                                    :style="{ backgroundColor: category.color || 'var(--accent-success)' }" />

                                <div class="category-row-info">
                                    <NText strong class="category-row-name">{{ category.name }}</NText>
                                    <NText depth="3" class="category-row-count">
                                        <template v-if="parentNameOf(category)">
                                            {{ t('promptManagement.categoryParentSuffix', { name: parentNameOf(category) }) }} ·
                                        </template>
                                        {{ t('promptManagement.categoryPromptCount', {
                                            count: getCategoryPromptCount(category.id)
                                        }) }}
                                    </NText>
                                </div>

                                <div class="category-row-actions">
                                    <NTooltip>
                                        <template #trigger>
                                            <NButton size="small" quaternary circle @click="openFormEdit(category)"
                                                :disabled="formShow"
                                                :aria-label="t('common.edit')">
                                                <template #icon><NIcon size="16"><Edit /></NIcon></template>
                                            </NButton>
                                        </template>
                                        {{ t('common.edit') }}
                                    </NTooltip>
                                    <NTooltip>
                                        <template #trigger>
                                            <NButton size="small" quaternary circle type="error"
                                                @click="handleDelete(category)"
                                                :disabled="getCategoryPromptCount(category.id) > 0 || formShow"
                                                :aria-label="t('common.delete')">
                                                <template #icon><NIcon size="16"><Trash /></NIcon></template>
                                            </NButton>
                                        </template>
                                        {{ t('common.delete') }}
                                    </NTooltip>
                                </div>
                            </div>
                        </div>

                        <NEmpty v-if="orderedCategories.length === 0"
                            :description="t('promptManagement.categoryManageEmpty')" size="large" class="category-manage-empty">
                            <template #icon>
                                <NIcon size="48">
                                    <FolderPlus />
                                </NIcon>
                            </template>
                        </NEmpty>
                    </div>
                </NScrollbar>
            </div>
        </template>

        <!-- 底部固定区域 -->
        <template #footer>
            <NFlex justify="end" align="center">
                <NButton @click="handleClose">{{ t('common.close') }}</NButton>
            </NFlex>
        </template>
    </CommonModal>

    <!-- 新建/编辑文件夹：参考工作区编辑弹窗的表单布局 -->
    <!-- 注意：必须是组件根级节点（Vue3 多根）。放在 CommonModal 默认插槽里永远不挂载——
         CommonModal 只渲染 #header/#content/#footer 三个具名插槽，无默认插槽出口，
         会导致 formShow=true 但表单不可见、列表按钮全被禁用的死锁（"编辑无效"根因） -->
    <NModal :show="formShow" :mask-closable="false" @update:show="formShow = $event">
            <div class="category-form" role="dialog" aria-modal="true">
                <header class="category-form-header">
                    <NText strong class="category-form-title">
                        {{ editingId === null ? t('promptManagement.categoryFormCreateTitle') : t('promptManagement.categoryFormEditTitle') }}
                    </NText>
                    <NButton quaternary circle size="small" @click="closeForm">
                        <template #icon><NIcon size="16"><CloseIcon /></NIcon></template>
                    </NButton>
                </header>
                <div class="category-form-body">
                    <div class="form-field">
                        <label class="form-field-label">{{ t('promptManagement.categoryParent') }}</label>
                        <NSelect v-model:value="categoryForm.parentId" size="small" clearable
                            :options="parentOptions" :placeholder="t('promptManagement.categoryParentRoot')" />
                    </div>
                    <!-- 图标在左、名称在右一行布局；预览框实时反馈已选图标 -->
                    <IconPalettePicker v-model:icon="categoryForm.icon" v-model:icon-theme="categoryForm.iconTheme"
                        v-model:color="categoryForm.color"
                        :icon-label="t('promptManagement.categoryIconLabel')"
                        :color-label="t('promptManagement.categoryColorLabel')">
                        <div class="form-field">
                            <label class="form-field-label">{{ t('promptManagement.categoryName') }}</label>
                            <NInput v-model:value="categoryForm.name" size="small"
                                :placeholder="t('promptManagement.categoryNamePlaceholder')" @keyup.enter="saveForm" />
                        </div>
                    </IconPalettePicker>
                </div>
                <footer class="category-form-footer">
                    <NButton size="small" @click="closeForm">{{ t('common.cancel') }}</NButton>
                    <NButton type="primary" size="small" :loading="savingForm" @click="saveForm">
                        {{ editingId === null ? t('promptManagement.categoryFormCreateTitle') : t('common.save') }}
                    </NButton>
                </footer>
            </div>
        </NModal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
    NFlex,
    NText,
    NInput,
    NButton,
    NIcon,
    NEmpty,
    NModal,
    NSelect,
    NScrollbar,
    NTooltip,
    useMessage,
    useDialog
} from 'naive-ui'
import { Edit, FolderPlus, GripVertical, Plus, Trash, X as CloseIcon } from '@vicons/tabler'
import IconPalettePicker from '@/components/common/IconPalettePicker.vue'
import { resolveIcon, type IconTheme } from '@/lib/utils/icon-registry'
import { api } from '@/lib/api'
import CommonModal from '@/components/common/CommonModal.vue'
import { useI18n } from 'vue-i18n'
import type { Category } from '@shared/types/database'
import {
    reorderCategoriesByDrop,
    sortCategoriesByOrder,
    type CategoryDropPosition,
} from '@/lib/utils/category-order'

interface Props {
    show: boolean
    categories: Category[]
}

interface Emits {
    (e: 'update:show', value: boolean): void
    (e: 'updated'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const message = useMessage()
const dialog = useDialog()
const { t } = useI18n()

const DEFAULT_CATEGORY_COLOR = '#0d0d0d'

// 表单弹窗状态（新建/编辑共用，参考工作区编辑设计）
const formShow = ref(false)
const editingId = ref<number | null>(null)
const savingForm = ref(false)
const categoryForm = ref({
    name: '',
    parentId: null as number | null,
    icon: '',
    iconTheme: 'outline' as IconTheme,
    color: DEFAULT_CATEGORY_COLOR
})

const parentOptions = computed(() => orderedCategories.value
    .filter(category => category.id !== editingId.value)
    .map(category => ({ label: category.name, value: category.id as number })))

const parentNameOf = (category: Category): string | null => {
    if (!category.parentId) return null
    return orderedCategories.value.find(item => item.id === category.parentId)?.name ?? null
}
const reordering = ref(false)
const orderedCategories = ref<Category[]>([])
const draggingCategoryId = ref<number | null>(null)
const dropTargetCategoryId = ref<number | null>(null)
const dropPosition = ref<CategoryDropPosition | null>(null)

// 统计信息
const statistics = ref<{
    totalCount: number;
    categoryStats: Array<{ id: string | null, name: string, count: number }>;
    popularTags: Array<{ name: string, count: number }>;
}>({
    totalCount: 0,
    categoryStats: [],
    popularTags: []
})

// 获取分类下的提示词数量
const getCategoryPromptCount = (categoryId: number) => {
    const categoryStats = statistics.value.categoryStats.find(stat => stat.id === categoryId?.toString())
    return categoryStats ? categoryStats.count : 0
}

// 加载统计信息
const loadStatistics = async () => {
    try {
        statistics.value = await api.prompts.getStatistics.query()
    } catch (error) {
        console.error('加载统计信息失败:', error)
    }
}

// 方法
const openFormCreate = () => {
    editingId.value = null
    categoryForm.value = {
        name: '',
        parentId: null,
        icon: '',
        iconTheme: 'outline',
        color: DEFAULT_CATEGORY_COLOR
    }
    formShow.value = true
}

const openFormEdit = (category: Category) => {
    if (!category.id) return
    editingId.value = category.id
    categoryForm.value = {
        name: category.name,
        parentId: category.parentId ?? null,
        icon: category.icon || '',
        iconTheme: (category.iconTheme || 'outline') as IconTheme,
        color: category.color || DEFAULT_CATEGORY_COLOR
    }
    formShow.value = true
}

const closeForm = () => {
    formShow.value = false
}

const saveForm = async () => {
    if (!categoryForm.value.name.trim()) {
        message.warning(t('promptManagement.enterCategoryName'))
        return
    }

    try {
        savingForm.value = true
        if (editingId.value === null) {
            await api.categories.create.mutate({
                name: categoryForm.value.name,
                color: categoryForm.value.color,
                icon: categoryForm.value.icon || undefined,
                iconTheme: categoryForm.value.icon ? categoryForm.value.iconTheme : undefined,
                parentId: categoryForm.value.parentId ?? undefined,
                uuid: '', // 这个会被服务层自动生成
                isActive: true,
                description: ''
            })
            message.success(t('promptManagement.categoryCreatedSuccess'))
        } else {
            await api.categories.update.mutate({
                id: editingId.value,
                data: {
                    name: categoryForm.value.name,
                    color: categoryForm.value.color,
                    icon: categoryForm.value.icon || undefined,
                    iconTheme: categoryForm.value.icon ? categoryForm.value.iconTheme : undefined,
                    parentId: categoryForm.value.parentId ?? undefined
                }
            })
            message.success(t('promptManagement.categoryUpdatedSuccess'))
        }

        formShow.value = false
        await loadStatistics()
        emit('updated')
    } catch (error) {
        message.error(editingId.value === null
            ? t('promptManagement.categoryCreatedFailed')
            : t('promptManagement.categoryUpdatedFailed'))
        console.error(error)
    } finally {
        savingForm.value = false
    }
}

const persistCategoryOrder = async (nextOrder: Category[], previousOrder: Category[]) => {
    orderedCategories.value = nextOrder
    reordering.value = true

    try {
        await api.categories.reorder.mutate(nextOrder.flatMap((item, sortOrder) => (
            item.id ? [{ id: item.id, sortOrder }] : []
        )))
        message.success(t('promptManagement.categoryOrderUpdatedSuccess'))
        emit('updated')
    } catch (error) {
        orderedCategories.value = previousOrder
        message.error(t('promptManagement.categoryOrderUpdatedFailed'))
        console.error(error)
    } finally {
        reordering.value = false
    }
}

const resetCategoryDragState = () => {
    draggingCategoryId.value = null
    dropTargetCategoryId.value = null
    dropPosition.value = null
}

const handleCategoryDragStart = (event: DragEvent, category: Category) => {
    if (!category.id || formShow.value || reordering.value || !event.dataTransfer) {
        event.preventDefault()
        return
    }

    draggingCategoryId.value = category.id
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(category.id))

    const item = (event.currentTarget as HTMLElement | null)?.closest('.category-order-item') as HTMLElement | null
    if (item) event.dataTransfer.setDragImage(item, 24, 24)
}

const handleCategoryDragOver = (event: DragEvent, category: Category) => {
    if (!draggingCategoryId.value || draggingCategoryId.value === category.id || !category.id) {
        dropTargetCategoryId.value = null
        dropPosition.value = null
        return
    }

    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    const item = event.currentTarget as HTMLElement
    const bounds = item.getBoundingClientRect()
    dropTargetCategoryId.value = category.id
    dropPosition.value = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
}

const handleCategoryDrop = async (targetCategory: Category) => {
    const sourceId = draggingCategoryId.value
    const position = dropPosition.value
    const previousOrder = [...orderedCategories.value]
    resetCategoryDragState()

    if (!sourceId || !targetCategory.id || !position || sourceId === targetCategory.id || reordering.value) return

    const nextOrder = reorderCategoriesByDrop(
        previousOrder,
        sourceId,
        targetCategory.id,
        position,
    )

    if (nextOrder.every((category, index) => category.id === previousOrder[index]?.id)) return
    await persistCategoryOrder(nextOrder, previousOrder)
}

const handleCategoryDragEnd = () => {
    resetCategoryDragState()
}

const handleDelete = (category: any) => {
    const promptCount = getCategoryPromptCount(category.id)
    if (promptCount > 0) {
        message.warning(t('promptManagement.categoryHasPrompts'))
        return
    }

    dialog.error({
        title: t('common.confirm'),
        content: t('promptManagement.confirmDeleteCategory', { name: category.name }),
        positiveText: t('common.delete'),
        negativeText: t('common.cancel'),
        onPositiveClick: async () => {
            try {
                await api.categories.delete.mutate(category.id)
                message.success(t('promptManagement.categoryDeletedSuccess'))
                // 重新加载统计信息
                await loadStatistics()
                emit('updated')
            } catch (error) {
                message.error(t('promptManagement.categoryDeletedFailed'))
                console.error(error)
            }
        },
    })
}

// 供父组件从侧边栏右键菜单直接调起：打开管理弹窗后直达编辑/删除
defineExpose({
    openFormEdit,
    handleDelete,
})

const handleClose = () => {
    formShow.value = false
    resetCategoryDragState()
    emit('update:show', false)
}

// 监听显示状态，重置编辑状态并加载统计信息
watch(() => props.show, async (show) => {
    if (!show) {
        formShow.value = false
        resetCategoryDragState()
    } else {
        // 当模态框显示时，加载最新的统计信息
        await loadStatistics()
    }
})

// 监听分类数据变化，重新加载统计信息
watch(() => props.categories, async (newCategories) => {
    if (!reordering.value) {
        orderedCategories.value = sortCategoriesByOrder(newCategories)
    }
    if (props.show && newCategories.length > 0) {
        await loadStatistics()
    }
}, { deep: true, immediate: true })
</script>

<style scoped>
.category-manage {
    display: flex;
    flex-direction: column;
    gap: var(--section-gap);
    min-height: 0;
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
}

.modal-title {
    display: block;
    font-size: var(--font-size-xl);
    line-height: var(--line-height-normal);
}

.modal-subtitle {
    display: block;
    margin-top: 3px;
    font-size: var(--font-size-sm);
    line-height: var(--line-height-normal);
    white-space: normal;
    overflow-wrap: anywhere;
}

.category-manage-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px var(--content-padding);
    flex: 0 0 auto;
}

.category-manage-count {
    font-size: 12px;
}

.category-manage-scroll {
    flex: 1;
    min-height: 0;
}

.category-manage-list {
    display: flex;
    flex-direction: column;
    padding-right: 8px;
}

.category-manage-empty {
    padding: 32px 8px;
}

.category-order-item {
    position: relative;
}

.category-order-item::before,
.category-order-item::after {
    content: '';
    position: absolute;
    z-index: 2;
    left: 8px;
    right: 8px;
    height: 2px;
    border-radius: var(--radius-control);
    background: var(--accent-primary);
    opacity: 0;
    pointer-events: none;
}

.category-order-item::before { top: -2px; }
.category-order-item::after { bottom: -2px; }
.category-order-item.drop-before::before,
.category-order-item.drop-after::after { opacity: 1; }
.category-order-item.dragging { opacity: .46; }
.category-order-item.dragging .category-row { background: var(--surface-secondary); }

.category-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 8px 10px;
    margin-bottom: 2px;
    border-radius: var(--radius-panel);
    transition: background-color .12s ease;
}

.category-row:hover { background: var(--interactive-hover); }

.category-drag-handle { cursor: grab; color: var(--content-secondary); flex: 0 0 auto; }
.category-drag-handle:active { cursor: grabbing; }

.category-color-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: 0 0 auto;
}

.category-row-icon {
    flex: 0 0 auto;
    color: var(--content-secondary);
}

.category-row-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.category-row-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.category-row-count {
    font-size: 12px;
}

.category-row-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
}

/* 新建/编辑文件夹表单弹窗 */
.category-form {
    width: 460px;
    max-width: calc(100vw - 48px);
    max-height: calc(100vh - 96px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-modal);
    background: var(--surface-primary, #fff);
    box-shadow: var(--shadow-overlay);
}

.category-form-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 14px 18px 4px;
}

.category-form-title {
    font-size: var(--font-size-lg);
}

.category-form-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 12px 18px 6px;
    overflow-y: auto;
}

.form-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.form-field-label {
    font-size: 12px;
    color: var(--content-secondary);
}

.category-form-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px 16px;
}
</style>
