import { describe, expect, it } from 'vitest'
import { StudioModelRequestStore } from '../src/model-request'
import { buildStudioModelRequestTrajectoryFromStore } from '../src/model-request-trajectory'
import {
  buildModelRequestAnalysisNavigation,
  modelAnalysisTargetId,
  resolveAnalysisEvidenceTarget,
} from '../client/model-request/analysis'
import { parseModelRequestConversationDetail } from '../client/model-request/conversation'
import {
  anthropicMessagesJsonResponse,
  anthropicMessagesRequest,
  geminiGenerateContentRequest,
  openAiChatJsonResponse,
  openAiChatRequest,
  openAiChatSseResponse,
  openAiResponsesJsonResponse,
  openAiResponsesRequest,
} from './fixtures/model-protocol-fixtures'

interface Fixture {
  name: string
  requestBody: unknown
  responseBodyRaw: string
  responseBodyFormat: 'json' | 'sse'
}

const FIXTURES: readonly Fixture[] = [
  { name: 'OpenAI Chat Completions', requestBody: openAiChatRequest, responseBodyRaw: openAiChatJsonResponse, responseBodyFormat: 'json' },
  { name: 'OpenAI Chat Completions SSE', requestBody: openAiChatRequest, responseBodyRaw: openAiChatSseResponse, responseBodyFormat: 'sse' },
  { name: 'OpenAI Responses', requestBody: openAiResponsesRequest, responseBodyRaw: openAiResponsesJsonResponse, responseBodyFormat: 'json' },
  { name: 'Anthropic Messages', requestBody: anthropicMessagesRequest, responseBodyRaw: anthropicMessagesJsonResponse, responseBodyFormat: 'json' },
  { name: 'Gemini generateContent', requestBody: geminiGenerateContentRequest, responseBodyRaw: openAiChatJsonResponse, responseBodyFormat: 'json' },
]

async function buildViews(fixture: Fixture) {
  const store = new StudioModelRequestStore()
  const appended = store.append({
    status: 'success',
    durationMs: 120,
    provider: 'custom-gateway',
    model: 'model-under-test',
    attribution: 'attributed',
    entities: { conversationId: 'conversation-1' },
    requestBodyAvailable: true,
    requestBody: fixture.requestBody,
    responseBodyStatus: 'complete',
    responseBodyFormat: fixture.responseBodyFormat,
    responseBodyRaw: fixture.responseBodyRaw,
  })
  const detail = (await store.getRecord(appended.id))!
  const trajectory = await buildStudioModelRequestTrajectoryFromStore({ record: detail, mode: 'request', store })
  const conversation = parseModelRequestConversationDetail(detail)
  const navigation = buildModelRequestAnalysisNavigation(conversation, detail)
  return { detail, trajectory, conversation, navigation }
}

describe('模型证据身份跨视图契约', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name} 的轨迹行、组成分段与分析目标指向同一条证据`, async () => {
      const { trajectory, conversation, navigation } = await buildViews(fixture)

      const rowEvidenceIds = trajectory.rows.flatMap(({ evidenceId }) => evidenceId ? [evidenceId] : [])
      expect(rowEvidenceIds.length).toBeGreaterThan(0)
      for (const evidenceId of rowEvidenceIds) {
        expect(resolveAnalysisEvidenceTarget(navigation, evidenceId), evidenceId).toBeDefined()
      }
      for (const item of trajectory.promptComposition) {
        expect(resolveAnalysisEvidenceTarget(navigation, item.evidenceId), item.evidenceId).toBeDefined()
      }

      // 请求消息的身份在服务端轨迹和客户端卡片之间完全一致。
      // 只含工具调用、没有可见正文的消息不单独占账本行——它的工具调用行才是该证据的入口，
      // 否则同一次调用会同时出现在 ASSISTANT 和 TOOL CALL 两行。
      const messageIds = new Set(conversation.messages.map(({ evidenceId }) => evidenceId))
      const rowMessageIds = trajectory.rows.flatMap(row => (
        row.source === 'request' && row.kind !== 'tool-definition' && row.kind !== 'tool-call' && row.evidenceId
          ? [row.evidenceId]
          : []
      ))
      for (const evidenceId of rowMessageIds) expect(messageIds.has(evidenceId), evidenceId).toBe(true)
      for (const message of conversation.messages) {
        if (!message.content && !message.reasoning) continue
        expect(rowMessageIds, message.evidenceId).toContain(message.evidenceId)
      }
      const callIds = new Set(conversation.messages.flatMap(({ toolCalls }) => toolCalls.map(({ evidenceId }) => evidenceId)))
      expect(new Set(trajectory.rows.flatMap(row => (
        row.source === 'request' && row.kind === 'tool-call' && row.evidenceId ? [row.evidenceId] : []
      )))).toEqual(callIds)
      expect(conversation.tools.map(({ evidenceId }) => evidenceId))
        .toEqual(trajectory.rows.flatMap(row => row.kind === 'tool-definition' && row.evidenceId ? [row.evidenceId] : []))
    })
  }

  it('请求工具调用与响应工具事件都能从轨迹定位到具体分析卡片', async () => {
    const { trajectory, conversation, navigation } = await buildViews(FIXTURES[0]!)

    const requestCall = trajectory.rows.find(row => row.source === 'request' && row.kind === 'tool-call')!
    expect(resolveAnalysisEvidenceTarget(navigation, requestCall.evidenceId))
      .toBe(modelAnalysisTargetId(conversation.messages.flatMap(({ toolCalls }) => toolCalls)[0]!.evidenceId))

    const responseCall = trajectory.rows.find(row => row.source === 'response' && row.kind === 'tool-call')!
    expect(resolveAnalysisEvidenceTarget(navigation, responseCall.evidenceId))
      .toBe(modelAnalysisTargetId(conversation.response!.toolCalls[0]!.evidenceId))

    const responseContent = trajectory.rows.find(row => row.source === 'response' && row.kind === 'assistant')!
    expect(resolveAnalysisEvidenceTarget(navigation, responseContent.evidenceId)).toBe('model-analysis-response')
  })

  it('多个 SSE 分片合并出的响应事实仍然定位到同一目标并保留全部来源', async () => {
    const { trajectory, conversation, navigation } = await buildViews(FIXTURES[1]!)
    const contentRows = trajectory.rows.filter(row => row.source === 'response' && row.kind === 'assistant')

    expect(contentRows.map(({ preview }) => preview)).toEqual(['思考 · 思考', '北京晴'])
    for (const row of contentRows) {
      expect(resolveAnalysisEvidenceTarget(navigation, row.evidenceId)).toBe('model-analysis-response')
    }
    expect(conversation.response?.content).toEqual(['北京晴'])
    expect(conversation.response?.reasoning).toEqual(['思考'])
  })

  it('展示用 provider 与模型名不参与协议识别，同一份证据在自定义网关下结果不变', async () => {
    const gateway = await buildViews(FIXTURES[0]!)
    const store = new StudioModelRequestStore()
    const appended = store.append({
      status: 'success',
      durationMs: 120,
      provider: '127.0.0.1:1234',
      model: 'unknown-alias',
      attribution: 'unattributed',
      entities: {},
      requestBodyAvailable: true,
      requestBody: openAiChatRequest,
      responseBodyStatus: 'complete',
      responseBodyFormat: 'json',
      responseBodyRaw: openAiChatJsonResponse,
    })
    const trajectory = await buildStudioModelRequestTrajectoryFromStore({ record: (await store.getRecord(appended.id))!, mode: 'request', store })

    expect(trajectory.rows.map(({ evidenceId }) => evidenceId))
      .toEqual(gateway.trajectory.rows.map(({ evidenceId }) => evidenceId))
  })

  it('pending 请求补齐响应后，已有请求证据身份保持稳定', async () => {
    const store = new StudioModelRequestStore()
    const appended = store.append({
      status: 'pending',
      durationMs: 0,
      attribution: 'unattributed',
      entities: {},
      requestBodyAvailable: true,
      requestBody: openAiChatRequest,
      responseBodyStatus: 'pending',
    })
    const before = await buildStudioModelRequestTrajectoryFromStore({ record: (await store.getRecord(appended.id))!, mode: 'request', store })
    store.update(appended.id, {
      status: 'success',
      durationMs: 120,
      responseBodyStatus: 'complete',
      responseBodyFormat: 'json',
      responseBodyRaw: openAiChatJsonResponse,
    })
    const after = await buildStudioModelRequestTrajectoryFromStore({ record: (await store.getRecord(appended.id))!, mode: 'request', store })

    const requestIdsBefore = before.rows.filter(row => row.source === 'request').map(({ evidenceId }) => evidenceId)
    const requestIdsAfter = after.rows.filter(row => row.source === 'request').map(({ evidenceId }) => evidenceId)
    expect(requestIdsAfter).toEqual(requestIdsBefore)
    expect(after.rows.some(row => row.source === 'response')).toBe(true)
  })
})
