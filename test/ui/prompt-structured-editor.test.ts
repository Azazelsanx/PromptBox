import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readRendererFile = (path: string) => readFileSync(`src/renderer/${path}`, 'utf8')
const readSharedFile = (path: string) => readFileSync(`src/shared/${path}`, 'utf8')

describe('structured prompt editor wiring', () => {
  it('keeps the stored template syntax compatible while presenting variable blocks', () => {
    const editor = readRendererFile('components/prompt-management/StructuredPromptEditor.vue')
    const core = readRendererFile('lib/utils/prompt-template.ts')

    expect(editor).toContain('Decoration.replace')
    expect(editor).toContain('EditorView.atomicRanges')
    expect(editor).toContain('autocompletion')
    expect(editor).toContain('setVisualMode(false)')
    expect(editor).toContain('`{{${name}}}`')
    expect(core).toContain('PLACEHOLDER_PATTERN')
    expect(core).toContain('reconcilePromptVariables')
  })

  it('uses the shared fill canvas in the workspace and shortcut launcher', () => {
    const workspace = readRendererFile('components/prompt-management/PromptUseWorkspace.vue')
    const launcher = readRendererFile('components/shortcuts/PromptLauncher.vue')
    const canvas = readRendererFile('components/prompt-management/PromptFillCanvas.vue')

    expect(workspace).toContain('<PromptFillCanvas')
    expect(launcher).toContain('<PromptFillCanvas')
    expect(canvas).toContain("viewMode === 'fill'")
    expect(canvas).toContain('prompt.isJinjaTemplate')
    expect(canvas).toContain(':first-occurrence="segment.firstOccurrence"')
    expect(canvas).toContain('validateAndFocus')
  })

  it('shares one variable inspector across regular and Jinja editors', () => {
    const regular = readRendererFile('components/prompt-management/RegularPromptEditor.vue')
    const jinja = readRendererFile('components/prompt-management/JinjaPromptEditor.vue')
    const inspector = readRendererFile('components/prompt-management/VariableInspector.vue')
    const editModal = readRendererFile('components/prompt-management/VariableEditModal.vue')

    expect(regular).toContain('<VariableInspector')
    expect(jinja).toContain('<VariableInspector')
    expect(jinja).toContain('source-only')
    expect(jinja).toContain('<QuickOptimizationActions')
    expect(jinja).toContain('#toolbar-prefix')
    expect(jinja).toContain('#toolbar-extra')
    // 变量属性表单迁移到编辑弹窗
    expect(editModal).toContain('typeTextarea')
    expect(editModal).toContain('typeNumber')
    expect(editModal).toContain('typeBoolean')
    expect(editModal).toContain('typeList')
    expect(editModal).toContain('typeDict')
    // 目录列表交互契约：搜索过滤、双击插入、右键菜单、编辑弹窗
    expect(inspector).toContain('searchKeyword')
    expect(inspector).toContain('@dblclick')
    expect(inspector).toContain('contextmenu')
    expect(inspector).toContain('<VariableEditModal')
    expect(inspector).toContain('unusedVariables')
  })

  it('lists unused global-library variables in collapsible groups inside the inspector', () => {
    const regular = readRendererFile('components/prompt-management/RegularPromptEditor.vue')
    const inspector = readRendererFile('components/prompt-management/VariableInspector.vue')
    const library = readRendererFile('lib/utils/global-variable-library.ts')

    // 库快照同时暴露分组路径（uuid → 名称路径），供面板归组
    expect(library).toContain('libraryGroupPaths')
    expect(library).toContain('getGroupTree')

    // 面板两处实例（常驻面板 + 抽屉）都接上库变量与分组
    const inspectorUsages = regular.match(/:library-variables="libraryVariables"/g) || []
    expect(inspectorUsages.length).toBe(2)
    expect(regular).toContain(':library-group-paths="libraryGroupPaths"')

    // 库变量按分组折叠：排除正文已有的同名变量，未分组垫底且可折叠
    expect(inspector).toContain('libraryVariables?: GlobalVariable[]')
    expect(inspector).toContain('libraryGroupPaths?: Map<string, string[]>')
    expect(inspector).toContain('localNameSet')
    expect(inspector).toContain('libraryGroups')
    expect(inspector).toContain('collapsedLibraryGroups')
    expect(inspector).toContain('toggleLibraryGroup')
    expect(inspector).toContain('ungroupedVariables')
    // 折叠动画走 NCollapseTransition；点击走双击插入正文
    expect(inspector).toContain('<NCollapseTransition')
    expect(inspector).toContain("$emit('request-insert', definition.name)")
    // 库变量不写进 promptVariables：面板只读展示，插入才落正文
    expect(inspector).toContain("$emit('select', definition.name)")
  })

  it('matches variable search against option names and SKU values, not just the variable name', () => {
    const regular = readRendererFile('components/prompt-management/RegularPromptEditor.vue')
    const inspector = readRendererFile('components/prompt-management/VariableInspector.vue')
    const picker = readRendererFile('components/prompt-management/VariablePickerModal.vue')
    const service = readRendererFile('lib/services/variable.service.ts')
    const template = readRendererFile('lib/utils/prompt-template.ts')

    // 共用匹配器：名称 / 描述 / 列表选项 / 选项元数据键 / SKU 维度值
    expect(template).toContain('matchesVariableKeyword')
    expect(template).toContain('variable.options?.some(hits)')
    expect(template).toContain('optionMeta')
    expect(template).toContain('dimension.values?.some(hits)')

    // 三个入口都改走共用匹配器（面板 / 插入弹窗 / 库管理页的 service 查询）
    expect(inspector).toContain('matchesVariableKeyword(variable, searchKeyword.value)')
    expect(inspector).toContain('matchesVariableKeyword(definition, searchKeyword.value)')
    expect(picker).toContain('matchesVariableKeyword(variable, keyword.value)')
    expect(service).toContain('matchesVariableKeyword(variable, filter.search)')

    // 反例锚定：旧的「只看名称 + 描述」内联写法不得残留
    expect(inspector).not.toContain("variable.name.toLowerCase().includes(query)")
    expect(picker).not.toContain("name.toLowerCase().includes(query)")
    expect(service).not.toContain('variable.name.toLowerCase().includes(keyword)')
  })

  it('aligns the use workspace with the embedded editor geometry', () => {
    const useWorkspace = readRendererFile('components/prompt-management/PromptUseWorkspace.vue')
    const fillCanvas = readRendererFile('components/prompt-management/PromptFillCanvas.vue')
    const structuredEditor = readRendererFile('components/prompt-management/StructuredPromptEditor.vue')

    expect(useWorkspace).toMatch(/\.use-workspace\s*\{[^}]*padding:\s*var\(--content-padding\) var\(--content-padding\) 0/s)
    expect(useWorkspace).toMatch(/\.use-action-bar\s*\{[^}]*height:\s*58px/s)
    expect(fillCanvas).toContain('padding: var(--content-padding)')
    expect(fillCanvas).not.toContain('clamp(20px, 4vw, 48px)')
    expect(fillCanvas).not.toContain('max-width: 900px')
    expect(fillCanvas).toMatch(/\.fill-toolbar\s*\{[^}]*min-height:\s*46px/s)
    expect(structuredEditor).toMatch(/\.structured-editor-toolbar\s*\{[^}]*min-height:\s*46px/s)
  })

  it('wires the editor context menu for create-from-selection and insert', () => {
    const structured = readRendererFile('components/prompt-management/StructuredPromptEditor.vue')
    const regular = readRendererFile('components/prompt-management/RegularPromptEditor.vue')

    // 右键菜单：CodeMirror domEventHandlers + NDropdown manual 定位
    expect(structured).toContain('domEventHandlers')
    expect(structured).toContain('contextmenu')
    expect(structured).toContain('trigger="manual"')
    expect(structured).toContain(':options="contextMenuOptions"')
    // 选区创建变量：替换选区为占位符并回传新变量定义
    expect(structured).toContain('create-variable')
    expect(structured).toContain('validateVariableName')
    expect(structured).toContain("emit('variable-created'")
    expect(structured).toContain('insertVariableInRange')
    // 插入变量：提示词变量 + 全局库变量两组
    expect(structured).toContain("'group-prompt'")
    expect(structured).toContain("'group-library'")
    // 右键命中已有变量：删除占位符 / 替换为其他变量
    expect(structured).toContain('resolveVariableAt')
    expect(structured).toContain('contextVariable')
    expect(structured).toContain('deleteVariableRange')
    expect(structured).toContain("'replace-variable'")
    expect(structured).toContain('contextReplaceVariable')
    expect(structured).toContain('contextDeleteVariable')
    // 工具栏"插入变量"按钮：打开选择器而不是直接新建变量
    expect(structured).toContain("'request-insert-variables'")
    expect(structured).not.toContain("'request-add-variable'")
    // 父组件接线：选择器 + 库变量 + 接收新建变量
    expect(regular).toContain('<VariablePickerModal')
    expect(regular).toContain(':library-variables="libraryEditorVariables"')
    expect(regular).toContain('@variable-created="handleVariableCreated"')
  })
})

describe('variable management page contract', () => {
  it('supports double-click editing and a row context menu in the variables table', () => {
    const page = readRendererFile('pages/VariableManagementPage.vue')

    expect(page).toContain(':row-props="variableRowProps"')
    expect(page).toContain('onDblclick: () => openVariableEditor(row)')
    expect(page).toContain('onContextmenu')
    expect(page).toContain('handleRowMenuSelect')
    expect(page).toContain('askRemoveVariable')
    expect(page).toContain('deleteVariableConfirm')
  })

  it('shows descendant variables by default and exposes a group-tree context-menu toggle', () => {
    const page = readRendererFile('pages/VariableManagementPage.vue')

    // 默认包含子分组
    expect(page).toContain('const includeDescendants = ref(true)')
    // 分组树右键菜单：开启/关闭“显示子项内容”
    expect(page).toContain(':node-props="treeNodeProps"')
    expect(page).toContain('treeMenuOptions')
    expect(page).toContain('handleTreeMenuSelect')
    expect(page).toContain('toggleDescendants')
  })

  it('moves group add/rename/delete off the tree row into the context menu', () => {
    const page = readRendererFile('pages/VariableManagementPage.vue')

    // 分组节点不再有悬停内联操作按钮
    expect(page).not.toContain('renderTreeSuffix')
    expect(page).not.toContain('tree-actions')
    // 右键菜单承载分组增删改 + 显示子项开关
    expect(page).toContain('treeMenu.key')
    expect(page).toContain('addChild')
    expect(page).toContain("key === 'rename'")
    expect(page).toContain("key === 'delete'")
    expect(page).toContain('askDeleteGroup')
  })

  it('sizes inline controls from measured text width instead of the ch unit', () => {
    const field = readRendererFile('components/prompt-management/PromptVariableField.vue')

    // 用 canvas measureText 量真实字形宽度：`1ch` 是 "0" 的宽度，会把 `-`/空格/i 这类窄字形算宽
    expect(field).toContain('measureText')
    expect(field).toContain("'--field-text-px'")
    // 各控件只叠加自己的 chrome（内边距 / 箭头 / 步进器）
    expect(field).toContain('type-text.inline :deep(.n-input) { width: clamp(64px')
    expect(field).toContain('type-select.inline :deep(.n-select) { width: clamp(72px')
    expect(field).toContain('type-number.inline :deep(.n-input-number) { width: clamp(76px')
    // 旧的 ch 估算路径已彻底移除（别让两套并存）
    expect(field).not.toContain('measureWidthUnits')
    expect(field).not.toContain('FIELD_MIN_CH')
    expect(field).not.toContain('--field-content-ch')
  })

  it('supports IconPark icons with theme and color for groups and folders', () => {
    const page = readRendererFile('pages/VariableManagementPage.vue')
    const palette = readRendererFile('components/common/IconPalettePicker.vue')
    const registry = readRendererFile('lib/utils/icon-registry.ts')
    const categoryModal = readRendererFile('components/prompt-management/CategoryManageModal.vue')
    const folderExplorer = readRendererFile('components/prompt-management/PromptFolderExplorer.vue')
    const librarySidebar = readRendererFile('components/prompt-management/PromptLibrarySidebar.vue')

    expect(registry).toContain('@icon-park/vue-next')
    expect(registry).toContain('ICON_GROUPS')
    // 内联选择器：线性/面性切换 + 精简 8 色板 + 选中加框/加环
    expect(palette).toContain('themeOutline')
    expect(palette).toContain('themeFilled')
    expect(palette).toContain('REFERENCE_PALETTE')
    expect(palette).toContain('icon-cell')
    expect(palette).toContain('color-dot')
    // 变量分组：弹窗用内联选择器（上级分组→名称→图标→颜色）+ 树前缀渲染
    expect(page).toContain('<IconPalettePicker')
    expect(page).toContain('groupModal.parent')
    expect(page).toContain('renderTreePrefix')
    expect(page).toContain('resolveIcon')
    // 提示词文件夹：新建/编辑走表单弹窗（上级文件夹/名称/图标/颜色），列表行显示图标
    expect(categoryModal).toContain('<IconPalettePicker')
    expect(categoryModal).toContain('categoryParent')
    expect(categoryModal).toContain('parentId')
    expect(categoryModal).toContain('openFormEdit')
    expect(folderExplorer).toContain('resolveIcon')
    expect(librarySidebar).toContain('resolveIcon')
  })
})

describe('variable picker modal contract', () => {
  it('picks from existing variables with search, groups, and double-click confirm', () => {
    const picker = readRendererFile('components/prompt-management/VariablePickerModal.vue')

    expect(picker).toContain('searchVariablePlaceholder')
    expect(picker).toContain('groupLibraryVariables')
    expect(picker).toContain('promptEditor.inUse')
    expect(picker).toContain('promptEditor.unused')
    expect(picker).toContain('@dblclick="confirmPick(item.name)"')
    expect(picker).toContain('confirmInsert')
  })

  it('routes jinja toolbar insert through the shared picker too', () => {
    const jinja = readRendererFile('components/prompt-management/JinjaPromptEditor.vue')

    expect(jinja).toContain('@request-insert-variables')
    expect(jinja).toContain('<VariablePickerModal')
  })
})

it('keeps full-height prompt panels inside their parent boxes', () => {
  const regular = readRendererFile('components/prompt-management/RegularPromptEditor.vue')
  const structured = readRendererFile('components/prompt-management/StructuredPromptEditor.vue')
  const inspector = readRendererFile('components/prompt-management/VariableInspector.vue')
  const fillCanvas = readRendererFile('components/prompt-management/PromptFillCanvas.vue')
  const useWorkspace = readRendererFile('components/prompt-management/PromptUseWorkspace.vue')
  const jinja = readRendererFile('components/prompt-management/JinjaPromptEditor.vue')

  for (const source of [regular, structured, inspector, fillCanvas, useWorkspace, jinja]) {
    expect(source).toContain('box-sizing: border-box')
  }
  expect(regular).toContain('padding-bottom: var(--content-padding)')
  expect(regular).toContain(':show-variables-button="compactInspector"')
  expect(regular).not.toContain('class="drawer-trigger"')
  expect(jinja).toMatch(/\.jinja-editor-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 320px/s)
  expect(jinja).toContain('padding-bottom: var(--content-padding)')
  expect(jinja).toContain(':show-variables-button="compactInspector"')
  expect(jinja).toContain('ResizeObserver')
  expect(structured).toContain("'request-open-variables': []")
  expect(structured).toContain('<slot name="toolbar-prefix" />')
  expect(structured).toContain('<slot name="toolbar-extra" />')
  expect(structured).toContain('container: structured-editor / inline-size')
  expect(structured).toContain('@container structured-editor (max-width: 620px)')
  expect(useWorkspace).toContain('@click="openHistory"')
  expect(useWorkspace).toContain('historyPromptId')
})

describe('select variable SKU combos', () => {
  it('generates cartesian combos with per-combo enable and decoration', () => {
    const core = readRendererFile('lib/utils/prompt-template.ts')
    const editor = readRendererFile('components/prompt-management/SkuComboEditor.vue')
    const editModal = readRendererFile('components/prompt-management/VariableEditModal.vue')
    const field = readRendererFile('components/prompt-management/PromptVariableField.vue')
    const workspace = readRendererFile('lib/utils/prompt-workspace.ts')

    expect(core).toContain('skuCombos')
    expect(core).toContain('enabledSkuCombos')
    expect(core).toContain('SKU_KEY_SEPARATOR')
    expect(core).toContain('comboOrder')
    expect(core).toContain('splitBatchValues')
    expect(core).toContain('pruneOptionMeta')
    // 组合名前缀维度名（"-- ar 1:1"），备注不参与拼接
    expect(core).toContain('dimensions[index]?.name')
    // SKU 编辑器：维度/取值/组合拖拽排序 + 批量添加 + 逐组合配图 + 维度备注
    expect(editor).toContain('splitBatchValues')
    expect(editor).toContain('onValueDrop')
    expect(editor).toContain('onComboDrop')
    expect(editor).toContain('sortCombos')
    expect(editor).toContain('toggleCombo')
    expect(editor).toContain('<DecorPicker')
    expect(editor).toContain('patchComboMeta')
    expect(editor).toContain('dimension.remark')
    expect(editor).toContain('skuEditor.remarkPlaceholder')
    // 简单列表编辑器：chips + 批量添加 + 排序 + 逐项配图
    const optionList = readRendererFile('components/prompt-management/OptionListEditor.vue')
    expect(optionList).toContain('splitBatchValues')
    expect(optionList).toContain('sortOptions')
    expect(optionList).toContain('<DecorPicker')
    // 长按多选 + 一键删除（简单列表与组合列表统一）
    expect(optionList).toContain('useLongPressSelection')
    expect(optionList).toContain('removeSelected')
    expect(editor).toContain('useLongPressSelection')
    expect(editor).toContain('removeSelectedCombos')
    // 模式切换互斥确认：共享 SkuModeSwitch（默认否/二次确认/不再提醒）
    expect(editModal).toContain('<SkuModeSwitch')
    const switchComp = readRendererFile('components/prompt-management/SkuModeSwitch.vue')
    expect(switchComp).toContain('switchKeepDraft')
    expect(switchComp).toContain('switchSkipRemind')
    const varPage = readRendererFile('pages/VariableManagementPage.vue')
    expect(varPage).toContain('<SkuModeSwitch')
    expect(varPage).toContain('useUndoRedo')
    expect(varPage).toContain('saveDraft')
    expect(varPage).toContain('listVariableHistories')
    expect(varPage).toContain('rollbackToHistory')
    // 提示词编辑：草稿自动保存 + 撤销恢复 + 保存校验红标
    const promptEdit = readRendererFile('components/prompt-management/PromptEditModal.vue')
    expect(promptEdit).toContain('useUndoRedo')
    expect(promptEdit).toContain('saveDraft')
    expect(promptEdit).toContain('promptValidationIssues')
    // 统一装饰选择器：图标/图片双模式、裁切、本地化下载、放大预览，一处改处处改
    const decor = readRendererFile('components/common/DecorPicker.vue')
    expect(decor).toContain('<IconPalettePicker')
    expect(decor).toContain('ImageSquareCropper')
    expect(decor).toContain("images:fetch-data-url")
    expect(decor).toContain('openCropper')
    expect(decor).toContain('decor-zoom-overlay')
    expect(decor).toContain('panelRequested')
    const cropper = readRendererFile('components/common/ImageSquareCropper.vue')
    expect(cropper).toContain('confirmCrop')
    expect(cropper).toContain('toDataURL')
    // 编辑弹窗：简单列表 / SKU 组合双模式互斥
    expect(editModal).toContain('skuMode')
    expect(editModal).toContain('<SkuComboEditor')
    expect(editModal).toContain('<OptionListEditor')
    expect(editModal).toContain('pruneOptionMeta')
    // 填充端：选项带图标/配图，选中态有可变图标预览；维度备注信息图标悬停展示
    expect(field).toContain('renderSelectLabel')
    expect(field).toContain('resolveIcon')
    expect(field).toContain('selected-preview')
    expect(field).toContain('dimensionRemarks')
    expect(field).toContain('remark-help')
    // 全局库定义合并时携带 SKU 元数据
    expect(workspace).toContain('definition.optionMeta ?? variable.optionMeta')
    expect(workspace).toContain('definition.sku ?? variable.sku')
    // 变量级图标/配图：所有类型均可用；列表选项可选「引用上级」
    expect(core).toContain('decor: variable.decor ? { ...variable.decor } : undefined')
    expect(decor).toContain('allowInherit')
    expect(decor).toContain('inheritParent')
    expect(decor).toContain('decor-inherit')
    expect(optionList).toContain('allow-inherit')
    expect(optionList).toContain(':parent-meta="parentDecor"')
    expect(editor).toContain('allow-inherit')
    expect(editor).toContain(':parent-meta="parentDecor"')
    expect(editModal).toContain('<DecorPicker')
    expect(editModal).toContain(':parent-decor="draft.decor"')
    expect(varPage).toContain('<DecorPicker')
    expect(varPage).toContain(':parent-decor="variableForm.decor"')
    expect(workspace).toContain('definition.decor ?? variable.decor')
    // 填充端：变量标签旁的变量级装饰 + 选项「引用上级」解析
    expect(field).toContain('labelDecor')
    expect(field).toContain('resolveMeta')
    // 变量级装饰穿过 4 处白名单（脏检测 / 保存 / updateVariables / 回填）
    expect(promptEdit).toContain('decor: JSON.stringify(variable.decor ?? null)')
    expect(promptEdit).toContain('decor: v.decor')
  })
})

describe('variable display rule (prefix / suffix affixes)', () => {
  it('renders, inserts and stores the affix rule end to end', () => {
    const core = readRendererFile('lib/utils/prompt-template.ts')
    const types = readSharedFile('types/database.ts')
    const ruleEditor = readRendererFile('components/prompt-management/VariableDisplayRuleEditor.vue')
    const editModal = readRendererFile('components/prompt-management/VariableEditModal.vue')
    const inspector = readRendererFile('components/prompt-management/VariableInspector.vue')
    const varPage = readRendererFile('pages/VariableManagementPage.vue')
    const workspace = readRendererFile('lib/utils/prompt-workspace.ts')
    const promptEdit = readRendererFile('components/prompt-management/PromptEditModal.vue')
    const structured = readRendererFile('components/prompt-management/StructuredPromptEditor.vue')
    const field = readRendererFile('components/prompt-management/PromptVariableField.vue')
    const service = readRendererFile('lib/services/variable.service.ts')

    // 类型层：变量名 / 选项名 两个槽位各自可选前缀·后缀·不显示
    expect(types).toContain('VariableDisplaySlot')
    expect(types).toContain('displayRule?: VariableDisplayRule')
    // 渲染：值必须输出，两个槽位按顺序拼接
    expect(core).toContain('resolveDisplayRule')
    expect(core).toContain('renderVariableOutput')
    expect(core).toContain('insertVariableSnippet')
    expect(core).toContain('hasLiteralNameNearby')
    expect(core).toContain('displayRule: variable.displayRule ? { ...variable.displayRule } : undefined')
    // 编辑视图插入：变量名槽字面化写进正文，值槽保留占位符
    expect(structured).toContain('insertVariableSnippet')
    expect(structured).toContain('variableSnippet')
    expect(structured).toContain('withAffix')
    // 配置入口：变量级默认（全局库表单）+ 提示词内覆盖（变量编辑弹窗）
    expect(ruleEditor).toContain('display-rule-editor')
    expect(ruleEditor).toContain('slotOption')
    expect(ruleEditor).toContain('needsSeparator')
    expect(ruleEditor).toContain('renderVariableOutput')
    expect(editModal).toContain('<VariableDisplayRuleEditor')
    expect(editModal).toContain('displayRule: draft.displayRule ? { ...draft.displayRule } : undefined')
    expect(editModal).toContain('effectiveDisplayRule')
    expect(varPage).toContain('<VariableDisplayRuleEditor')
    expect(varPage).toContain('displayRule: variableForm.displayRule ? { ...variableForm.displayRule } : undefined')
    expect(varPage).toContain('variableForm.displayRule = snapshot.displayRule')
    // 库合并：提示词内覆盖优先于全局库默认
    expect(workspace).toContain('variable.displayRule ?? definition.displayRule')
    expect(inspector).toContain('libraryRules')
    expect(inspector).toContain(':default-rule=')
    // 编辑弹窗白名单：脏检测 / 保存 / updateVariables / 回填
    expect(promptEdit).toContain('displayRule: JSON.stringify(variable.displayRule ?? null)')
    expect(promptEdit).toContain('displayRule: v.displayRule')
    expect(promptEdit).toContain('JSON.stringify(newVar.displayRule ?? null)')
    // 服务层：历史快照 / 导出 / 导入 / 提示词扫描
    expect(service).toContain('displayRule: variable.displayRule')
    expect(service).toContain('displayRule: existing.displayRule ?? item.displayRule')
    // 填充端：下拉/数字/文本全部按内容自适应宽度
    expect(field).toContain('isContentSized')
    expect(field).toContain('type-select.inline :deep(.n-select)')
    expect(field).toContain('type-number.inline :deep(.n-input-number)')
  })
})
