import { describe, expect, it } from 'vitest'
import {
  KoishiDatabaseModelRequestPersistence,
  registerStudioModelRequestModel,
  type StudioModelRequestDatabase,
} from '../src/persistence'
import {
  InMemoryModelRequestRecords,
  StudioModelRequestStore,
  estimateModelRequestRecordBytes,
  type StudioModelRequestPersistence,
} from '../src/model-request'
import type { StudioModelRequestRecord } from '../src/types'
import { FakeDatabase } from './helpers/fake-database'

/**
 * 数据库适配器与内存适配器必须给出等价结果。
 *
 * 两个适配器共用同一份过滤谓词与列表切片，但只有真实查询语义能证明它们等价，因此这里的替身把
 * 过滤交给 Minato 自己的 `executeQuery`，而不是替身重写一套近似匹配。
 */

const MODEL_REQUEST_TABLE = 'chatluna-studio.model-request'
const MODEL_REQUEST_STATE_TABLE = 'chatluna-studio.model-request-state'

function createDatabase() {
  const database = new FakeDatabase({
    [MODEL_REQUEST_TABLE]: ['sequence'],
    [MODEL_REQUEST_STATE_TABLE]: ['id'],
  })
  return database as unknown as StudioModelRequestDatabase & FakeDatabase
}

function createStore(persistence: StudioModelRequestPersistence, maxRecords = 100) {
  return new StudioModelRequestStore({ persistence, maxRecords })
}

async function appendRequest(
  store: StudioModelRequestStore,
  overrides: Partial<Pick<StudioModelRequestRecord, 'model' | 'status' | 'attribution' | 'entities'>> = {},
) {
  const record = store.append({
    status: overrides.status ?? 'success',
    durationMs: 12,
    method: 'POST',
    url: 'https://api.openai.com/v1/chat/completions',
    model: overrides.model ?? 'gpt-4.1',
    attribution: overrides.attribution ?? 'attributed',
    entities: overrides.entities ?? { platform: 'onebot', botId: '10001', conversationId: '20002', conversationType: 'group' },
    requestBodyAvailable: true,
    requestBody: { model: overrides.model ?? 'gpt-4.1', messages: [{ role: 'user', content: '在吗' }] },
    responseBodyStatus: 'complete',
    responseBodyRaw: '{"ok":true}',
  })
  await store.waitForPersistence()
  return record
}

describe('模型请求记录持久化', () => {
  it('落库后按序号恢复高水位，重启不与历史记录撞号', async () => {
    const database = createDatabase()
    const first = createStore(new KoishiDatabaseModelRequestPersistence(() => database))
    await first.waitForReady()
    const recorded = await appendRequest(first)
    expect(recorded.sequence).toBe(1)
    expect(database.countRows(MODEL_REQUEST_TABLE)).toBe(1)

    const restarted = createStore(new KoishiDatabaseModelRequestPersistence(() => database))
    await restarted.waitForReady()
    const next = await appendRequest(restarted)
    expect(next.sequence).toBe(2)
    const page = await restarted.getRecords({ order: 'asc' })
    expect(page.records.map(({ sequence }) => sequence)).toEqual([1, 2])
  })

  it('归属过滤在两个适配器上语义一致', async () => {
    // getter 必须解析到同一个库：每次调用都新建一个空库会让写入后的读取落在别的实例上。
    const database = createDatabase()
    for (const persistence of [
      new InMemoryModelRequestRecords(),
      new KoishiDatabaseModelRequestPersistence(() => database),
    ]) {
      const store = createStore(persistence)
      await store.waitForReady()
      await appendRequest(store, { attribution: 'attributed' })
      await appendRequest(store, { attribution: 'unattributed', entities: {} })

      const all = await store.getRecords({})
      const attributed = await store.getRecords({ attribution: 'attributed' })
      const unattributed = await store.getRecords({ attribution: 'unattributed' })
      expect(all.records).toHaveLength(2)
      expect(attributed.records.map(({ attribution }) => attribution)).toEqual(['attributed'])
      expect(unattributed.records.map(({ attribution }) => attribution)).toEqual(['unattributed'])
    }
  })

  it('列表读取只取记录头，请求体与响应原文留在存储里', async () => {
    const database = createDatabase()
    const store = createStore(new KoishiDatabaseModelRequestPersistence(() => database))
    await store.waitForReady()
    const record = await appendRequest(store)

    const page = await store.getRecords({})
    const [listItem] = page.records
    expect(listItem).toBeDefined()
    expect('requestBody' in listItem!).toBe(false)
    expect('responseBodyRaw' in listItem!).toBe(false)

    const detail = await store.requireRecord(record.id)
    expect(detail.requestBody).toBeDefined()
    expect(detail.responseBodyRaw).toBe('{"ok":true}')
  })

  it('超出条数上限时从最旧记录开始回收，容量统计跟着变', async () => {
    const database = createDatabase()
    const store = createStore(new KoishiDatabaseModelRequestPersistence(() => database), 2)
    await store.waitForReady()
    await appendRequest(store, { model: 'a' })
    await appendRequest(store, { model: 'b' })
    await appendRequest(store, { model: 'c' })

    const page = await store.getRecords({ order: 'asc' })
    expect(page.records.map(({ model }) => model)).toEqual(['b', 'c'])
    const capacity = await store.getCapacity()
    expect(capacity.recordCount).toBe(2)
    expect(capacity.maxRecords).toBe(2)
  })

  it('筛选可选值按最近记录聚合出机器人、会话与模型', async () => {
    const store = createStore(new InMemoryModelRequestRecords())
    await store.waitForReady()
    await appendRequest(store, {
      model: 'gpt-4.1',
      entities: { platform: 'onebot', botId: '10001', botName: '小助手', conversationId: '20002', conversationName: '测试群', conversationType: 'group' },
    })
    await appendRequest(store, {
      model: 'claude-sonnet-5',
      entities: { platform: 'onebot', botId: '10001', botName: '小助手', conversationId: 'private:30003', conversationType: 'private' },
    })
    await appendRequest(store, { attribution: 'unattributed', entities: {} })

    const facets = await store.getFacets()
    expect(facets.bots).toEqual([{ id: '10001', name: '小助手', platform: 'onebot' }])
    expect(facets.conversations.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'private:30003', type: 'private' },
      { id: '20002', type: 'group' },
    ])
    expect(facets.models).toEqual(['claude-sonnet-5', 'gpt-4.1'])
  })

  it('建表声明的主键是单调序号，状态表只有一行', () => {
    const extended: Array<{ table: string, primary: unknown }> = []
    registerStudioModelRequestModel({
      model: {
        extend: (table: string, _fields: unknown, options: { primary: unknown }) => {
          extended.push({ table, primary: options.primary })
        },
      },
    } as never)
    expect(extended).toEqual([
      { table: MODEL_REQUEST_TABLE, primary: 'sequence' },
      { table: MODEL_REQUEST_STATE_TABLE, primary: 'id' },
    ])
  })

  it('记录字节数按完整记录估算，回收判据与写入口径一致', async () => {
    const store = createStore(new InMemoryModelRequestRecords())
    await store.waitForReady()
    const record = await appendRequest(store)
    const capacity = await store.getCapacity()
    expect(capacity.totalBytes).toBe(estimateModelRequestRecordBytes({ ...record, sequence: 1 }))
  })
})
