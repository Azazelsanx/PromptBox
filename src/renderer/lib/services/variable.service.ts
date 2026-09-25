/**
 * 全局变量库服务
 * 提供多级分组与全局变量的 CRUD、树构建、导入导出与模板生成
 * 注意：全局变量独立于提示词内变量（promptVariables），本期不做填充打通
 */

import type { GlobalVariable, Prompt, PromptVariable, VariableDecor, VariableDisplayRule, VariableGroup, VariableGroupNode, VariableHistory } from '@shared/types/database';
import { BaseDatabaseService } from './base-database.service';
import { emitDataChange } from './data-change-events';
import { generateUUID } from '../utils/uuid';
import { matchesVariableKeyword } from '../utils/prompt-template';

export const VARIABLE_EXPORT_FORMAT = 'promptbox-variables';
export const VARIABLE_EXPORT_VERSION = 1;

export const VARIABLE_TYPES: GlobalVariable['type'][] = [
  'text',
  'textarea',
  'select',
  'number',
  'boolean',
  'list',
  'dict'
];

/** CSV 列定义：options 用 | 分隔；validation 规则仅 JSON 承载 */
export const VARIABLE_CSV_COLUMNS = [
  'groupPath',
  'name',
  'type',
  'required',
  'defaultValue',
  'options',
  'placeholder',
  'description'
] as const;

export interface VariableImportItem {
  groupPath?: string[];
  name: string;
  type?: string;
  required?: boolean | string;
  defaultValue?: string;
  options?: string[] | string;
  placeholder?: string;
  description?: string;
  validation?: GlobalVariable['validation'];
  /** 选项级图标/配图（select 列表项，可「引用上级」） */
  optionMeta?: GlobalVariable['optionMeta'];
  /** SKU 组合生成器配置 */
  sku?: GlobalVariable['sku'];
  /** 变量级图标/配图装饰 */
  decor?: VariableDecor;
  /** 显示规则（变量名/选项名作前缀·后缀·不显示） */
  displayRule?: VariableDisplayRule;
  uuid?: string;
}

export interface VariableImportPayload {
  format?: string;
  version?: number;
  groups?: { path?: string[]; name?: string; description?: string }[];
  variables?: VariableImportItem[];
}

/** 提示词内变量的扫描清单条目（按变量名聚合去重） */
export interface PromptVariableInventoryItem {
  name: string;
  type: GlobalVariable['type'];
  required: boolean;
  defaultValue?: string;
  options?: string[];
  placeholder?: string;
  description?: string;
  /** 变量级图标/配图装饰 */
  decor?: VariableDecor;
  /** 显示规则（变量名/选项名作前缀·后缀·不显示） */
  displayRule?: VariableDisplayRule;
  /** 使用该变量的提示词数量 */
  usageCount: number;
  /** 来源提示词标题（最多保留 5 个） */
  promptTitles: string[];
}

export interface VariableImportSummary {
  groupsCreated: number;
  variablesCreated: number;
  variablesUpdated: number;
  variablesSkipped: number;
  warnings: string[];
}

export interface VariableExportPayload {
  format: string;
  version: number;
  exportedAt: string;
  groups: { path: string[]; name: string; description?: string }[];
  variables: VariableImportItem[];
}

/** 导入时未知类型的归一化映射 */
const TYPE_ALIASES: Record<string, GlobalVariable['type']> = {
  str: 'text',
  string: 'text',
  int: 'number',
  float: 'number',
  bool: 'boolean',
  array: 'list',
  object: 'dict'
};

const normalizeVariableType = (raw?: string): GlobalVariable['type'] | null => {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (VARIABLE_TYPES.includes(value as GlobalVariable['type'])) return value as GlobalVariable['type'];
  return TYPE_ALIASES[value] ?? null;
};

const parseBooleanish = (raw: unknown): boolean => {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') return ['true', 'yes', '1', '是'].includes(raw.trim().toLowerCase());
  return false;
};

const normalizeOptions = (raw: unknown): string[] | undefined => {
  if (Array.isArray(raw)) {
    const options = raw.map(item => String(item).trim()).filter(Boolean);
    return options.length ? options : undefined;
  }
  if (typeof raw === 'string') {
    const options = raw.split('|').map(item => item.trim()).filter(Boolean);
    return options.length ? options : undefined;
  }
  return undefined;
};

/** 简易 CSV 行解析：支持双引号包裹与引号转义 */
export const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
};

const escapeCsvCell = (value: unknown): string => {
  const text = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

export class VariableService extends BaseDatabaseService {
  private static instance: VariableService;

  static getInstance(): VariableService {
    if (!VariableService.instance) {
      VariableService.instance = new VariableService();
    }
    return VariableService.instance;
  }

  // ---------------------------------------------------------------- 分组

  /**
   * 获取多级分组树
   * 孤儿分组（父不存在）自动提升为根节点
   */
  async getGroupTree(): Promise<VariableGroupNode[]> {
    const groups = await this.getAll<VariableGroup>('variableGroups');
    const byUuid = new Map<string, VariableGroupNode>();
    groups.forEach(group => {
      byUuid.set(group.uuid, { ...group, path: [group.name] });
    });

    const roots: VariableGroupNode[] = [];
    for (const node of byUuid.values()) {
      const parent = node.parentUuid ? byUuid.get(node.parentUuid) : undefined;
      if (parent && parent !== node) {
        (parent.children ??= []).push(node);
      } else {
        roots.push(node);
      }
    }

    const finalize = (nodes: VariableGroupNode[], prefix: string[] = []): VariableGroupNode[] => {
      return nodes
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
        .map(node => {
          node.path = [...prefix, node.name];
          if (node.children?.length) finalize(node.children, node.path);
          else delete node.children;
          return node;
        });
    };
    return finalize(roots);
  }

  async createGroup(
    data: Pick<VariableGroup, 'name'> & Partial<Pick<VariableGroup, 'description' | 'parentUuid' | 'icon' | 'iconTheme' | 'color'>>
  ): Promise<VariableGroup> {
    const name = data.name.trim();
    if (!name) throw new Error('[VARIABLE_GROUP_NAME_REQUIRED] 分组名称不能为空');
    await this.assertNoSiblingName(name, data.parentUuid ?? null);

    const siblings = await this.getChildren(data.parentUuid ?? null);
    const group = await this.add<VariableGroup>('variableGroups', {
      uuid: generateUUID(),
      name,
      description: data.description?.trim() || undefined,
      parentUuid: data.parentUuid ?? null,
      icon: data.icon || undefined,
      iconTheme: data.iconTheme || undefined,
      color: data.color || undefined,
      sortOrder: siblings.length,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    emitDataChange({ storeName: 'variableGroups', action: 'create', id: group.id });
    return group;
  }

  async updateGroup(
    uuid: string,
    patch: Partial<Pick<VariableGroup, 'name' | 'description' | 'parentUuid' | 'icon' | 'iconTheme' | 'color'>>
  ): Promise<VariableGroup> {
    const group = await this.getGroupByUuid(uuid);
    if (!group) throw new Error(`[VARIABLE_GROUP_NOT_FOUND] 分组不存在: ${uuid}`);

    const nextParent = patch.parentUuid === undefined ? group.parentUuid ?? null : patch.parentUuid;
    if (patch.parentUuid !== undefined) {
      await this.assertMoveAllowed(uuid, nextParent);
    }

    const nextName = patch.name !== undefined ? patch.name.trim() : group.name;
    if (!nextName) throw new Error('[VARIABLE_GROUP_NAME_REQUIRED] 分组名称不能为空');
    const nameChanged = nextName !== group.name;
    const parentChanged = nextParent !== (group.parentUuid ?? null);
    if (nameChanged || parentChanged) {
      await this.assertNoSiblingName(nextName, nextParent, uuid);
    }

    const updated = await this.update<VariableGroup>('variableGroups', group.id!, {
      ...patch,
      name: nextName,
      parentUuid: nextParent,
      updatedAt: new Date()
    });
    emitDataChange({ storeName: 'variableGroups', action: 'update', id: group.id });
    return updated;
  }

  /**
   * 删除分组。默认仅允许删除空分组（无子分组且无变量）；
   * recursive=true 时级联删除子孙分组及其下全部变量。
   */
  async deleteGroup(uuid: string, options: { recursive?: boolean } = {}): Promise<void> {
    const group = await this.getGroupByUuid(uuid);
    if (!group) return;

    const children = await this.getChildren(uuid);
    const groupVariables = await this.getVariables({ groupUuid: uuid });

    if (!options.recursive && (children.length || groupVariables.length)) {
      throw new Error('[VARIABLE_GROUP_NOT_EMPTY] 分组下仍有子分组或变量，请先清空或选择递归删除');
    }

    if (options.recursive) {
      for (const child of children) {
        await this.deleteGroup(child.uuid, { recursive: true });
      }
      for (const variable of groupVariables) {
        await this.deleteVariable(variable.uuid);
      }
    }

    await this.delete('variableGroups', group.id!);
    emitDataChange({ storeName: 'variableGroups', action: 'delete', id: group.id });
  }

  /** 按名称路径查找分组（导入用），不存在返回 null */
  async getGroupByPath(path: string[]): Promise<VariableGroup | null> {
    let current: VariableGroup | null = null;
    for (const segment of path) {
      const name = segment.trim();
      if (!name) continue;
      const parentUuid: string | null = current ? current.uuid : null;
      const children = await this.getChildren(parentUuid);
      const found = children.find(child => child.name === name);
      if (!found) return null;
      current = found;
    }
    return current;
  }

  /** 按名称路径查找分组，缺失的层级自动创建（导入用） */
  async ensureGroupPath(path: string[]): Promise<VariableGroup | null> {
    let current: VariableGroup | null = null;
    for (const segment of path) {
      const name = segment.trim();
      if (!name) continue;
      const parentUuid: string | null = current ? current.uuid : null;
      const children = await this.getChildren(parentUuid);
      const found = children.find(child => child.name === name);
      current = found ?? (await this.createGroup({ name, parentUuid }));
    }
    return current;
  }

  async getGroupByUuid(uuid: string): Promise<VariableGroup | null> {
    const groups = await this.getAll<VariableGroup>('variableGroups');
    return groups.find(group => group.uuid === uuid) ?? null;
  }

  private async getChildren(parentUuid: string | null): Promise<VariableGroup[]> {
    const groups = await this.getAll<VariableGroup>('variableGroups');
    return groups.filter(group => (group.parentUuid ?? null) === parentUuid);
  }

  private async assertNoSiblingName(name: string, parentUuid: string | null, excludeUuid?: string): Promise<void> {
    const siblings = await this.getChildren(parentUuid);
    if (siblings.some(sibling => sibling.uuid !== excludeUuid && sibling.name === name)) {
      throw new Error(`[VARIABLE_GROUP_DUPLICATE] 同级已存在同名分组: ${name}`);
    }
  }

  /** 禁止把分组移动到自己或自己的子孙下面（防环） */
  private async assertMoveAllowed(uuid: string, newParentUuid: string | null): Promise<void> {
    if (!newParentUuid) return;
    if (newParentUuid === uuid) {
      throw new Error('[VARIABLE_GROUP_CYCLE] 不能把分组移动到自身下面');
    }
    const groups = await this.getAll<VariableGroup>('variableGroups');
    const byUuid = new Map(groups.map(group => [group.uuid, group]));
    let cursor: VariableGroup | undefined = byUuid.get(newParentUuid);
    while (cursor) {
      if (cursor.uuid === uuid) {
        throw new Error('[VARIABLE_GROUP_CYCLE] 不能把分组移动到自己的子孙分组下面');
      }
      cursor = cursor.parentUuid ? byUuid.get(cursor.parentUuid) : undefined;
    }
  }

  // ---------------------------------------------------------------- 变量

  async getAllVariables(): Promise<GlobalVariable[]> {
    const variables = await this.getAll<GlobalVariable>('globalVariables');
    return variables.sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)
    );
  }

  /**
   * 查询变量：groupUuid 为空返回全部（含未分组）；
   * includeDescendants=true 时包含该分组所有子孙分组下的变量
   */
  async getVariables(filter: { groupUuid?: string | null; includeDescendants?: boolean; search?: string } = {}): Promise<GlobalVariable[]> {
    let variables = await this.getAllVariables();
    if (filter.groupUuid) {
      let scope: Set<string> | null = null;
      if (filter.includeDescendants) {
        const groups = await this.getAll<VariableGroup>('variableGroups');
        scope = new Set([filter.groupUuid]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const group of groups) {
            const parent = group.parentUuid ?? null;
            if (parent && scope.has(parent) && !scope.has(group.uuid)) {
              scope.add(group.uuid);
              grew = true;
            }
          }
        }
      }
      variables = variables.filter(variable => {
        const groupUuid = variable.groupUuid ?? null;
        if (filter.includeDescendants) return groupUuid ? scope!.has(groupUuid) : false;
        return groupUuid === filter.groupUuid;
      });
    }
    if (filter.search) {
      // 比对范围与编辑器内搜索一致（名称/描述/选项/SKU 维度值），
      // 用户常按列表里的某个选项名来找变量，只匹配名称会搜不到。
      variables = variables.filter(variable => matchesVariableKeyword(variable, filter.search));
    }
    return variables;
  }

  async createVariable(
    data: Omit<GlobalVariable, 'id' | 'uuid' | 'createdAt' | 'updatedAt'> & Partial<Pick<GlobalVariable, 'uuid'>>
  ): Promise<GlobalVariable> {
    const name = data.name.trim();
    if (!name) throw new Error('[VARIABLE_NAME_REQUIRED] 变量名不能为空');
    await this.assertNoDuplicateName(name, data.groupUuid ?? null);

    const all = await this.getAll<GlobalVariable>('globalVariables');
    const variable = await this.add<GlobalVariable>('globalVariables', {
      ...data,
      uuid: data.uuid ?? generateUUID(),
      name,
      type: data.type,
      groupUuid: data.groupUuid ?? null,
      sortOrder: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : all.length,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    emitDataChange({ storeName: 'globalVariables', action: 'create', id: variable.id });
    await this.saveVariableHistory(variable, 1, 'create');
    return variable;
  }

  async updateVariable(uuid: string, patch: Partial<Omit<GlobalVariable, 'id' | 'uuid'>>): Promise<GlobalVariable> {
    const all = await this.getAll<GlobalVariable>('globalVariables');
    const variable = all.find(item => item.uuid === uuid);
    if (!variable) throw new Error(`[VARIABLE_NOT_FOUND] 变量不存在: ${uuid}`);

    const nextName = patch.name !== undefined ? patch.name.trim() : variable.name;
    if (!nextName) throw new Error('[VARIABLE_NAME_REQUIRED] 变量名不能为空');
    const nextGroup = patch.groupUuid === undefined ? variable.groupUuid ?? null : patch.groupUuid;
    if (nextName !== variable.name || nextGroup !== (variable.groupUuid ?? null)) {
      await this.assertNoDuplicateName(nextName, nextGroup, uuid);
    }

    const updated = await this.update<GlobalVariable>('globalVariables', variable.id!, {
      ...patch,
      name: nextName,
      groupUuid: nextGroup,
      updatedAt: new Date()
    });
    // 内容有变化才记历史版本
    if (this.variablePayloadChanged(variable, updated)) {
      await this.saveVariableHistory(updated, await this.nextVariableVersion(uuid), 'update');
    }
    emitDataChange({ storeName: 'globalVariables', action: 'update', id: variable.id });
    return updated;
  }

  async deleteVariable(uuid: string): Promise<void> {
    const all = await this.getAll<GlobalVariable>('globalVariables');
    const variable = all.find(item => item.uuid === uuid);
    if (!variable) return;
    await this.delete('globalVariables', variable.id!);
    await this.deleteVariableHistories(uuid);
    emitDataChange({ storeName: 'globalVariables', action: 'delete', id: variable.id });
  }

  // -------------------------------------------------- 变量历史版本（查看与回退）

  /** 历史快照覆盖的业务载荷（不含 id/uuid/时间戳等元字段） */
  private toHistorySnapshot(variable: GlobalVariable): Record<string, unknown> {
    return {
      name: variable.name,
      type: variable.type,
      required: variable.required,
      groupUuid: variable.groupUuid ?? null,
      defaultValue: variable.defaultValue ?? '',
      options: variable.options ?? [],
      optionMeta: variable.optionMeta,
      sku: variable.sku,
      decor: variable.decor,
      displayRule: variable.displayRule,
      placeholder: variable.placeholder ?? '',
      description: variable.description ?? '',
      validation: variable.validation,
      sortOrder: variable.sortOrder
    };
  }

  private variablePayloadChanged(before: GlobalVariable, after: GlobalVariable): boolean {
    return JSON.stringify(this.toHistorySnapshot(before)) !== JSON.stringify(this.toHistorySnapshot(after));
  }

  private async nextVariableVersion(variableUuid: string): Promise<number> {
    const all = await this.getAll<VariableHistory>('variableHistories');
    const max = all
      .filter(item => item.variableUuid === variableUuid)
      .reduce((acc, item) => Math.max(acc, item.version), 0);
    return max + 1;
  }

  private async saveVariableHistory(variable: GlobalVariable, version: number, changeDescription?: string): Promise<void> {
    if (!variable.uuid) return;
    await this.add<VariableHistory>('variableHistories', {
      uuid: generateUUID(),
      variableUuid: variable.uuid,
      name: variable.name,
      version,
      snapshot: this.toHistorySnapshot(variable),
      changeDescription,
      createdAt: new Date()
    });
  }

  /** 版本倒序，最多保留 50 条 */
  async listVariableHistories(variableUuid: string): Promise<VariableHistory[]> {
    const all = await this.getAll<VariableHistory>('variableHistories');
    return all
      .filter(item => item.variableUuid === variableUuid)
      .sort((a, b) => b.version - a.version)
      .slice(0, 50);
  }

  private async deleteVariableHistories(variableUuid: string): Promise<void> {
    const all = await this.getAll<VariableHistory>('variableHistories');
    const doomed = all.filter(item => item.variableUuid === variableUuid);
    for (const item of doomed) {
      if (item.id !== undefined) await this.delete('variableHistories', item.id);
    }
  }

  private async assertNoDuplicateName(name: string, groupUuid: string | null, excludeUuid?: string): Promise<void> {
    const all = await this.getAll<GlobalVariable>('globalVariables');
    const duplicated = all.some(
      item => item.uuid !== excludeUuid && item.name === name && (item.groupUuid ?? null) === groupUuid
    );
    if (duplicated) {
      throw new Error(`[VARIABLE_DUPLICATE] 同一分组下已存在同名变量: ${name}`);
    }
  }

  // -------------------------------------------------- 扫描与收编提示词内变量

  /**
   * 扫描全部提示词内变量，按变量名聚合去重。
   * 变量名是提示词模板 {{name}} 的语义键，同名视为同一变量：
   * 选项取并集，required 取「任一」，其余字段取第一个非空值。
   */
  async scanPromptVariables(): Promise<PromptVariableInventoryItem[]> {
    const prompts = await this.getAll<Prompt>('prompts');
    const titleById = new Map<number, string>();
    prompts.forEach(prompt => {
      if (prompt.id !== undefined) titleById.set(prompt.id, prompt.title);
    });

    const rows = await this.getAll<PromptVariable>('promptVariables');
    const byName = new Map<string, PromptVariableInventoryItem>();

    for (const row of rows) {
      const name = row.name.trim();
      if (!name) continue;
      const type = normalizeVariableType(row.type) ?? 'text';
      const title = titleById.get(row.promptId) ?? '未知提示词';
      const existing = byName.get(name);
      if (existing) {
        existing.usageCount += 1;
        if (existing.promptTitles.length < 5 && !existing.promptTitles.includes(title)) {
          existing.promptTitles.push(title);
        }
        existing.required = existing.required || row.required;
        const optionSet = new Set([...(existing.options ?? []), ...(row.options ?? [])]);
        if (optionSet.size) existing.options = Array.from(optionSet);
        existing.defaultValue = existing.defaultValue || row.defaultValue || undefined;
        existing.placeholder = existing.placeholder || row.placeholder || undefined;
        existing.description = existing.description || row.description || undefined;
        existing.decor = existing.decor || (row.decor ? { ...row.decor } : undefined);
        existing.displayRule = existing.displayRule ?? (row.displayRule ? { ...row.displayRule } : undefined);
      } else {
        byName.set(name, {
          name,
          type,
          required: row.required,
          defaultValue: row.defaultValue || undefined,
          options: row.options?.length ? [...row.options] : undefined,
          placeholder: row.placeholder || undefined,
          description: row.description || undefined,
          decor: row.decor ? { ...row.decor } : undefined,
          displayRule: row.displayRule ? { ...row.displayRule } : undefined,
          usageCount: 1,
          promptTitles: [title]
        });
      }
    }

    return Array.from(byName.values()).sort(
      (a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name)
    );
  }

  /**
   * 把勾选的提示词变量收编进全局变量库。
   * 以变量名为匹配键：库中已存在同名变量（无论哪个分组）→ 合并更新（选项并集、
   * 必填取或、空字段补齐，保留其所在分组）；不存在 → 在目标分组下新建。
   */
  async importPromptVariables(
    items: PromptVariableInventoryItem[],
    targetGroupUuid: string | null
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    const all = await this.getAllVariables();
    const byName = new Map(all.map(variable => [variable.name, variable]));

    for (const item of items) {
      const existing = byName.get(item.name);
      if (existing) {
        const optionSet = new Set([...(existing.options ?? []), ...(item.options ?? [])]);
        await this.updateVariable(existing.uuid, {
          required: existing.required || item.required,
          options: optionSet.size ? Array.from(optionSet) : undefined,
          defaultValue: existing.defaultValue || item.defaultValue,
          placeholder: existing.placeholder || item.placeholder,
          description: existing.description || item.description,
          decor: existing.decor ?? item.decor,
          displayRule: existing.displayRule ?? item.displayRule,
          type: existing.type || item.type
        });
        updated += 1;
      } else {
        await this.createVariable({
          name: item.name,
          type: item.type,
          required: item.required,
          defaultValue: item.defaultValue,
          options: item.options,
          placeholder: item.placeholder,
          description: item.description,
          decor: item.decor,
          displayRule: item.displayRule,
          groupUuid: targetGroupUuid
        });
        created += 1;
      }
    }
    return { created, updated };
  }

  // ---------------------------------------------------------------- 导入导出

  /** 导出全部分组与变量为可再导入的 JSON 结构 */
  async exportAll(): Promise<VariableExportPayload> {
    const tree = await this.getGroupTree();
    const variables = await this.getAllVariables();
    const groupByUuid = new Map<string, VariableGroupNode>();

    const walk = (nodes: VariableGroupNode[]) => {
      nodes.forEach(node => {
        groupByUuid.set(node.uuid, node);
        if (node.children?.length) walk(node.children);
      });
    };
    walk(tree);

    return {
      format: VARIABLE_EXPORT_FORMAT,
      version: VARIABLE_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      groups: Array.from(groupByUuid.values()).map(node => ({
        path: node.path,
        name: node.name,
        description: node.description
      })),
      variables: variables.map(variable => ({
        groupPath: variable.groupUuid ? (groupByUuid.get(variable.groupUuid)?.path ?? []) : [],
        name: variable.name,
        type: variable.type,
        required: variable.required,
        defaultValue: variable.defaultValue,
        options: variable.options,
        optionMeta: variable.optionMeta,
        sku: variable.sku,
        decor: variable.decor,
        displayRule: variable.displayRule,
        placeholder: variable.placeholder,
        description: variable.description,
        validation: variable.validation,
        uuid: variable.uuid
      }))
    };
  }

  /** 导出 CSV（分组用 "/" 路径表达，不含校验规则） */
  async exportCsv(): Promise<string> {
    const payload = await this.exportAll();
    const rows = [VARIABLE_CSV_COLUMNS.join(',')];
    payload.variables.forEach(variable => {
      rows.push(
        [
          (variable.groupPath ?? []).join('/'),
          variable.name,
          variable.type,
          variable.required ? 'true' : 'false',
          variable.defaultValue ?? '',
          (Array.isArray(variable.options) ? variable.options : (variable.options ? String(variable.options).split('|') : [])).join('|'),
          variable.placeholder ?? '',
          variable.description ?? ''
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    });
    return rows.join('\r\n');
  }

  /**
   * 导入变量（JSON 或已解析的条目）。
   * merge 模式：uuid 或「分组路径+变量名」命中则更新，否则新建；
   * skip 模式：命中则跳过。
   */
  async importPayload(
    payload: VariableImportPayload,
    mode: 'merge' | 'skip' = 'merge'
  ): Promise<VariableImportSummary> {
    if (payload.format && payload.format !== VARIABLE_EXPORT_FORMAT) {
      throw new Error(`[VARIABLE_IMPORT_FORMAT] 无法识别的导入格式: ${payload.format}`);
    }

    const summary: VariableImportSummary = {
      groupsCreated: 0,
      variablesCreated: 0,
      variablesUpdated: 0,
      variablesSkipped: 0,
      warnings: []
    };

    const groupCountBefore = (await this.getAll<VariableGroup>('variableGroups')).length;

    for (const entry of payload.groups ?? []) {
      const path = (entry.path ?? []).map(segment => String(segment).trim()).filter(Boolean);
      if (!path.length && !entry.name?.trim()) continue;
      const fullPath = path.length ? path : [String(entry.name).trim()];
      const existed = await this.getGroupByPath(fullPath);
      if (!existed) {
        await this.ensureGroupPath(fullPath);
      } else if (entry.description && !existed.description) {
        await this.updateGroup(existed.uuid, { description: entry.description });
      }
    }

    const existing = await this.getAllVariables();
    const groups = await this.getAll<VariableGroup>('variableGroups');
    const pathByUuid = new Map<string, string[]>();
    const buildPaths = (list: VariableGroup[], prefix: string[]) => {
      list.forEach(group => {
        const path = [...prefix, group.name];
        pathByUuid.set(group.uuid, path);
        const children = groups.filter(item => (item.parentUuid ?? null) === group.uuid);
        if (children.length) buildPaths(children, path);
      });
    };
    buildPaths(groups.filter(group => !group.parentUuid), []);

    const byKey = new Map<string, GlobalVariable>();
    existing.forEach(variable => {
      const path = variable.groupUuid ? pathByUuid.get(variable.groupUuid) ?? [] : [];
      byKey.set(`${path.join('/')}/${variable.name}`, variable);
      if (variable.uuid) byKey.set(`uuid:${variable.uuid}`, variable);
    });

    for (const item of payload.variables ?? []) {
      try {
        const name = String(item.name ?? '').trim();
        if (!name) {
          summary.warnings.push('存在缺少变量名的条目，已跳过');
          summary.variablesSkipped += 1;
          continue;
        }
        const type = normalizeVariableType(item.type);
        if (!type) {
          summary.warnings.push(`变量 ${name} 的类型无法识别（${item.type ?? '空'}），已跳过`);
          summary.variablesSkipped += 1;
          continue;
        }

        const groupPath = (item.groupPath ?? [])
          .map(segment => String(segment).trim())
          .filter(Boolean);
        let groupUuid: string | null = null;
        if (groupPath.length) {
          const group = await this.ensureGroupPath(groupPath);
          groupUuid = group?.uuid ?? null;
        }

        const defined = <T>(value: T | undefined, fallback?: T): T | undefined =>
          value === undefined ? fallback : value;
        const defaults = {
          name,
          type,
          required: parseBooleanish(item.required),
          defaultValue: defined(item.defaultValue === undefined || item.defaultValue === null ? undefined : String(item.defaultValue)),
          options: normalizeOptions(item.options),
          placeholder: defined(item.placeholder ? String(item.placeholder) : undefined),
          description: defined(item.description ? String(item.description) : undefined),
          validation: defined(item.validation),
          optionMeta: defined(item.optionMeta),
          sku: defined(item.sku),
          decor: defined(item.decor),
          displayRule: defined(item.displayRule),
          groupUuid
        };

        const matched = (item.uuid ? byKey.get(`uuid:${item.uuid}`) : undefined) ?? byKey.get(`${groupPath.join('/')}/${name}`);
        if (matched) {
          if (mode === 'skip') {
            summary.variablesSkipped += 1;
            continue;
          }
          // 只覆盖导入数据中明确给出的字段，避免 undefined 抹掉已有配置
          const patch: Partial<Omit<GlobalVariable, 'id' | 'uuid'>> = { ...defaults };
          (Object.keys(patch) as (keyof typeof patch)[]).forEach(key => {
            if (patch[key] === undefined) delete patch[key];
          });
          await this.updateVariable(matched.uuid, patch);
          summary.variablesUpdated += 1;
        } else {
          await this.createVariable(defaults);
          summary.variablesCreated += 1;
        }
      } catch (error) {
        summary.warnings.push(
          `导入变量 ${item?.name ?? '未知'} 失败: ${error instanceof Error ? error.message : String(error)}`
        );
        summary.variablesSkipped += 1;
      }
    }

    summary.groupsCreated = (await this.getAll<VariableGroup>('variableGroups')).length - groupCountBefore;
    return summary;
  }

  /** 解析 CSV 文本为导入条目（列顺序见 VARIABLE_CSV_COLUMNS） */
  parseCsv(text: string): VariableImportPayload {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim().length);
    if (!lines.length) return { variables: [] };

    const header = parseCsvLine(lines[0]).map(cell => cell.trim().toLowerCase());
    const columns = VARIABLE_CSV_COLUMNS as readonly string[];
    const indexes = columns.map(column => header.indexOf(column.toLowerCase()));
    if (header.length && header.includes('groupPath'.toLowerCase()) && header.includes('name')) {
      const body = lines.slice(1);
      return {
        variables: body.map(line => {
          const cells = parseCsvLine(line);
          const record: Record<string, string> = {};
          columns.forEach((column, index) => {
            const cellIndex = indexes[index];
            record[column] = cellIndex >= 0 ? (cells[cellIndex] ?? '').trim() : '';
          });
          return {
            groupPath: record.groupPath ? record.groupPath.split('/').filter(Boolean) : [],
            name: record.name,
            type: record.type,
            required: record.required,
            defaultValue: record.defaultValue,
            options: record.options,
            placeholder: record.placeholder,
            description: record.description
          } satisfies VariableImportItem;
        })
      };
    }

    // 无表头：按默认列序解析
    return {
      variables: lines.map(line => {
        const cells = parseCsvLine(line);
        const record: Record<string, string> = {};
        columns.forEach((column, index) => {
          record[column] = cells[index] ?? '';
        });
        return {
          groupPath: record.groupPath ? record.groupPath.split('/').filter(Boolean) : [],
          name: record.name,
          type: record.type,
          required: record.required,
          defaultValue: record.defaultValue,
          options: record.options,
          placeholder: record.placeholder,
          description: record.description
        } satisfies VariableImportItem;
      })
    };
  }

  /** JSON 导入模板（可下载后填写再导入） */
  getJsonTemplate(): string {
    return JSON.stringify(
      {
        format: VARIABLE_EXPORT_FORMAT,
        version: VARIABLE_EXPORT_VERSION,
        groups: [
          { path: ['写作'], name: '写作' },
          { path: ['写作', '中文润色'], name: '中文润色' },
          { path: ['开发'], name: '开发' }
        ],
        variables: [
          {
            groupPath: ['写作'],
            name: '文章主题',
            type: 'text',
            required: true,
            defaultValue: '',
            placeholder: '例如：产品推广文案',
            description: '文章要围绕的主题'
          },
          {
            groupPath: ['写作', '中文润色'],
            name: '语气风格',
            type: 'select',
            required: false,
            defaultValue: '正式',
            options: ['正式', '轻松', '幽默'],
            description: '润色后的语言风格'
          },
          {
            groupPath: ['开发'],
            name: '目标语言',
            type: 'select',
            required: true,
            defaultValue: 'TypeScript',
            options: ['TypeScript', 'Go', 'Python'],
            description: '生成代码的目标语言'
          },
          {
            groupPath: [],
            name: '输出字数',
            type: 'number',
            required: false,
            defaultValue: '500',
            description: '未分组变量示例',
            validation: { min: 100, max: 5000 }
          }
        ]
      },
      null,
      2
    );
  }

  /** CSV 导入模板（分组路径用 / 分隔，options 用 | 分隔） */
  getCsvTemplate(): string {
    const sample = [
      ['groupPath', 'name', 'type', 'required', 'defaultValue', 'options', 'placeholder', 'description'].join(','),
      ['写作', '文章主题', 'text', 'true', '', '', '例如：产品推广文案', '文章要围绕的主题'].map(escapeCsvCell).join(','),
      ['写作/中文润色', '语气风格', 'select', 'false', '正式', '正式|轻松|幽默', '', '润色后的语言风格'].map(escapeCsvCell).join(','),
      ['开发', '目标语言', 'select', 'true', 'TypeScript', 'TypeScript|Go|Python', '', '生成代码的目标语言'].map(escapeCsvCell).join(','),
      ['', '输出字数', 'number', 'false', '500', '', '', '未分组变量示例'].map(escapeCsvCell).join(',')
    ];
    return sample.join('\r\n');
  }
}
