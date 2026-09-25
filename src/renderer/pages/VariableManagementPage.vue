<template>
    <div class="variable-page">
        <header class="variable-command-bar">
            <div class="page-identity">
                <span class="page-identity-icon"><NIcon size="18"><VariableIcon /></NIcon></span>
                <div>
                    <NText strong class="page-title">{{ t('variableManagement.title') }}</NText>
                    <NText depth="3" class="page-subtitle">{{ t('variableManagement.subtitle') }}</NText>
                </div>
            </div>
            <div class="page-actions">
                <NButton size="small" @click="openPromptImportModal">
                    <template #icon><NIcon size="16"><Wand /></NIcon></template>
                    <span class="action-label">{{ t('variableManagement.promptImport.action') }}</span>
                </NButton>
                <NButton size="small" @click="openImportModal">
                    <template #icon><NIcon size="16"><Upload /></NIcon></template>
                    <span class="action-label">{{ t('variableManagement.actions.import') }}</span>
                </NButton>
                <NDropdown trigger="click" :options="exportOptions" @select="handleExportSelect">
                    <NButton size="small">
                        <template #icon><NIcon size="16"><Download /></NIcon></template>
                        <span class="action-label">{{ t('variableManagement.actions.export') }}</span>
                    </NButton>
                </NDropdown>
                <NButton type="primary" size="small" @click="openVariableEditor(null)">
                    <template #icon><NIcon size="16"><Plus /></NIcon></template>
                    <span class="action-label">{{ t('variableManagement.actions.newVariable') }}</span>
                </NButton>
            </div>
        </header>

        <div class="variable-content">
            <aside class="group-panel">
                <div class="group-panel-toolbar">
                    <NText depth="3" class="group-panel-title">{{ t('variableManagement.tree.groupsTitle') }}</NText>
                    <NTooltip>
                        <template #trigger>
                            <NButton quaternary circle size="tiny" @click="openGroupEditor(null)">
                                <template #icon><NIcon size="16"><FolderPlus /></NIcon></template>
                            </NButton>
                        </template>
                        {{ t('variableManagement.actions.newGroup') }}
                    </NTooltip>
                </div>
                <NScrollbar class="group-tree-scroll">
                    <NTree :data="treeData" block-line selectable :selected-keys="[selectedGroupKey]"
                        :render-prefix="renderTreePrefix"
                        :default-expanded-keys="defaultExpandedKeys" :node-props="treeNodeProps"
                        @update:selected-keys="handleTreeSelect" />
                </NScrollbar>
            </aside>

            <section class="variable-panel">
                <div class="variable-toolbar">
                    <NInput v-model:value="search" size="small" clearable class="variable-search"
                        :placeholder="t('variableManagement.search.placeholder')">
                        <template #prefix><NIcon size="16"><Search /></NIcon></template>
                    </NInput>
                    <NCheckbox v-if="isGroupSelected" v-model:checked="includeDescendants" size="small">
                        {{ t('variableManagement.includeDescendants') }}
                    </NCheckbox>
                    <NText depth="3" class="variable-count">{{ variables.length }} {{ t('variableManagement.table.countUnit') }}</NText>
                </div>
                <div class="variable-table-wrap">
                    <NDataTable :columns="tableColumns" :data="variables" :loading="loading" size="small"
                        :bordered="false" :row-key="(row: GlobalVariable) => row.uuid" flex-height
                        :row-props="variableRowProps" class="variable-table" />
                </div>
            </section>
        </div>

        <!-- 分组树右键菜单：新建子分组 / 重命名 / 删除 + 显示子项内容开关 -->
        <NDropdown trigger="manual" :show="treeMenu.show" :x="treeMenu.x" :y="treeMenu.y"
            placement="bottom-start" :options="treeMenuOptions"
            @select="handleTreeMenuSelect" @clickoutside="treeMenu.show = false" />

        <!-- 表格行右键菜单：编辑 / 删除 -->
        <NDropdown trigger="manual" :show="rowMenu.show" :x="rowMenu.x" :y="rowMenu.y"
            placement="bottom-start" :options="rowMenuOptions"
            @select="handleRowMenuSelect" @clickoutside="rowMenu.show = false" />

        <!-- 分组新建/重命名 -->
        <NModal :show="showGroupModal" :mask-closable="false" display-directive="show" @update:show="showGroupModal = $event">
            <div class="form-modal" role="dialog" aria-modal="true">
                <header class="form-modal-header">
                    <NText strong class="form-modal-title">
                        {{ editingGroup ? t('variableManagement.groupModal.renameTitle') : t('variableManagement.groupModal.createTitle') }}
                    </NText>
                    <NButton quaternary circle size="small" @click="showGroupModal = false">
                        <template #icon><NIcon size="16"><X /></NIcon></template>
                    </NButton>
                </header>
                <div class="form-modal-body">
                    <div class="form-field">
                        <label class="field-label">{{ t('variableManagement.groupModal.parent') }}</label>
                        <NTreeSelect v-model:value="groupForm.parentUuid" :options="parentOptions" clearable
                            :placeholder="t('variableManagement.groupModal.parentRoot')" key-field="key" label-field="label"
                            children-field="children" :disabled="!!editingGroup && isDescendantSelected" />
                    </div>
                    <!-- 图标在左、名称在右一行布局；预览框实时反馈已选图标 -->
                    <IconPalettePicker v-model:icon="groupForm.icon" v-model:icon-theme="groupForm.iconTheme"
                        v-model:color="groupForm.color"
                        :icon-label="t('variableManagement.groupModal.iconLabel')"
                        :color-label="t('variableManagement.groupModal.colorLabel')">
                        <div class="form-field">
                            <label class="field-label">{{ t('variableManagement.groupModal.name') }}</label>
                            <NInput v-model:value="groupForm.name"
                                :placeholder="t('variableManagement.groupModal.namePlaceholder')"
                                @keyup.enter="saveGroup" />
                        </div>
                    </IconPalettePicker>
                    <div class="form-field">
                        <label class="field-label">{{ t('variableManagement.groupModal.description') }}</label>
                        <NInput v-model:value="groupForm.description" type="textarea" :rows="2" />
                    </div>
                </div>
                <footer class="form-modal-footer">
                    <NButton size="small" @click="showGroupModal = false">{{ t('common.cancel') }}</NButton>
                    <NButton type="primary" size="small" :loading="saving" @click="saveGroup">{{ t('common.save') }}</NButton>
                </footer>
            </div>
        </NModal>

        <!-- 分组删除确认 -->
        <NModal :show="showGroupDeleteModal" :mask-closable="false" display-directive="show"
            @update:show="showGroupDeleteModal = $event">
            <div class="form-modal form-modal--narrow" role="dialog" aria-modal="true">
                <header class="form-modal-header">
                    <NText strong class="form-modal-title">{{ t('variableManagement.deleteGroup.title') }}</NText>
                    <NButton quaternary circle size="small" @click="showGroupDeleteModal = false">
                        <template #icon><NIcon size="16"><X /></NIcon></template>
                    </NButton>
                </header>
                <div class="form-modal-body">
                    <NText depth="2">{{ t('variableManagement.deleteGroup.confirm', { name: groupDeleteName }) }}</NText>
                    <NCheckbox v-if="groupDeleteHasContent" v-model:checked="groupDeleteRecursive" class="delete-recursive">
                        {{ t('variableManagement.deleteGroup.recursive') }}
                    </NCheckbox>
                    <NText v-if="groupDeleteHasContent && groupDeleteRecursive" depth="3" class="delete-recursive-tip">
                        {{ t('variableManagement.deleteGroup.recursiveTip') }}
                    </NText>
                </div>
                <footer class="form-modal-footer">
                    <NButton size="small" @click="showGroupDeleteModal = false">{{ t('common.cancel') }}</NButton>
                    <NButton type="error" size="small" :loading="saving" @click="confirmDeleteGroup">
                        {{ t('common.delete') }}
                    </NButton>
                </footer>
            </div>
        </NModal>

        <!-- 变量编辑器 -->
        <NModal :show="showVariableModal" :mask-closable="false" display-directive="show"
            @update:show="showVariableModal = $event">
            <div class="form-modal" role="dialog" aria-modal="true">
                <header class="form-modal-header">
                    <div class="editor-title-row">
                        <NText strong class="form-modal-title">
                            {{ editingVariable ? t('variableManagement.editor.editTitle') : t('variableManagement.editor.createTitle') }}
                        </NText>
                        <!-- 撤销/恢复 -->
                        <NFlex size="small" :wrap="false">
                            <NButton quaternary circle size="tiny" :disabled="!canUndo"
                                :title="t('common.undo')" :aria-label="t('common.undo')" @click="undoForm">
                                <template #icon><NIcon size="15"><ArrowBackUp /></NIcon></template>
                            </NButton>
                            <NButton quaternary circle size="tiny" :disabled="!canRedo"
                                :title="t('common.redo')" :aria-label="t('common.redo')" @click="redoForm">
                                <template #icon><NIcon size="15"><ArrowForwardUp /></NIcon></template>
                            </NButton>
                        </NFlex>
                    </div>
                    <NButton quaternary circle size="small" @click="showVariableModal = false">
                        <template #icon><NIcon size="16"><X /></NIcon></template>
                    </NButton>
                </header>
                <div class="form-modal-body">
                    <NAlert v-if="draftRestoredAt" type="info" size="small" class="draft-alert" closable
                        @close="draftRestoredAt = null">
                        {{ t('variableManagement.editor.draftRestored', { time: draftRestoredText }) }}
                        <NButton text size="tiny" type="error" class="draft-discard" @click="discardDraft">
                            {{ t('variableManagement.editor.draftDiscard') }}
                        </NButton>
                    </NAlert>
                    <div class="form-grid">
                        <div class="form-field">
                            <label class="field-label" :class="{ 'field-label--error': !!nameIssue }">
                                {{ t('variableManagement.editor.name') }}
                                <NTooltip v-if="nameIssue" trigger="hover" placement="top">
                                    <template #trigger><NIcon size="13" class="issue-icon"><InfoCircle /></NIcon></template>
                                    {{ nameIssue }}
                                </NTooltip>
                            </label>
                            <div class="name-decor-row">
                                <!-- 变量级图标/图片：所有类型均可用；列表选项可在面板里选「引用上级」 -->
                                <DecorPicker :meta="variableForm.decor"
                                    @update:meta="variableForm.decor = $event" />
                                <NInput v-model:value="variableForm.name"
                                    :placeholder="t('variableManagement.editor.namePlaceholder')"
                                    :class="{ 'field-input--error': !!nameIssue }"
                                    @blur="touchValidation" />
                            </div>
                        </div>
                        <div class="form-field">
                            <label class="field-label">{{ t('variableManagement.editor.type') }}</label>
                            <NSelect v-model:value="variableForm.type" :options="typeOptions" />
                        </div>
                        <div class="form-field">
                            <label class="field-label">{{ t('variableManagement.editor.group') }}</label>
                            <NTreeSelect v-model:value="variableForm.groupUuid" :options="parentOptions" clearable
                                :placeholder="t('variableManagement.editor.groupNone')" key-field="key" label-field="label"
                                children-field="children" />
                        </div>
                        <div class="form-field form-field--switch">
                            <label class="field-label">{{ t('variableManagement.editor.required') }}</label>
                            <NSwitch v-model:value="variableForm.required" size="small" />
                        </div>
                    </div>

                    <div class="form-field">
                        <label class="field-label">{{ t('variableManagement.editor.defaultValue') }}</label>
                        <NInput v-if="variableForm.type === 'text' || variableForm.type === 'list' || variableForm.type === 'dict'"
                            v-model:value="variableForm.defaultValue" />
                        <NInput v-else-if="variableForm.type === 'textarea'" v-model:value="variableForm.defaultValue" type="textarea" :rows="2" />
                        <NSelect v-else-if="variableForm.type === 'select'" v-model:value="variableForm.defaultValue"
                            :options="selectDefaultOptions" clearable tag filterable />
                        <NInputNumber v-else-if="variableForm.type === 'number'" v-model:value="defaultValueNumber"
                            :style="{ width: '100%' }" />
                        <NSwitch v-else-if="variableForm.type === 'boolean'" v-model:value="defaultValueBoolean" size="small" />
                    </div>

                    <div v-if="variableForm.type === 'select'" class="form-field">
                        <label class="field-label" :class="{ 'field-label--error': !!optionsIssue }">
                            {{ t('variableManagement.editor.options') }}
                            <NTooltip v-if="optionsIssue" trigger="hover" placement="top">
                                <template #trigger><NIcon size="13" class="issue-icon"><InfoCircle /></NIcon></template>
                                {{ optionsIssue }}
                            </NTooltip>
                        </label>
                        <SkuModeSwitch :value="variableSkuMode"
                            :has-content="mode => mode === 'simple' ? variableForm.options.length > 0
                                : !!variableForm.sku && variableForm.sku.dimensions.some(dimension => dimension.values.length > 0)"
                            @change="applySkuModeSwitch" />
                        <OptionListEditor v-if="variableSkuMode === 'simple'" :options="variableForm.options"
                            :option-meta="variableForm.optionMeta" :parent-decor="variableForm.decor"
                            @update:options="variableForm.options = $event"
                            @update:option-meta="variableForm.optionMeta = $event || {}" />
                        <SkuComboEditor v-else :sku="variableForm.sku" :option-meta="variableForm.optionMeta"
                            :parent-decor="variableForm.decor"
                            @update:sku="variableForm.sku = $event" @update:option-meta="variableForm.optionMeta = $event" />
                    </div>

                    <div class="form-field">
                        <label class="field-label">{{ t('variableManagement.editor.placeholder') }}</label>
                        <NInput v-model:value="variableForm.placeholder" />
                    </div>
                    <div class="form-field">
                        <label class="field-label">{{ t('variableManagement.editor.description') }}</label>
                        <NInput v-model:value="variableForm.description" type="textarea" :rows="2" />
                    </div>

                    <div class="form-field">
                        <label class="field-label">{{ t('displayRule.title') }}</label>
                        <NText depth="3" class="field-hint">{{ t('displayRule.libraryHint') }}</NText>
                        <VariableDisplayRuleEditor :value="variableForm.displayRule"
                            :variable-name="variableForm.name" :is-select="variableForm.type === 'select'"
                            :sample-value="variableDisplaySample"
                            @update:value="variableForm.displayRule = $event" />
                    </div>

                    <details class="validation-section">
                        <summary class="field-label">{{ t('variableManagement.editor.validation') }}</summary>
                        <div class="form-grid validation-grid">
                            <template v-if="variableForm.type === 'number'">
                                <div class="form-field">
                                    <label class="field-label">{{ t('variableManagement.editor.validationMin') }}</label>
                                    <NInputNumber v-model:value="variableForm.validation.min" :style="{ width: '100%' }" clearable />
                                </div>
                                <div class="form-field">
                                    <label class="field-label">{{ t('variableManagement.editor.validationMax') }}</label>
                                    <NInputNumber v-model:value="variableForm.validation.max" :style="{ width: '100%' }" clearable />
                                </div>
                            </template>
                            <template v-else>
                                <div class="form-field">
                                    <label class="field-label">{{ t('variableManagement.editor.validationMinLength') }}</label>
                                    <NInputNumber v-model:value="variableForm.validation.minLength" :style="{ width: '100%' }" clearable />
                                </div>
                                <div class="form-field">
                                    <label class="field-label">{{ t('variableManagement.editor.validationMaxLength') }}</label>
                                    <NInputNumber v-model:value="variableForm.validation.maxLength" :style="{ width: '100%' }" clearable />
                                </div>
                                <div class="form-field form-span-2">
                                    <label class="field-label">{{ t('variableManagement.editor.validationPattern') }}</label>
                                    <NInput v-model:value="validationPatternText" placeholder="^[\w\u4e00-\u9fa5]+$" />
                                </div>
                            </template>
                        </div>
                    </details>

                    <!-- 历史版本：查看 + 回退（回退填入表单，保存后生效） -->
                    <details v-if="editingVariable" class="validation-section">
                        <summary class="field-label">{{ t('variableManagement.editor.historySection') }}</summary>
                        <NSpin :show="historyLoading" size="small">
                            <NText v-if="!variableHistories.length" depth="3" class="history-empty">
                                {{ t('variableManagement.editor.historyEmpty') }}
                            </NText>
                            <div v-else class="history-list">
                                <div v-for="history in variableHistories" :key="history.uuid" class="history-item">
                                    <span class="history-version">{{ t('variableManagement.editor.historyVersion', { version: history.version }) }}</span>
                                    <span class="history-time">{{ formatHistoryTime(history.createdAt) }}</span>
                                    <NButton size="tiny" quaternary @click="previewingHistory = previewingHistory === history.uuid ? null : history.uuid">
                                        {{ t('variableManagement.editor.historyView') }}
                                    </NButton>
                                    <NPopconfirm :show-arrow="false" @positive-click="rollbackToHistory(history)">
                                        <template #trigger>
                                            <NButton size="tiny" type="primary" quaternary>
                                                {{ t('variableManagement.editor.historyRollback') }}
                                            </NButton>
                                        </template>
                                        {{ t('variableManagement.editor.historyRollbackConfirm', { version: history.version }) }}
                                    </NPopconfirm>
                                </div>
                                <pre v-if="previewingHistory" class="history-preview">{{ previewingHistoryText }}</pre>
                            </div>
                        </NSpin>
                    </details>
                </div>
                <footer class="form-modal-footer">
                    <NButton size="small" @click="showVariableModal = false">{{ t('common.cancel') }}</NButton>
                    <!-- 校验不通过：禁用 + 红色标注，悬停显示原因 -->
                    <NTooltip :disabled="!validationIssues.length" trigger="hover" placement="top">
                        <template #trigger>
                            <NButton type="primary" size="small" :loading="saving"
                                :class="{ 'save-btn--error': !!validationIssues.length }"
                                :disabled="!!validationIssues.length || saving" @click="saveVariable">
                                {{ t('common.save') }}
                            </NButton>
                        </template>
                        <span v-for="issue in validationIssues" :key="issue" class="save-issue-line">{{ issue }}<br /></span>
                    </NTooltip>
                </footer>
            </div>
        </NModal>

        <!-- 简单列表/组合列表切换确认弹层由 SkuModeSwitch 组件内部渲染 -->

        <!-- 从提示词导入（收编提示词内变量） -->
        <NModal :show="showPromptImportModal" :mask-closable="false" display-directive="show"
            @update:show="showPromptImportModal = $event">
            <div class="form-modal form-modal--wide" role="dialog" aria-modal="true">
                <header class="form-modal-header">
                    <div>
                        <NText strong class="form-modal-title">{{ t('variableManagement.promptImport.title') }}</NText>
                        <NText depth="3" class="form-modal-subtitle">{{ t('variableManagement.promptImport.subtitle') }}</NText>
                    </div>
                    <NButton quaternary circle size="small" @click="showPromptImportModal = false">
                        <template #icon><NIcon size="16"><X /></NIcon></template>
                    </NButton>
                </header>
                <div class="form-modal-body">
                    <div v-if="scanningPrompts" class="scan-state">
                        <NSpin size="small" />
                        <NText depth="3">{{ t('common.loading') }}</NText>
                    </div>
                    <template v-else>
                        <NDataTable :columns="inventoryColumns" :data="promptInventory" size="small"
                            :bordered="false" :row-key="(row: PromptVariableInventoryItem) => row.name"
                            v-model:checked-row-keys="checkedInventoryKeys" :max-height="320"
                            class="inventory-table" />
                        <NText v-if="!promptInventory.length" depth="3" class="scan-state">
                            {{ t('variableManagement.promptImport.empty') }}
                        </NText>
                        <div class="import-target-row">
                            <label class="field-label">{{ t('variableManagement.promptImport.targetGroup') }}</label>
                            <NTreeSelect v-model:value="promptImportTargetGroup" :options="parentOptions" clearable
                                :placeholder="t('variableManagement.editor.groupNone')" key-field="key"
                                label-field="label" children-field="children" class="target-select" />
                        </div>
                        <NText depth="3" class="field-label">{{ t('variableManagement.promptImport.mergeTip') }}</NText>
                    </template>
                </div>
                <footer class="form-modal-footer">
                    <NButton size="small" @click="showPromptImportModal = false">{{ t('common.cancel') }}</NButton>
                    <NButton type="primary" size="small" :disabled="!checkedInventoryKeys.length" :loading="saving"
                        @click="runPromptImport">
                        {{ t('variableManagement.promptImport.start', { count: checkedInventoryKeys.length }) }}
                    </NButton>
                </footer>
            </div>
        </NModal>

        <!-- 导入 -->
        <NModal :show="showImportModal" :mask-closable="false" display-directive="show" @update:show="showImportModal = $event">
            <div class="form-modal" role="dialog" aria-modal="true">
                <header class="form-modal-header">
                    <NText strong class="form-modal-title">{{ t('variableManagement.import.title') }}</NText>
                    <NButton quaternary circle size="small" @click="showImportModal = false">
                        <template #icon><NIcon size="16"><X /></NIcon></template>
                    </NButton>
                </header>
                <div class="form-modal-body">
                    <NUpload :max="1" accept=".json,.csv,text/csv,application/json" :default-upload="false"
                        @change="handleImportFileChange">
                        <NUploadDragger>
                            <div class="upload-hint">
                                <NIcon size="28" :depth="3"><Upload /></NIcon>
                                <NText depth="2">{{ t('variableManagement.import.fileTip') }}</NText>
                            </div>
                        </NUploadDragger>
                    </NUpload>

                    <div class="form-field">
                        <label class="field-label">{{ t('variableManagement.import.mode') }}</label>
                        <NRadioGroup v-model:value="importMode">
                            <NFlex vertical size="small">
                                <NRadio value="merge">{{ t('variableManagement.import.modeMerge') }}</NRadio>
                                <NRadio value="skip">{{ t('variableManagement.import.modeSkip') }}</NRadio>
                            </NFlex>
                        </NRadioGroup>
                    </div>

                    <NAlert v-if="importSummary" :type="importSummary.warnings.length ? 'warning' : 'success'" class="import-result">
                        {{ t('variableManagement.import.result', importSummary) }}
                        <ul v-if="importSummary.warnings.length" class="import-warnings">
                            <li v-for="(warning, index) in importSummary.warnings" :key="index">{{ warning }}</li>
                        </ul>
                    </NAlert>

                    <div class="import-template-row">
                        <NText depth="3" class="field-label">{{ t('variableManagement.import.templateTip') }}</NText>
                        <NFlex size="small">
                            <NButton size="tiny" @click="downloadTemplate('json')">
                                <template #icon><NIcon size="16"><FileDownload /></NIcon></template>
                                JSON
                            </NButton>
                            <NButton size="tiny" @click="downloadTemplate('csv')">
                                <template #icon><NIcon size="16"><FileDownload /></NIcon></template>
                                CSV
                            </NButton>
                        </NFlex>
                    </div>
                </div>
                <footer class="form-modal-footer">
                    <NButton size="small" @click="showImportModal = false">{{ t('common.close') }}</NButton>
                    <NButton type="primary" size="small" :disabled="!importFileText" :loading="saving"
                        @click="runImport">{{ t('variableManagement.import.start') }}</NButton>
                </footer>
            </div>
        </NModal>
    </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
    NAlert,
    NButton,
    NCheckbox,
    NDataTable,
    NDropdown,
    NFlex,
    NIcon,
    NInput,
    NInputNumber,
    NModal,
    NPopconfirm,
    NRadio,
    NRadioButton,
    NRadioGroup,
    NScrollbar,
    NSelect,
    NSpin,
    NSwitch,
    NTag,
    NText,
    NTooltip,
    NTree,
    NTreeSelect,
    NUpload,
    NUploadDragger,
    useDialog,
    useMessage,
    type DataTableColumns
} from 'naive-ui'
import {
    ArrowBackUp,
    ArrowForwardUp,
    Check,
    Download,
    FileDownload,
    Folder,
    Folders,
    FolderPlus,
    InfoCircle,
    Pencil,
    Plus,
    Search,
    Trash,
    Upload,
    Variable as VariableIcon,
    Wand,
    X
} from '@vicons/tabler'
import IconPalettePicker from '@/components/common/IconPalettePicker.vue'
import { resolveIcon, type IconTheme } from '@/lib/utils/icon-registry'
import {
    VariableService,
    VARIABLE_TYPES,
    type PromptVariableInventoryItem,
    type VariableImportSummary
} from '~/lib/services/variable.service'
import type { GlobalVariable, VariableDecor, VariableDisplayRule, VariableGroupNode, VariableHistory, VariableOptionMeta, VariableSkuConfig } from '@shared/types/database'
import { enabledSkuCombos, pruneOptionMeta } from '@/lib/utils/prompt-template'
import { useUndoRedo } from '@/composables/useUndoRedo'
import { clearDraft, loadDraft, saveDraft } from '@/composables/useFormDraft'
import SkuComboEditor from '@/components/prompt-management/SkuComboEditor.vue'
import OptionListEditor from '@/components/prompt-management/OptionListEditor.vue'
import SkuModeSwitch from '@/components/prompt-management/SkuModeSwitch.vue'
import VariableDisplayRuleEditor from '@/components/prompt-management/VariableDisplayRuleEditor.vue'
import DecorPicker from '@/components/common/DecorPicker.vue'

const { t } = useI18n()
const message = useMessage()
const dialog = useDialog()
const service = VariableService.getInstance()

const loading = ref(false)
const saving = ref(false)
const groupTree = ref<VariableGroupNode[]>([])
const variables = ref<GlobalVariable[]>([])
const selectedGroupKey = ref<string>('__all__')
/** 选中分组时是否连同子孙分组的变量一起显示（默认显示，可在分组右键菜单/工具栏开关） */
const includeDescendants = ref(true)
const search = ref('')

const pathByUuid = ref<Map<string, string[]>>(new Map())

const isGroupSelected = computed(() => !selectedGroupKey.value.startsWith('__'))
const selectedGroupUuid = computed(() => (isGroupSelected.value ? selectedGroupKey.value : null))

// ---------------------------------------------------------------- 树

interface TreeOption { key: string; label: string; children?: TreeOption[] }

const buildGroupOptions = (nodes: VariableGroupNode[]): TreeOption[] =>
    nodes.map(node => ({
        key: node.uuid,
        label: node.name,
        children: node.children?.length ? buildGroupOptions(node.children) : undefined
    }))

const parentOptions = computed<TreeOption[]>(() => [
    ...buildGroupOptions(groupTree.value)
])

const collectExpandedKeys = (nodes: VariableGroupNode[], acc: string[] = []): string[] => {
    nodes.forEach(node => {
        acc.push(node.uuid)
        if (node.children?.length) collectExpandedKeys(node.children, acc)
    })
    return acc
}
const defaultExpandedKeys = computed(() => collectExpandedKeys(groupTree.value))

const treeData = computed<TreeOption[]>(() => [
    { key: '__all__', label: t('variableManagement.tree.all') },
    { key: '__ungrouped__', label: t('variableManagement.tree.ungrouped') },
    ...buildGroupOptions(groupTree.value)
])

const handleTreeSelect = (keys: Array<string | number>) => {
    if (!keys.length) return
    selectedGroupKey.value = String(keys[0])
    void loadVariables()
}

// 树前缀：分组图标（无图标用默认文件夹），特殊节点用功能图标
const renderTreePrefix = ({ option }: { option: TreeOption }) => {
    if (option.key === '__all__') {
        return h(NIcon, { size: 15 }, { default: () => h(VariableIcon) })
    }
    if (option.key === '__ungrouped__') {
        return h(NIcon, { size: 15 }, { default: () => h(Folders) })
    }
    const node = findGroupNode(groupTree.value, option.key)
    const icon = resolveIcon(node?.icon)
    if (icon) {
        return h(icon, { theme: (node?.iconTheme || 'outline') as IconTheme, size: 15, fill: node?.color || undefined })
    }
    return h(NIcon, { size: 15 }, { default: () => h(Folder) })
}

const findGroupNode = (nodes: VariableGroupNode[], uuid: string): VariableGroupNode | null => {
    for (const node of nodes) {
        if (node.uuid === uuid) return node
        const found = node.children ? findGroupNode(node.children, uuid) : null
        if (found) return found
    }
    return null
}

// ---------------------------------------------------------------- 分组树右键菜单：分组增删改 + 显示子项内容开关

const treeMenu = reactive({ show: false, x: 0, y: 0, key: '' })

/** 右键分组节点弹菜单（“全部变量/未分组”为虚拟节点，无增删改，不弹） */
const treeNodeProps = ({ option }: { option: TreeOption }) => ({
    onContextmenu: (event: MouseEvent) => {
        const key = String(option.key)
        if (key.startsWith('__')) return
        event.preventDefault()
        treeMenu.x = event.clientX
        treeMenu.y = event.clientY
        treeMenu.key = key
        treeMenu.show = true
    }
})

const treeMenuOptions = computed(() => [
    {
        key: 'addChild',
        label: t('variableManagement.actions.addChildGroup'),
        icon: () => h(NIcon, { size: 15 }, { default: () => h(Plus) })
    },
    {
        key: 'rename',
        label: t('variableManagement.actions.rename'),
        icon: () => h(NIcon, { size: 15 }, { default: () => h(Pencil) })
    },
    {
        key: 'delete',
        label: t('common.delete'),
        icon: () => h(NIcon, { size: 15 }, { default: () => h(Trash) })
    },
    { type: 'divider', key: 'divider' },
    {
        key: 'toggleDescendants',
        label: t('variableManagement.includeDescendants'),
        // 左侧勾选图标表达开关状态（点菜单项即切换）
        icon: includeDescendants.value
            ? () => h(NIcon, { size: 14 }, { default: () => h(Check) })
            : undefined
    }
])

const handleTreeMenuSelect = (key: string) => {
    treeMenu.show = false
    if (key === 'toggleDescendants') {
        includeDescendants.value = !includeDescendants.value
        // 仅选中分组时该开关影响查询（“全部变量/未分组”本就是全量）
        if (isGroupSelected.value) void loadVariables()
        return
    }
    // 其余操作作用于右键命中的那个分组
    const target = treeMenu.key
    if (!target || target.startsWith('__')) return
    if (key === 'addChild') {
        openGroupEditor(null, target)
    } else if (key === 'rename') {
        const node = findGroupNode(groupTree.value, target)
        if (node) openGroupEditor(node)
    } else if (key === 'delete') {
        askDeleteGroup(target)
    }
}

// ---------------------------------------------------------------- 数据加载

const loadAll = async () => {
    loading.value = true
    try {
        groupTree.value = await service.getGroupTree()
        const pathMap = new Map<string, string[]>()
        const walk = (nodes: VariableGroupNode[]) => {
            nodes.forEach(node => {
                pathMap.set(node.uuid, node.path)
                if (node.children?.length) walk(node.children)
            })
        }
        walk(groupTree.value)
        pathByUuid.value = pathMap
        await loadVariables()
    } finally {
        loading.value = false
    }
}

const loadVariables = async () => {
    variables.value = await service.getVariables({
        groupUuid: selectedGroupUuid.value,
        includeDescendants: includeDescendants.value,
        search: search.value
    })
}

// ---------------------------------------------------------------- 表格

const typeTagType = (type: GlobalVariable['type']): 'default' | 'info' | 'success' | 'warning' | 'error' => {
    const map: Record<GlobalVariable['type'], 'default' | 'info' | 'success' | 'warning' | 'error'> = {
        text: 'default',
        textarea: 'default',
        select: 'info',
        number: 'success',
        boolean: 'warning',
        list: 'info',
        dict: 'warning'
    }
    return map[type]
}

/** 类型中文名（与提示词编辑器的类型标签共用同一套文案） */
const TYPE_LABEL_KEYS: Record<GlobalVariable['type'], string> = {
    text: 'promptEditor.typeText',
    textarea: 'promptEditor.typeTextarea',
    select: 'promptEditor.typeSelect',
    number: 'promptEditor.typeNumber',
    boolean: 'promptEditor.typeBoolean',
    list: 'promptEditor.typeList',
    dict: 'promptEditor.typeDict'
}

const typeLabel = (type: string): string => {
    const key = TYPE_LABEL_KEYS[type as GlobalVariable['type']]
    return key ? t(key) : type
}

const renderEllipsis = (text: string | undefined) =>
    h('span', { class: 'cell-ellipsis' }, text || '—')

const tableColumns = computed<DataTableColumns<GlobalVariable>>(() => [
    {
        title: t('variableManagement.table.name'),
        key: 'name',
        minWidth: 140,
        render: (row) => h('span', { class: 'cell-name' }, [
            row.name,
            row.required ? h('span', { class: 'required-dot', title: t('variableManagement.editor.required') }) : null
        ])
    },
    {
        title: t('variableManagement.table.type'),
        key: 'type',
        width: 96,
        render: (row) => h(NTag, { size: 'small', type: typeTagType(row.type), bordered: false }, { default: () => typeLabel(row.type) })
    },
    {
        title: t('variableManagement.table.defaultValue'),
        key: 'defaultValue',
        minWidth: 120,
        render: (row) => renderEllipsis(row.defaultValue ?? '')
    },
    {
        title: t('variableManagement.table.options'),
        key: 'options',
        minWidth: 120,
        render: (row) => renderEllipsis((row.options ?? []).join(' | '))
    },
    {
        title: t('variableManagement.table.group'),
        key: 'group',
        minWidth: 140,
        render: (row) => {
            const path = row.groupUuid ? pathByUuid.value.get(row.groupUuid) : []
            return renderEllipsis(path?.length ? path.join(' / ') : t('variableManagement.tree.ungrouped'))
        }
    },
    {
        title: t('variableManagement.table.description'),
        key: 'description',
        minWidth: 160,
        render: (row) => renderEllipsis(row.description ?? '')
    },
    {
        title: t('variableManagement.table.actions'),
        key: 'actions',
        width: 88,
        render: (row) => h('span', { class: 'row-actions' }, [
            h(NButton, {
                quaternary: true, circle: true, size: 'tiny',
                onClick: () => openVariableEditor(row)
            }, { icon: () => h(NIcon, { size: 15 }, { default: () => h(Pencil) }) }),
            h(NButton, {
                quaternary: true, circle: true, size: 'tiny', type: 'error',
                onClick: () => askRemoveVariable(row)
            }, { icon: () => h(NIcon, { size: 15 }, { default: () => h(Trash) }) })
        ])
    }
])

// ---------------------------------------------------------------- 表格行交互（双击编辑 / 右键菜单）

const rowMenu = reactive({ show: false, x: 0, y: 0, variable: null as GlobalVariable | null })

const rowMenuOptions = computed(() => [
    { label: t('common.edit'), key: 'edit' },
    { label: t('common.delete'), key: 'delete' }
])

const variableRowProps = (row: GlobalVariable) => ({
    onDblclick: () => openVariableEditor(row),
    onContextmenu: (event: MouseEvent) => {
        event.preventDefault()
        rowMenu.x = event.clientX
        rowMenu.y = event.clientY
        rowMenu.variable = row
        rowMenu.show = true
    }
})

const handleRowMenuSelect = (key: string) => {
    rowMenu.show = false
    if (!rowMenu.variable) return
    if (key === 'edit') openVariableEditor(rowMenu.variable)
    else if (key === 'delete') askRemoveVariable(rowMenu.variable)
}

/** 删除变量（带确认，防止右键误触） */
const askRemoveVariable = (variable: GlobalVariable) => {
    dialog.warning({
        title: t('common.delete'),
        content: t('variableManagement.messages.deleteVariableConfirm', { name: variable.name }),
        positiveText: t('common.delete'),
        negativeText: t('common.cancel'),
        onPositiveClick: () => removeVariable(variable)
    })
}

// ---------------------------------------------------------------- 分组表单

const showGroupModal = ref(false)
const editingGroup = ref<VariableGroupNode | null>(null)
const groupForm = reactive({
    name: '',
    description: '',
    parentUuid: null as string | null,
    icon: '',
    iconTheme: 'outline' as IconTheme,
    color: ''
})
/** 编辑中的分组 uuid，用于禁止把父级选到自己子孙下 */
const editingGroupUuid = ref<string | null>(null)

const isDescendantSelected = computed(() => {
    if (!editingGroupUuid.value || !groupForm.parentUuid) return false
    const node = findGroupNode(groupTree.value, editingGroupUuid.value)
    if (!node) return false
    const stack = [...(node.children ?? [])]
    while (stack.length) {
        const current = stack.pop()!
        if (current.uuid === groupForm.parentUuid) return true
        if (current.children?.length) stack.push(...current.children)
    }
    return false
})

const openGroupEditor = (group: VariableGroupNode | null, parentUuid?: string) => {
    editingGroup.value = group
    editingGroupUuid.value = group?.uuid ?? null
    groupForm.name = group?.name ?? ''
    groupForm.description = group?.description ?? ''
    groupForm.parentUuid = group ? (group.parentUuid ?? null) : (parentUuid ?? null)
    groupForm.icon = group?.icon ?? ''
    groupForm.iconTheme = group?.iconTheme ?? 'outline'
    groupForm.color = group?.color ?? '#0d0d0d'
    showGroupModal.value = true
}

const saveGroup = async () => {
    if (!groupForm.name.trim()) {
        message.warning(t('variableManagement.messages.groupNameRequired'))
        return
    }
    saving.value = true
    try {
        if (editingGroup.value) {
            await service.updateGroup(editingGroup.value.uuid, {
                name: groupForm.name,
                description: groupForm.description || undefined,
                icon: groupForm.icon || undefined,
                iconTheme: groupForm.icon ? groupForm.iconTheme : undefined,
                color: groupForm.color || undefined
            })
        } else {
            const created = await service.createGroup({
                name: groupForm.name,
                description: groupForm.description || undefined,
                parentUuid: groupForm.parentUuid,
                icon: groupForm.icon || undefined,
                iconTheme: groupForm.icon ? groupForm.iconTheme : undefined,
                color: groupForm.color || undefined
            })
            selectedGroupKey.value = created.uuid
        }
        showGroupModal.value = false
        message.success(t('variableManagement.messages.groupSaved'))
        await loadAll()
    } catch (error) {
        message.error(normalizeError(error))
    } finally {
        saving.value = false
    }
}

// ---------------------------------------------------------------- 分组删除

const showGroupDeleteModal = ref(false)
const groupDeleteUuid = ref<string | null>(null)
const groupDeleteName = ref('')
const groupDeleteHasContent = ref(false)
const groupDeleteRecursive = ref(false)

const askDeleteGroup = async (uuid: string) => {
    const node = findGroupNode(groupTree.value, uuid)
    if (!node) return
    groupDeleteUuid.value = uuid
    groupDeleteName.value = node.name
    groupDeleteRecursive.value = false
    const groupVariables = await service.getVariables({ groupUuid: uuid, includeDescendants: true })
    groupDeleteHasContent.value = !!(node.children?.length || groupVariables.length)
    showGroupDeleteModal.value = true
}

const confirmDeleteGroup = async () => {
    if (!groupDeleteUuid.value) return
    saving.value = true
    try {
        await service.deleteGroup(groupDeleteUuid.value, { recursive: groupDeleteRecursive.value })
        if (selectedGroupKey.value === groupDeleteUuid.value) selectedGroupKey.value = '__all__'
        showGroupDeleteModal.value = false
        await loadAll()
    } catch (error) {
        message.error(normalizeError(error))
    } finally {
        saving.value = false
    }
}

// ---------------------------------------------------------------- 变量表单

const showVariableModal = ref(false)
const editingVariable = ref<GlobalVariable | null>(null)
const variableForm = reactive<{
    name: string
    type: GlobalVariable['type']
    required: boolean
    groupUuid: string | null
    defaultValue: string
    options: string[]
    optionMeta: Record<string, VariableOptionMeta>
    decor: VariableDecor
    displayRule: VariableDisplayRule | null
    sku: VariableSkuConfig | null
    placeholder: string
    description: string
    validation: { minLength?: number | null; maxLength?: number | null; pattern?: string | null; min?: number | null; max?: number | null }
}>({
    name: '',
    type: 'select',
    required: false,
    groupUuid: null,
    defaultValue: '',
    options: [],
    optionMeta: {},
    decor: {},
    displayRule: null,
    sku: null,
    placeholder: '',
    description: '',
    validation: {}
})

/** 显示规则预览用的示例值：优先第一个选项，其次默认值 */
const variableDisplaySample = computed(() => variableForm.options.find(option => option && option.trim())
    || variableForm.defaultValue || '')

const variableSkuMode = ref<'simple' | 'sku'>('simple')

// ---------------------------------------------------------------- 校验（不满足保存要求：红标 + 悬停原因 + 禁用保存）
const nameIssue = computed(() => {
    const name = variableForm.name.trim()
    if (!name) return t('variableManagement.editor.issueNameRequired')
    if (variables.value.some(item => item.name === name && item.uuid !== editingVariable.value?.uuid)) {
        return t('variableManagement.editor.issueNameDuplicate')
    }
    return ''
})

const optionsIssue = computed(() => {
    if (variableForm.type !== 'select') return ''
    if (variableSkuMode.value === 'simple') {
        return variableForm.options.filter(Boolean).length ? '' : t('variableManagement.editor.issueOptionsRequired')
    }
    const hasCombos = !!variableForm.sku && enabledSkuCombos(variableForm.sku).length > 0
    return hasCombos ? '' : t('skuEditor.needsDimension')
})

const validationIssues = computed(() => [nameIssue.value, optionsIssue.value].filter(Boolean))
const touchValidation = () => { /* 保留 blur 锚点；红标为实时显示 */ }

// ---------------------------------------------------------------- 草稿自动保存 + 撤销/恢复
const draftKey = computed(() => `variable:${editingVariable.value?.uuid ?? 'new'}`)
const draftRestoredAt = ref<number | null>(null)
const draftRestoredText = computed(() =>
    draftRestoredAt.value ? new Date(draftRestoredAt.value).toLocaleString() : '')

const serializeForm = () => JSON.stringify({ form: { ...variableForm, validation: { ...variableForm.validation } }, mode: variableSkuMode.value })

const applyFormState = (state: { form: Record<string, unknown>; mode: 'simple' | 'sku' }) => {
    const form = state.form as Record<string, unknown>
    for (const key of Object.keys(variableForm)) {
        if (key in form) (variableForm as Record<string, unknown>)[key] = form[key]
    }
    variableForm.validation = { ...(form.validation as typeof variableForm.validation) }
    variableSkuMode.value = state.mode
}

const { canUndo, canRedo, scheduleChange, undo, redo, reset: resetUndo, flush: flushUndo } = useUndoRedo({
    serialize: serializeForm,
    apply: snapshot => {
        try {
            applyFormState(JSON.parse(snapshot))
        } catch {
            // 快照损坏时忽略
        }
    },
})
const undoForm = () => undo()
const redoForm = () => redo()

let draftTimer: ReturnType<typeof setTimeout> | null = null
watch(variableForm, () => {
    if (!showVariableModal.value) return
    scheduleChange()
    if (draftTimer !== null) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
        draftTimer = null
        saveDraft(draftKey.value, JSON.parse(serializeForm()))
    }, 600)
}, { deep: true })

watch(variableSkuMode, () => {
    if (!showVariableModal.value) return
    scheduleChange()
    saveDraft(draftKey.value, JSON.parse(serializeForm()))
})

/** 打开编辑器时：有草稿则恢复并提示（可放弃），撤销栈以此为新基线 */
const restoreDraftIfAny = () => {
    const draft = loadDraft<Record<string, unknown>>(draftKey.value)
    if (draft?.data) {
        applyFormState(draft.data as { form: Record<string, unknown>; mode: 'simple' | 'sku' })
        draftRestoredAt.value = draft.savedAt
    } else {
        draftRestoredAt.value = null
    }
    resetUndo()
}

const discardDraft = () => {
    clearDraft(draftKey.value)
    draftRestoredAt.value = null
    message.success(t('variableManagement.editor.draftDiscarded'))
}

/** 弹窗打开期间 Ctrl+Z / Ctrl+Shift+Z(或 Ctrl+Y) 撤销恢复 */
const onEditorKeydown = (event: KeyboardEvent) => {
    if (!showVariableModal.value || !(event.ctrlKey || event.metaKey) || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault()
        redo()
    }
}
onMounted(() => window.addEventListener('keydown', onEditorKeydown))
onUnmounted(() => window.removeEventListener('keydown', onEditorKeydown))

// ---------------------------------------------------------------- 变量历史版本（查看 + 回退）
const variableHistories = ref<VariableHistory[]>([])
const historyLoading = ref(false)
const previewingHistory = ref<string | null>(null)

const loadVariableHistories = async () => {
    if (!editingVariable.value) {
        variableHistories.value = []
        return
    }
    historyLoading.value = true
    try {
        variableHistories.value = await service.listVariableHistories(editingVariable.value.uuid)
    } catch {
        variableHistories.value = []
    } finally {
        historyLoading.value = false
    }
}

const previewingHistoryText = computed(() => {
    const item = variableHistories.value.find(entry => entry.uuid === previewingHistory.value)
    return item ? JSON.stringify(item.snapshot, null, 2) : ''
})

const formatHistoryTime = (value: Date | string | number) => new Date(value).toLocaleString()

/** 回退：把快照载荷填回表单（保存后生效） */
const rollbackToHistory = (history: VariableHistory) => {
    const snapshot = history.snapshot as Partial<GlobalVariable>
    variableForm.name = snapshot.name ?? ''
    variableForm.type = (snapshot.type as GlobalVariable['type']) ?? 'select'
    variableForm.required = snapshot.required ?? false
    variableForm.groupUuid = snapshot.groupUuid ?? null
    variableForm.defaultValue = snapshot.defaultValue ?? ''
    variableForm.options = [...(snapshot.options ?? [])]
    variableForm.optionMeta = Object.fromEntries(
        Object.entries(snapshot.optionMeta ?? {}).map(([key, meta]) => [key, { ...(meta as VariableOptionMeta) }])
    )
    variableForm.decor = snapshot.decor ? { ...(snapshot.decor as VariableDecor) } : {}
    variableForm.displayRule = snapshot.displayRule ? { ...snapshot.displayRule } : null
    variableForm.sku = snapshot.sku
        ? {
            ...snapshot.sku,
            dimensions: snapshot.sku.dimensions.map(dimension => ({ ...dimension, values: [...dimension.values] })),
            enabled: snapshot.sku.enabled ? [...snapshot.sku.enabled] : undefined
        }
        : null
    variableSkuMode.value = snapshot.sku ? 'sku' : 'simple'
    variableForm.placeholder = snapshot.placeholder ?? ''
    variableForm.description = snapshot.description ?? ''
    variableForm.validation = {
        minLength: snapshot.validation?.minLength ?? null,
        maxLength: snapshot.validation?.maxLength ?? null,
        pattern: snapshot.validation?.pattern ?? null,
        min: snapshot.validation?.min ?? null,
        max: snapshot.validation?.max ?? null
    }
    previewingHistory.value = null
    message.success(t('variableManagement.editor.rolledBack', { version: history.version }))
}

// ---------------------------------------------------------------- 简单/组合列表切换（确认流程在 SkuModeSwitch 内）
const applySkuModeSwitch = (target: 'simple' | 'sku', clearLeft: boolean) => {
    variableSkuMode.value = target
    if (!clearLeft) return
    // 清空被离开模式的全部选项（删除不可恢复，已二次确认）
    if (target === 'sku') {
        variableForm.options = []
        variableForm.optionMeta = {}
    } else {
        variableForm.sku = null
    }
}

// 「选择」类型已更名「列表」；旧「列表(list)」类型从下拉移除，仅存量变量可编辑时保留兜底项
const typeOptions = computed(() => VARIABLE_TYPES
    .filter(type => type !== 'list' || variableForm.type === 'list')
    .map(type => ({ label: typeLabel(type), value: type })))

/** SKU 模式下默认值下拉用启用的组合生成 */
const selectDefaultOptions = computed(() => (
    variableSkuMode.value === 'sku' && variableForm.sku
        ? enabledSkuCombos(variableForm.sku).map(combo => combo.label)
        : variableForm.options
).map(option => ({ label: option, value: option })))

const defaultValueNumber = computed({
    get: () => (variableForm.defaultValue === '' ? null : Number(variableForm.defaultValue)),
    set: (value: number | null) => { variableForm.defaultValue = value === null ? '' : String(value) }
})

const defaultValueBoolean = computed({
    get: () => variableForm.defaultValue === 'true',
    set: (value: boolean) => { variableForm.defaultValue = String(value) }
})

const validationPatternText = computed({
    get: () => variableForm.validation.pattern ?? '',
    set: (value: string) => { variableForm.validation.pattern = value || null }
})

const openVariableEditor = (variable: GlobalVariable | null) => {
    editingVariable.value = variable
    variableForm.name = variable?.name ?? ''
    // 新建变量默认为「列表」类型
    variableForm.type = variable?.type ?? 'select'
    variableForm.required = variable?.required ?? false
    variableForm.groupUuid = variable?.groupUuid ?? (isGroupSelected.value ? selectedGroupUuid.value : null)
    variableForm.defaultValue = variable?.defaultValue ?? ''
    variableForm.options = [...(variable?.options ?? [])]
    variableForm.optionMeta = Object.fromEntries(
        Object.entries(variable?.optionMeta ?? {}).map(([key, meta]) => [key, { ...meta }])
    )
    variableForm.decor = variable?.decor ? { ...variable.decor } : {}
    variableForm.displayRule = variable?.displayRule ? { ...variable.displayRule } : null
    variableForm.sku = variable?.sku
        ? {
            ...variable.sku,
            dimensions: variable.sku.dimensions.map(dimension => ({ ...dimension, values: [...dimension.values] })),
            enabled: variable.sku.enabled ? [...variable.sku.enabled] : undefined
        }
        : null
    variableSkuMode.value = variable?.sku ? 'sku' : 'simple'
    variableForm.placeholder = variable?.placeholder ?? ''
    variableForm.description = variable?.description ?? ''
    variableForm.validation = {
        minLength: variable?.validation?.minLength ?? null,
        maxLength: variable?.validation?.maxLength ?? null,
        pattern: variable?.validation?.pattern ?? null,
        min: variable?.validation?.min ?? null,
        max: variable?.validation?.max ?? null
    }
    // 有未保存草稿则恢复（实时自动保存），否则按传入变量初始化；撤销栈以此为基线
    restoreDraftIfAny()
    previewingHistory.value = null
    void loadVariableHistories()
    showVariableModal.value = true
}

const saveVariable = async () => {
    saving.value = true
    try {
        const validation = variableForm.validation
        const cleanedValidation = {
            minLength: validation.minLength ?? undefined,
            maxLength: validation.maxLength ?? undefined,
            pattern: validation.pattern || undefined,
            min: validation.min ?? undefined,
            max: validation.max ?? undefined
        }
        const hasValidation = Object.values(cleanedValidation).some(value => value !== undefined)
        const isSku = variableForm.type === 'select' && variableSkuMode.value === 'sku'
        const skuOptions = isSku && variableForm.sku
            ? enabledSkuCombos(variableForm.sku).map(combo => combo.label)
            : []
        // SKU 模式下没有任何可用组合时阻断保存，避免静默清空已有配置
        if (isSku && !skuOptions.length) {
            message.warning(t('skuEditor.needsDimension'))
            return
        }
        const labels = isSku ? skuOptions : variableForm.options.filter(Boolean)
        const payload = {
            name: variableForm.name,
            type: variableForm.type,
            required: variableForm.required,
            groupUuid: variableForm.groupUuid,
            defaultValue: variableForm.defaultValue || undefined,
            options: variableForm.type === 'select'
                ? (isSku ? (skuOptions.length ? skuOptions : undefined) : (variableForm.options.length ? variableForm.options : undefined))
                : undefined,
            // 模式互斥：仅当前模式写入对应数据
            sku: isSku && variableForm.sku ? variableForm.sku : undefined,
            optionMeta: variableForm.type === 'select' ? pruneOptionMeta(variableForm.optionMeta, labels) : undefined,
            // 变量级装饰：所有类型均可保留（列表选项的「引用上级」指向这里）
            decor: Object.keys(variableForm.decor).length ? { ...variableForm.decor } : undefined,
            // 显示规则：变量写进提示词时的前后缀默认形态
            displayRule: variableForm.displayRule ? { ...variableForm.displayRule } : undefined,
            placeholder: variableForm.placeholder || undefined,
            description: variableForm.description || undefined,
            validation: hasValidation ? cleanedValidation : undefined
        }
        if (editingVariable.value) {
            await service.updateVariable(editingVariable.value.uuid, payload)
        } else {
            await service.createVariable(payload as Parameters<typeof service.createVariable>[0])
        }
        // 保存成功：清空草稿与撤销栈
        clearDraft(draftKey.value)
        flushUndo()
        showVariableModal.value = false
        await loadAll()
    } catch (error) {
        message.error(normalizeError(error))
    } finally {
        saving.value = false
    }
}

const removeVariable = async (variable: GlobalVariable) => {
    try {
        await service.deleteVariable(variable.uuid)
        clearDraft(`variable:${variable.uuid}`)
        await loadAll()
    } catch (error) {
        message.error(normalizeError(error))
    }
}

// ---------------------------------------------------------------- 从提示词导入

const showPromptImportModal = ref(false)
const scanningPrompts = ref(false)
const promptInventory = ref<PromptVariableInventoryItem[]>([])
const checkedInventoryKeys = ref<Array<string | number>>([])
const promptImportTargetGroup = ref<string | null>(null)

const inventoryColumns = computed<DataTableColumns<PromptVariableInventoryItem>>(() => [
    { type: 'selection' },
    {
        title: t('variableManagement.table.name'),
        key: 'name',
        minWidth: 130,
        render: (row) => h('span', { class: 'cell-name' }, row.name)
    },
    {
        title: t('variableManagement.table.type'),
        key: 'type',
        width: 90,
        render: (row) => h(NTag, { size: 'small', type: typeTagType(row.type), bordered: false }, { default: () => typeLabel(row.type) })
    },
    {
        title: t('variableManagement.table.defaultValue'),
        key: 'defaultValue',
        minWidth: 110,
        render: (row) => renderEllipsis(row.defaultValue ?? '')
    },
    {
        title: t('variableManagement.table.options'),
        key: 'options',
        minWidth: 110,
        render: (row) => renderEllipsis((row.options ?? []).join(' | '))
    },
    {
        title: t('variableManagement.promptImport.usageCount'),
        key: 'usageCount',
        width: 90,
        render: (row) => h('span', { class: 'usage-count' }, String(row.usageCount))
    },
    {
        title: t('variableManagement.promptImport.usedBy'),
        key: 'promptTitles',
        minWidth: 150,
        render: (row) => renderEllipsis(row.promptTitles.join('、'))
    }
])

const openPromptImportModal = async () => {
    showPromptImportModal.value = true
    scanningPrompts.value = true
    checkedInventoryKeys.value = []
    promptImportTargetGroup.value = isGroupSelected.value ? selectedGroupUuid.value : null
    try {
        promptInventory.value = await service.scanPromptVariables()
        // 默认全选，直接导入最常用场景
        checkedInventoryKeys.value = promptInventory.value.map(item => item.name)
    } finally {
        scanningPrompts.value = false
    }
}

const runPromptImport = async () => {
    const selected = promptInventory.value.filter(item => checkedInventoryKeys.value.includes(item.name))
    if (!selected.length) return
    saving.value = true
    try {
        const result = await service.importPromptVariables(selected, promptImportTargetGroup.value)
        message.success(t('variableManagement.promptImport.result', result))
        showPromptImportModal.value = false
        await loadAll()
    } catch (error) {
        message.error(normalizeError(error))
    } finally {
        saving.value = false
    }
}

// ---------------------------------------------------------------- 导入导出

const showImportModal = ref(false)
const importMode = ref<'merge' | 'skip'>('merge')
const importFileText = ref('')
const importFileName = ref('')
const importSummary = ref<VariableImportSummary | null>(null)

const exportOptions = computed(() => [
    { key: 'json', label: t('variableManagement.actions.exportJson') },
    { key: 'csv', label: t('variableManagement.actions.exportCsv') }
])

const openImportModal = () => {
    importFileText.value = ''
    importFileName.value = ''
    importSummary.value = null
    showImportModal.value = true
}

const handleImportFileChange = async (options: { file?: { file?: File; name?: string } | null }) => {
    const file = options.file?.file
    if (!file) {
        importFileText.value = ''
        importFileName.value = ''
        return
    }
    importFileName.value = file.name
    importFileText.value = await file.text()
    importSummary.value = null
}

const runImport = async () => {
    if (!importFileText.value) return
    saving.value = true
    try {
        let payload
        if (importFileName.value.toLowerCase().endsWith('.csv')) {
            payload = service.parseCsv(importFileText.value)
        } else {
            payload = JSON.parse(importFileText.value)
        }
        importSummary.value = await service.importPayload(payload, importMode.value)
        await loadAll()
    } catch (error) {
        message.error(normalizeError(error))
    } finally {
        saving.value = false
    }
}

const triggerDownload = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
}

const handleExportSelect = async (key: string | number) => {
    if (key === 'json') {
        const payload = await service.exportAll()
        triggerDownload(JSON.stringify(payload, null, 2), 'promptbox-variables.json', 'application/json')
    } else if (key === 'csv') {
        const csv = await service.exportCsv()
        triggerDownload(`\uFEFF${csv}`, 'promptbox-variables.csv', 'text/csv;charset=utf-8')
    }
}

const downloadTemplate = (kind: 'json' | 'csv') => {
    if (kind === 'json') {
        triggerDownload(service.getJsonTemplate(), 'promptbox-variables-template.json', 'application/json')
    } else {
        triggerDownload(`\uFEFF${service.getCsvTemplate()}`, 'promptbox-variables-template.csv', 'text/csv;charset=utf-8')
    }
}

// ---------------------------------------------------------------- 杂项

const normalizeError = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('VARIABLE_GROUP_DUPLICATE') || message.includes('VARIABLE_DUPLICATE')) {
        return t('variableManagement.messages.duplicateName')
    }
    if (message.includes('VARIABLE_GROUP_CYCLE')) {
        return t('variableManagement.messages.cycle')
    }
    if (message.includes('VARIABLE_GROUP_NOT_EMPTY')) {
        return t('variableManagement.messages.groupNotEmpty')
    }
    return t('common.unknownError')
}

onMounted(loadAll)
</script>

<style scoped>
.variable-page {
    display: flex;
    flex-direction: column;
    /* 与 PromptManagementPage 等页面一致：NLayoutContent 滚动容器内 height:100% 解析为 auto，
       会导致 flex-height 表格 body 塌陷；须用视口高度减去底部状态栏高度 */
    height: calc(100vh - 24px);
    min-height: 0;
    overflow: hidden;
    background: var(--surface-body);
}

.variable-command-bar {
    flex: 0 0 60px;
    min-height: 60px;
    display: grid;
    grid-template-columns: minmax(220px, 1fr) auto;
    align-items: center;
    gap: var(--section-gap);
    padding: 0 var(--page-padding);
    border-bottom: 1px solid var(--border-default);
    background: var(--surface-primary);
}

.page-identity {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}

.page-identity-icon {
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    display: grid;
    place-items: center;
    color: var(--accent-primary);
    border-radius: var(--radius-panel);
    background: var(--surface-secondary);
}

.page-title {
    display: block;
    font-size: var(--font-size-lg);
    line-height: 1.25;
}

.page-subtitle {
    display: block;
    margin-top: 1px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-xs);
}

.page-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
}

.variable-content {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 264px minmax(0, 1fr);
}

.group-panel {
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border-default);
    background: var(--surface-primary);
}

.group-panel-toolbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface-secondary);
}

.group-panel-title {
    font-size: var(--font-size-xs);
}

.group-tree-scroll {
    flex: 1;
    min-height: 0;
    padding: 8px 6px;
}

.group-tree-scroll :deep(.n-tree-node--selected) {
    background: var(--surface-tertiary);
}

.variable-panel {
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface-body);
}

.variable-toolbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px var(--content-padding);
    border-bottom: 1px solid var(--border-default);
    background: var(--surface-primary);
}

.variable-search {
    max-width: 280px;
}

.variable-count {
    margin-left: auto;
    font-size: var(--font-size-xs);
    font-variant-numeric: tabular-nums;
}

.variable-table-wrap {
    flex: 1;
    min-height: 0;
    padding: var(--content-padding);
}

.variable-table {
    height: 100%;
}

.variable-table :deep(.cell-name) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: var(--font-weight-medium);
}

.variable-table :deep(.required-dot) {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
}

.variable-table :deep(.cell-ellipsis) {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.variable-table :deep(.row-actions) {
    display: inline-flex;
    gap: 2px;
}

/* 弹窗（遵循设计语言：surface-primary + 边框 + overlay 阴影） */
.form-modal {
    width: 520px;
    max-width: calc(100vw - 48px);
    max-height: calc(100vh - 96px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-modal);
    background: var(--surface-primary);
    box-shadow: var(--shadow-overlay);
}

.form-modal--narrow {
    width: 420px;
}

.form-modal--confirm {
    width: 400px;
}

.switch-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}

/* 校验红标 */
.editor-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
}

.editor-title-row .form-modal-title {
    flex: 1;
}

.field-label--error {
    color: var(--error-color, #d33);
}

.issue-icon {
    vertical-align: -1px;
    margin-left: 3px;
    color: var(--error-color, #d33);
    cursor: help;
}

.field-input--error :deep(.n-input__border),
.field-input--error :deep(.n-input__state-border) {
    border-color: var(--error-color, #d33);
}

.save-btn--error {
    background: var(--error-color, #d33);
}

.draft-alert {
    margin-bottom: 10px;
}

.draft-discard {
    margin-left: 8px;
}

/* 历史版本 */
.history-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.history-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-control);
}

.history-version {
    font-weight: 600;
    flex: 0 0 auto;
}

.history-time {
    flex: 1;
    font-size: 12px;
    color: var(--content-tertiary);
}

.history-empty {
    display: block;
    padding: 6px 0;
}

.history-preview {
    margin: 4px 0 0;
    padding: 8px;
    max-height: 200px;
    overflow: auto;
    font-size: 12px;
    background: var(--surface-secondary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-control);
    white-space: pre-wrap;
    word-break: break-all;
}

.form-modal--wide {
    width: 760px;
}

.form-modal-subtitle {
    display: block;
    margin-top: 2px;
    font-size: var(--font-size-xs);
}

.scan-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 28px 0;
}

.inventory-table :deep(.usage-count) {
    font-variant-numeric: tabular-nums;
    color: var(--content-secondary);
}

.import-target-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.import-target-row .field-label {
    flex: 0 0 auto;
}

.target-select {
    flex: 1;
    max-width: 320px;
}

.form-modal-header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-default);
    background: var(--surface-secondary);
}

.form-modal-title {
    font-size: var(--font-size-md);
}

.form-modal-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    overflow-y: auto;
}

.form-modal-footer {
    flex: 0 0 auto;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border-default);
    background: var(--surface-secondary);
}

.form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 16px;
}

.form-span-2 {
    grid-column: 1 / -1;
}

.form-field {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
}

.form-field--switch {
    justify-content: flex-end;
}

.options-mode-switch {
    align-self: flex-start;
}

.options-mode-switch :deep(.n-radio-button) {
    min-width: 96px;
    text-align: center;
}

.field-label {
    color: var(--content-secondary);
    font-size: var(--font-size-xs);
}

.field-hint {
    display: block;
    margin: -4px 0 6px;
    font-size: 12px;
    line-height: 1.4;
}

.name-decor-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
}

.name-decor-row :deep(.n-input) {
    flex: 1 1 auto;
    min-width: 0;
}

.validation-section {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface-secondary);
    padding: 10px 12px;
}

.validation-section summary {
    cursor: pointer;
    user-select: none;
}

.validation-grid {
    margin-top: 12px;
}

.delete-recursive {
    margin-top: 12px;
}

.delete-recursive-tip {
    margin-top: 6px;
    font-size: var(--font-size-xs);
}

.upload-hint {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 18px 0;
}

.import-result {
    font-size: var(--font-size-sm);
}

.import-warnings {
    margin: 8px 0 0;
    padding-left: 18px;
    font-size: var(--font-size-xs);
}

.import-template-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface-secondary);
}

@media (max-width: 1240px) {
    .variable-command-bar {
        grid-template-columns: minmax(220px, 1fr) auto;
    }
}

@media (max-width: 1024px) {
    .variable-content {
        grid-template-columns: 220px minmax(0, 1fr);
    }
}
</style>
