/**
 * 数据库相关类型定义 - 统一管理
 * 从各个分散的类型定义文件整合而来
 */

// 导入 AI 相关类型
import type { AIConfig, AIGenerationHistory } from './ai';
// 导入数据管理相关类型
import type { ExportResult, ImportResult } from './data-management';
// 导入通用类型
import type { PaginationResult } from './common';

export * from './ai';

/**
 * 分类数据模型
 */
export interface Category {
  id?: number;
  uuid: string; // 全局唯一标识符，用于WebDAV同步
  name: string;
  description?: string;
  color?: string;  
  icon?: string;
  /** 图标风格：outline=线性 / filled=面性（IconPark 主题） */
  iconTheme?: 'outline' | 'filled';
  parentId?: number;
  isActive: boolean;
  sortOrder?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 提示词数据模型
 */
export interface Prompt {
  id?: number;
  uuid: string; // 全局唯一标识符，用于WebDAV同步
  title: string;
  content: string;
  description?: string;
  categoryId?: number;
  tags: string[] | string; // 支持数组或字符串格式
  variables?: PromptVariable[];
  isFavorite: boolean;
  useCount: number;
  version?: number;
  isActive: boolean;
  isJinjaTemplate?: boolean; // 是否为 Jinja 模板
  imageBlobs?: Blob[]; // 图片数据数组，支持多张图片

  /** @deprecated 仅用于迁移旧数据；新快捷键绑定保存在本机偏好设置中。 */
  shortcutKey?: string;
  /** @deprecated 仅用于迁移旧数据。 */
  isShortcutTrigger?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * SKU 组合维度（如：尺寸 / 颜色），select 型变量的组合生成器输入
 */
export interface VariableSkuDimension {
  /** 维度名，如"尺寸" */
  name: string;
  /** 维度备注：帮助理解维度含义；提示词编辑时以信息图标悬停展示，不参与组合名拼接 */
  remark?: string;
  /** 维度取值，如 ["S", "M", "L"] */
  values: string[];
}

/**
 * 图标 / 配图装饰载荷：变量级与选项级共用同一结构
 */
export interface VariableDecor {
  /** IconPark 图标名（PascalCase），配合 iconTheme/color 渲染 */
  icon?: string;
  iconTheme?: string;
  color?: string;
  /** 配图 URL / dataURL / 本地路径 */
  image?: string;
}

/**
 * 选项级元数据：为单个选项（或 SKU 组合）配图标 / 配图，强化解释。
 * 也可声明「引用上级」——自身未设置时沿用所属变量（上级）的装饰。
 */
export interface VariableOptionMeta extends VariableDecor {
  /** 引用上级（变量级）装饰：自身未设置图标/图片时生效 */
  inheritParent?: boolean;
}

/**
 * SKU 组合配置：维度笛卡尔积生成候选组合，可逐个启用/停用（自定义拆分）
 */
export interface VariableSkuConfig {
  dimensions: VariableSkuDimension[];
  /** 组合值拼接符，默认 " / " */
  separator?: string;
  /** 启用的组合键（维度值按维度顺序以 \u001F 连接）；缺省 = 全部启用 */
  enabled?: string[];
  /** 组合展示顺序（拖拽/排序后的组合键列表）；缺省 = 生成顺序 */
  comboOrder?: string[];
}

/**
 * 显示规则槽位取值：
 * - none  不显示
 * - name  变量名
 * - value 变量值（列表类型即当前选中的「选项名」）
 */
export type VariableDisplaySlot = 'none' | 'name' | 'value';

/**
 * 变量在使用时的显示规则：前缀槽 / 后缀槽 各自可选，中间用 separator 连接。
 * 输出 = 前缀槽内容 + separator + 后缀槽内容（空槽跳过）。
 * 例：prefix=name / suffix=value / separator=" " → 「色调 冷蓝色调」
 * 默认 prefix=value → 只输出变量值（与历史行为一致）。
 * 非列表类型没有「选项名」，value 槽即用户填写的值。
 */
export interface VariableDisplayRule {
  prefix?: VariableDisplaySlot;
  suffix?: VariableDisplaySlot;
  /** 前后缀之间的连接符；仅当两个槽位都有内容时才出现 */
  separator?: string;
}

/**
 * 提示词变量数据模型
 */
export interface PromptVariable {
  id?: number;
  uuid: string; // 全局唯一标识符，用于WebDAV同步
  promptId: number;
  name: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'boolean' | 'str' | 'int' | 'float' | 'bool' | 'list' | 'dict';
  defaultValue?: string;
  options?: string[];
  /** 选项级图标/配图元数据，key = 选项文本（select 型可用） */
  optionMeta?: Record<string, VariableOptionMeta>;
  /** SKU 组合生成器配置（select 型可选启用；生成结果写入 options） */
  sku?: VariableSkuConfig;
  /** 变量级图标/配图（所有类型均可用；用于填充端标签等展示位） */
  decor?: VariableDecor;
  /** 显示规则：变量出现在提示词正文时的前后缀形态（本提示词内覆盖，优先于全局库默认） */
  displayRule?: VariableDisplayRule;
  required: boolean;
  placeholder?: string;
  description?: string;
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    min?: number;
    max?: number;
  };
  sortOrder?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 全局变量分组数据模型
 * 支持通过 parentUuid 组成多级分组树，与提示词内变量无关
 */
export interface VariableGroup {
  id?: number;
  uuid: string;
  name: string;
  description?: string;
  /** 父分组 uuid，根分组为空 */
  parentUuid?: string | null;
  /** IconPark 图标名，如 "folder"、"star" */
  icon?: string;
  /** 图标风格：outline=线性 / filled=面性 */
  iconTheme?: 'outline' | 'filled';
  /** 图标/主题色，hex */
  color?: string;
  sortOrder?: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 带层级路径的分组视图模型，用于树形展示与导入导出 */
export interface VariableGroupNode extends VariableGroup {
  /** 从根到当前分组的名称路径，如 ["写作", "中文润色"] */
  path: string[];
  children?: VariableGroupNode[];
}

/**
 * 全局变量数据模型（独立于提示词的变量库）
 */
export interface GlobalVariable {
  id?: number;
  uuid: string;
  /** 变量名，同一分组内唯一（不含分组时全局唯一） */
  name: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'boolean' | 'list' | 'dict';
  defaultValue?: string;
  options?: string[];
  /** 选项级图标/配图元数据，key = 选项文本（select 型可用） */
  optionMeta?: Record<string, VariableOptionMeta>;
  /** SKU 组合生成器配置（select 型可选启用；生成结果写入 options） */
  sku?: VariableSkuConfig;
  /** 变量级图标/配图（所有类型均可用；用于填充端标签等展示位） */
  decor?: VariableDecor;
  /** 显示规则：全局库默认，提示词内可覆盖 */
  displayRule?: VariableDisplayRule;
  required: boolean;
  placeholder?: string;
  description?: string;
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    min?: number;
    max?: number;
  };
  /** 所属分组 uuid，未分组为空 */
  groupUuid?: string | null;
  sortOrder?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Bot 数据模型：绑定了 AI 配置与指令的可复用 AI 助手容器。
 * 第一个内置动作是"逆向图片提示词"：拖拽图片到 Bot 上，按 instruction 生成提示词。
 */
export interface Bot {
  id?: number;
  uuid: string; // 全局唯一标识符，用于WebDAV同步
  name: string;
  /** 头像，base64 dataURL（导入前压缩到 ≤256px），空则渲染默认机器人图标 */
  avatar?: string;
  /** Bot 的系统指令，描述逆向图片提示词的要求（风格、格式、侧重点等） */
  instruction: string;
  /** 绑定的 AI 配置 configId；空则运行时选择首选可用配置 */
  configId?: string;
  /** 指定模型；空则用绑定配置的默认模型 */
  model?: string;
  enabled: boolean;
  sortOrder?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Bot 图片逆向结果：一次运行的输入输出载荷（不落库，仅用于结果卡片与存入提示词库）
 */
export interface BotReversePromptRequest {
  botUuid: string;
  /** 图片 dataURL（已压缩） */
  imageDataUrl: string;
}

export interface BotReversePromptResult {
  botUuid: string;
  botName: string;
  /** 模型生成的提示词文本 */
  prompt: string;
  model: string;
  configId: string;
  createdAt: Date;
}

/**
 * 应用设置数据模型
 */
export interface AppSettings {
  id?: number;
  key: string;
  value: any;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  category?: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 扩展的提示词数据模型
 */
export interface PromptWithRelations extends Prompt {
  category?: Category;
  variableValues?: Record<string, any>;
}

/**
 * 扩展的分类数据模型
 */
export interface CategoryWithRelations extends Category {
  prompts?: Prompt[];
  children?: Category[];
  parent?: Category;
}

/**
 * 提示词查询过滤条件
 */
export interface PromptFilters {
  categoryId?: number | null;
  tags?: string;
  isFavorite?: boolean;
  isActive?: boolean;
  search?: string;
  searchText?: string;
  sortBy?: 'timeDesc' | 'timeAsc' | 'useCount' | 'favorite' | 'title' | 'createdAt' | 'updatedAt';
  page?: number;
  limit?: number;
}

/**
 * 分页查询结果 - 使用统一的 PaginationResult 类型
 */
export type PaginatedResult<T> = PaginationResult<T>;

/**
 * 数据库健康检查结果
 */
export interface DatabaseHealthStatus {
  healthy: boolean;
  missingStores?: string[];
  corruptedStores?: string[];
  repairSuggestions?: string[];
}

/**
 * 数据导出结果 - 使用统一的 ExportResult 类型
 */
export type DatabaseExportResult = ExportResult;

/**
 * 数据导入结果 - 使用统一的 ImportResult 类型
 */
export type DatabaseImportResult = ImportResult;

/**
 * 提示词历史记录数据模型
 */
export interface PromptHistory {
  id?: number;
  uuid: string; // 全局唯一标识符，用于WebDAV同步
  promptId: number;
  title: string;
  content: string;
  description?: string;
  categoryId?: number;
  tags?: string;
  variables?: string;
  isJinjaTemplate?: boolean; // 是否为 Jinja 模板
  imageBlobs?: Blob[]; // 图片数据数组，支持多张图片
  version: number;
  changeDescription?: string; // 变更描述
  createdAt: Date;
}

/**
 * 变量历史记录数据模型（变量版本管理，对齐 PromptHistory 的查看/回退体验）
 */
export interface VariableHistory {
  id?: number;
  uuid: string;
  variableUuid: string;
  name: string;
  version: number;
  /** 保存时的变量数据载荷（不含自增 id） */
  snapshot: Record<string, unknown>;
  changeDescription?: string;
  createdAt: Date;
}

/**
 * 同步删除标记。
 * 业务表仍然执行硬删除；同步层依靠 tombstone 将删除传播到其他设备。
 */
export interface SyncTombstone {
  id?: number;
  storeName: string;
  collectionName: string;
  recordKey: string;
  recordUuid?: string;
  deletedAt: Date;
  recordSnapshot?: any;
}

/**
 * 提示词填充结果
 */
export interface PromptFillResult {
  originalContent: string;
  filledContent: string;
  variables: Record<string, string>;
  promptVariables: PromptVariable[];
}

/**
 * AI生成历史查询选项
 */
export interface AIGenerationHistoryOptions {
  configId?: string;
  topic?: string;
  status?: 'success' | 'error' | 'pending';
  sortBy?: 'createdAt' | 'topic' | 'status';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  search?: string;
}

/**
 * AI生成历史统计信息
 */
export interface AIGenerationHistoryStats {
  total: number;
  successful: number;
  failed: number;
  pending: number;
  totalByConfig: Record<string, number>;
  mostUsedConfigs: {
    configId: string;
    count: number;
  }[];
}

/**
 * 用户数据模型
 * @deprecated 不再使用，保留仅为了向后兼容
 */
export interface User {
  id?: number;
  email: string;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 文章数据模型
 * @deprecated 不再使用，保留仅为了向后兼容
 */
export interface Post {
  id?: number;
  title: string;
  content?: string;
  published: boolean;
  authorId: number;
  createdAt: Date;
  updatedAt: Date;
}
