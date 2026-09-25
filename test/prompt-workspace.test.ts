import { describe, expect, it } from 'vitest'
import type { GlobalVariable, PromptWithRelations, PromptVariable } from '../src/shared/types/database'
import {
  applyGlobalLibraryDefinitions,
  createWorkspaceDraft,
  deriveWorkspaceVariables,
  getMissingRequiredVariables,
  renderWorkspacePrompt,
} from '../src/renderer/lib/utils/prompt-workspace'

const variable = (name: string, overrides: Partial<PromptVariable> = {}): PromptVariable => ({
  uuid: `variable-${name}`,
  promptId: 1,
  name,
  type: 'text',
  required: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

const prompt = (overrides: Partial<PromptWithRelations> = {}): PromptWithRelations => ({
  id: 1,
  uuid: 'prompt-1',
  title: 'Test prompt',
  content: 'Hello {{ name }}',
  tags: [],
  variables: [variable('name')],
  isFavorite: false,
  useCount: 0,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

describe('prompt workspace rendering', () => {
  it('fills regular prompt variables while allowing whitespace in placeholders', () => {
    expect(renderWorkspacePrompt(prompt(), { name: 'Codex' }).content).toBe('Hello Codex')
  })

  it('preserves current values and supplies configured defaults', () => {
    const variables = [
      variable('name', { defaultValue: 'Guest' }),
      variable('enabled', { type: 'boolean', defaultValue: 'true' }),
    ]

    expect(createWorkspaceDraft(variables, { name: 'Yarin' })).toEqual({
      name: 'Yarin',
      enabled: true,
    })
  })

  it('reports only missing required values', () => {
    const variables = [variable('required'), variable('optional', { required: false })]
    expect(getMissingRequiredVariables(variables, { optional: '' })).toEqual(['required'])
  })

  it('derives and renders Jinja variables when no schema was saved', () => {
    const jinjaPrompt = prompt({
      content: '{% if enabled %}Hello {{ name }}{% endif %}',
      variables: [],
      isJinjaTemplate: true,
    })

    expect(deriveWorkspaceVariables(jinjaPrompt).map(item => item.name)).toEqual(['enabled', 'name'])
    expect(renderWorkspacePrompt(jinjaPrompt, { enabled: true, name: 'Codex' }).content).toBe('Hello Codex')
  })
})

describe('applyGlobalLibraryDefinitions', () => {
  const libraryVariable = (name: string, overrides: Partial<GlobalVariable> = {}): GlobalVariable => ({
    uuid: `global-${name}`,
    name,
    type: 'text',
    required: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  })

  it('overrides local definitions when a same-name library variable exists', () => {
    const local = [
      variable('style', { type: 'text', required: true, defaultValue: 'plain' }),
      variable('tone', { type: 'text', required: true }),
    ]
    const library = [
      libraryVariable('style', {
        type: 'select',
        options: ['formal', 'casual'],
        required: false,
        defaultValue: 'casual',
        placeholder: '选择语气',
        description: '全局库语气定义',
      }),
    ]

    const [style, tone] = applyGlobalLibraryDefinitions(local, library)
    expect(style).toMatchObject({
      name: 'style',
      type: 'select',
      options: ['formal', 'casual'],
      required: false,
      defaultValue: 'casual',
      placeholder: '选择语气',
      description: '全局库语气定义',
      libraryLinked: true,
      libraryUuid: 'global-style',
    })
    // 库中没有的变量保持本地定义，不标记
    expect(tone).toMatchObject({ name: 'tone', type: 'text', required: true })
    expect(tone.libraryLinked).toBeUndefined()
  })

  it('falls back to local fields when the library definition leaves them empty', () => {
    const local = [variable('legacy', { type: 'str' as never, defaultValue: 'kept', options: ['a'], validation: { maxLength: 10 } })]
    const library = [libraryVariable('legacy', { type: 'text', options: [] })]

    const [merged] = applyGlobalLibraryDefinitions(local, library)
    expect(merged).toMatchObject({
      type: 'text',
      // 库未设置默认值/校验时回落本地
      defaultValue: 'kept',
      validation: { maxLength: 10 },
      libraryLinked: true,
    })
    // 库 options 为空时保留本地 options
    expect(merged.options).toEqual(['a'])
  })

  it('returns variables untouched when the library is empty', () => {
    const local = [variable('name')]
    expect(applyGlobalLibraryDefinitions(local, [])).toEqual(local)
  })
})
