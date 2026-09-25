<template>
  <div class="structured-editor">
    <div class="structured-editor-toolbar ui-toolbar">
      <div class="editor-view-switch" :role="sourceOnly ? undefined : 'group'"
        :aria-label="sourceOnly ? undefined : t('promptEditor.viewMode')">
        <template v-if="!sourceOnly">
          <NButton size="small" :type="visualMode ? 'primary' : 'default'"
            :secondary="visualMode" :quaternary="!visualMode" @click="setVisualMode(true)">
            <template #icon><NIcon size="16"><LayoutCards /></NIcon></template>
            <span class="view-mode-label">{{ t('promptEditor.visual') }}</span>
          </NButton>
          <NButton size="small" :type="!visualMode ? 'primary' : 'default'"
            :secondary="!visualMode" :quaternary="visualMode" @click="setVisualMode(false)">
            <template #icon><NIcon size="16"><Code /></NIcon></template>
            <span class="view-mode-label">{{ t('promptEditor.source') }}</span>
          </NButton>
        </template>
        <slot name="toolbar-prefix" />
      </div>

      <div class="editor-toolbar-actions">
        <slot name="toolbar-extra" />
        <NText v-if="!showVariablesButton" depth="3" class="variable-count">
          {{ t('promptEditor.variableCount', { count: displayedVariableCount }) }}
        </NText>
        <NTooltip v-else>
          <template #trigger>
            <NButton size="small" class="variables-toolbar-button" @click="$emit('request-open-variables')">
              <template #icon><NIcon size="16"><AdjustmentsHorizontal /></NIcon></template>
              <span class="toolbar-button-label">{{ t('promptEditor.variables') }}</span>
              <span class="toolbar-button-count">{{ displayedVariableCount }}</span>
            </NButton>
          </template>
          {{ t('promptEditor.variables') }} · {{ displayedVariableCount }}
        </NTooltip>
        <NTooltip>
          <template #trigger>
            <NButton size="small" :disabled="readonly" @click="$emit('request-insert-variables')">
              <template #icon><NIcon size="16"><Braces /></NIcon></template>
              <span class="toolbar-button-label">{{ t('promptEditor.insertVariable') }}</span>
            </NButton>
          </template>
          {{ t('promptEditor.insertAtCursor') }}
        </NTooltip>
      </div>
    </div>

    <div ref="editorHost" class="structured-editor-host" :class="{ readonly }" />

    <div v-if="diagnosticCount" class="editor-diagnostic" role="status">
      <NIcon size="16"><AlertTriangle /></NIcon>
      <span>{{ t('promptEditor.unclosedVariable', { count: diagnosticCount }) }}</span>
    </div>

    <!-- 右键菜单：选区创建变量 / 插入已有变量 -->
    <NDropdown trigger="manual" :show="contextMenu.show" :x="contextMenu.x" :y="contextMenu.y"
      placement="bottom-start" :options="contextMenuOptions"
      @select="handleContextMenuSelect" @clickoutside="closeContextMenu" />

    <!-- 从选区创建变量 -->
    <NModal :show="createModal.show" :mask-closable="false" display-directive="show"
      @update:show="createModal.show = $event">
      <div class="create-variable-modal" role="dialog" aria-modal="true">
        <header class="create-variable-header">
          <NText strong>{{ t('promptEditor.createFromSelectionTitle') }}</NText>
        </header>
        <p class="create-variable-hint">{{ t('promptEditor.createFromSelectionHint') }}</p>
        <div class="create-variable-field">
          <label class="create-variable-label">{{ t('promptManagement.variableName') }}</label>
          <NInput v-model:value="createModal.name" :status="createModal.error ? 'error' : undefined"
            @keyup.enter="confirmCreateVariable" />
          <p v-if="createModal.error" class="create-variable-error">{{ createVariableErrorText }}</p>
        </div>
        <div class="create-variable-field">
          <label class="create-variable-label">{{ t('promptManagement.variableType') }}</label>
          <NSelect v-model:value="createModal.type" :options="createTypeOptions" />
        </div>
        <footer class="create-variable-actions">
          <NButton size="small" quaternary @click="createModal.show = false">{{ t('common.cancel') }}</NButton>
          <NButton size="small" type="primary" @click="confirmCreateVariable">{{ t('common.confirm') }}</NButton>
        </footer>
      </div>
    </NModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton, NDropdown, NIcon, NInput, NModal, NSelect, NText, NTooltip,
  type DropdownOption,
} from 'naive-ui'
import { AdjustmentsHorizontal, AlertTriangle, Braces, Code, LayoutCards } from '@vicons/tabler'
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  Compartment, EditorSelection, EditorState, StateEffect, StateField,
  type Text,
} from '@codemirror/state'
import {
  Decoration, EditorView, keymap, placeholder as editorPlaceholder,
  WidgetType, type DecorationSet,
} from '@codemirror/view'
import type { EditablePromptVariable } from '@/lib/utils/prompt-template'
import { createVariable, insertVariableSnippet, parsePromptTemplate, validateVariableName } from '@/lib/utils/prompt-template'

const props = withDefaults(defineProps<{
  content: string
  variables: EditablePromptVariable[]
  selectedVariable?: string
  readonly?: boolean
  placeholder?: string
  showVariablesButton?: boolean
  sourceOnly?: boolean
  variableCount?: number
  /** 全局库变量（仅供右键菜单插入；由父组件传入） */
  libraryVariables?: EditablePromptVariable[]
}>(), {
  selectedVariable: '',
  readonly: false,
  placeholder: '',
  showVariablesButton: false,
  sourceOnly: false,
  variableCount: undefined,
  libraryVariables: () => [],
})

const emit = defineEmits<{
  'update:content': [value: string]
  'select-variable': [name: string]
  'request-insert-variables': []
  'request-open-variables': []
  'variable-created': [variable: EditablePromptVariable]
}>()

const { t } = useI18n()
const editorHost = ref<HTMLElement>()
const visualMode = ref(!props.sourceOnly)
const diagnosticCount = ref(parsePromptTemplate(props.content).diagnostics.length)
const displayedVariableCount = computed(() => (
  props.variableCount ?? parsePromptTemplate(props.content).variableNames.length
))
const readonlyCompartment = new Compartment()
let editorView: EditorView | null = null
let lastSelection = EditorSelection.cursor(props.content.length)

interface DecorationState {
  visual: boolean
  selected: string
  decorations: DecorationSet
  atomicRanges: DecorationSet
}

const setDecorationConfig = StateEffect.define<{ visual: boolean; selected: string }>()

class VariableWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly occurrenceCount: number,
    readonly selected: boolean,
  ) { super() }

  eq(other: VariableWidget) {
    return other.name === this.name
      && other.occurrenceCount === this.occurrenceCount
      && other.selected === this.selected
  }

  toDOM() {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `prompt-variable-token${this.selected ? ' selected' : ''}`
    button.dataset.variable = this.name
    button.setAttribute('aria-label', t('promptEditor.variableTokenLabel', {
      name: this.name,
      count: this.occurrenceCount,
    }))

    const braces = document.createElement('span')
    braces.className = 'prompt-variable-token-icon'
    braces.textContent = '{}'
    const label = document.createElement('span')
    label.textContent = this.name
    button.append(braces, label)
    if (this.occurrenceCount > 1) {
      const count = document.createElement('span')
      count.className = 'prompt-variable-token-count'
      count.textContent = String(this.occurrenceCount)
      button.append(count)
    }

    button.addEventListener('mousedown', event => event.preventDefault())
    button.addEventListener('click', () => emit('select-variable', this.name))
    return button
  }

  ignoreEvent() { return false }
}

const buildDecorations = (doc: Text, visual: boolean, selected: string) => {
  const parsed = parsePromptTemplate(doc.toString())
  diagnosticCount.value = parsed.diagnostics.length
  const ranges: any[] = []
  const atomicRanges: any[] = []

  for (const segment of parsed.segments) {
    if (segment.kind !== 'variable') continue
    const occurrenceCount = parsed.occurrences.get(segment.name)?.length || 1
    const decoration = visual
      ? Decoration.replace({
        widget: new VariableWidget(segment.name, occurrenceCount, selected === segment.name),
      })
      : Decoration.mark({
        class: `prompt-variable-source${selected === segment.name ? ' selected' : ''}`,
        attributes: { 'data-variable': segment.name },
      })
    ranges.push(decoration.range(segment.start, segment.end))
    if (visual) atomicRanges.push(decoration.range(segment.start, segment.end))
  }

  for (const diagnostic of parsed.diagnostics) {
    if (diagnostic.end > diagnostic.start) {
      ranges.push(Decoration.mark({ class: 'prompt-variable-diagnostic' }).range(diagnostic.start, diagnostic.end))
    }
  }

  return {
    decorations: Decoration.set(ranges, true),
    atomicRanges: Decoration.set(atomicRanges, true),
  }
}

const variableDecorations = StateField.define<DecorationState>({
  create(state) {
    const visual = !props.sourceOnly
    const built = buildDecorations(state.doc, visual, props.selectedVariable)
    return { visual, selected: props.selectedVariable, ...built }
  },
  update(value, transaction) {
    let visual = value.visual
    let selected = value.selected
    let configChanged = false
    transaction.effects.forEach(effect => {
      if (!effect.is(setDecorationConfig)) return
      visual = effect.value.visual
      selected = effect.value.selected
      configChanged = true
    })
    if (!transaction.docChanged && !configChanged) return value
    const built = buildDecorations(transaction.state.doc, visual, selected)
    return { visual, selected, ...built }
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
})

const variableAtomicRanges = EditorView.atomicRanges.of(view => view.state.field(variableDecorations).atomicRanges)

const completionSource = (context: CompletionContext): CompletionResult | null => {
  const token = context.matchBefore(/\{\{[^{}\n]*$/)
  if (!token) return null
  const typed = token.text.slice(2).trim()
  const existingNames = props.variables.map(variable => variable.name).filter(Boolean)
  const options = existingNames.map(name => ({ label: name, type: 'variable', apply: `{{${name}}}` }))
  if (typed && !existingNames.includes(typed) && !validateVariableName(typed, props.variables)) {
    options.unshift({ label: t('promptEditor.createVariable', { name: typed }), type: 'keyword', apply: `{{${typed}}}` })
  }
  return { from: token.from, options, filter: false }
}

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--surface-primary)', color: 'var(--content-primary)' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-prompt)', lineHeight: '1.7' },
  '.cm-content': { minHeight: '100%', padding: '16px', caretColor: 'var(--accent-primary)', fontSize: '14px' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent-primary)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--interactive-focus)' },
  '.cm-gutters': { display: 'none' },
})

onMounted(() => {
  if (!editorHost.value) return
  const state = EditorState.create({
    doc: props.content,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      variableDecorations,
      variableAtomicRanges,
      EditorView.domEventHandlers({
        contextmenu: (event, view) => {
          if (props.readonly) return false
          const selection = view.state.selection.main
          contextRange.value = { from: selection.from, to: selection.to }
          contextSelectedText.value = view.state.doc.sliceString(selection.from, selection.to)
          // 右键落在变量占位符上时，切换为变量操作菜单（删除/替换）
          contextVariable.value = resolveVariableAt(view, event)
          contextMenu.x = event.clientX
          contextMenu.y = event.clientY
          contextMenu.show = true
          event.preventDefault()
          return true
        },
      }),
      autocompletion({ override: [completionSource], activateOnTyping: true }),
      readonlyCompartment.of(EditorState.readOnly.of(props.readonly)),
      editorPlaceholder(props.placeholder),
      editorTheme,
      EditorView.updateListener.of(update => {
        if (update.selectionSet) lastSelection = update.state.selection
        if (update.docChanged) emit('update:content', update.state.doc.toString())
      }),
    ],
  })
  editorView = new EditorView({ state, parent: editorHost.value })
})

onBeforeUnmount(() => editorView?.destroy())

watch(() => props.content, value => {
  if (!editorView || value === editorView.state.doc.toString()) return
  editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: value } })
})

watch(() => props.readonly, value => {
  editorView?.dispatch({ effects: readonlyCompartment.reconfigure(EditorState.readOnly.of(value)) })
})

watch(() => props.selectedVariable, selected => refreshDecorations(selected || ''))

const refreshDecorations = (selected = props.selectedVariable || '') => {
  editorView?.dispatch({ effects: setDecorationConfig.of({ visual: visualMode.value, selected }) })
}

const setVisualMode = (value: boolean) => {
  visualMode.value = props.sourceOnly ? false : value
  refreshDecorations()
  editorView?.focus()
}

/**
 * 插入文本：按变量显示规则把「变量名」槽位字面化（如 `色调 {{色调}}`），
 * 值槽位保留占位符（运行时才拿到选中项）。替换已有变量时只写占位符，
 * 避免正文里残留的旧变量名与新变量名叠成两层。
 */
const variableSnippet = (name: string, withAffix: boolean) => {
  if (!withAffix) return `{{${name}}}`
  const variable = props.variables.find(item => item.name === name)
    || (props.libraryVariables || []).find(item => item.name === name)
  return insertVariableSnippet(variable?.displayRule, name)
}

const insertVariableInRange = (name: string, range?: { from: number; to: number }, withAffix = true) => {
  if (!editorView || props.readonly) return
  const selection = range ?? (editorView.hasFocus ? editorView.state.selection.main : lastSelection.main)
  const snippet = variableSnippet(name, withAffix)
  editorView.dispatch({
    changes: { from: selection.from, to: selection.to, insert: snippet },
    selection: { anchor: selection.from + snippet.length },
    scrollIntoView: true,
  })
  emit('select-variable', name)
  editorView.focus()
}

const insertVariable = (name: string) => insertVariableInRange(name)

// ---------------------------------------------------------------- 右键菜单

const contextMenu = reactive({ show: false, x: 0, y: 0 })
const contextRange = ref({ from: 0, to: 0 })
const contextSelectedText = ref('')
/** 右键命中的变量占位符；命中时菜单切换为删除/替换操作 */
const contextVariable = ref<{ name: string; from: number; to: number } | null>(null)
const createModal = reactive({ show: false, name: '', type: 'text', error: '' })

/** 计算右键坐标命中的变量段；未命中返回 null */
const resolveVariableAt = (view: EditorView, event: MouseEvent) => {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (pos == null || pos < 0) return null
  const parsed = parsePromptTemplate(view.state.doc.toString())
  for (const segment of parsed.segments) {
    if (segment.kind !== 'variable') continue
    if (pos >= segment.start && pos <= segment.end) {
      return { name: segment.name, from: segment.start, to: segment.end }
    }
  }
  return null
}

const insertablePromptVariables = computed(() => props.variables.filter(variable => variable.name))
const insertableLibraryVariables = computed(() => (props.libraryVariables || [])
  .filter(variable => variable.name && !props.variables.some(local => local.name === variable.name)))

/** 替换目标：提示词变量 + 全局库变量，排除被替换变量自身 */
const replaceableVariables = computed(() => [
  ...insertablePromptVariables.value,
  ...insertableLibraryVariables.value,
].filter(variable => variable.name !== contextVariable.value?.name))

const contextMenuOptions = computed<DropdownOption[]>(() => {
  if (contextVariable.value) {
    return [
      {
        label: t('promptEditor.contextReplaceVariable', { name: contextVariable.value.name }),
        key: 'replace-variable',
        disabled: props.readonly || !replaceableVariables.value.length,
        children: replaceableVariables.value.map(variable => ({
          label: variable.name,
          key: `replace:${variable.name}`,
        })),
      },
      {
        label: t('promptEditor.contextDeleteVariable'),
        key: 'delete-variable',
        disabled: props.readonly,
      },
    ]
  }
  return [
  {
    label: t('promptEditor.contextCreateVariable'),
    key: 'create-variable',
    disabled: props.readonly || !contextSelectedText.value.trim(),
  },
  {
    label: t('promptEditor.insertVariable'),
    key: 'insert-variable',
    disabled: props.readonly
      || (!insertablePromptVariables.value.length && !insertableLibraryVariables.value.length),
    children: [
      ...(insertablePromptVariables.value.length ? [{
        type: 'group' as const,
        label: t('promptEditor.groupPromptVariables'),
        key: 'group-prompt',
        children: insertablePromptVariables.value.map(variable => ({
          label: variable.name,
          key: `insert:${variable.name}`,
        })),
      }] : []),
      ...(insertableLibraryVariables.value.length ? [{
        type: 'group' as const,
        label: t('promptEditor.groupLibraryVariables'),
        key: 'group-library',
        children: insertableLibraryVariables.value.map(variable => ({
          label: variable.name,
          key: `insert:${variable.name}`,
        })),
      }] : []),
    ],
  },
  ]
})

const closeContextMenu = () => {
  contextMenu.show = false
}

const handleContextMenuSelect = (key: string) => {
  contextMenu.show = false
  if (key === 'create-variable') {
    openCreateVariableModal()
  } else if (key === 'delete-variable' && contextVariable.value) {
    deleteVariableRange(contextVariable.value)
  } else if (key.startsWith('replace:') && contextVariable.value) {
    insertVariableInRange(key.slice('replace:'.length), contextVariable.value, false)
  } else if (key.startsWith('insert:')) {
    insertVariableInRange(key.slice('insert:'.length), contextRange.value)
  }
}

/** 删除变量占位符（移除整个 {{name}}） */
const deleteVariableRange = (target: { from: number; to: number; name: string }) => {
  if (!editorView || props.readonly) return
  editorView.dispatch({
    changes: { from: target.from, to: target.to },
    selection: EditorSelection.cursor(target.from),
    scrollIntoView: true,
  })
  editorView.focus()
}

const sanitizeVariableName = (raw: string) => raw.trim()
  .replace(/[{}\r\n]+/g, '')
  .replace(/\s+/g, '-')
  .slice(0, 40)

const openCreateVariableModal = () => {
  createModal.name = sanitizeVariableName(contextSelectedText.value)
    || t('promptEditor.defaultVariableName', { index: 1 })
  createModal.type = 'text'
  createModal.error = ''
  createModal.show = true
}

const createVariableErrorText = computed(() => {
  if (createModal.error === 'required') return t('promptEditor.variableNameRequired')
  if (createModal.error === 'invalid') return t('promptEditor.variableNameInvalid')
  if (createModal.error === 'duplicate') return t('promptEditor.variableNameDuplicate')
  return ''
})

const createTypeOptions = computed(() => [
  { label: t('promptEditor.typeText'), value: 'text' },
  { label: t('promptEditor.typeTextarea'), value: 'textarea' },
  { label: t('promptEditor.typeSelect'), value: 'select' },
  { label: t('promptEditor.typeNumber'), value: 'number' },
  { label: t('promptEditor.typeBoolean'), value: 'boolean' },
])

const confirmCreateVariable = () => {
  const name = createModal.name.trim()
  const error = validateVariableName(name, props.variables)
  if (error) {
    createModal.error = error
    return
  }
  createModal.show = false
  insertVariableInRange(name, contextRange.value)
  emit('variable-created', { ...createVariable(name), type: createModal.type })
}

const focusVariable = (name: string, occurrence = 0) => {
  if (!editorView) return
  const target = parsePromptTemplate(editorView.state.doc.toString()).occurrences.get(name)?.[occurrence]
  if (!target) return
  editorView.dispatch({
    selection: EditorSelection.cursor(target.start),
    scrollIntoView: true,
  })
  emit('select-variable', name)
  editorView.focus()
}

defineExpose({
  focus: () => editorView?.focus(),
  insertVariable,
  focusVariable,
  getCursorPosition: () => editorView?.state.selection.main.head ?? props.content.length,
  setVisualMode,
})
</script>

<style scoped>
.structured-editor { container: structured-editor / inline-size; box-sizing: border-box; min-height: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--border-default); border-radius: var(--radius-panel); background: var(--surface-primary); font-family: var(--font-prompt); }
.structured-editor-toolbar { min-height: 46px; padding: 6px var(--compact-padding); display: flex; align-items: center; justify-content: space-between; gap: var(--compact-padding); border: 0; border-bottom: 1px solid var(--border-default); border-radius: 0; }
.editor-view-switch, .editor-toolbar-actions { min-width: 0; display: flex; align-items: center; gap: 4px; }
.editor-view-switch { flex: 0 1 auto; }
.editor-toolbar-actions { flex: 0 0 auto; gap: 4px; }
.variable-count { white-space: nowrap; font-size: 12px; font-variant-numeric: tabular-nums; }
.toolbar-button-count { min-width: 16px; color: var(--content-secondary); font-size: 12px; font-variant-numeric: tabular-nums; text-align: center; }
.structured-editor-host { flex: 1; min-height: 0; overflow: hidden; user-select: text; -webkit-user-select: text; }
.structured-editor-host.readonly { opacity: .78; }
.structured-editor-host :deep(.cm-editor) { height: 100%; }
.structured-editor-host :deep(.cm-placeholder) { color: var(--content-tertiary); }
.structured-editor-host :deep(.prompt-variable-token) { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; margin: 0 2px; padding: 1px 8px; border: 1px solid var(--border-default); border-radius: var(--radius-control); color: var(--content-primary); background: var(--surface-secondary); font: inherit; font-family: inherit; cursor: pointer; vertical-align: baseline; }
.structured-editor-host :deep(.prompt-variable-token:hover) { border-color: var(--border-strong); background: var(--surface-tertiary); }
.structured-editor-host :deep(.prompt-variable-token.selected) { background: var(--surface-tertiary); font-weight: var(--font-weight-medium); }
.structured-editor-host :deep(.prompt-variable-token:focus-visible) { outline: 2px solid var(--interactive-focus); outline-offset: 1px; }
.structured-editor-host :deep(.prompt-variable-token-icon) { color: var(--accent-primary); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
.structured-editor-host :deep(.prompt-variable-token-count) { min-width: 17px; padding: 0 4px; border-radius: var(--radius-control); color: var(--content-secondary); background: var(--surface-tertiary); font-size: 12px; line-height: 17px; text-align: center; }
.structured-editor-host :deep(.prompt-variable-source) { border-radius: 2px; color: var(--accent-primary); background: var(--interactive-focus); }
.structured-editor-host :deep(.prompt-variable-source.selected) { background: var(--interactive-active); font-weight: var(--font-weight-medium); }
.structured-editor-host :deep(.prompt-variable-diagnostic) { text-decoration: underline wavy var(--accent-warning); text-underline-offset: 3px; }
.editor-diagnostic { min-height: 32px; padding: 6px var(--compact-padding); display: flex; align-items: center; gap: 6px; border-top: 1px solid var(--border-default); color: var(--accent-warning); background: var(--surface-secondary); font-size: 12px; }
.create-variable-modal { box-sizing: border-box; width: 360px; padding: var(--content-padding); border: 1px solid var(--border-default); border-radius: var(--radius-panel); background: var(--surface-primary); }
.create-variable-hint { margin: 4px 0 var(--content-padding); color: var(--content-secondary); font-size: 12px; }
.create-variable-field { margin-bottom: 12px; display: flex; flex-direction: column; gap: 6px; }
.create-variable-label { color: var(--content-secondary); font-size: 13px; font-weight: var(--font-weight-medium); }
.create-variable-error { margin: 0; color: var(--accent-error); font-size: 12px; }
.create-variable-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: var(--content-padding); }
@container structured-editor (max-width: 680px) {
  .variable-count { display: none; }
  .structured-editor-toolbar { padding-inline: 8px; gap: 4px; }
  .editor-view-switch :deep(.n-button__content), .editor-toolbar-actions :deep(.n-button__content) { font-size: 12px; }
}
@container structured-editor (max-width: 620px) {
  .toolbar-button-label { display: none; }
}
@container structured-editor (max-width: 500px) {
  .view-mode-label { display: none; }
}
</style>
