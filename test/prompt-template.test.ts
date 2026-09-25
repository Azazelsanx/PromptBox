import { describe, expect, it } from 'vitest'
import type { PromptWithRelations } from '../src/shared/types/database'
import {
  createPromptDraft,
  displayVariableType,
  getActivePromptVariables,
  getMissingPromptVariables,
  insertVariableSnippet,
  matchesVariableKeyword,
  normalizeVariableType,
  parsePromptTemplate,
  reconcilePromptVariables,
  removeVariableOccurrences,
  renderPrompt,
  renderVariableOutput,
  replaceVariableName,
  resolveDisplayRule,
  skuCombos,
} from '../src/renderer/lib/utils/prompt-template'

const prompt = (overrides: Partial<PromptWithRelations> = {}): PromptWithRelations => ({
  id: 1,
  uuid: 'prompt-1',
  title: 'Template',
  content: 'Hello {{name}}',
  tags: [],
  variables: [],
  isFavorite: false,
  useCount: 0,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

describe('prompt template core', () => {
  it('parses Unicode, whitespace and repeated placeholders in document order', () => {
    const parsed = parsePromptTemplate('请让 {{ 角色 }} 向 {{name}} 介绍 {{角色}}。')
    expect(parsed.variableNames).toEqual(['角色', 'name'])
    expect(parsed.occurrences.get('角色')).toHaveLength(2)
    expect(parsed.segments.filter(segment => segment.kind === 'variable')).toMatchObject([
      { name: '角色', occurrence: 0, firstOccurrence: true },
      { name: 'name', occurrence: 0, firstOccurrence: true },
      { name: '角色', occurrence: 1, firstOccurrence: false },
    ])
  })

  it('reports unclosed placeholders without changing their text', () => {
    const content = 'Hello {{name\nNext line'
    const parsed = parsePromptTemplate(content)
    expect(parsed.diagnostics).toHaveLength(1)
    expect(parsed.segments).toEqual([{ kind: 'text', text: content, start: 0, end: content.length }])
  })

  it('reconciles active variables while retaining unused configurations', () => {
    const reconciled = reconcilePromptVariables('Hello {{name}} and {{topic}}', [
      { name: 'name', type: 'textarea', required: false, description: 'Name hint' },
      { name: 'old', type: 'select', required: true, options: ['A'] },
    ])
    expect(reconciled.active).toMatchObject([
      { name: 'name', type: 'textarea', required: false, description: 'Name hint' },
      { name: 'topic', type: 'text', required: true },
    ])
    expect(reconciled.unused).toMatchObject([{ name: 'old' }])
  })

  it('renames and removes every occurrence atomically', () => {
    const content = '{{ name }} greets {{name}} and {{other}}'
    expect(replaceVariableName(content, 'name', '角色')).toBe('{{角色}} greets {{角色}} and {{other}}')
    expect(removeVariableOccurrences(content, 'name')).toBe(' greets  and {{other}}')
  })

  it('normalizes legacy types and creates typed defaults', () => {
    expect(normalizeVariableType('int')).toBe('number')
    expect(normalizeVariableType('bool')).toBe('boolean')
    expect(createPromptDraft([
      { name: 'count', type: 'number', required: true, defaultValue: '0' },
      { name: 'enabled', type: 'boolean', required: true, defaultValue: 'true' },
    ])).toEqual({ count: '0', enabled: true })
  })

  it('treats zero and false as filled required values', () => {
    const variables = [
      { name: 'count', type: 'number', required: true },
      { name: 'enabled', type: 'boolean', required: true },
      { name: 'subject', type: 'text', required: true },
    ]
    expect(getMissingPromptVariables(variables, { count: 0, enabled: false, subject: '' })).toEqual(['subject'])
  })

  it('derives only referenced variables for regular prompts and renders repeated values', () => {
    const source = prompt({
      content: '{{name}} / {{ name }}',
      variables: [
        { uuid: 'v1', promptId: 1, name: 'name', type: 'text', required: true, createdAt: new Date(), updatedAt: new Date() },
        { uuid: 'v2', promptId: 1, name: 'unused', type: 'text', required: true, createdAt: new Date(), updatedAt: new Date() },
      ],
    })
    expect(getActivePromptVariables(source).map(variable => variable.name)).toEqual(['name'])
    expect(renderPrompt(source, { name: 'Ada' }).content).toBe('Ada / Ada')
  })
})

describe('sku combo labels', () => {
  const sku = {
    dimensions: [
      { name: '-- ar', remark: '画面宽高比', values: ['1:1', '3:4'] },
      { name: '-- w', values: ['512px'] },
    ],
  }

  it('prefixes each combo segment with its dimension name', () => {
    const combos = skuCombos(sku)
    expect(combos.map(combo => combo.label)).toEqual([
      '-- ar 1:1 / -- w 512px',
      '-- ar 3:4 / -- w 512px',
    ])
  })

  it('keeps the raw value when a dimension has no name and never appends remarks', () => {
    const combos = skuCombos({
      dimensions: [
        { name: '', values: ['a'] },
        { name: '比例', remark: '宽高比说明', values: ['1:1'] },
      ],
    })
    expect(combos.map(combo => combo.label)).toEqual(['a / 比例 1:1'])
  })
})

describe('displayVariableType', () => {
  it('normalizes legacy aliases into the 7-type display taxonomy', () => {
    expect(displayVariableType('str')).toBe('text')
    expect(displayVariableType('string')).toBe('text')
    expect(displayVariableType('int')).toBe('number')
    expect(displayVariableType('float')).toBe('number')
    expect(displayVariableType('bool')).toBe('boolean')
    expect(displayVariableType('array')).toBe('list')
    expect(displayVariableType('object')).toBe('dict')
  })

  it('keeps canonical types and falls back to text for unknown values', () => {
    expect(displayVariableType('text')).toBe('text')
    expect(displayVariableType('textarea')).toBe('textarea')
    expect(displayVariableType('select')).toBe('select')
    expect(displayVariableType('number')).toBe('number')
    expect(displayVariableType('boolean')).toBe('boolean')
    expect(displayVariableType('list')).toBe('list')
    expect(displayVariableType('dict')).toBe('dict')
    expect(displayVariableType('whatever')).toBe('text')
  })
})

describe('variable display rule', () => {
  it('defaults to the bare value so历史行为不变', () => {
    expect(resolveDisplayRule(undefined)).toEqual({ prefix: 'value', suffix: 'none', separator: ' ' })
    expect(renderVariableOutput(undefined, '色调', '冷蓝色调')).toBe('冷蓝色调')
    expect(renderVariableOutput({}, '色调', '冷蓝色调')).toBe('冷蓝色调')
  })

  it('orders the 变量名 / 选项名 slots and joins them with the separator', () => {
    expect(renderVariableOutput({ prefix: 'name', suffix: 'value', separator: ' ' }, '色调', '冷蓝色调'))
      .toBe('色调 冷蓝色调')
    expect(renderVariableOutput({ prefix: 'value', suffix: 'name', separator: '：' }, '色调', '冷蓝色调'))
      .toBe('冷蓝色调：色调')
    expect(renderVariableOutput({ prefix: 'name', separator: ':' }, '色调', '冷蓝色调'))
      .toBe('色调:冷蓝色调')
  })

  it('never drops the value when a slot is left empty', () => {
    // 只设了「变量名在前」：空槽让给值，而不是输出一个光秃秃的变量名
    expect(resolveDisplayRule({ prefix: 'name' })).toEqual({ prefix: 'name', suffix: 'value', separator: ' ' })
    expect(resolveDisplayRule({ prefix: 'none', suffix: 'name' }))
      .toEqual({ prefix: 'value', suffix: 'name', separator: ' ' })
    // 两槽都塞变量名属于退化配置：后槽让位给值
    expect(renderVariableOutput({ prefix: 'name', suffix: 'name' }, '色调', '冷蓝色调')).toBe('色调 冷蓝色调')
  })

  it('writes the name slot literally into the template and keeps the value placeholder', () => {
    expect(insertVariableSnippet(undefined, '色调')).toBe('{{色调}}')
    expect(insertVariableSnippet({ prefix: 'name', suffix: 'value' }, '色调')).toBe('色调 {{色调}}')
    expect(insertVariableSnippet({ prefix: 'value', suffix: 'name' }, '色调')).toBe('{{色调}} 色调')
  })

  it('applies the rule at render time without duplicating an already-literal name', () => {
    const vars = [{
      name: '色调', type: 'select', required: false,
      displayRule: { prefix: 'name' as const, suffix: 'value' as const },
    }]
    expect(renderPrompt(prompt({ content: '画面{{色调}}', variables: vars }), { 色调: '冷蓝色调' }))
      .toEqual({ content: '画面色调 冷蓝色调' })
    // 插入变量已经写过字面变量名：渲染端只补值，不重复
    expect(renderPrompt(prompt({ content: '画面色调 {{色调}}', variables: vars }), { 色调: '冷蓝色调' }))
      .toEqual({ content: '画面色调 冷蓝色调' })
    // 变量名放在后面时同理
    const suffixVars = [{ name: '色调', type: 'select', required: false, displayRule: { suffix: 'name' as const } }]
    expect(renderPrompt(prompt({ content: '画面{{色调}} 色调', variables: suffixVars }), { 色调: '冷蓝色调' }))
      .toEqual({ content: '画面冷蓝色调 色调' })
  })
})

describe('variable keyword matching', () => {
  const listVariable = {
    name: '年龄阶段',
    description: '用于描述人物所处的人生阶段',
    options: ['婴幼儿', '儿童期', '青少年'],
  }

  it('matches on the variable name and description', () => {
    expect(matchesVariableKeyword(listVariable, '年龄')).toBe(true)
    expect(matchesVariableKeyword(listVariable, '人生阶段')).toBe(true)
  })

  it('matches on list option names so搜选项名也能定位变量', () => {
    // 用户按「婴幼儿」建的变量，脑子里搜的可能是「幼儿」
    expect(matchesVariableKeyword(listVariable, '幼儿')).toBe(true)
    expect(matchesVariableKeyword(listVariable, '儿童')).toBe(true)
    expect(matchesVariableKeyword(listVariable, '青少年')).toBe(true)
  })

  it('matches on SKU dimension names and values', () => {
    const skuVariable = {
      name: '图片参数',
      sku: { dimensions: [{ name: '尺寸', values: ['1970S', '2000S'] }] },
    }
    expect(matchesVariableKeyword(skuVariable, '尺寸')).toBe(true)
    expect(matchesVariableKeyword(skuVariable, '1970S')).toBe(true)
    expect(matchesVariableKeyword(skuVariable, '2000s')).toBe(true) // 大小写不敏感
  })

  it('matches on optionMeta keys and normalizes case/whitespace', () => {
    const decorated = { name: '色调', optionMeta: { 冷蓝色调: { icon: 'Snow' } } }
    expect(matchesVariableKeyword(decorated, '冷蓝')).toBe(true)
    expect(matchesVariableKeyword({ name: 'Ar' }, '  ar ')).toBe(true)
  })

  it('treats an empty keyword as a match and rejects non-hits', () => {
    expect(matchesVariableKeyword(listVariable, '')).toBe(true)
    expect(matchesVariableKeyword(listVariable, undefined)).toBe(true)
    expect(matchesVariableKeyword(listVariable, '   ')).toBe(true)
    expect(matchesVariableKeyword(listVariable, '不存在的词')).toBe(false)
  })

  it('does not throw on variables missing optional fields', () => {
    expect(matchesVariableKeyword({ name: '纯文本' }, '纯')).toBe(true)
    expect(matchesVariableKeyword({ name: '纯文本' }, '无')).toBe(false)
    expect(matchesVariableKeyword({ name: '空选项', options: [], sku: {} }, 'x')).toBe(false)
  })
})
