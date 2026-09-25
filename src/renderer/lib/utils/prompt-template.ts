import type {
  PromptVariable, PromptWithRelations,
  VariableDecor, VariableDisplayRule, VariableDisplaySlot,
  VariableOptionMeta, VariableSkuConfig,
} from '@shared/types/database'
import { jinjaService } from './jinja.service'

export type CanonicalPromptVariableType = 'text' | 'textarea' | 'select' | 'number' | 'boolean'

export interface EditablePromptVariable {
  id?: number
  uuid?: string
  promptId?: number
  name: string
  type: PromptVariable['type'] | string
  defaultValue?: string
  options?: string[]
  /** 选项级图标/配图元数据，key = 选项文本（select 型可用） */
  optionMeta?: Record<string, VariableOptionMeta>
  /** SKU 组合生成器配置（select 型可选启用；生成结果写入 options） */
  sku?: VariableSkuConfig
  /** 变量级图标/配图（所有类型均可用） */
  decor?: VariableDecor
  /** 显示规则：变量写进正文时前缀槽/后缀槽的形态（全局库默认，提示词内可覆盖） */
  displayRule?: VariableDisplayRule
  required: boolean
  placeholder?: string
  description?: string
  validation?: PromptVariable['validation']
  sortOrder?: number
  /** 仅运行时标记：该变量定义来自全局变量库（同名引用），不落库 */
  libraryLinked?: boolean
  libraryUuid?: string
}

export interface PromptTextSegment {
  kind: 'text'
  text: string
  start: number
  end: number
}

export interface PromptVariableSegment {
  kind: 'variable'
  raw: string
  name: string
  start: number
  end: number
  occurrence: number
  firstOccurrence: boolean
}

export type PromptTemplateSegment = PromptTextSegment | PromptVariableSegment

export interface PromptTemplateDiagnostic {
  kind: 'unclosed-variable'
  start: number
  end: number
  message: string
}

export interface ParsedPromptTemplate {
  segments: PromptTemplateSegment[]
  variableNames: string[]
  occurrences: Map<string, PromptVariableSegment[]>
  diagnostics: PromptTemplateDiagnostic[]
}

export interface ReconciledPromptVariables {
  active: EditablePromptVariable[]
  unused: EditablePromptVariable[]
  all: EditablePromptVariable[]
}

const PLACEHOLDER_PATTERN = /\{\{\s*([^{}\r\n]+?)\s*\}\}/g

export function parsePromptTemplate(content = ''): ParsedPromptTemplate {
  const segments: PromptTemplateSegment[] = []
  const occurrences = new Map<string, PromptVariableSegment[]>()
  const variableNames: string[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  PLACEHOLDER_PATTERN.lastIndex = 0
  while ((match = PLACEHOLDER_PATTERN.exec(content))) {
    const start = match.index
    const end = start + match[0].length
    const name = match[1].trim()
    if (!name) continue

    if (start > cursor) {
      segments.push({ kind: 'text', text: content.slice(cursor, start), start: cursor, end: start })
    }

    const nameOccurrences = occurrences.get(name) || []
    const segment: PromptVariableSegment = {
      kind: 'variable',
      raw: match[0],
      name,
      start,
      end,
      occurrence: nameOccurrences.length,
      firstOccurrence: nameOccurrences.length === 0,
    }
    nameOccurrences.push(segment)
    occurrences.set(name, nameOccurrences)
    if (segment.firstOccurrence) variableNames.push(name)
    segments.push(segment)
    cursor = end
  }

  if (cursor < content.length || segments.length === 0) {
    segments.push({ kind: 'text', text: content.slice(cursor), start: cursor, end: content.length })
  }

  return {
    segments,
    variableNames,
    occurrences,
    diagnostics: findUnclosedVariables(content, segments),
  }
}

function findUnclosedVariables(
  content: string,
  segments: PromptTemplateSegment[]
): PromptTemplateDiagnostic[] {
  const occupied = segments
    .filter((segment): segment is PromptVariableSegment => segment.kind === 'variable')
    .map(segment => [segment.start, segment.end] as const)
  const diagnostics: PromptTemplateDiagnostic[] = []
  let offset = content.indexOf('{{')

  while (offset >= 0) {
    const insideValidPlaceholder = occupied.some(([start, end]) => offset >= start && offset < end)
    if (!insideValidPlaceholder) {
      const lineEnd = content.indexOf('\n', offset)
      diagnostics.push({
        kind: 'unclosed-variable',
        start: offset,
        end: lineEnd >= 0 ? lineEnd : content.length,
        message: 'Unclosed variable placeholder',
      })
    }
    offset = content.indexOf('{{', offset + 2)
  }

  return diagnostics
}

export function normalizeVariableType(type: string): CanonicalPromptVariableType {
  if (type === 'textarea') return 'textarea'
  if (type === 'select') return 'select'
  if (['number', 'int', 'float'].includes(type)) return 'number'
  if (['boolean', 'bool'].includes(type)) return 'boolean'
  return 'text'
}

export type DisplayVariableType = 'text' | 'textarea' | 'select' | 'number' | 'boolean' | 'list' | 'dict'

/**
 * 7 类展示口径：与全局变量库的 VARIABLE_TYPES 对齐，
 * 把旧别名（str/int/float/bool/array/object 等）统一归一为标准类型名。
 * 仅用于展示与渲染分支选择，不回写底层数据。
 */
export function displayVariableType(type: string): DisplayVariableType {
  if (type === 'textarea') return 'textarea'
  if (type === 'select') return 'select'
  if (['number', 'int', 'float'].includes(type)) return 'number'
  if (['boolean', 'bool'].includes(type)) return 'boolean'
  if (['list', 'array'].includes(type)) return 'list'
  if (['dict', 'object'].includes(type)) return 'dict'
  return 'text'
}

export function createVariable(name: string): EditablePromptVariable {
  return {
    name,
    type: 'text',
    options: [],
    defaultValue: '',
    required: true,
    placeholder: '',
    description: '',
  }
}

/** 变量搜索可比对的最小结构：名称/描述/列表选项/SKU 维度取值 */
export interface VariableSearchTarget {
  name: string
  description?: string
  options?: string[]
  /** 列表类型之外还可能存在选项级元数据（key = 选项文本） */
  optionMeta?: Record<string, unknown>
  sku?: { dimensions?: { name?: string; values?: string[] }[] }
}

/**
 * 变量是否命中搜索关键字。
 *
 * 比对范围刻意**不止变量名**——用户脑子里的"变量"常常是列表里的某个选项
 * （如按「婴幼儿」建变量，想搜「幼儿」），所以 name/description/options/SKU 维度值全都参与匹配。
 * 纯字符串匹配、大小写不敏感；空关键字恒命中。
 */
export function matchesVariableKeyword(variable: VariableSearchTarget, keyword?: string): boolean {
  const query = (keyword ?? '').trim().toLowerCase()
  if (!query) return true

  const hits = (text?: string) => !!text && text.toLowerCase().includes(query)
  if (hits(variable.name) || hits(variable.description)) return true

  // 列表选项文本与选项级元数据的 key（如自定义图标时按选项名建过键）
  if (variable.options?.some(hits)) return true
  if (variable.optionMeta && Object.keys(variable.optionMeta).some(hits)) return true

  // SKU 维度名与维度取值（组合结果由维度值拼出，搜取值即等价于搜组合片段）
  return !!variable.sku?.dimensions?.some(dimension => hits(dimension.name) || dimension.values?.some(hits))
}

export function reconcilePromptVariables(
  content: string,
  variables: EditablePromptVariable[] = []
): ReconciledPromptVariables {
  const parsed = parsePromptTemplate(content)
  const existing = new Map(variables.filter(variable => variable.name).map(variable => [variable.name, variable]))
  const active = parsed.variableNames.map(name => cloneVariable(existing.get(name) || createVariable(name)))
  const activeNames = new Set(parsed.variableNames)
  const unused = variables
    .filter(variable => variable.name && !activeNames.has(variable.name))
    .map(cloneVariable)

  return { active, unused, all: [...active, ...unused] }
}

export function validateVariableName(name: string, variables: EditablePromptVariable[], currentName?: string): string | null {
  const normalized = name.trim()
  if (!normalized) return 'required'
  if (/[{}\r\n]/.test(normalized)) return 'invalid'
  if (variables.some(variable => variable.name !== currentName && variable.name === normalized)) return 'duplicate'
  return null
}

export function replaceVariableName(content: string, previousName: string, nextName: string): string {
  return parsePromptTemplate(content).segments.map(segment => (
    segment.kind === 'variable' && segment.name === previousName
      ? `{{${nextName}}}`
      : content.slice(segment.start, segment.end)
  )).join('')
}

export function removeVariableOccurrences(content: string, name: string): string {
  return parsePromptTemplate(content).segments
    .filter(segment => segment.kind !== 'variable' || segment.name !== name)
    .map(segment => content.slice(segment.start, segment.end))
    .join('')
}

export function getActivePromptVariables(prompt: PromptWithRelations): EditablePromptVariable[] {
  if (prompt.isJinjaTemplate) {
    if (prompt.variables?.length) return prompt.variables.map(cloneVariable)
    return jinjaService.extractVariables(prompt.content || '').map(createVariable)
  }

  return reconcilePromptVariables(prompt.content || '', prompt.variables || []).active
}

export function createPromptDraft(
  variables: EditablePromptVariable[],
  current: Record<string, any> = {}
): Record<string, any> {
  const next = { ...current }
  variables.forEach(variable => {
    if (next[variable.name] !== undefined) return
    next[variable.name] = normalizeVariableType(variable.type) === 'boolean'
      ? variable.defaultValue === 'true'
      : variable.defaultValue ?? ''
  })
  return next
}

export function isEmptyPromptValue(value: any): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim())
}

export function getMissingPromptVariables(
  variables: EditablePromptVariable[],
  values: Record<string, any>
): string[] {
  return variables
    .filter(variable => variable.required && isEmptyPromptValue(values[variable.name]))
    .map(variable => variable.name)
}

// ---------------------------------------------------------------- 显示规则（前后缀）

/** 前后缀默认连接符（两槽位都有内容时才出现） */
export const DEFAULT_DISPLAY_SEPARATOR = ' '

export interface ResolvedDisplayRule {
  prefix: VariableDisplaySlot
  suffix: VariableDisplaySlot
  separator: string
}

/** 默认规则 = 只输出变量值，等同历史行为 */
export const DEFAULT_DISPLAY_RULE: ResolvedDisplayRule = {
  prefix: 'value',
  suffix: 'none',
  separator: DEFAULT_DISPLAY_SEPARATOR,
}

const normalizeSlot = (slot: VariableDisplaySlot | undefined, fallback: VariableDisplaySlot): VariableDisplaySlot => (
  slot === 'none' || slot === 'name' || slot === 'value' ? slot : fallback
)

/**
 * 归一化显示规则。
 * 「变量值必须输出」是硬约束：若两个槽位都没落到 value，就把空闲槽让给值
 * （变量名挤占两槽时后槽让位），避免用户误配导致值被静默丢弃。
 */
export function resolveDisplayRule(rule?: VariableDisplayRule | null): ResolvedDisplayRule {
  const separator = rule?.separator ?? DEFAULT_DISPLAY_SEPARATOR
  let prefix = normalizeSlot(rule?.prefix, 'value')
  let suffix = normalizeSlot(rule?.suffix, 'none')
  if (prefix !== 'value' && suffix !== 'value') {
    if (prefix === 'none') prefix = 'value'
    else suffix = 'value'
  }
  return { prefix, suffix, separator }
}

/** 规则是否等于默认（只输出值）——用于判断是否需要在界面上高亮/落库 */
export function isDefaultDisplayRule(rule?: VariableDisplayRule | null): boolean {
  const resolved = resolveDisplayRule(rule)
  return resolved.prefix === DEFAULT_DISPLAY_RULE.prefix
    && resolved.suffix === DEFAULT_DISPLAY_RULE.suffix
}

const slotToken = (slot: VariableDisplaySlot, name: string, value: string): string => {
  if (slot === 'name') return name
  if (slot === 'value') return value
  return ''
}

/** 变量在最终结果里的输出：前缀槽 + 连接符 + 后缀槽（空槽跳过） */
export function renderVariableOutput(
  rule: VariableDisplayRule | null | undefined,
  name: string,
  value: unknown
): string {
  const resolved = resolveDisplayRule(rule)
  const text = value === undefined || value === null ? '' : String(value)
  return [slotToken(resolved.prefix, name, text), slotToken(resolved.suffix, name, text)]
    .filter(part => part !== '')
    .join(resolved.separator)
}

/**
 * 编辑视图「插入变量」写入正文的文本：
 * 变量名槽位字面化（静态可编辑），值槽位保留 {{name}} 占位（运行时才知道取到什么）。
 */
export function insertVariableSnippet(rule: VariableDisplayRule | null | undefined, name: string): string {
  const resolved = resolveDisplayRule(rule)
  return [resolved.prefix, resolved.suffix]
    .filter(slot => slot !== 'none')
    .map(slot => (slot === 'name' ? name : `{{${name}}}`))
    .join(resolved.separator)
}

/** 占位符紧邻处是否已经存在同名变量名字面量（插入时字面化过），避免渲染端重复补 */
const hasLiteralNameNearby = (content: string, start: number, end: number, name: string): { before: boolean; after: boolean } => ({
  before: content.slice(0, start).replace(/\s+$/, '').endsWith(name),
  after: content.slice(end).replace(/^\s+/, '').startsWith(name),
})

export function renderPrompt(
  prompt: PromptWithRelations,
  values: Record<string, any>,
  variables = getActivePromptVariables(prompt)
): { content: string; error?: string } {
  try {
    if (prompt.isJinjaTemplate) return { content: jinjaService.render(prompt.content || '', values) }

    const raw = prompt.content || ''
    const variableNames = new Set(variables.map(variable => variable.name))
    const content = parsePromptTemplate(raw).segments.map(segment => {
      if (segment.kind === 'text' || !variableNames.has(segment.name)) {
        return raw.slice(segment.start, segment.end)
      }
      const variable = variables.find(item => item.name === segment.name)
      const value = String(values[segment.name] ?? variable?.defaultValue ?? '')
      const resolved = resolveDisplayRule(variable?.displayRule)
      // 变量名槽位若在正文里已由「插入变量」字面化，则渲染端不再重复补，只补值
      const literal = hasLiteralNameNearby(raw, segment.start, segment.end, segment.name)
      const rule: VariableDisplayRule = {
        prefix: resolved.prefix === 'name' && literal.before ? 'none' : resolved.prefix,
        suffix: resolved.suffix === 'name' && literal.after ? 'none' : resolved.suffix,
        separator: resolved.separator,
      }
      return renderVariableOutput(rule, segment.name, value)
    }).join('')
    return { content }
  } catch (error) {
    return {
      content: prompt.content || '',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export const isNumberPromptVariable = (type: string) => normalizeVariableType(type) === 'number'
export const isBooleanPromptVariable = (type: string) => normalizeVariableType(type) === 'boolean'

function cloneVariable<T extends EditablePromptVariable>(variable: T): T {
  return {
    ...variable,
    options: variable.options ? [...variable.options] : undefined,
    optionMeta: variable.optionMeta
      ? Object.fromEntries(Object.entries(variable.optionMeta).map(([key, meta]) => [key, { ...meta }]))
      : undefined,
    sku: variable.sku
      ? {
        ...variable.sku,
        dimensions: variable.sku.dimensions.map(dimension => ({ ...dimension, values: [...dimension.values] })),
        enabled: variable.sku.enabled ? [...variable.sku.enabled] : undefined,
        comboOrder: variable.sku.comboOrder ? [...variable.sku.comboOrder] : undefined,
      }
      : undefined,
    validation: variable.validation ? { ...variable.validation } : undefined,
    decor: variable.decor ? { ...variable.decor } : undefined,
    displayRule: variable.displayRule ? { ...variable.displayRule } : undefined,
  }
}

// ---------------------------------------------------------------- SKU 组合工具

/** SKU 组合键的内部连接符（不可见于正常输入） */
export const SKU_KEY_SEPARATOR = '\u001F'
export const DEFAULT_SKU_SEPARATOR = ' / '

export interface SkuCombo {
  /** 内部键（\u001F 连接，用于 enabled 集合与 meta 索引） */
  key: string
  /** 写入 options 的展示值（separator 拼接） */
  label: string
  /** 按维度顺序的取值 */
  values: string[]
}

/**
 * 组合键 → 展示值：每段取值前带所属维度名（如 "-- ar 1:1 / -- w 512"），
 * 备注不参与拼接；维度名为空时该段退化为纯取值。
 */
export function skuComboLabel(sku: VariableSkuConfig, values: string[]): string {
  const separator = sku.separator || DEFAULT_SKU_SEPARATOR
  const dimensions = sku.dimensions.filter(dimension => dimension.values.length > 0)
  return values.map((value, index) => {
    const name = (dimensions[index]?.name || '').trim()
    return name ? `${name} ${value}` : value
  }).join(separator)
}

/** 维度笛卡尔积（顺序稳定：后面维度先转）；emptyDimension 返回空数组由调用方处理 */
export function skuCombos(sku: VariableSkuConfig): SkuCombo[] {
  const dimensions = sku.dimensions.filter(dimension => dimension.values.length > 0)
  if (!dimensions.length) return []
  let combos: SkuCombo[] = [{ key: '', label: '', values: [] }]
  dimensions.forEach(dimension => {
    const next: SkuCombo[] = []
    combos.forEach(combo => {
      dimension.values.forEach(value => {
        const values = [...combo.values, value]
        next.push({
          key: values.join(SKU_KEY_SEPARATOR),
          label: skuComboLabel(sku, values),
          values,
        })
      })
    })
    combos = next
  })
  return combos
}

/** 启用的组合（sku.enabled 缺省 = 全部启用） */
export function enabledSkuCombos(sku: VariableSkuConfig): SkuCombo[] {
  const combos = skuCombos(sku)
  if (!sku.enabled) return combos
  const enabled = new Set(sku.enabled)
  return combos.filter(combo => enabled.has(combo.key))
}

/** 维度缺失时仍给出可用组合（单维度兜底：把已有 options 当作唯一维度值的场景由调用方决策） */
export function combosChanged(sku: VariableSkuConfig, options: string[] | undefined): boolean {
  const labels = enabledSkuCombos(sku).map(combo => combo.label)
  const current = (options || []).filter(Boolean)
  return labels.join('\n') !== current.join('\n')
}

/** 批量添加取值/选项时的分隔符：换行、中英文逗号、顿号、中英文分号、竖线、制表符、斜杠 */
export const BATCH_SPLIT_PATTERN = /[\r\n,，、;；|\t/]+/

/** 按常见分隔符批量拆分文本（去空白项） */
export function splitBatchValues(text: string): string[] {
  return text.split(BATCH_SPLIT_PATTERN).map(item => item.trim()).filter(Boolean)
}

/** 修剪 optionMeta：只保留仍存在于 labels 中的键 */
export function pruneOptionMeta(
  meta: Record<string, VariableOptionMeta> | undefined,
  labels: string[]
): Record<string, VariableOptionMeta> | undefined {
  if (!meta) return undefined
  const keep = new Set(labels)
  const next: Record<string, VariableOptionMeta> = {}
  Object.entries(meta).forEach(([label, value]) => {
    if (keep.has(label) && value && Object.keys(value).length) next[label] = value
  })
  return Object.keys(next).length ? next : undefined
}
