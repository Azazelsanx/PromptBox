/**
 * Bot 数据服务
 * 提供 Bot（AI 逆向提示词助手容器）相关的数据库操作功能
 */

import { BaseDatabaseService } from './base-database.service';
import { Bot } from '@shared/types/database';
import { generateUUID } from '../utils/uuid';
import { emitDataChange } from './data-change-events';

const BOT_STORE = 'bots';

/**
 * Bot 数据服务类
 * 继承基础数据库服务，提供 Bot 特定的数据操作方法
 */
export class BotService extends BaseDatabaseService {
  private static instance: BotService;

  static getInstance(): BotService {
    if (!BotService.instance) {
      BotService.instance = new BotService();
    }
    return BotService.instance;
  }

  /**
   * 创建新 Bot
   * @param data Omit<Bot, 'id' | 'uuid' | 'createdAt' | 'updatedAt'> Bot 数据（不包含自动生成的字段）
   * @returns Promise<Bot> 创建成功的 Bot 记录
   */
  async createBot(data: Omit<Bot, 'id' | 'uuid' | 'createdAt' | 'updatedAt'>): Promise<Bot> {
    const bots = await this.getAll<Bot>(BOT_STORE);
    const bot: Bot = {
      ...data,
      sortOrder: Number.isFinite(Number(data.sortOrder)) && data.sortOrder !== undefined
        ? Number(data.sortOrder)
        : this.getNextSortOrder(bots),
      uuid: generateUUID(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    return this.add<Bot>(BOT_STORE, bot);
  }

  /**
   * 获取所有 Bot（按 sortOrder 升序、创建时间升序排列）
   */
  async getAllBots(): Promise<Bot[]> {
    const bots = await this.getAll<Bot>(BOT_STORE);
    return bots.sort((left, right) => {
      const leftOrder = Number.isFinite(Number(left.sortOrder)) ? Number(left.sortOrder) : Number.MAX_SAFE_INTEGER;
      const rightOrder = Number.isFinite(Number(right.sortOrder)) ? Number(right.sortOrder) : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
  }

  /**
   * 获取所有启用的 Bot
   */
  async getEnabledBots(): Promise<Bot[]> {
    const bots = await this.getAllBots();
    return bots.filter(bot => bot.enabled);
  }

  /**
   * 根据 ID 获取 Bot
   */
  async getBotById(id: number): Promise<Bot | null> {
    return this.getById<Bot>(BOT_STORE, id);
  }

  /**
   * 根据 UUID 获取 Bot
   */
  async getBotByUUID(uuid: string): Promise<Bot | null> {
    return this.getByUUID<Bot>(BOT_STORE, uuid);
  }

  /**
   * 更新 Bot
   */
  async updateBot(id: number, data: Partial<Omit<Bot, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Bot> {
    return this.update<Bot>(BOT_STORE, id, data);
  }

  /**
   * 根据 UUID 更新 Bot
   */
  async updateBotByUUID(
    uuid: string,
    data: Partial<Omit<Bot, 'id' | 'uuid' | 'createdAt' | 'updatedAt'>>
  ): Promise<Bot | null> {
    return this.updateByUUID<Bot>(BOT_STORE, uuid, data);
  }

  /**
   * 删除 Bot
   */
  async deleteBot(id: number): Promise<void> {
    return this.delete(BOT_STORE, id);
  }

  /**
   * 根据 UUID 删除 Bot
   */
  async deleteBotByUUID(uuid: string): Promise<boolean> {
    return this.deleteByUUID(BOT_STORE, uuid);
  }

  /**
   * 按用户指定的顺序重新排列 Bot。
   * 所有排序值在同一个 IndexedDB 事务中写入，避免只保存部分顺序。
   */
  async reorderBots(bots: { id: number; sortOrder: number }[]): Promise<void> {
    if (!bots.length) return;

    const ids = new Set(bots.map(bot => bot.id));
    if (ids.size !== bots.length) {
      throw new Error('Bot reorder contains duplicate ids');
    }
    if (bots.some(bot => !Number.isFinite(bot.sortOrder))) {
      throw new Error('Bot reorder contains an invalid sort order');
    }

    const db = await this.ensureDB();
    const updatedAt = new Date();

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([BOT_STORE], 'readwrite');
      const store = transaction.objectStore(BOT_STORE);
      let failure: Error | null = null;

      const abort = (error: Error) => {
        if (failure) return;
        failure = error;
        try { transaction.abort(); } catch { /* transaction already finishing */ }
      };

      bots.forEach(({ id, sortOrder }) => {
        const getRequest = store.get(id);
        getRequest.onerror = () => abort(new Error(
          `Failed to load bot ${id}: ${getRequest.error?.message || 'transaction failed'}`
        ));
        getRequest.onsuccess = () => {
          const bot = getRequest.result as Bot | undefined;
          if (!bot) {
            abort(new Error(`Bot ${id} not found`));
            return;
          }

          const putRequest = store.put(this.cleanDataForStorage({
            ...bot,
            sortOrder,
            updatedAt
          }));
          putRequest.onerror = () => abort(new Error(
            `Failed to reorder bot ${id}: ${putRequest.error?.message || 'transaction failed'}`
          ));
        };
      });

      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(failure || new Error('Bot reorder transaction aborted'));
      transaction.onerror = () => {
        failure ||= new Error(transaction.error?.message || 'Bot reorder transaction failed');
      };
    });

    bots.forEach(({ id }) => emitDataChange({
      storeName: BOT_STORE,
      action: 'update',
      id
    }));
  }

  private getNextSortOrder(bots: Bot[]): number {
    return bots.reduce((max, bot) => {
      const order = Number.isFinite(Number(bot.sortOrder)) ? Number(bot.sortOrder) : 0;
      return Math.max(max, order);
    }, 0) + 1;
  }
}

export const botService = BotService.getInstance();
