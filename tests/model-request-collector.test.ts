import { describe, expect, it, vi } from 'vitest'
import {
  installModelRequestCollector,
  isKnownChatModelRequestUrl,
  sanitizeModelRequestUrl,
  type ChatLunaPluginLike,
} from '../src/model-request-collector'
import { InMemoryModelRequestRecords, StudioModelRequestStore } from '../src/model-request'
import type { ChatLunaTurn } from '../src/chatluna/session-tracker'

/**
 * 模型请求采集器：在 ChatLuna 的 fetch 边界上记录每次模型调用。
 *
 * 采集器不认识 Koishi，也不认识会话跟踪器的内部状态——它只问「这次请求属于哪一轮」。因此这里用
 * 一个可直接改写的 turn 驱动归属，两种归属结果都能在没有 ChatLuna 运行时的情况下断言。
 */

function createStore() {
  return new StudioModelRequestStore({ persistence: new InMemoryModelRequestRecords() })
}

function createPlugin(respond: (info: unknown, init?: unknown) => Promise<unknown>) {
  const original = vi.fn(respond)
  const plugin = { prototype: { fetch: original } } as unknown as ChatLunaPluginLike
  return { plugin, original }
}

function jsonResponse(body: unknown, status = 200) {
  const raw = JSON.stringify(body)
  return {
    ok: status < 400,
    status,
    bodyUsed: false,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    clone: () => ({
      text: async () => raw,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    }),
  }
}

const groupTurn: ChatLunaTurn = {
  interactionId: 'turn-1',
  entities: {
    platform: 'onebot',
    botId: '10001',
    botName: '小助手',
    conversationId: '20002',
    conversationName: '测试群',
    conversationType: 'group',
    guildId: '20002',
    userId: '30003',
  },
}

const CHAT_URL = 'https://api.openai.com/v1/chat/completions'

describe('模型请求地址判定', () => {
  it('认得四种主流对话补全路径，认不出普通接口', () => {
    expect(isKnownChatModelRequestUrl(CHAT_URL)).toBe(true)
    expect(isKnownChatModelRequestUrl('https://api.anthropic.com/v1/messages')).toBe(true)
    expect(isKnownChatModelRequestUrl('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent')).toBe(true)
    expect(isKnownChatModelRequestUrl('https://api.openai.com/v1/responses')).toBe(true)
    expect(isKnownChatModelRequestUrl('https://api.openai.com/v1/embeddings')).toBe(false)
  })

  it('地址脱敏抹掉认证 query 与用户名密码，保留可复盘的地址本身', () => {
    expect(sanitizeModelRequestUrl(`${CHAT_URL}?api_key=secret&stream=true`))
      .toBe(`${CHAT_URL}?stream=true`)
    expect(sanitizeModelRequestUrl('https://user:pass@api.openai.com/v1/chat/completions'))
      .toBe(CHAT_URL)
  })
})

describe('模型请求采集器', () => {
  it('归属到一轮对话时写下会话实体与交互标识', async () => {
    const store = createStore()
    const { plugin } = createPlugin(async () => jsonResponse({ choices: [{ message: { content: '在' } }] }))
    const dispose = installModelRequestCollector({
      plugin,
      store,
      resolveTurn: () => groupTurn,
    })

    await plugin.prototype.fetch(CHAT_URL, {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4.1', messages: [{ role: 'user', content: '在吗' }] }),
    })
    await store.waitForPersistence()

    const [record] = (await store.getRecords({})).records
    expect(record?.attribution).toBe('attributed')
    expect(record?.entities.conversationName).toBe('测试群')
    expect(record?.interactionId).toBe('turn-1')
    expect(record?.model).toBe('gpt-4.1')
    expect(record?.provider).toBe('openai')
    expect(record?.status).toBe('success')
    dispose()
  })

  it('判不出归属时记成未归属，实体留空而不是猜一个', async () => {
    const store = createStore()
    const { plugin } = createPlugin(async () => jsonResponse({ ok: true }))
    const dispose = installModelRequestCollector({ plugin, store, resolveTurn: () => undefined })

    await plugin.prototype.fetch(CHAT_URL, { method: 'POST', body: '{"model":"gpt-4.1"}' })
    await store.waitForPersistence()

    const [record] = (await store.getRecords({})).records
    expect(record?.attribution).toBe('unattributed')
    expect(record?.entities).toEqual({})
    expect(record?.interactionId).toBeUndefined()
    dispose()
  })

  it('非对话请求原样透传，不产生记录', async () => {
    const store = createStore()
    const { plugin, original } = createPlugin(async () => jsonResponse({ data: [] }))
    const dispose = installModelRequestCollector({ plugin, store, resolveTurn: () => groupTurn })

    await plugin.prototype.fetch('https://api.openai.com/v1/embeddings', { method: 'POST', body: '{}' })
    await plugin.prototype.fetch(CHAT_URL, { method: 'GET' })
    await store.waitForPersistence()

    expect(original).toHaveBeenCalledTimes(2)
    expect((await store.getRecords({})).records).toHaveLength(0)
    dispose()
  })

  it('保存响应原文，HTTP 失败记成错误状态', async () => {
    const store = createStore()
    const { plugin } = createPlugin(async () => jsonResponse({ error: { message: '超出配额' } }, 429))
    const dispose = installModelRequestCollector({ plugin, store, resolveTurn: () => groupTurn })

    await plugin.prototype.fetch(CHAT_URL, { method: 'POST', body: '{"model":"gpt-4.1"}' })
    await store.waitForPersistence()

    const [listItem] = (await store.getRecords({})).records
    const detail = await store.requireRecord(listItem!.id)
    expect(detail.status).toBe('error')
    expect(detail.responseStatus).toBe(429)
    expect(detail.responseBodyStatus).toBe('complete')
    expect(detail.responseBodyRaw).toContain('超出配额')
    expect(detail.error?.retryable).toBe(false)
    dispose()
  })

  it('上游抛异常时记下错误并把异常继续抛给 ChatLuna', async () => {
    const store = createStore()
    const failure = new Error('connect ECONNRESET')
    const { plugin } = createPlugin(async () => { throw failure })
    const dispose = installModelRequestCollector({ plugin, store, resolveTurn: () => groupTurn })

    await expect(plugin.prototype.fetch(CHAT_URL, { method: 'POST', body: '{}' })).rejects.toBe(failure)
    await store.waitForPersistence()

    const [listItem] = (await store.getRecords({})).records
    const detail = await store.requireRecord(listItem!.id)
    expect(detail.status).toBe('error')
    // 可重试判定来自消息本身：连接被重置属于瞬时错误，值得在界面上与配置错误区分开。
    expect(detail.error?.retryable).toBe(true)
    dispose()
  })

  it('归属成功时带上运行时预设快照，并通知调用方有新记录', async () => {
    const store = createStore()
    const { plugin } = createPlugin(async () => jsonResponse({ ok: true }))
    const onRecordAppended = vi.fn()
    const getActivePresetSnapshots = vi.fn(() => [{
      kind: 'core' as const,
      presetName: '默认',
      capturedAt: new Date().toISOString(),
      templates: [{ path: ['prompts', 0, 'content'], role: 'system' as const, template: '你是{name}' }],
    }])
    const dispose = installModelRequestCollector({
      plugin,
      store,
      resolveTurn: () => groupTurn,
      getActivePresetSnapshots,
      onRecordAppended,
    })

    await plugin.prototype.fetch(CHAT_URL, { method: 'POST', body: '{"model":"gpt-4.1"}' })
    await store.waitForPersistence()

    expect(getActivePresetSnapshots).toHaveBeenCalledWith({ botId: '10001', conversationId: '20002' })
    expect(onRecordAppended).toHaveBeenCalledTimes(1)
    const [listItem] = (await store.getRecords({})).records
    expect(listItem?.presetSnapshotSummaries).toEqual([
      { kind: 'core', presetName: '默认', capturedAt: expect.any(String), templateCount: 1 },
    ])
    dispose()
  })

  it('未归属请求不去查预设快照：没有会话就没有「当前预设」可言', async () => {
    const store = createStore()
    const { plugin } = createPlugin(async () => jsonResponse({ ok: true }))
    const getActivePresetSnapshots = vi.fn(() => [])
    const dispose = installModelRequestCollector({
      plugin,
      store,
      resolveTurn: () => undefined,
      getActivePresetSnapshots,
    })

    await plugin.prototype.fetch(CHAT_URL, { method: 'POST', body: '{}' })
    await store.waitForPersistence()

    expect(getActivePresetSnapshots).not.toHaveBeenCalled()
    dispose()
  })

  it('卸载后恢复原始 fetch', async () => {
    const store = createStore()
    const { plugin, original } = createPlugin(async () => jsonResponse({ ok: true }))
    const dispose = installModelRequestCollector({ plugin, store, resolveTurn: () => groupTurn })
    expect(plugin.prototype.fetch).not.toBe(original)
    dispose()
    expect(plugin.prototype.fetch).toBe(original)
  })
})
