import type { GlobalVariable, PromptVariable, PromptWithRelations } from '@shared/types/database'
import {
  createPromptDraft,
  getActivePromptVariables,
  getMissingPromptVariables,
  isBooleanPromptVariable,
  isEmptyPromptValue,
  isNumberPromptVariable,
  renderPrompt,
  type EditablePromptVariable,
} from './prompt-template'

export function deriveWorkspaceVariables(prompt: PromptWithRelations): PromptVariable[] {
  return getActivePromptVariables(prompt).map((variable, index) => ({
    ...variable,
    uuid: variable.uuid || `derived-${prompt.id ?? 'draft'}-${index}`,
    promptId: variable.promptId ?? prompt.id ?? 0,
    type: variable.type as PromptVariable['type'],
    createdAt: new Date(),
    updatedAt: new Date(),
  }))
}

/**
 * 全局库同名引用叠加：提示词变量按名称关联全局库，
 * 同名时库定义（类型/选项/必填/默认值/校验/提示/说明）覆盖本地定义，
 * 库中没有的变量保持本地定义（仅关联、不写库）。
 * 标记 libraryLinked 供界面展示定义来源，不落库。
 */
export function applyGlobalLibraryDefinitions<T extends EditablePromptVariable>(
  variables: T[],
  library: GlobalVariable[]
): T[] {
  if (!library.length) return variables
  const byName = new Map(library.map(definition => [definition.name, definition]))
  return variables.map(variable => {
    const definition = byName.get(variable.name)
    if (!definition) return variable
    return {
      ...variable,
      type: definition.type,
      options: definition.options?.length ? [...definition.options] : variable.options,
      optionMeta: definition.optionMeta ?? variable.optionMeta,
      sku: definition.sku ?? variable.sku,
      decor: definition.decor ?? variable.decor,
      // 显示规则提示词内优先（库里的是默认值，提示词里改过就以提示词为准）
      displayRule: variable.displayRule ?? definition.displayRule,
      required: definition.required,
      defaultValue: definition.defaultValue ?? variable.defaultValue,
      placeholder: definition.placeholder || variable.placeholder,
      description: definition.description || variable.description,
      validation: definition.validation ?? variable.validation,
      libraryLinked: true,
      libraryUuid: definition.uuid,
    }
  })
}

export function createWorkspaceDraft(
  variables: PromptVariable[],
  current: Record<string, any> = {}
): Record<string, any> {
  return createPromptDraft(variables, current)
}

export function getMissingRequiredVariables(
  variables: PromptVariable[],
  draft: Record<string, any>
): string[] {
  return getMissingPromptVariables(variables, draft)
}

export function renderWorkspacePrompt(
  prompt: PromptWithRelations,
  draft: Record<string, any>,
  variables = deriveWorkspaceVariables(prompt)
): { content: string; error?: string } {
  return renderPrompt(prompt, draft, variables)
}

export const isNumberVariable = isNumberPromptVariable
export const isBooleanVariable = isBooleanPromptVariable
export const isEmptyWorkspaceValue = isEmptyPromptValue
