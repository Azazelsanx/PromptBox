/**
 * IconPark 图标注册表（@icon-park/vue-next）
 *
 * 仅静态引入精选子集（分组/文件夹/提示词场景），避免打包全部 2600+ 图标。
 * 数据库存 PascalCase 名称（如 "FolderOpen"）+ 风格（outline=线性 / filled=面性）。
 */
import { reactive, ref } from 'vue'
import type { Component } from 'vue'
import '@icon-park/vue-next/styles/index.css'
import {
  Folder, FolderOpen, FolderFocus, FolderDownload, FolderUpload, FolderSettings,
  FileText, FileEditing, Copy, CollectionFiles, TransactionOrder, Bookmark,
  BookOne, Book, Bookshelf, ReadBook, Notebook, NotebookOne, TagOne, Label,
  Link, LinkOne, CloudStorage,
  Edit, EditTwo, Pencil, Write,
  Comment, Comments, Message, MessageOne, MessageSuccess, Sleep, Microphone, AudioFile,
  ImageFiles, Camera, Music, MusicOne, VideoFile, VideoTwo, Film,
  Briefcase, Calendar, CalendarThree, Time, Alarm, List, ListView, ListCheckbox,
  ChartHistogram, ChartLine, Data, Dashboard, Wallet, Bill,
  Code, Config, Bug, Browser, Compass, Rocket, Cloudy, Download, Upload,
  System, SettingTwo, Setting, Tool,
  Star, Heart, Like, Fire, Lightning, Sun, Moon, Planet, Earth,
  Home, Add, Lock, Unlock, Key, KeyOne, Search, Target,
  Crown, Diamond, Trophy, Gift, Attention, GridTwo,
  Shop, ShoppingCart, Car, Ship, MapDraw, Scissors,
  User, UserPositioning, Customer,
} from '@icon-park/vue-next'

/** 图标名 → 组件；key 即存库的 icon 字符串 */
export const ICON_REGISTRY: Record<string, Component> = {
  Folder, FolderOpen, FolderFocus, FolderDownload, FolderUpload, FolderSettings,
  FileText, FileEditing, Copy, CollectionFiles, TransactionOrder, Bookmark,
  BookOne, Book, Bookshelf, ReadBook, Notebook, NotebookOne, TagOne, Label,
  Link, LinkOne, CloudStorage,
  Edit, EditTwo, Pencil, Write,
  Comment, Comments, Message, MessageOne, MessageSuccess, Sleep, Microphone, AudioFile,
  ImageFiles, Camera, Music, MusicOne, VideoFile, VideoTwo, Film,
  Briefcase, Calendar, CalendarThree, Time, Alarm, List, ListView, ListCheckbox,
  ChartHistogram, ChartLine, Data, Dashboard, Wallet, Bill,
  Code, Config, Bug, Browser, Compass, Rocket, Cloudy, Download, Upload,
  System, SettingTwo, Setting, Tool,
  Star, Heart, Like, Fire, Lightning, Sun, Moon, Planet, Earth,
  Home, Add, Lock, Unlock, Key, KeyOne, Search, Target,
  Crown, Diamond, Trophy, Gift, Attention, GridTwo,
  Shop, ShoppingCart, Car, Ship, MapDraw, Scissors,
  User, UserPositioning, Customer,
}

export type IconTheme = 'outline' | 'filled'

/** 按场景分组（key 为 i18n 命名空间 iconPicker.group*） */
export const ICON_GROUPS: { key: string; icons: string[] }[] = [
  { key: 'folder', icons: ['Folder', 'FolderOpen', 'FolderFocus', 'FolderDownload', 'FolderUpload', 'FolderSettings', 'FileText', 'FileEditing', 'Copy', 'CollectionFiles', 'TransactionOrder', 'Bookmark'] },
  { key: 'note', icons: ['BookOne', 'Book', 'Bookshelf', 'ReadBook', 'Notebook', 'NotebookOne', 'TagOne', 'Label', 'Link', 'LinkOne', 'CloudStorage'] },
  { key: 'edit', icons: ['Edit', 'EditTwo', 'Pencil', 'Write'] },
  { key: 'chat', icons: ['Comment', 'Comments', 'Message', 'MessageOne', 'MessageSuccess', 'Sleep', 'Microphone', 'AudioFile'] },
  { key: 'media', icons: ['ImageFiles', 'Camera', 'Music', 'MusicOne', 'VideoFile', 'VideoTwo', 'Film'] },
  { key: 'work', icons: ['Briefcase', 'Calendar', 'CalendarThree', 'Time', 'Alarm', 'List', 'ListView', 'ListCheckbox', 'ChartHistogram', 'ChartLine', 'Data', 'Dashboard', 'Wallet', 'Bill'] },
  { key: 'tech', icons: ['Code', 'Config', 'Bug', 'Browser', 'Compass', 'Rocket', 'Cloudy', 'Download', 'Upload', 'System', 'SettingTwo', 'Setting', 'Tool'] },
  { key: 'symbol', icons: ['Star', 'Heart', 'Like', 'Fire', 'Lightning', 'Sun', 'Moon', 'Planet', 'Earth', 'Home', 'Add', 'Lock', 'Unlock', 'Key', 'KeyOne', 'Search', 'Target', 'Crown', 'Diamond', 'Trophy', 'Gift', 'Attention', 'GridTwo'] },
  { key: 'life', icons: ['Shop', 'ShoppingCart', 'Car', 'Ship', 'MapDraw', 'Scissors', 'User', 'UserPositioning', 'Customer'] },
]

/** 色板 8 色（钉钉工作区色板采样后精简：黑/绿/蓝/杏/红/紫/灰/淡紫） */
export const REFERENCE_PALETTE = [
  '#0d0d0d', '#579b6e', '#3b81e9', '#efb041', '#ec5b56',
  '#605ce5', '#8e8c98', '#b49ef9',
] as const

/** 解析图标：先查静态注册表，再查懒加载的全量库（reactive，模板内访问自动追踪） */
export const resolveIcon = (name?: string | null): Component | undefined =>
  (name && (ICON_REGISTRY[name] ?? iconLibrary[name])) || undefined

/* ------------------------------------------------------------------ */
/* 全量图标库（懒加载）+ 双语搜索                                       */
/* ------------------------------------------------------------------ */

interface IconparkIconMeta {
  title: string
  name: string
  category: string
  categoryCN: string
  tag?: string[]
}

export interface IconSearchHit {
  /** PascalCase 组件名（存库值，如 "FolderOpen"） */
  name: string
  /** 中文名（如 "文件夹打开"） */
  title: string
  /** 中文分类（如 "办公文档"） */
  categoryCN: string
}

/** 全量组件表（2658 个，按需动态 import 后填充） */
export const iconLibrary = reactive<Record<string, Component>>({})
export const iconLibraryReady = ref(false)
export const iconLibraryLoading = ref(false)

interface IconSearchEntry extends IconSearchHit {
  keywords: string
}

let libraryPromise: Promise<void> | null = null
let searchIndex: IconSearchEntry[] | null = null

const kebabToPascal = (name: string): string =>
  name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')

/**
 * 懒加载全量图标组件（es/map）+ 元数据索引（icons.json，含中文名/分类/标签）。
 * 重复调用复用同一 Promise；面性/线性由组件 theme prop 切换，无需分别加载。
 */
export const ensureIconLibrary = (): Promise<void> => {
  if (iconLibraryReady.value) return Promise.resolve()
  if (!libraryPromise) {
    iconLibraryLoading.value = true
    libraryPromise = Promise.all([
      import('@icon-park/vue-next/es/map'),
      import('@icon-park/vue-next/icons.json'),
    ])
      .then(([map, meta]) => {
        Object.assign(iconLibrary, map)
        const raw = (meta as { default: IconparkIconMeta[] }).default
        searchIndex = raw.map((m) => {
          const pascal = kebabToPascal(m.name)
          return {
            name: pascal,
            title: m.title,
            categoryCN: m.categoryCN,
            keywords: [m.name, pascal, m.title, m.category, m.categoryCN, ...(m.tag ?? [])]
              .join(' ')
              .toLowerCase(),
          }
        })
        iconLibraryReady.value = true
      })
      .finally(() => {
        iconLibraryLoading.value = false
      })
  }
  return libraryPromise
}

/**
 * 全库搜索（中英文均可：命中中文名/分类/标签/PascalCase/kebab-case 名）。
 * 索引未就绪时返回空数组；name/title 前缀命中优先。
 */
export const searchIcons = (query: string, limit = 80): IconSearchHit[] => {
  const trimmed = query.trim()
  const q = trimmed.toLowerCase()
  if (!searchIndex || !q) return []
  const scored: { hit: IconSearchEntry; score: number }[] = []
  for (const entry of searchIndex) {
    let score = 0
    if (entry.name.toLowerCase().startsWith(q) || entry.title.startsWith(trimmed)) score = 3
    else if (entry.keywords.includes(q)) score = 1
    else continue
    scored.push({ hit: entry, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(({ hit }) => ({ name: hit.name, title: hit.title, categoryCN: hit.categoryCN }))
}
