import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerConsole, resolveConsoleEntry, type StudioConsoleRegistrar } from '../src/console'
import { InMemoryModelRequestRecords, StudioModelRequestStore } from '../src/model-request'
import { StudioPresetService } from '../src/presets'
import type { StudioAppearance, StudioPersistenceStatus } from '../src/types'

/**
 * Console 端点：契约里的每个端点都必须真的注册，并且入参出参与契约一致。
 *
 * 这里用一个记录调用的 registrar 替身，而不是启动真实控制台：端点集合、鉴权级别与「范围怎么翻译
 * 成归属过滤」都是本插件自己的决定，它们不需要 Koishi 的 WebSocket 才能被证明。
 */

interface RegisteredListener {
  event: string
  callback: (...args: unknown[]) => unknown
  authority: number
}

function createRegistrar() {
  const listeners: RegisteredListener[] = []
  const entries: unknown[] = []
  const broadcasts: Array<{ type: string, body: unknown }> = []
  const registrar: StudioConsoleRegistrar = {
    addEntry: (entry) => { entries.push(entry); return entry },
    addListener: (event, callback, options) => {
      listeners.push({ event, callback: callback as (...args: unknown[]) => unknown, authority: options.authority })
      return undefined
    },
    broadcast: (type, body) => { broadcasts.push({ type, body }); return undefined },
  }
  const invoke = async (event: string, ...args: unknown[]) => {
    const listener = listeners.find((candidate) => candidate.event === event)
    if (!listener) throw new Error(`端点未注册：${event}`)
    return listener.callback(...args)
  }
  return { registrar, listeners, entries, broadcasts, invoke }
}

const appearance: StudioAppearance = {
  enableStudioFrostedGlass: true,
  studioColorMode: 'auto',
  studioAccentColor: '#2563eb',
  studioUseQQAvatars: true,
}

const persistence: StudioPersistenceStatus = { mode: 'memory', available: true, persisted: false }

async function createPresetRoot() {
  const baseDir = await mkdtemp(join(tmpdir(), 'chatluna-studio-console-'))
  await mkdir(join(baseDir, 'data/chathub/presets'), { recursive: true })
  await writeFile(
    join(baseDir, 'data/chathub/presets/default.yml'),
    'keywords:\n  - 默认\nprompts:\n  - role: system\n    content: 你是{name}\n',
    'utf8',
  )
  return baseDir
}

async function setup() {
  const modelRequests = new StudioModelRequestStore({ persistence: new InMemoryModelRequestRecords() })
  await modelRequests.waitForReady()
  const baseDir = await createPresetRoot()
  const presets = new StudioPresetService({ baseDir, modelRequests })
  const harness = createRegistrar()
  const notifyRecorded = registerConsole(harness.registrar, {
    modelRequests,
    presets,
    appearance,
    getPersistenceStatus: () => persistence,
  })
  return { ...harness, modelRequests, presets, notifyRecorded, baseDir }
}

function appendRequest(
  store: StudioModelRequestStore,
  attribution: 'attributed' | 'unattributed',
  conversationId?: string,
) {
  return store.append({
    status: 'success',
    durationMs: 8,
    method: 'POST',
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4.1',
    attribution,
    entities: conversationId
      ? { platform: 'onebot', botId: '10001', conversationId, conversationType: 'group' }
      : {},
    requestBodyAvailable: true,
    requestBody: { model: 'gpt-4.1', messages: [{ role: 'user', content: '在吗' }] },
    responseBodyStatus: 'complete',
    responseBodyRaw: '{"choices":[{"message":{"content":"在"}}]}',
  })
}

describe('Console 端点', () => {
  it('注册前端入口与契约里的全部端点，鉴权级别一致为 4', async () => {
    const { entries, listeners } = await setup()
    expect(entries).toHaveLength(1)
    expect(listeners.map(({ event }) => event)).toEqual([
      'chatluna-studio/workspace',
      'chatluna-studio/model-request-records',
      'chatluna-studio/model-request-record',
      'chatluna-studio/model-request-trajectory',
      'chatluna-studio/model-request-facets',
      'chatluna-studio/clear-model-request-records',
      'chatluna-studio/preset-catalog',
      'chatluna-studio/preset-read',
      'chatluna-studio/preset-create',
      'chatluna-studio/preset-save',
      'chatluna-studio/preset-rename',
      'chatluna-studio/preset-delete',
      'chatluna-studio/preset-locate-expression',
    ])
    expect(new Set(listeners.map(({ authority }) => authority))).toEqual(new Set([4]))
  })

  it('工作区端点交出外观与持久化状态', async () => {
    const { invoke } = await setup()
    expect(await invoke('chatluna-studio/workspace')).toEqual({ appearance, persistence })
  })

  it('范围翻译成归属过滤：全部不过滤，另外两个各自只读一类', async () => {
    const { invoke, modelRequests } = await setup()
    appendRequest(modelRequests, 'attributed', '20002')
    appendRequest(modelRequests, 'unattributed')
    await modelRequests.waitForPersistence()

    const all = await invoke('chatluna-studio/model-request-records', { scope: 'all' }) as { records: unknown[] }
    const attributed = await invoke('chatluna-studio/model-request-records', { scope: 'attributed' }) as { records: { attribution: string }[] }
    const unattributed = await invoke('chatluna-studio/model-request-records', { scope: 'unattributed' }) as { records: { attribution: string }[] }
    expect(all.records).toHaveLength(2)
    expect(attributed.records.map(({ attribution }) => attribution)).toEqual(['attributed'])
    expect(unattributed.records.map(({ attribution }) => attribution)).toEqual(['unattributed'])
  })

  it('详情与轨迹按记录标识读取，读不到时抛领域拒绝', async () => {
    const { invoke, modelRequests } = await setup()
    const record = appendRequest(modelRequests, 'attributed', '20002')
    await modelRequests.waitForPersistence()

    const detail = await invoke('chatluna-studio/model-request-record', { recordId: record.id }) as { id: string, variables: unknown[] }
    expect(detail.id).toBe(record.id)
    expect(detail.variables).toEqual([])

    const trajectory = await invoke('chatluna-studio/model-request-trajectory', { recordId: record.id, mode: 'request' }) as { mode: string, rows: unknown[] }
    expect(trajectory.mode).toBe('request')
    expect(trajectory.rows.length).toBeGreaterThan(0)

    await expect(invoke('chatluna-studio/model-request-record', { recordId: '不存在' }))
      .rejects.toThrow('模型请求记录不存在')
  })

  it('筛选可选值与清理都作用在同一个记录库上', async () => {
    const { invoke, modelRequests } = await setup()
    appendRequest(modelRequests, 'attributed', '20002')
    await modelRequests.waitForPersistence()

    const facets = await invoke('chatluna-studio/model-request-facets') as { bots: unknown[], conversations: unknown[] }
    expect(facets.bots).toHaveLength(1)
    expect(facets.conversations).toHaveLength(1)

    expect(await invoke('chatluna-studio/clear-model-request-records')).toEqual({ cleared: 1 })
    const cleared = await invoke('chatluna-studio/model-request-records', { scope: 'all' }) as { records: unknown[] }
    expect(cleared.records).toHaveLength(0)
  })

  it('预设端点读到磁盘上的真实预设目录', async () => {
    const { invoke } = await setup()
    const catalog = await invoke('chatluna-studio/preset-catalog') as Array<{ kind: string, fileName: string, displayName?: string }>
    expect(catalog).toEqual([
      expect.objectContaining({ kind: 'core', fileName: 'default.yml', displayName: '默认' }),
    ])

    const document = await invoke('chatluna-studio/preset-read', { kind: 'core', fileName: 'default.yml' }) as { source: string }
    expect(document.source).toContain('你是{name}')
  })

  it('表达式定位在没有可证明请求时给出结构化失败，而不是抛异常', async () => {
    const { invoke } = await setup()
    const document = await invoke('chatluna-studio/preset-read', { kind: 'core', fileName: 'default.yml' }) as {
      revision: string
      expressions: { stableId: string }[]
    }
    const result = await invoke('chatluna-studio/preset-locate-expression', {
      document: { kind: 'core', fileName: 'default.yml', revision: document.revision },
      expression: { stableId: document.expressions[0]!.stableId },
    }) as { status: string, code: string }
    expect(result).toEqual({ status: 'failed', code: 'request-not-observed', message: expect.any(String) })
  })

  it('新记录通知走广播频道，载荷只带序号', async () => {
    const { broadcasts, notifyRecorded } = await setup()
    notifyRecorded(7)
    expect(broadcasts).toEqual([{ type: 'chatluna-studio/model-request-recorded', body: { sequence: 7 } }])
  })

  it('前端入口优先取工作区内的安装路径，回退到模块目录', () => {
    const entry = resolveConsoleEntry('/不存在的工作区')
    expect(entry.dev.endsWith('client/index.ts')).toBe(true)
    expect(entry.prod.endsWith('dist')).toBe(true)
  })
})
