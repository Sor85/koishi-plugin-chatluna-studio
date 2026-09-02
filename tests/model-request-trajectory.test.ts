import { describe, expect, it } from 'vitest'
import { StudioModelRequestStore } from '../src/model-request'
import { buildStudioModelRequestTrajectoryFromStore } from '../src/model-request-trajectory'
import {
  geminiGenerateContentRequest,
  openAiChatJsonResponse,
  openAiChatRequest,
  openAiResponsesRequest,
} from './fixtures/model-protocol-fixtures'

function createStore() {
  const store = new StudioModelRequestStore()
  const first = store.append({
    status: 'success',
    durationMs: 120,
    provider: 'openai',
    model: 'gpt-4.1',
    attribution: 'attributed',
    entities: { botId: 'bot-1', conversationId: 'conversation-1' },
    requestBodyAvailable: true,
    requestBody: openAiChatRequest,
    responseBodyStatus: 'complete',
    responseBodyFormat: 'json',
    responseBodyRaw: openAiChatJsonResponse,
  })
  const second = store.append({
    status: 'error',
    durationMs: 80,
    provider: 'anthropic',
    model: 'claude-test',
    attribution: 'attributed',
    entities: { botId: 'bot-1', conversationId: 'conversation-1' },
    requestBodyAvailable: true,
    requestBody: { messages: [{ role: 'user', content: '继续' }] },
    responseBodyStatus: 'unavailable',
  })
  return { store, first, second }
}

async function trajectoryFor(store: StudioModelRequestStore, recordId: string, mode: 'request' | 'conversation') {
  return buildStudioModelRequestTrajectoryFromStore({ record: (await store.getRecord(recordId))!, mode, store })
}

describe('模型请求轨迹投影', () => {
  it('把共享模型证据投影映射为请求边界、请求行与响应行', async () => {
    const { store, first } = createStore()
    const trajectory = await trajectoryFor(store, first.id, 'request')

    expect(trajectory.records).toHaveLength(1)
    expect(trajectory.rows.map(({ kind, source }) => ({ kind, source }))).toEqual([
      { kind: 'request', source: undefined },
      { kind: 'system', source: 'request' },
      { kind: 'user', source: 'request' },
      { kind: 'assistant', source: 'request' },
      { kind: 'tool-definition', source: 'request' },
      { kind: 'tool-call', source: 'request' },
      { kind: 'tool-result', source: 'request' },
      { kind: 'assistant', source: 'response' },
      { kind: 'assistant', source: 'response' },
      { kind: 'tool-call', source: 'response' },
    ])
    // 行种类是一维基础证据种类：判断这一行是定义、调用还是结果不需要读第二个字段。
    expect(trajectory.rows.every(row => !('toolEvent' in row))).toBe(true)
    expect(trajectory.rows.map(({ index }) => index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(trajectory.rows[0]).toMatchObject({ preview: 'openai / gpt-4.1 · 120 ms', status: 'success', requestId: first.id })
    expect(trajectory.rows[0]?.evidenceId).toBeUndefined()
  })

  it('轨迹行携带模型证据身份，请求与响应工具事件保留调用标识和工具名', async () => {
    const { store, first } = createStore()
    const trajectory = await trajectoryFor(store, first.id, 'request')

    expect(trajectory.rows.find(({ kind }) => kind === 'tool-definition')).toMatchObject({
      evidenceId: 'req:tool-definition:tools.0.function',
      toolName: 'lookup',
      preview: '工具定义 · lookup',
    })
    expect(trajectory.rows.find(({ callId }) => callId === 'call-1')).toMatchObject({
      evidenceId: 'req:tool-call:messages.2.tool_calls.0',
      kind: 'tool-call',
      source: 'request',
      toolName: 'lookup',
    })
    expect(trajectory.rows.find(({ kind, source }) => kind === 'tool-result' && source === 'request')).toMatchObject({
      evidenceId: 'req:message:messages.3',
      toolName: 'lookup',
      callId: 'call-1',
      source: 'request',
    })
    expect(trajectory.rows.filter(({ source }) => source === 'response')).toEqual([
      expect.objectContaining({ evidenceId: 'res:reasoning:choices.0.reasoning', preview: '思考 · 读取工具结果' }),
      expect.objectContaining({ evidenceId: 'res:content:choices.0.content', preview: '北京今天晴朗' }),
      expect.objectContaining({ evidenceId: 'res:tool-call:choices.0.tool_calls.0', callId: 'call-9', toolName: 'forecast' }),
    ])
    expect(trajectory.rows.every(({ id, requestId }) => id.startsWith(`${requestId}:`))).toBe(true)
  })

  it('请求组成统计与轨迹行共享同一模型证据身份', async () => {
    const { store, first } = createStore()
    const trajectory = await trajectoryFor(store, first.id, 'request')

    expect(trajectory.promptComposition).toEqual([
      { kind: 'system', evidenceId: 'req:message:messages.0', characters: 6 },
      { kind: 'user', evidenceId: 'req:message:messages.1', characters: 4 },
      { kind: 'tool-definition', evidenceId: 'req:tool-definition:tools.0.function', characters: 129 },
      { kind: 'assistant', evidenceId: 'req:message:messages.2', characters: 4 },
      { kind: 'tool-interaction', evidenceId: 'req:tool-call:messages.2.tool_calls.0', characters: 13 },
      { kind: 'tool-interaction', evidenceId: 'req:message:messages.3', characters: 1 },
    ])
    const rowEvidenceIds = new Set(trajectory.rows.flatMap(({ evidenceId }) => evidenceId ? [evidenceId] : []))
    for (const item of trajectory.promptComposition) {
      expect(rowEvidenceIds.has(item.evidenceId), item.evidenceId).toBe(true)
    }
  })

  it('按提示词出现顺序拆成多段，不把同类消息合并成一条轨道', async () => {
    const store = new StudioModelRequestStore()
    const record = store.append({
      status: 'success',
      durationMs: 10,
      attribution: 'unattributed',
      entities: {},
      requestBodyAvailable: true,
      requestBody: {
        messages: [
          { role: 'system', content: '系统' },
          { role: 'user', content: '第一问' },
          { role: 'assistant', content: '先答' },
          { role: 'user', content: '第二问' },
        ],
      },
      responseBodyStatus: 'unavailable',
    })

    expect((await trajectoryFor(store, record.id, 'request')).promptComposition).toEqual([
      { kind: 'system', evidenceId: 'req:message:messages.0', characters: 2 },
      { kind: 'user', evidenceId: 'req:message:messages.1', characters: 3 },
      { kind: 'assistant', evidenceId: 'req:message:messages.2', characters: 2 },
      { kind: 'user', evidenceId: 'req:message:messages.3', characters: 3 },
    ])
  })

  it('Gemini 与 Responses 请求同样区分工具声明和工具交互', async () => {
    const store = new StudioModelRequestStore()
    const gemini = store.append({
      status: 'success', durationMs: 10, attribution: 'unattributed', entities: {},
      requestBodyAvailable: true, requestBody: geminiGenerateContentRequest, responseBodyStatus: 'unavailable',
    })
    const responses = store.append({
      status: 'success', durationMs: 10, attribution: 'unattributed', entities: {},
      requestBodyAvailable: true, requestBody: openAiResponsesRequest, responseBodyStatus: 'unavailable',
    })

    for (const record of [gemini, responses]) {
      const { promptComposition } = await trajectoryFor(store, record.id, 'request')
      expect(promptComposition.find(({ kind }) => kind === 'tool-definition')?.characters).toBeGreaterThan(0)
      expect(promptComposition.find(({ kind }) => kind === 'tool-interaction')?.characters).toBeGreaterThan(0)
    }

    const geminiTrajectory = await trajectoryFor(store, gemini.id, 'request')
    expect(geminiTrajectory.rows.filter(({ kind }) => kind === 'system').map(({ preview, evidenceId }) => ({ preview, evidenceId }))).toEqual([
      { preview: 'Gemini 系统一', evidenceId: 'req:message:systemInstruction.parts.0' },
      { preview: 'Gemini 系统二', evidenceId: 'req:message:systemInstruction.parts.1' },
    ])
    expect(geminiTrajectory.rows.some(({ kind }) => kind === 'tool-definition')).toBe(true)
    expect(geminiTrajectory.promptComposition.map(({ kind }) => kind)).toEqual([
      'system',
      'system',
      'user',
      'tool-definition',
      'tool-interaction',
      'tool-interaction',
    ])
  })

  it('请求事件按分析页顺序排列，并在请求消息后展示 Variables', async () => {
    const store = new StudioModelRequestStore()
    const first = store.append({
      status: 'success',
      durationMs: 10,
      attribution: 'attributed',
      entities: { },
      requestBodyAvailable: true,
      requestBody: { messages: [{ role: 'system', content: '天气：晴' }, { role: 'user', content: '继续' }] },
      presetSnapshots: [{
        kind: 'character',
        presetName: 'demo',
        capturedAt: '2026-08-24T00:00:00.000Z',
        templates: [{ path: ['system'], role: 'system', template: '天气：{weather}' }],
      }],
      responseBodyStatus: 'unavailable',
    })

    const trajectory = await trajectoryFor(store, first.id, 'request')
    expect(trajectory.rows.map(({ kind, variableName }) => ({ kind, variableName }))).toEqual([
      { kind: 'request', variableName: undefined },
      { kind: 'system', variableName: undefined },
      { kind: 'user', variableName: undefined },
      { kind: 'variable', variableName: 'weather' },
    ])
    expect(trajectory.rows.find(({ kind }) => kind === 'variable')).toMatchObject({
      variableName: 'weather',
      variableValue: '晴',
      variableStatus: 'observed',
      variablePresetName: 'demo',
    })
    expect(trajectory.promptComposition).toEqual([
      { kind: 'system', evidenceId: 'req:message:messages.0', characters: 3 },
      {
        kind: 'user',
        evidenceId: expect.stringMatching(/^variable:/),
        characters: 1,
        variableId: expect.any(String),
        variableName: 'weather',
      },
      { kind: 'user', evidenceId: 'req:message:messages.1', characters: 2 },
    ])
    expect(trajectory.promptComposition.reduce((sum, item) => sum + item.characters, 0)).toBe(6)
  })

  it('把多个变量按实际范围拆成独立片段且不重复计算消息大小', async () => {
    const store = new StudioModelRequestStore()
    const first = store.append({
      status: 'success',
      durationMs: 10,
      attribution: 'attributed',
      entities: { },
      requestBodyAvailable: true,
      requestBody: { messages: [{ role: 'user', content: '城市北京，天气晴朗。' }] },
      presetSnapshots: [{
        kind: 'core',
        presetName: 'demo',
        capturedAt: '2026-08-24T00:00:00.000Z',
        templates: [{ path: ['prompts', 0, 'content'], role: 'user', template: '城市{city}，天气{weather}。' }],
      }],
      responseBodyStatus: 'unavailable',
    })

    const trajectory = await trajectoryFor(store, first.id, 'request')
    expect(trajectory.promptComposition.map(({ kind, characters, variableName }) => ({ kind, characters, variableName }))).toEqual([
      { kind: 'user', characters: 2, variableName: undefined },
      { kind: 'user', characters: 2, variableName: 'city' },
      { kind: 'user', characters: 3, variableName: undefined },
      { kind: 'user', characters: 2, variableName: 'weather' },
      { kind: 'user', characters: 1, variableName: undefined },
    ])
    expect(trajectory.promptComposition.reduce((sum, item) => sum + item.characters, 0)).toBe(10)
    expect(trajectory.promptComposition.filter(({ variableId }) => variableId).map(({ evidenceId }) => evidenceId))
      .toEqual(trajectory.rows.filter(({ kind }) => kind === 'variable').map(({ evidenceId }) => evidenceId))
  })

  it('按同一记录库和 conversationId 组成完整会话 Step，不混入其他会话', async () => {
    const { store, second } = createStore()
    store.append({
      status: 'success',
      durationMs: 20,
      attribution: 'attributed',
      entities: { conversationId: 'conversation-other' },
      requestBodyAvailable: false,
    })
    const trajectory = await trajectoryFor(store, second.id, 'conversation')

    expect(trajectory.mode).toBe('conversation')
    expect(trajectory.conversationId).toBe('conversation-1')
    expect(trajectory.records.map(({ sequence }) => sequence)).toEqual([1, 2])
    expect(trajectory.rows.filter(({ kind }) => kind === 'request')).toHaveLength(2)
    expect(trajectory.rows.some(({ kind }) => kind === 'tool-definition')).toBe(true)
    expect(trajectory.promptComposition.map(({ kind, requestId }) => ({ kind, requestId }))).toEqual([
      { kind: 'system', requestId: trajectory.records[0]?.id },
      { kind: 'user', requestId: trajectory.records[0]?.id },
      { kind: 'tool-definition', requestId: trajectory.records[0]?.id },
      { kind: 'assistant', requestId: trajectory.records[0]?.id },
      { kind: 'tool-interaction', requestId: trajectory.records[0]?.id },
      { kind: 'tool-interaction', requestId: trajectory.records[0]?.id },
      { kind: 'user', requestId: trajectory.records[1]?.id },
    ])
    // 会话轨迹里两条请求会出现同名证据身份；行 id 仍按记录区分，不会互相覆盖。
    expect(new Set(trajectory.rows.map(({ id }) => id)).size).toBe(trajectory.rows.length)
  })

  it('响应不可用或采集失败时不生成响应行', async () => {
    const { store, second } = createStore()
    const trajectory = await trajectoryFor(store, second.id, 'request')

    expect(trajectory.rows.some(({ source }) => source === 'response')).toBe(false)
    expect(trajectory.rows.map(({ kind }) => kind)).toEqual(['request', 'user'])
  })
})
