import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  STUDIO_EVIDENCE_READING_ORDER,
  studioEvidenceReadingGroup,
  studioEvidenceReadingRank,
  type StudioEvidenceReadingGroup,
} from '../src/evidence-reading-order'
import {
  MODEL_ANALYSIS_RESPONSE_TARGET,
  buildModelRequestAnalysisNavigation,
} from '../client/model-request/analysis'
import { parseModelRequestConversationDetail } from '../client/model-request/conversation'
import { buildStudioModelRequestTrajectory } from '../src/model-request-trajectory'
import type { StudioModelRequestDetail } from '../src/types'

/**
 * 证据阅读顺序是分析导航、分析卡片与轨迹账本三处共用的唯一先后。
 *
 * 值得守的原因是错位形态完全无声：三处各自排一次的时候，点导航里的 Assistant 会跳到卡片列表
 * 中段，Variable 明明排在 User 之后、卡片里却要翻过整段对话才见到，账本里的响应行又排在
 * 请求侧工具往返之后。三种先后同屏出现，不报错，只能靠人逐条比对。
 */

function detail(): StudioModelRequestDetail {
  return {
    id: 'request-7',
    sequence: 7,
    createdAt: '2026-09-01T02:00:00.000Z',
    status: 'success',
    durationMs: 120,
    provider: 'openai',
    model: 'gpt-5',
    attribution: 'unattributed',
    entities: {},
    requestBodyAvailable: true,
    requestBody: {
      messages: [
        { role: 'system', content: '遵守规则' },
        { role: 'user', content: '查询天气' },
        { role: 'assistant', content: '准备查询', tool_calls: [{ id: 'call-1', function: { name: 'weather', arguments: '{"city":"北京"}' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: '晴' },
      ],
      tools: [{ type: 'function', function: { name: 'weather', description: '查询天气', parameters: { type: 'object' } } }],
    },
    variables: [{
      id: 'variable-1',
      name: 'weather',
      presetKind: 'character',
      presetName: 'koishi',
      path: ['system'],
      occurrence: 0,
      status: 'observed',
      value: '晴',
      evidenceId: 'req:message:messages.0',
      range: { start: 0, end: 2 },
    }],
    responseBodyStatus: 'complete',
    responseBodyFormat: 'json',
    responseBodyRaw: JSON.stringify({ choices: [{ message: { content: '北京晴朗' }, finish_reason: 'stop' }] }),
  }
}

describe('证据阅读顺序', () => {
  it('声明的档位顺序把响应排在工具之前', () => {
    expect(STUDIO_EVIDENCE_READING_ORDER).toEqual([
      'system', 'user', 'variable', 'assistant', 'response', 'tool',
    ])
  })

  it('响应侧证据整体归 Response 一档', () => {
    for (const kind of ['assistant', 'tool-call', 'tool-result'] as const) {
      expect(studioEvidenceReadingGroup({ kind, source: 'response' })).toBe('response')
    }
  })

  it('三种工具证据在请求侧收成 Tool 一档', () => {
    for (const kind of ['tool-definition', 'tool-call', 'tool-result'] as const) {
      expect(studioEvidenceReadingGroup({ kind, source: 'request' })).toBe('tool')
    }
  })

  it('工具调用跟着发起它的那条消息', () => {
    expect(studioEvidenceReadingGroup({ kind: 'tool-call', parent: 'assistant' })).toBe('assistant')
    // 响应侧优先：整张响应卡片是一档，父档不能把它拆回 assistant。
    expect(studioEvidenceReadingGroup({ kind: 'tool-call', source: 'response', parent: 'assistant' })).toBe('response')
  })

  it('未知档位排在末尾而不是把已知档位顶下去', () => {
    expect(studioEvidenceReadingRank('system')).toBe(0)
    expect(studioEvidenceReadingRank('tool')).toBe(STUDIO_EVIDENCE_READING_ORDER.length - 1)
    expect(studioEvidenceReadingRank('未知' as StudioEvidenceReadingGroup)).toBe(STUDIO_EVIDENCE_READING_ORDER.length)
  })

  it('分析导航的分组顺序就是这一份声明的子序列', () => {
    const request = detail()
    const navigation = buildModelRequestAnalysisNavigation(parseModelRequestConversationDetail(request), request)
    const ranks = navigation.groups.map(({ key }) => studioEvidenceReadingRank(key))

    expect(navigation.groups.map(({ key }) => key)).toEqual([
      'system', 'user', 'variable', 'assistant', 'response', 'tool',
    ])
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right))
  })

  it('账本事件行与导航把同一条证据排在同一档', () => {
    const request = detail()
    const navigation = buildModelRequestAnalysisNavigation(parseModelRequestConversationDetail(request), request)
    const trajectory = buildStudioModelRequestTrajectory({ record: request, mode: 'request' })
    // 导航条目自带档位；响应正文、思考与用量只落在响应卡片上，没有独立条目，按目标反查。
    const groups = new Map(navigation.groups.flatMap(({ key, items }) => items.flatMap(
      item => item.evidenceId ? [[item.evidenceId, key] as const] : [],
    )))
    const groupOf = (evidenceId: string) => groups.get(evidenceId)
      ?? (navigation.targets[evidenceId] === MODEL_ANALYSIS_RESPONSE_TARGET ? 'response' : undefined)

    const ranks = trajectory.rows.flatMap((row) => {
      if (row.kind === 'request') return []
      const group = groupOf(row.evidenceId!)
      // 每一条账本行都必须在导航里找得到自己的档位，否则两侧的先后无从比较。
      expect(group, row.evidenceId).toBeDefined()
      return [studioEvidenceReadingRank(group!)]
    })

    expect(ranks.length).toBeGreaterThan(5)
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right))
  })

  it('分析视图右侧卡片分区从同一份声明铺开', () => {
    const view = readFileSync(resolve('client/model-request/analysis-view.vue'), 'utf8')

    expect(view).toContain('STUDIO_EVIDENCE_READING_ORDER.flatMap')
    expect(view).toContain('v-for="block in analysisBlocks"')
    expect(view).toContain('<template v-for="message in block.messages"')
    // 三块非消息分区各归自己那一档，不再固定接在消息列表末尾。
    expect(view).toContain('v-if="block.variables"')
    expect(view).toContain('v-if="block.response"')
    expect(view).toContain('v-if="block.tools"')
    expect(view).not.toContain('v-for="message in visibleMessages"')
  })
})
