import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) => readFileSync(path, 'utf8')
const readRendererFile = (path: string) => readFileSync(`src/renderer/${path}`, 'utf8')
const readLocale = (locale: string) =>
  JSON.parse(readFileSync(`src/renderer/i18n/locales/${locale}.json`, 'utf8'))

describe('bots workspace regressions', () => {
  it('registers the bots store across database schema, sync, backup, and restore layers', () => {
    const baseDatabase = readRendererFile('lib/services/base-database.service.ts')
    expect(baseDatabase).toContain('bots: {')
    expect(baseDatabase).toContain('uuid: { keyPath: \'uuid\', unique: true }')
    expect(baseDatabase).toContain("dbVersion = 15")
    expect(baseDatabase).toContain('currentDbVersion = 15')
    expect(baseDatabase).toContain("bots: 'bots'")

    const dataChangeEvents = readRendererFile('lib/services/data-change-events.ts')
    expect(dataChangeEvents).toContain("| 'bots'")

    const contract = readProjectFile('src/shared/cloud-sync-contract.ts')
    expect(contract).toContain("bots: {\n    storeName: 'bots',")
    expect(contract).toContain("stableIdentityFields: ['uuid'],\n    businessUniqueFields: []\n  },\n  syncTombstones:")

    const engine = readProjectFile('src/shared/cloud-sync-engine.ts')
    expect(engine).toContain("  | 'bots'")
    expect(engine).toContain('bots?: any[];')
    expect(engine).toContain("  'bots'\n];")
    expect(engine).toContain('bots: [\'uuid\', \'id\']')

    const cloudSync = readRendererFile('lib/services/cloud-sync.service.ts')
    expect(cloudSync).toContain("  'bots',\n  'syncTombstones'\n];")
    expect(cloudSync).toContain("      'settings',\n      'bots'\n    ];")

    const automaticBackup = readRendererFile('lib/services/automatic-backup.service.ts')
    expect(automaticBackup).toContain("  'bots',\n  'syncTombstones'\n];")

    const databaseManager = readRendererFile('lib/services/database-manager.service.ts')
    expect(databaseManager).toContain("  'bots',\n  'syncTombstones'\n];")
    expect(databaseManager).toContain('bots: \'bots\'')
    expect(databaseManager).toContain('this.bot = BotService.getInstance()')
    expect(databaseManager).toContain("this.bot.getAllBots()")
    expect(databaseManager).toContain('bots: values.get(\'bots\') || []')
    expect(databaseManager).toContain("records.push(this.createPreparedRecord('bots', { ...record, id: index + 1 }))")
    expect(databaseManager).toContain("bots: ['uuid', 'id'],")

    const dataRestore = readRendererFile('lib/services/data-restore.service.ts')
    expect(dataRestore).toContain("'aiConfigs', 'quickOptimizationConfigs', 'aiHistory', 'settings', 'bots', 'syncTombstones'")
    expect(dataRestore).toContain('bots: number')

    const databaseTypes = readProjectFile('src/shared/types/database.ts')
    expect(databaseTypes).toContain('export interface Bot {')
    expect(databaseTypes).toContain('export interface BotReversePromptResult {')
  })

  it('wires the multimodal reverse chain from provider to preload', () => {
    const provider = readProjectFile('src/main/ai/providers/openai-provider.ts')
    expect(provider).toContain("from '@langchain/core/messages'")
    expect(provider).toContain('async reversePromptFromImage(')
    expect(provider).toContain("{ type: 'image_url', image_url: { url: imageDataUrl } }")
    expect(provider).toContain('buildReversePromptError')

    const manager = readProjectFile('src/main/ai/ai-service-manager.ts')
    expect(manager).toContain('async processReversePrompt(')
    // 能力探测而非 instanceof 白名单：LM Studio / Ollama 等本地多模态供应商也能走图片逆向
    expect(manager).toContain("typeof provider.reversePromptFromImage !== 'function'")
    expect(manager).not.toContain('请绑定 OpenAI 兼容系配置')

    // LM Studio / Ollama 各自实现多模态逆向（OpenAI 兼容端点 + image_url 格式）
    for (const name of ['lmstudio-provider.ts', 'ollama-provider.ts']) {
      const local = readProjectFile(`src/main/ai/providers/${name}`)
      expect(local).toContain('async reversePromptFromImage(')
      expect(local).toContain("{ type: 'image_url', image_url: { url: imageDataUrl } }")
      expect(local).toContain('buildReversePromptError')
    }

    // 共享错误可读化与流式消费都在基类，三个 provider 复用
    const baseProvider = readProjectFile('src/main/ai/providers/base-provider.ts')
    expect(baseProvider).toContain('protected buildReversePromptError')
    expect(baseProvider).toContain('reversePromptFromImage?(options: {')
    expect(baseProvider).toContain('onProgress?: (partial: string) => void;')
    expect(baseProvider).toContain('protected async consumeReverseStream(')

    const ipcHandlers = readProjectFile('src/main/electron/ipc-handlers.ts')
    expect(ipcHandlers).toContain("ipcMain.handle('ai:reverse-prompt'")
    expect(ipcHandlers).toContain("ipcMain.removeHandler('ai:reverse-prompt');")
    // 流式进度：主进程把 partial 经事件通道转发给渲染层
    expect(ipcHandlers).toContain("event.sender.send('ai:reverse-progress', { taskId: request.taskId, partial })")

    const preload = readProjectFile('src/main/preload.ts')
    expect(preload).toContain("ipcRenderer.invoke('ai:reverse-prompt', request)")
    expect(preload).toContain("ipcRenderer.on('ai:reverse-progress', listener)")

    const electronApi = readProjectFile('src/shared/types/electron-api.ts')
    expect(electronApi).toContain('reversePrompt: (request: { config: AIConfig; instruction: string; imageDataUrl: string; model?: string; taskId?: string })')
    expect(electronApi).toContain('cancelReverseTask: (taskId: string) => Promise<boolean>')
    expect(electronApi).toContain('onReverseProgress: (callback: (payload: { taskId: string; partial: string }) => void) => () => void')

    // 取消链路：taskId → 主进程 AbortController → LangChain invoke signal
    expect(manager).toContain('activeReverseTasks = new Map<string, AbortController>()')
    expect(manager).toContain('cancelReverseTask(taskId: string)')
    expect(ipcHandlers).toContain("ipcMain.handle('ai:cancel-reverse-task'")
    expect(ipcHandlers).toContain("ipcMain.removeHandler('ai:cancel-reverse-task');")
    for (const name of ['openai-provider.ts', 'lmstudio-provider.ts', 'ollama-provider.ts']) {
      const providerFile = readProjectFile(`src/main/ai/providers/${name}`)
      expect(providerFile).toContain('signal?: AbortSignal')
      expect(providerFile).toContain('onProgress?: (partial: string) => void;')
      // 流式化：统一走基类 consumeReverseStream（llm.stream 累积 + onProgress 回调）
      expect(providerFile).toContain('this.consumeReverseStream(llm, messages, signal, onProgress)')
    }
    expect(baseProvider).toContain('/abort/i')

    // 任务日志服务：持久化与取消标记
    const taskManager = readProjectFile('src/renderer/lib/services/ai-task-manager.ts')
    expect(taskManager).toContain("const HISTORY_KEY = 'promptbox.ai-task-logs'")
    expect(taskManager).toContain('export const aiTaskManager = new AiTaskManager()')
    expect(taskManager).toContain('cancelledIds')
    // 流式进度：running 任务实时保存 partial（悬停预览数据源）
    expect(taskManager).toContain('partial?: string')
    expect(taskManager).toContain('updatePartial(id: string, partial: string)')
  })

  it('exposes the bots entry in the desktop navigation and page switch', () => {
    const navigationIcons = readRendererFile('theme/navigation-icons.ts')
    expect(navigationIcons).toContain('Robot as BotNavigationIcon')

    const mainPage = readRendererFile('pages/MainPage.vue')
    expect(mainPage).toContain('BotNavigationIcon')
    expect(mainPage).toContain("key: 'bots'")
    expect(mainPage).toContain("<BotsPage v-else-if=\"currentView === 'bots'\" />")
    expect(mainPage).toContain("import BotsPage from './BotsPage.vue'")
  })

  it('keeps bot drop-to-reverse on the page and never fakes a save', () => {
    const page = readRendererFile('pages/BotsPage.vue')
    expect(page).toContain('@drop="onDrop($event, bot)"')
    expect(page).toContain('extractImageFile')
    expect(page).toContain('compressImageDataUrl')
    expect(page).toContain('maxEdge: 1536')
    expect(page).toContain('window.electronAPI.ai.reversePrompt(')
    expect(page).toContain('promptService.createPrompt(')
    expect(page).toContain('botService.createBot(')
    // 任务管理：进度计时 / 取消 / 日志接入拖拽与重跑链路
    expect(page).toContain("aiTaskManager.start({ type: 'reverse'")
    expect(page).toContain('aiTaskManager.finish(task.id)')
    expect(page).toContain('aiTaskManager.fail(task.id')
    expect(page).toContain('aiTaskManager.isCancelled(task.id)')
    expect(page).toContain('window.electronAPI.ai.cancelReverseTask(taskId)')
    expect(page).toContain('runningElapsedText')
    expect(page).toContain('cancelRunningTask')
    expect(page).toContain('showTaskLogs')
    // 流式进度悬停预览：订阅进度事件 → updatePartial，popover 实时展示正在书写的提示词
    expect(page).toContain('window.electronAPI.ai.onReverseProgress(')
    expect(page).toContain('aiTaskManager.updatePartial(payload.taskId, payload.partial)')
    expect(page).toContain('partialPreviewRef')
    expect(page).toContain('class="bot-partial-preview"')
    expect(page).toContain("runningTask?.partial || t('bots.streamWaiting')")
    // IPC 结构化克隆不接受 Vue 响应式 Proxy：两处 reversePrompt 调用都必须先纯化 config
    expect(page).toContain('const toPlainConfig = (config: AIConfig): AIConfig => JSON.parse(JSON.stringify(config)) as AIConfig')
    expect(page).not.toContain('\n            config,\n')
    expect((page.match(/config: toPlainConfig\(config\)/g) || []).length).toBe(2)

    const imageCompress = readRendererFile('lib/utils/image-compress.ts')
    expect(imageCompress).toContain('export async function compressImageDataUrl(')
    expect(imageCompress).toContain('DEFAULT_AVATAR_MAX_EDGE = 256')
  })

  it('ships bots translations in all five locales', () => {
    for (const locale of ['zh-CN', 'en-US', 'zh-TW', 'ja-JP', 'it-IT']) {
      const messages = readLocale(locale)
      expect(messages.bots?.title, locale).toBeTruthy()
      expect(messages.bots?.deleteConfirm, locale).toBeTruthy()
      expect(messages.bots?.editMode, locale).toBeTruthy()
      expect(messages.bots?.previewMode, locale).toBeTruthy()
      expect(messages.bots?.taskLogs, locale).toBeTruthy()
      expect(messages.bots?.cancelTask, locale).toBeTruthy()
      expect(messages.bots?.streamWaiting, locale).toBeTruthy()
      expect(messages.bots?.noTaskLogs, locale).toBeTruthy()
      expect(messages.bots?.instruction, locale).toBeTruthy()
      expect(messages.bots?.instruction, locale).not.toContain('逆向')
      expect(messages.mainPage?.menu?.bots, locale).toBeTruthy()
    }
  })

  it('renders the instruction markdown preview safely with the zero-dependency renderer', async () => {
    const { renderMarkdownLite } = await import('~/lib/utils/markdown-lite')

    // 列表 + 粗体（截图中的典型指令格式）
    const list = renderMarkdownLite('- **景别**: 大特写\n- **光影**: 主光源')
    expect(list).toContain('<ul class="md-list">')
    expect(list).toContain('<li><strong>景别</strong>: 大特写</li>')

    // 标题、行内代码、分段
    const heading = renderMarkdownLite('# 参数\n用 `85mm` 镜头')
    expect(heading).toContain('<h3 class="md-h">参数</h3>')
    expect(heading).toContain('<code class="md-code">85mm</code>')

    // XSS：先整体转义，任何 HTML 都不会以原始形式出现
    const escaped = renderMarkdownLite('<script>alert(1)</script>')
    expect(escaped).toContain('&lt;script&gt;')
    expect(escaped).not.toContain('<script>')

    // 链接仅允许 http/https；非白名单协议保持原文本、不渲染成 href
    const safe = renderMarkdownLite('[a](https://example.com) [b](javascript:alert(1))')
    expect(safe).toContain('href="https://example.com"')
    expect(safe).not.toContain('href="javascript:')
  })
})
