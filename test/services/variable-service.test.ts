import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  VariableService,
  VARIABLE_EXPORT_FORMAT,
  type VariableImportPayload,
} from '../../src/renderer/lib/services/variable.service'

describe('VariableService', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
  })

  it('creates a multi-level group tree with paths', async () => {
    const service = new VariableService()
    const writing = await service.createGroup({ name: '写作' })
    await service.createGroup({ name: '中文润色', parentUuid: writing.uuid })
    await service.createGroup({ name: '开发' })

    const tree = await service.getGroupTree()
    expect(tree.map(node => node.name)).toEqual(['写作', '开发'])
    expect(tree[0].children?.map(node => node.name)).toEqual(['中文润色'])
    expect(tree[0].children?.[0].path).toEqual(['写作', '中文润色'])
  })

  it('rejects duplicate sibling names and cyclic moves', async () => {
    const service = new VariableService()
    const parent = await service.createGroup({ name: '父分组' })
    await service.createGroup({ name: '子分组', parentUuid: parent.uuid })

    await expect(service.createGroup({ name: '子分组', parentUuid: parent.uuid }))
      .rejects.toThrow('VARIABLE_GROUP_DUPLICATE')

    await expect(service.updateGroup(parent.uuid, { parentUuid: parent.uuid }))
      .rejects.toThrow('VARIABLE_GROUP_CYCLE')
  })

  it('refuses to delete a non-empty group unless recursive', async () => {
    const service = new VariableService()
    const group = await service.createGroup({ name: '分组' })
    await service.createVariable({ name: '变量', type: 'text', required: false, groupUuid: group.uuid })

    await expect(service.deleteGroup(group.uuid)).rejects.toThrow('VARIABLE_GROUP_NOT_EMPTY')

    await service.deleteGroup(group.uuid, { recursive: true })
    expect(await service.getAllVariables()).toEqual([])
    expect(await service.getGroupTree()).toEqual([])
  })

  it('enforces unique variable names inside a group but allows across groups', async () => {
    const service = new VariableService()
    const groupA = await service.createGroup({ name: 'A' })
    const groupB = await service.createGroup({ name: 'B' })

    await service.createVariable({ name: '主题', type: 'text', required: false, groupUuid: groupA.uuid })
    await expect(service.createVariable({ name: '主题', type: 'text', required: false, groupUuid: groupA.uuid }))
      .rejects.toThrow('VARIABLE_DUPLICATE')
    await expect(service.createVariable({ name: '主题', type: 'text', required: false, groupUuid: groupB.uuid }))
      .resolves.toBeTruthy()
  })

  it('includes descendant group variables when requested', async () => {
    const service = new VariableService()
    const parent = await service.createGroup({ name: '父' })
    const child = await service.createGroup({ name: '子', parentUuid: parent.uuid })
    await service.createVariable({ name: 'p', type: 'text', required: false, groupUuid: parent.uuid })
    await service.createVariable({ name: 'c', type: 'text', required: false, groupUuid: child.uuid })
    await service.createVariable({ name: 'u', type: 'text', required: false, groupUuid: null })

    const direct = await service.getVariables({ groupUuid: parent.uuid })
    expect(direct.map(v => v.name)).toEqual(['p'])

    const nested = await service.getVariables({ groupUuid: parent.uuid, includeDescendants: true })
    expect(nested.map(v => v.name).sort()).toEqual(['c', 'p'])
  })

  it('exports and re-imports groups and variables without loss', async () => {
    const service = new VariableService()
    const writing = await service.createGroup({ name: '写作', description: '写作相关' })
    await service.createGroup({ name: '润色', parentUuid: writing.uuid })
    await service.createVariable({
      name: '主题', type: 'text', required: true, groupUuid: writing.uuid,
      defaultValue: '默认', description: '主题描述', validation: { maxLength: 20 }
    })
    await service.createVariable({ name: '风格', type: 'select', required: false, groupUuid: null, options: ['正式', '轻松'] })

    const exported = await service.exportAll()
    expect(exported.format).toBe(VARIABLE_EXPORT_FORMAT)
    expect(exported.groups).toHaveLength(2)
    expect(exported.variables).toHaveLength(2)

    // 导入到全新数据库
    globalThis.indexedDB = new IDBFactory()
    const fresh = new VariableService()
    const summary = await fresh.importPayload(exported as VariableImportPayload, 'merge')
    expect(summary.warnings).toEqual([])
    expect(summary.groupsCreated).toBe(2)
    expect(summary.variablesCreated).toBe(2)

    const tree = await fresh.getGroupTree()
    expect(tree[0].children?.[0].path).toEqual(['写作', '润色'])
    const variables = await fresh.getAllVariables()
    const topic = variables.find(v => v.name === '主题')
    expect(topic?.groupUuid).toBeTruthy()
    expect(topic?.validation).toEqual({ maxLength: 20 })
  })

  it('merge mode updates existing variables, skip mode keeps them', async () => {
    const service = new VariableService()
    await service.createVariable({ name: '字数', type: 'number', required: false, defaultValue: '500' })

    const payload: VariableImportPayload = {
      format: VARIABLE_EXPORT_FORMAT,
      variables: [{ groupPath: [], name: '字数', type: 'number', defaultValue: '800' }]
    }
    const merged = await service.importPayload(payload, 'merge')
    expect(merged.variablesUpdated).toBe(1)
    expect((await service.getAllVariables())[0].defaultValue).toBe('800')

    payload.variables![0].defaultValue = '999'
    const skipped = await service.importPayload(payload, 'skip')
    expect(skipped.variablesSkipped).toBe(1)
    expect((await service.getAllVariables())[0].defaultValue).toBe('800')
  })

  it('normalizes type aliases and reports unknown types as warnings', async () => {
    const service = new VariableService()
    const summary = await service.importPayload({
      variables: [
        { groupPath: [], name: 'a', type: 'str' },
        { groupPath: [], name: 'b', type: 'int' },
        { groupPath: [], name: 'c', type: 'nonsense' }
      ]
    }, 'merge')
    expect(summary.variablesCreated).toBe(2)
    expect(summary.warnings).toHaveLength(1)
    const names = (await service.getAllVariables()).map(v => `${v.name}:${v.type}`)
    expect(names).toEqual(['a:text', 'b:number'])
  })

  it('parses CSV with headers and creates groups from paths', async () => {
    const service = new VariableService()
    const csv = [
      'groupPath,name,type,required,defaultValue,options,placeholder,description',
      '写作,主题,text,true,,,,文章主题',
      '"写作/中文润色",风格,select,false,正式,正式|轻松,,润色风格'
    ].join('\n')

    const payload = service.parseCsv(csv)
    const summary = await service.importPayload(payload, 'merge')
    expect(summary.warnings).toEqual([])
    expect(summary.groupsCreated).toBe(2)
    expect(summary.variablesCreated).toBe(2)

    const tree = await service.getGroupTree()
    expect(tree[0].children?.[0].path).toEqual(['写作', '中文润色'])
    const style = (await service.getAllVariables()).find(v => v.name === '风格')
    expect(style?.options).toEqual(['正式', '轻松'])
    expect(style?.defaultValue).toBe('正式')
  })

  it('scans prompt variables and absorbs them into the library with dedupe', async () => {
    const service = new VariableService()
    // 直接往 prompts / promptVariables 写入模拟数据
    const promptA = await (service as any).add('prompts', {
      uuid: 'p-a', title: '海边人像', content: 'x', tags: [], isFavorite: false,
      useCount: 0, isActive: true, createdAt: new Date(), updatedAt: new Date()
    })
    const promptB = await (service as any).add('prompts', {
      uuid: 'p-b', title: '夜景街拍', content: 'x', tags: [], isFavorite: false,
      useCount: 0, isActive: true, createdAt: new Date(), updatedAt: new Date()
    })
    const pv = (promptId: number, name: string, extra: Record<string, unknown> = {}) => ({
      uuid: `pv-${promptId}-${name}`, promptId, name, type: 'str', required: false,
      createdAt: new Date(), updatedAt: new Date(), ...extra
    })
    await (service as any).add('promptVariables', pv(promptA.id, '图片参数', { type: 'text', required: true, defaultValue: 'A' }))
    await (service as any).add('promptVariables', pv(promptA.id, '镜头视角', { type: 'select', options: ['俯拍'] }))
    await (service as any).add('promptVariables', pv(promptB.id, '图片参数', { type: 'str', options: ['raw'] }))

    const inventory = await service.scanPromptVariables()
    expect(inventory.map(item => item.name)).toEqual(['图片参数', '镜头视角'])
    const photo = inventory.find(item => item.name === '图片参数')!
    expect(photo.usageCount).toBe(2)
    expect(photo.promptTitles).toEqual(['海边人像', '夜景街拍'])
    expect(photo.required).toBe(true)
    expect(photo.type).toBe('text')

    // 收编：全部进「摄影」分组
    const group = await service.createGroup({ name: '摄影' })
    const result = await service.importPromptVariables(inventory, group.uuid)
    expect(result).toEqual({ created: 2, updated: 0 })
    const stored = await service.getVariables({ groupUuid: group.uuid })
    expect(stored.map(v => v.name).sort()).toEqual(['图片参数', '镜头视角'])

    // 再收编一次：同名合并更新而非重复创建
    const again = await service.importPromptVariables(await service.scanPromptVariables(), null)
    expect(again).toEqual({ created: 0, updated: 2 })
    const photoVar = (await service.getAllVariables()).find(v => v.name === '图片参数')!
    expect(photoVar.groupUuid).toBe(group.uuid)
    expect(photoVar.options).toEqual(['raw'])
  })

  it('generates downloadable JSON and CSV templates that import cleanly', async () => {
    const service = new VariableService()

    const freshDb = () => {
      globalThis.indexedDB = new IDBFactory()
      return new VariableService()
    }

    const jsonSummary = await freshDb().importPayload(
      JSON.parse(service.getJsonTemplate()) as VariableImportPayload, 'merge'
    )
    expect(jsonSummary.warnings).toEqual([])
    expect(jsonSummary.variablesCreated).toBe(4)
    expect(jsonSummary.groupsCreated).toBe(3)

    const csvService = freshDb()
    const csvSummary = await csvService.importPayload(csvService.parseCsv(service.getCsvTemplate()), 'merge')
    expect(csvSummary.warnings).toEqual([])
    expect(csvSummary.variablesCreated).toBe(4)
  })
})
