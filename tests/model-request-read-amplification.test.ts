import { describe, expect, it, vi } from 'vitest'
import type { ModelEvidenceSlice } from '../src/model-evidence'

const projections: ModelEvidenceSlice[] = []

vi.mock('../src/model-evidence', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/model-evidence')>()
  return {
    ...original,
    projectModelEvidence(slice: ModelEvidenceSlice) {
      projections.push(slice)
      return original.projectModelEvidence(slice)
    },
  }
})

const { StudioModelRequestStore, presentModelRequestListItem } = await import('../src/model-request')
const { buildStudioModelRequestTrajectoryFromStore } = await import('../src/model-request-trajectory')
const { KoishiDatabaseModelRequestPersistence } = await import('../src/persistence')
const { createEvidenceRecordDatabase } = await import('./helpers/fake-database')
const { openAiChatJsonResponse } = await import('./fixtures/model-protocol-fixtures')

type Store = InstanceType<typeof StudioModelRequestStore>

const presetSnapshot = {
  kind: 'character' as const,
  presetName: 'demo',
  capturedAt: '2026-08-28T00:00:00.000Z',
  templates: [{ path: ['system'], role: 'system' as const, template: '天气：{weather}' }],
}

function appendConversation(store: Store, count: number) {
  const appended = []
  for (let index = 0; index < count; index += 1) {
    appended.push(store.append({
      status: 'success',
      durationMs: 10 + index,
      provider: 'openai',
      model: 'gpt-4.1',
      attribution: 'attributed',
      entities: { botId: 'bot-1', conversationId: 'conversation-1' },
      requestBodyAvailable: true,
      requestBody: { messages: [{ role: 'system', content: '天气：晴' }, { role: 'user', content: '继续' }] },
      responseBodyStatus: 'complete',
      responseBodyFormat: 'json',
      responseBodyRaw: openAiChatJsonResponse,
      presetSnapshots: [presetSnapshot],
    }))
  }
  return appended
}

describe('模型请求读取放大', () => {
  it('会话轨迹对每条记录只运行一次共享模型证据投影', async () => {
    const store = new StudioModelRequestStore()
    const records = appendConversation(store, 4)
    const detail = (await store.getRecord(records[0]!.id))!
    projections.length = 0

    const trajectory = await buildStudioModelRequestTrajectoryFromStore({ record: detail, mode: 'conversation', store })

    expect(trajectory.records).toHaveLength(4)
    // 每条记录一次；派生变量与请求组成都复用同一份投影，不再各自构造一次详情。
    expect(projections).toHaveLength(4)
    expect(projections.every(({ requestBody }) => requestBody !== undefined)).toBe(true)
    // 变量与组成分段仍然出自那一份投影。
    expect(trajectory.rows.some(({ kind }) => kind === 'variable')).toBe(true)
    expect(trajectory.promptComposition.some(({ variableName }) => variableName === 'weather')).toBe(true)
  })

  it('列表读取不运行投影，也不取出请求体与响应原文', async () => {
    const database = createEvidenceRecordDatabase()
    const reads: Array<{ table: string, fields?: string[] }> = []
    const instrumented = {
      get: (table: string, query: Record<string, unknown>, cursor?: { fields?: string[] }) => {
        reads.push({ table, ...(cursor?.fields ? { fields: cursor.fields } : {}) })
        return database.get(table, query, cursor ?? {})
      },
      upsert: database.upsert.bind(database),
      remove: database.remove.bind(database),
    }
    const persistence = new KoishiDatabaseModelRequestPersistence(() => instrumented as never)
    const store = new StudioModelRequestStore({ persistence })
    await store.waitForReady()
    appendConversation(store, 3)
    await store.waitForPersistence()
    projections.length = 0
    reads.length = 0

    const page = await store.getRecords({ limit: 50 })

    expect(page.records).toHaveLength(3)
    expect(projections).toHaveLength(0)
    const recordReads = reads.filter(({ table }) => table === 'chatluna-studio.model-request')
    expect(recordReads.length).toBeGreaterThan(0)
    expect(recordReads.every(({ fields }) => fields?.includes('header') && !fields.includes('bodies'))).toBe(true)
    // 列表项仍然带着预设快照摘要：预设定位靠它在读取完整记录之前筛掉不相关的请求。
    expect(page.records[0]?.presetSnapshotSummaries).toEqual([{
      kind: 'character',
      presetName: 'demo',
      capturedAt: presetSnapshot.capturedAt,
      templateCount: 1,
    }])
  })

  it('列表投影不深拷贝请求体与响应原文', () => {
    const requestBody = { messages: [{ role: 'user', content: '你好' }] }
    const listItem = presentModelRequestListItem({
      id: 'record-1',
      sequence: 1,
      createdAt: '2026-08-28T00:00:00.000Z',
      status: 'success',
      durationMs: 1,
      attribution: 'attributed',
      entities: { },
      requestBodyAvailable: true,
      requestBody,
      responseBodyStatus: 'complete',
      responseBodyRaw: openAiChatJsonResponse,
    })

    expect(listItem).not.toHaveProperty('requestBody')
    expect(listItem).not.toHaveProperty('responseBodyRaw')
    expect(listItem.entities).not.toBe(undefined)
  })
})
