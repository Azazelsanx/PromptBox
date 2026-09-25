<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
    NButton,
    NCheckbox,
    NEmpty,
    NIcon,
    NInput,
    NModal,
    NPopconfirm,
    NPopover,
    NSelect,
    NSpin,
    NSwitch,
    NTag,
    NText,
    NTooltip,
    useMessage
} from 'naive-ui'
import {
    AlertCircle,
    Copy,
    History,
    Pencil,
    PlayerStop,
    Plus,
    Refresh,
    Robot as BotIcon,
    DeviceFloppy as SaveIcon,
    Trash,
    Upload
} from '@vicons/tabler'
import { Bot } from '@shared/types/database'
import { AIConfig } from '@shared/types/ai'
import { aiConfigService, botService, promptService } from '~/lib/services'
import { aiTaskManager, AiTaskStatus, formatTaskDuration } from '~/lib/services/ai-task-manager'
import { onDataChange } from '~/lib/services/data-change-events'
import {
    DEFAULT_AVATAR_MAX_EDGE,
    compressImageDataUrl,
    extractImageFile,
    readImageAsDataUrl
} from '~/lib/utils/image-compress'
import { renderMarkdownLite } from '~/lib/utils/markdown-lite'

const { t } = useI18n()
const message = useMessage()

// ---------- 列表数据 ----------
const bots = ref<Bot[]>([])
const aiConfigs = ref<AIConfig[]>([])
const loading = ref(false)
const preferredConfig = ref<AIConfig | null>(null)

const enabledConfigs = computed(() => aiConfigs.value.filter(config => config.enabled))

const resolveConfig = (bot: Bot): AIConfig | null => {
    if (bot.configId) {
        const matched = aiConfigs.value.find(config => config.configId === bot.configId)
        if (matched) return matched
    }
    return preferredConfig.value
}

/** Electron IPC 结构化克隆不接受 Vue 响应式 Proxy，跨进程前必须转纯对象 */
const toPlainConfig = (config: AIConfig): AIConfig => JSON.parse(JSON.stringify(config)) as AIConfig

const configDisplayName = (bot: Bot): string => {
    const config = resolveConfig(bot)
    return config ? config.name : t('bots.aiConfigPlaceholder')
}

const loadBots = async () => {
    try {
        bots.value = await botService.getAllBots()
    } catch (error) {
        console.error('加载 Bot 列表失败:', error)
        message.error(t('bots.loadFailed'))
    }
}

const loadConfigs = async () => {
    try {
        aiConfigs.value = await aiConfigService.getAllAIConfigs()
        preferredConfig.value = await aiConfigService.getPreferredAIConfig()
    } catch (error) {
        console.error('加载 AI 配置失败:', error)
    }
}

let unsubscribeDataChanges: (() => void) | undefined
let unsubscribeReverseProgress: (() => void) | undefined
onMounted(async () => {
    loading.value = true
    await Promise.all([loadBots(), loadConfigs()])
    loading.value = false
    unsubscribeDataChanges = onDataChange(['bots'], () => { void loadBots() })
    // 订阅主进程流式进度：实时刷新任务 partial（悬停预览正在书写的提示词）
    if (window.electronAPI?.ai?.onReverseProgress) {
        unsubscribeReverseProgress = window.electronAPI.ai.onReverseProgress((payload) => {
            aiTaskManager.updatePartial(payload.taskId, payload.partial)
        })
    }
})
onBeforeUnmount(() => {
    unsubscribeDataChanges?.()
    unsubscribeReverseProgress?.()
    stopElapsedTimer()
})

// ---------- 编辑弹窗 ----------
const showEditor = ref(false)
const editingBot = ref<Bot | null>(null)
const editorSaving = ref(false)
const editorForm = ref({
    name: '',
    avatar: '' as string, // dataURL，空串 = 使用默认图标
    instruction: '',
    configId: '' as string,
    model: '' as string,
    enabled: true
})
const avatarInputRef = ref<HTMLInputElement | null>(null)

// 指令编辑区视图：编辑 / Markdown 预览
const instructionView = ref<'edit' | 'preview'>('edit')
const instructionPreviewHtml = computed(() => renderMarkdownLite(editorForm.value.instruction))

const openCreateEditor = () => {
    editingBot.value = null
    editorForm.value = {
        name: '',
        avatar: '',
        instruction: '',
        configId: preferredConfig.value?.configId || '',
        model: '',
        enabled: true
    }
    instructionView.value = 'edit'
    showEditor.value = true
}

const openEditEditor = (bot: Bot) => {
    editingBot.value = bot
    editorForm.value = {
        name: bot.name,
        avatar: bot.avatar || '',
        instruction: bot.instruction,
        configId: bot.configId || '',
        model: bot.model || '',
        enabled: bot.enabled
    }
    instructionView.value = 'edit'
    showEditor.value = true
}

const pickAvatar = () => avatarInputRef.value?.click()

const handleAvatarFile = async (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
        const raw = await readImageAsDataUrl(file)
        editorForm.value.avatar = await compressImageDataUrl(raw, { maxEdge: DEFAULT_AVATAR_MAX_EDGE, quality: 0.9 })
    } catch (error) {
        console.error('头像处理失败:', error)
        message.error(t('bots.readFailed'))
    }
}

const removeAvatar = () => { editorForm.value.avatar = '' }

const configOptions = computed(() => enabledConfigs.value.map(config => ({
    label: config.name,
    value: config.configId
})))

const editorModelOptions = computed(() => {
    const selected = editorForm.value.configId
        ? aiConfigs.value.find(config => config.configId === editorForm.value.configId)
        : preferredConfig.value
    const models = selected?.models || []
    const options = models.map(model => ({ label: model, value: model }))
    const current = editorForm.value.model
    if (current && !models.includes(current)) {
        options.unshift({ label: current, value: current })
    }
    return options
})

const handleEditorConfigChange = (value: string) => {
    editorForm.value.configId = value
    const selected = aiConfigs.value.find(config => config.configId === value)
    editorForm.value.model = selected?.defaultModel || ''
}

const saveEditor = async () => {
    const form = editorForm.value
    if (!form.name.trim() || !form.instruction.trim()) {
        message.warning(t('bots.requiredFields'))
        return
    }
    editorSaving.value = true
    try {
        const payload = {
            name: form.name.trim(),
            avatar: form.avatar || undefined,
            instruction: form.instruction,
            configId: form.configId || undefined,
            model: form.model || undefined,
            enabled: form.enabled
        }
        if (editingBot.value?.id) {
            await botService.updateBot(editingBot.value.id, payload)
        } else {
            await botService.createBot(payload)
        }
        message.success(t('bots.saveSuccess'))
        showEditor.value = false
        await loadBots()
    } catch (error) {
        console.error('保存 Bot 失败:', error)
        message.error(t('bots.saveFailed'))
    } finally {
        editorSaving.value = false
    }
}

// ---------- 启用开关 / 删除 ----------
const toggleEnabled = async (bot: Bot, enabled: boolean) => {
    try {
        await botService.updateBot(bot.id!, { enabled })
        await loadBots()
    } catch (error) {
        console.error('更新 Bot 状态失败:', error)
        bot.enabled = !enabled
    }
}

const handleDelete = async (bot: Bot) => {
    try {
        await botService.deleteBot(bot.id!)
        await loadBots()
    } catch (error) {
        console.error('删除 Bot 失败:', error)
        message.error(t('bots.deleteFailed'))
    }
}

// ---------- 拖拽逆向 ----------
const dragOverBotUuid = ref<string | null>(null)
const runningBotUuid = ref<string | null>(null)
let dragDepth = 0

// ---------- AI 任务管理（进度提示 / 取消 / 日志） ----------
const currentTaskId = ref<string | null>(null)
const elapsedTick = ref(0)
let elapsedTimer: ReturnType<typeof setInterval> | null = null
const showTaskLogs = ref(false)

const runningTask = computed(() => aiTaskManager.state.running[0] || null)

// 悬停预览：正在书写的提示词（partial 实时刷新，自动滚动到底部）
const partialPreviewRef = ref<HTMLElement | null>(null)
watch(() => runningTask.value?.partial, async () => {
    await nextTick()
    const el = partialPreviewRef.value
    if (el) el.scrollTop = el.scrollHeight
})

const runningElapsedText = computed(() => {
    elapsedTick.value // 依赖每秒 tick，驱动已耗时文案刷新
    if (!runningTask.value) return ''
    return formatTaskDuration(Date.now() - runningTask.value.startedAt)
})

const startElapsedTimer = () => {
    if (elapsedTimer) return
    elapsedTimer = setInterval(() => { elapsedTick.value += 1 }, 1000)
}

const stopElapsedTimer = () => {
    if (elapsedTimer) {
        clearInterval(elapsedTimer)
        elapsedTimer = null
    }
}

/** 注册新任务并开始计时 */
const beginTask = (bot: Bot, model?: string) => {
    const task = aiTaskManager.start({ type: 'reverse', title: bot.name, model })
    currentTaskId.value = task.id
    startElapsedTimer()
    return task
}

/** 结束计时 */
const endTaskTiming = (taskId: string) => {
    if (currentTaskId.value === taskId) {
        currentTaskId.value = null
    }
    if (!aiTaskManager.state.running.length) {
        stopElapsedTimer()
    }
}

/** 取消进行中的逆向任务：中止渲染层信号 + 通知主进程 abort 推理 */
const cancelRunningTask = async () => {
    const taskId = currentTaskId.value
    if (!taskId) return
    aiTaskManager.cancel(taskId)
    try {
        await window.electronAPI.ai.cancelReverseTask(taskId)
    } catch (error) {
        console.warn('取消任务通知失败:', error)
    }
}

const statusTypeOf = (status: AiTaskStatus) => (
    status === 'success' ? 'success'
        : status === 'failed' ? 'error'
            : status === 'cancelled' ? 'default'
                : 'info'
)

const onDragEnter = (bot: Bot) => {
    dragDepth += 1
    dragOverBotUuid.value = bot.uuid
}

const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) dragOverBotUuid.value = null
}

const onDragOver = (event: DragEvent) => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

const onDrop = async (event: DragEvent, bot: Bot) => {
    event.preventDefault()
    dragDepth = 0
    dragOverBotUuid.value = null
    if (runningBotUuid.value) return

    if (!bot.enabled) return
    const config = resolveConfig(bot)
    if (!config) {
        message.warning(t('bots.noConfigs'))
        return
    }

    const file = extractImageFile(event.dataTransfer!)
    if (!file) {
        message.warning(t('bots.dropNotImage'))
        return
    }

    runningBotUuid.value = bot.uuid
    const task = beginTask(bot, bot.model || config.defaultModel || config.customModel)
    try {
        const raw = await readImageAsDataUrl(file)
        const imageDataUrl = await compressImageDataUrl(raw, { maxEdge: 1536, quality: 0.85 })
        const response = await window.electronAPI.ai.reversePrompt({
            config: toPlainConfig(config),
            instruction: bot.instruction,
            imageDataUrl,
            model: bot.model || undefined,
            taskId: task.id
        })
        aiTaskManager.finish(task.id)
        resultState.value = {
            bot,
            prompt: response.prompt,
            model: response.model,
            imagePreview: imageDataUrl,
            saved: false
        }
        showResultModal.value = true
    } catch (error: any) {
        if (aiTaskManager.isCancelled(task.id)) {
            // 用户主动取消：任务日志已记录，不打扰
        } else {
            aiTaskManager.fail(task.id, error?.message || String(error))
            console.error('逆向失败:', error)
            message.error(`${t('bots.reverseFailed')}: ${error?.message || error}`)
        }
    } finally {
        runningBotUuid.value = null
        endTaskTiming(task.id)
    }
}

// ---------- 结果弹窗 ----------
const showResultModal = ref(false)
const resultState = ref<{
    bot: Bot
    prompt: string
    model: string
    imagePreview: string
    saved: boolean
} | null>(null)
const rerunning = ref(false)
const copied = ref(false)

const copyResult = async () => {
    if (!resultState.value) return
    try {
        await navigator.clipboard.writeText(resultState.value.prompt)
        copied.value = true
        setTimeout(() => { copied.value = false }, 2000)
    } catch (error) {
        console.error('复制失败:', error)
    }
}

const saveResultToPrompts = async () => {
    if (!resultState.value?.prompt.trim()) return
    try {
        await promptService.createPrompt({
            title: `${resultState.value.bot.name} · 逆向`,
            content: resultState.value.prompt,
            description: t('bots.resultFor', { name: resultState.value.bot.name }),
            tags: [],
            isFavorite: false,
            useCount: 0,
            isActive: true
        })
        resultState.value.saved = true
        message.success(t('bots.savedToPrompts'))
    } catch (error) {
        console.error('存入提示词库失败:', error)
        message.error(t('bots.saveFailed'))
    }
}

const rerunResult = async () => {
    if (!resultState.value || rerunning.value) return
    const { bot, imagePreview } = resultState.value
    const config = resolveConfig(bot)
    if (!config) {
        message.warning(t('bots.noConfigs'))
        return
    }
    rerunning.value = true
    const task = beginTask(bot, bot.model || config.defaultModel || config.customModel)
    try {
        const response = await window.electronAPI.ai.reversePrompt({
            config: toPlainConfig(config),
            instruction: bot.instruction,
            imageDataUrl: imagePreview,
            model: bot.model || undefined,
            taskId: task.id
        })
        aiTaskManager.finish(task.id)
        resultState.value.prompt = response.prompt
        resultState.value.model = response.model
        resultState.value.saved = false
    } catch (error: any) {
        if (!aiTaskManager.isCancelled(task.id)) {
            aiTaskManager.fail(task.id, error?.message || String(error))
            console.error('重新生成失败:', error)
            message.error(`${t('bots.reverseFailed')}: ${error?.message || error}`)
        }
    } finally {
        rerunning.value = false
        endTaskTiming(task.id)
    }
}
</script>

<template>
    <div class="bots-page">
        <header class="bots-command-bar">
            <div class="page-identity">
                <span class="page-identity-icon"><NIcon size="18"><BotIcon /></NIcon></span>
                <div>
                    <NText strong class="page-title">{{ t('bots.title') }}</NText>
                    <NText depth="3" class="page-subtitle">{{ t('bots.subtitle') }}</NText>
                </div>
            </div>
            <div class="page-actions">
                <NButton size="small" @click="showTaskLogs = true">
                    <template #icon><NIcon size="16"><History /></NIcon></template>
                    <span class="action-label">{{ t('bots.taskLogs') }}</span>
                </NButton>
                <NButton type="primary" size="small" @click="openCreateEditor">
                    <template #icon><NIcon size="16"><Plus /></NIcon></template>
                    <span class="action-label">{{ t('bots.createBot') }}</span>
                </NButton>
            </div>
        </header>

        <div class="bots-content">
            <NSpin :show="loading" class="bots-spin">
                <div v-if="bots.length === 0 && !loading" class="bots-empty">
                    <NEmpty :description="t('bots.empty')">
                        <template #extra>
                            <NText depth="3" class="bots-empty-hint">{{ t('bots.emptyHint') }}</NText>
                        </template>
                    </NEmpty>
                </div>

                <div v-else class="bots-grid">
                    <article v-for="bot in bots" :key="bot.uuid" class="bot-card"
                        :class="{
                            'bot-card-dragover': dragOverBotUuid === bot.uuid,
                            'bot-card-disabled': !bot.enabled
                        }"
                        @dragenter="onDragEnter(bot)"
                        @dragleave="onDragLeave"
                        @dragover="onDragOver"
                        @drop="onDrop($event, bot)">
                        <div v-if="dragOverBotUuid === bot.uuid" class="bot-card-drop-hint">
                            <NIcon size="20"><Upload /></NIcon>
                            <span>{{ t('bots.dropHere') }}</span>
                        </div>
                        <div v-if="runningBotUuid === bot.uuid" class="bot-card-running">
                            <NPopover trigger="hover" placement="top" :show-arrow="true">
                                <template #trigger>
                                    <div class="bot-card-running-info">
                                        <NSpin :show="true" size="small" />
                                        <span class="bot-card-running-text">{{ t('bots.running') }} · {{ runningElapsedText }}</span>
                                    </div>
                                </template>
                                <div ref="partialPreviewRef" class="bot-partial-preview">{{ runningTask?.partial || t('bots.streamWaiting') }}</div>
                            </NPopover>
                            <button type="button" class="bot-card-cancel" @click="cancelRunningTask">
                                <NIcon size="13"><PlayerStop /></NIcon>
                                {{ t('bots.cancelTask') }}
                            </button>
                        </div>

                        <div class="bot-card-head">
                            <img v-if="bot.avatar" :src="bot.avatar" class="bot-avatar" alt="" />
                            <span v-else class="bot-avatar bot-avatar-fallback">
                                <NIcon size="22"><BotIcon /></NIcon>
                            </span>
                            <div class="bot-card-titles">
                                <NText strong class="bot-name">{{ bot.name }}</NText>
                                <NText depth="3" class="bot-config">{{ configDisplayName(bot) }}</NText>
                            </div>
                            <NTooltip>
                                <template #trigger>
                                    <NSwitch size="small" :value="bot.enabled"
                                        @update:value="(value: boolean) => toggleEnabled(bot, value)" />
                                </template>
                                {{ bot.enabled ? t('bots.enabled') : t('bots.disabled') }}
                            </NTooltip>
                        </div>

                        <p class="bot-instruction">{{ bot.instruction }}</p>

                        <div class="bot-card-meta">
                            <NTag v-if="bot.model" size="small" :bordered="false" class="bot-model-tag">
                                {{ bot.model }}
                            </NTag>
                            <div class="bot-card-actions">
                                <NTooltip>
                                    <template #trigger>
                                        <NButton quaternary circle size="tiny" @click="openEditEditor(bot)">
                                            <template #icon><NIcon size="16"><Pencil /></NIcon></template>
                                        </NButton>
                                    </template>
                                    {{ t('bots.editBot') }}
                                </NTooltip>
                                <NPopconfirm @positive-click="handleDelete(bot)">
                                    <template #trigger>
                                        <NButton quaternary circle size="tiny" type="error">
                                            <template #icon><NIcon size="16"><Trash /></NIcon></template>
                                        </NButton>
                                    </template>
                                    {{ t('bots.deleteConfirm', { name: bot.name }) }}
                                </NPopconfirm>
                            </div>
                        </div>
                    </article>
                </div>
            </NSpin>
        </div>

        <!-- 新建 / 编辑 Bot -->
        <NModal :show="showEditor" :mask-closable="false" display-directive="show"
            @update:show="showEditor = $event">
            <div class="form-modal" role="dialog" aria-modal="true">
                <header class="form-modal-header">
                    <NText strong class="form-modal-title">
                        {{ editingBot ? t('bots.editBot') : t('bots.createBot') }}
                    </NText>
                    <NButton quaternary circle size="small" @click="showEditor = false">
                        <template #icon><NIcon size="16"><Trash /></NIcon></template>
                    </NButton>
                </header>
                <div class="form-modal-body">
                    <div class="form-field">
                        <label class="field-label">{{ t('bots.avatar') }}</label>
                        <div class="avatar-row">
                            <button type="button" class="avatar-picker" @click="pickAvatar">
                                <img v-if="editorForm.avatar" :src="editorForm.avatar" class="avatar-preview" alt="" />
                                <span v-else class="avatar-preview avatar-preview-empty">
                                    <NIcon size="20"><Upload /></NIcon>
                                </span>
                            </button>
                            <input ref="avatarInputRef" type="file" accept="image/*" class="avatar-input"
                                @change="handleAvatarFile" />
                            <NText depth="3" class="field-hint">{{ t('bots.avatarHint') }}</NText>
                            <NButton v-if="editorForm.avatar" quaternary size="tiny" @click="removeAvatar">
                                {{ t('bots.removeAvatar') }}
                            </NButton>
                        </div>
                    </div>

                    <div class="form-field">
                        <label class="field-label">{{ t('bots.name') }}</label>
                        <NInput v-model:value="editorForm.name" size="small"
                            :placeholder="t('bots.namePlaceholder')" />
                    </div>

                    <div class="form-field">
                        <div class="field-label-row">
                            <label class="field-label">{{ t('bots.instruction') }}</label>
                            <div class="instruction-mode-switch">
                                <button type="button" class="mode-btn"
                                    :class="{ active: instructionView === 'edit' }"
                                    @click="instructionView = 'edit'">{{ t('bots.editMode') }}</button>
                                <button type="button" class="mode-btn"
                                    :class="{ active: instructionView === 'preview' }"
                                    @click="instructionView = 'preview'">{{ t('bots.previewMode') }}</button>
                            </div>
                        </div>
                        <NInput v-if="instructionView === 'edit'" v-model:value="editorForm.instruction"
                            type="textarea" size="small" :rows="7"
                            :placeholder="t('bots.instructionPlaceholder')" />
                        <div v-else class="markdown-preview md-body" v-html="instructionPreviewHtml"></div>
                    </div>

                    <div class="form-field">
                        <label class="field-label">{{ t('bots.aiConfig') }}</label>
                        <NSelect v-model:value="editorForm.configId" size="small" clearable
                            :options="configOptions" :placeholder="t('bots.aiConfigPlaceholder')"
                            @update:value="handleEditorConfigChange" />
                    </div>

                    <div class="form-field">
                        <label class="field-label">{{ t('bots.model') }}</label>
                        <NSelect v-model:value="editorForm.model" size="small" clearable tag filterable
                            :options="editorModelOptions" :placeholder="t('bots.modelPlaceholder')" />
                        <NText depth="3" class="field-hint">{{ t('bots.visionHint') }}</NText>
                    </div>

                    <div class="form-field form-field-inline">
                        <label class="field-label">{{ t('bots.enabled') }}</label>
                        <NSwitch v-model:value="editorForm.enabled" size="small" />
                    </div>
                </div>
                <footer class="form-modal-footer">
                    <NButton size="small" @click="showEditor = false">{{ t('bots.close') }}</NButton>
                    <NButton type="primary" size="small" :loading="editorSaving" @click="saveEditor">
                        <template #icon><NIcon size="16"><SaveIcon /></NIcon></template>
                        {{ t('bots.saveSuccess') }}
                    </NButton>
                </footer>
            </div>
        </NModal>

        <!-- 逆向结果 -->
        <NModal :show="showResultModal" :mask-closable="false" display-directive="show"
            @update:show="showResultModal = $event">
            <div class="form-modal result-modal" role="dialog" aria-modal="true">
                <header class="form-modal-header">
                    <NText strong class="form-modal-title">
                        {{ resultState ? t('bots.resultFor', { name: resultState.bot.name }) : t('bots.resultTitle') }}
                    </NText>
                    <NButton quaternary circle size="small" @click="showResultModal = false">
                        <template #icon><NIcon size="16"><Trash /></NIcon></template>
                    </NButton>
                </header>
                <div class="form-modal-body result-body" v-if="resultState">
                    <div class="result-layout">
                        <img :src="resultState.imagePreview" class="result-image" alt="" />
                        <NInput v-model:value="resultState.prompt" type="textarea" class="result-prompt"
                            :autosize="{ minRows: 8, maxRows: 18 }" />
                    </div>
                    <NText depth="3" class="result-model">{{ resultState.model }}</NText>
                </div>
                <footer class="form-modal-footer" v-if="resultState">
                    <NButton size="small" :loading="rerunning" @click="rerunResult">
                        <template #icon><NIcon size="16"><Refresh /></NIcon></template>
                        {{ t('bots.rerun') }}
                    </NButton>
                    <div class="footer-spacer" />
                    <NButton size="small" @click="copyResult">
                        <template #icon><NIcon size="16"><Copy /></NIcon></template>
                        {{ copied ? t('bots.copied') : t('bots.copy') }}
                    </NButton>
                    <NButton size="small" type="primary" :disabled="resultState.saved"
                        @click="saveResultToPrompts">
                        <template #icon><NIcon size="16"><SaveIcon /></NIcon></template>
                        {{ resultState.saved ? t('bots.savedToPrompts') : t('bots.saveToPrompts') }}
                    </NButton>
                </footer>
            </div>
        </NModal>

        <!-- 任务日志 -->
        <NModal :show="showTaskLogs" :mask-closable="true" display-directive="show"
            class="task-logs-modal" @update:show="showTaskLogs = $event">
            <div class="task-logs-panel">
                <header class="task-logs-head">
                    <h3 class="task-logs-title">{{ t('bots.taskLogs') }}</h3>
                    <NButton quaternary size="tiny" :disabled="!aiTaskManager.state.history.length"
                        @click="aiTaskManager.clearHistory()">
                        <template #icon><NIcon size="14"><Trash /></NIcon></template>
                        {{ t('bots.clearLogs') }}
                    </NButton>
                </header>
                <NEmpty v-if="!aiTaskManager.state.history.length && !aiTaskManager.state.running.length"
                    :description="t('bots.noTaskLogs')" class="task-logs-empty" />
                <div v-else class="task-logs-list">
                    <div v-for="task in aiTaskManager.state.running" :key="task.id" class="task-log-row">
                        <NTag size="small" type="info" round>{{ t('bots.taskRunning') }}</NTag>
                        <span class="task-log-title">{{ task.title }}</span>
                        <span v-if="task.model" class="task-log-model">{{ task.model }}</span>
                        <span class="task-log-time">{{ new Date(task.startedAt).toLocaleTimeString() }}</span>
                        <span class="task-log-duration">{{ runningElapsedText }}</span>
                    </div>
                    <div v-for="task in aiTaskManager.state.history" :key="task.id" class="task-log-row">
                        <NTag size="small" :type="statusTypeOf(task.status)" round>
                            {{ t(task.status === 'success' ? 'bots.taskSuccess'
                                : task.status === 'failed' ? 'bots.taskFailed'
                                    : 'bots.taskCancelled') }}
                        </NTag>
                        <span class="task-log-title">{{ task.title }}</span>
                        <span v-if="task.model" class="task-log-model">{{ task.model }}</span>
                        <span class="task-log-time">{{ task.endedAt ? new Date(task.endedAt).toLocaleTimeString() : '' }}</span>
                        <span class="task-log-duration">{{ task.durationText }}</span>
                        <NTooltip v-if="task.error" trigger="hover">
                            <template #trigger>
                                <NIcon size="14" class="task-log-error"><AlertCircle /></NIcon>
                            </template>
                            {{ task.error }}
                        </NTooltip>
                    </div>
                </div>
            </div>
        </NModal>
    </div>
</template>

<style scoped>
.bots-page {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: var(--page-padding);
    gap: var(--section-gap);
    background: var(--surface-body);
    overflow: hidden;
}

.bots-command-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--content-padding);
    flex: 0 0 auto;
}

.page-identity {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}

.page-identity-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-control);
    background: var(--surface-secondary);
    border: 1px solid var(--border-default);
    color: var(--text-primary);
}

.page-title {
    display: block;
    font-size: 22px;
    line-height: 1.3;
}

.page-subtitle {
    display: block;
    font-size: 13px;
    margin-top: 2px;
}

.page-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
}

.bots-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}

.bots-spin {
    display: block;
    min-height: 200px;
}

.bots-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 80px 0;
}

.bots-empty-hint {
    font-size: 13px;
}

.bots-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--content-padding);
}

.bot-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: var(--compact-padding);
    background: var(--surface-primary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-panel);
    transition: border-color 0.15s ease, background-color 0.15s ease;
}

.bot-card:hover {
    border-color: var(--border-strong);
    background: var(--surface-secondary);
}

.bot-card-dragover {
    border-color: var(--primary-color);
    background: var(--surface-tertiary);
}

.bot-card-disabled {
    opacity: 0.6;
}

.bot-card-drop-hint {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: var(--radius-panel);
    background: var(--surface-tertiary);
    border: 1px dashed var(--primary-color);
    color: var(--primary-color);
    font-size: 13px;
    pointer-events: none;
}

.bot-card-running {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border-radius: var(--radius-panel);
    background: var(--surface-primary);
    opacity: 0.94;
}

.bot-card-running-text {
    font-size: 13px;
    color: var(--text-secondary);
}

.bot-card-running-info {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: help;
}

.bot-partial-preview {
    width: 340px;
    max-height: 220px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-primary, inherit);
}

.bot-card-cancel {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border-default);
    background: var(--surface-secondary);
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1;
    padding: 4px 10px;
    border-radius: var(--radius-control);
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
}

.bot-card-cancel:hover {
    color: var(--text-primary);
    border-color: var(--border-strong);
}

/* ---------- 任务日志 ---------- */
.task-logs-panel {
    width: min(640px, 92vw);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 18px;
    border-radius: var(--radius-modal);
    background: var(--surface-primary);
    border: 1px solid var(--border-default);
    box-shadow: var(--shadow-overlay);
}

.task-logs-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.task-logs-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
}

.task-logs-empty {
    padding: 28px 0;
}

.task-logs-list {
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.task-log-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-control);
    background: var(--surface-secondary);
    font-size: 12px;
    color: var(--text-secondary);
}

.task-log-title {
    color: var(--text-primary);
    max-width: 32%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.task-log-model {
    max-width: 26%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.task-log-time {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
}

.task-log-duration {
    min-width: 52px;
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.task-log-error {
    color: var(--primary-color);
    cursor: help;
    flex: 0 0 auto;
}

.bot-card-head {
    display: flex;
    align-items: center;
    gap: 10px;
}

.bot-avatar {
    width: 40px;
    height: 40px;
    flex: 0 0 40px;
    object-fit: cover;
    border-radius: var(--radius-image);
    border: 1px solid var(--border-default);
}

.bot-avatar-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-secondary);
    color: var(--text-secondary);
}

.bot-card-titles {
    flex: 1;
    min-width: 0;
}

.bot-name {
    display: block;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.bot-config {
    display: block;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.bot-instruction {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.bot-card-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: auto;
}

.bot-model-tag {
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
}

.bot-card-actions {
    display: flex;
    align-items: center;
    gap: 4px;
}

/* ---------- 弹窗 ---------- */
.form-modal {
    width: min(560px, calc(100vw - 48px));
    background: var(--surface-primary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-modal);
    box-shadow: var(--shadow-overlay);
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 64px);
}

.result-modal {
    width: min(880px, calc(100vw - 48px));
}

.form-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--compact-padding) var(--content-padding);
    border-bottom: 1px solid var(--border-default);
    background: var(--surface-secondary);
    border-radius: var(--radius-modal) var(--radius-modal) 0 0;
}

.form-modal-title {
    font-size: 16px;
}

.form-modal-body {
    padding: var(--content-padding);
    display: flex;
    flex-direction: column;
    gap: var(--compact-padding);
    overflow-y: auto;
    min-height: 0;
}

.form-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.form-field-inline {
    flex-direction: row;
    align-items: center;
    gap: 12px;
}

.field-label {
    font-size: 13px;
    color: var(--text-secondary);
}

.field-hint {
    font-size: 12px;
}

.field-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.instruction-mode-switch {
    display: inline-flex;
    gap: 4px;
}

.mode-btn {
    border: 1px solid var(--border-default);
    background: var(--surface-secondary);
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1;
    padding: 4px 10px;
    border-radius: var(--radius-control);
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.mode-btn:hover {
    color: var(--text-primary);
    border-color: var(--border-strong);
}

.mode-btn.active {
    background: var(--surface-tertiary);
    color: var(--primary-color);
    border-color: var(--primary-color);
}

.markdown-preview {
    min-height: 132px;
    max-height: 280px;
    overflow: auto;
    padding: 10px 12px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-control);
    background: var(--surface-secondary);
    font-size: 13px;
    line-height: 1.65;
    color: var(--text-primary);
    word-break: break-word;
}

/* ---------- Markdown 预览元素 ---------- */
.md-body p {
    margin: 0 0 8px;
}

.md-body p:last-child {
    margin-bottom: 0;
}

.md-body .md-h {
    margin: 10px 0 6px;
    font-weight: 600;
    color: var(--text-primary);
}

.md-body .md-h:first-child {
    margin-top: 0;
}

.md-body h3.md-h {
    font-size: 15px;
}

.md-body h4.md-h {
    font-size: 14px;
}

.md-body h5.md-h,
.md-body h6.md-h {
    font-size: 13px;
}

.md-body .md-list {
    margin: 4px 0 8px;
    padding-left: 20px;
}

.md-body .md-list li {
    margin: 2px 0;
}

.md-body .md-quote {
    margin: 6px 0;
    padding: 4px 10px;
    border-left: 3px solid var(--border-strong);
    color: var(--text-secondary);
}

.md-body .md-code {
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--surface-tertiary);
    font-size: 12px;
}

.md-body .md-pre {
    margin: 6px 0;
    padding: 8px 10px;
    border-radius: var(--radius-control);
    background: var(--surface-tertiary);
    overflow: auto;
    font-size: 12px;
    line-height: 1.5;
}

.md-body .md-link {
    color: var(--primary-color);
    text-decoration: none;
}

.md-body .md-link:hover {
    text-decoration: underline;
}

.avatar-row {
    display: flex;
    align-items: center;
    gap: 12px;
}

.avatar-picker {
    padding: 0;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-image);
    background: var(--surface-secondary);
    cursor: pointer;
}

.avatar-preview {
    display: block;
    width: 56px;
    height: 56px;
    object-fit: cover;
    border-radius: var(--radius-image);
}

.avatar-preview-empty {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
}

.avatar-input {
    display: none;
}

.form-modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: var(--compact-padding) var(--content-padding);
    border-top: 1px solid var(--border-default);
    background: var(--surface-secondary);
    border-radius: 0 0 var(--radius-modal) var(--radius-modal);
}

.footer-spacer {
    flex: 1;
}

.result-body {
    gap: 10px;
}

.result-layout {
    display: flex;
    gap: var(--compact-padding);
    min-height: 0;
}

.result-image {
    width: 180px;
    height: 180px;
    flex: 0 0 180px;
    object-fit: contain;
    border-radius: var(--radius-image);
    border: 1px solid var(--border-default);
    background: var(--surface-secondary);
}

.result-prompt {
    flex: 1;
    min-width: 0;
}

.result-model {
    font-size: 12px;
}

@media (max-width: 1200px) {
    .result-layout {
        flex-direction: column;
    }

    .result-image {
        width: 100%;
        height: auto;
        max-height: 220px;
        flex: 0 0 auto;
    }
}
</style>
