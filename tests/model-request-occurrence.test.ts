import { describe, expect, it } from 'vitest'
import {
  isValidUtf16Range,
  modelRequestOccurrenceTargetId,
  renderModelRequestOccurrence,
  resolveModelRequestOccurrence,
} from '../client/model-request/occurrence'
import { parseModelRequestConversationDetail } from '../client/model-request/conversation'
import type { StudioModelRequestDetail } from '../src/types'

function detail(content: string): StudioModelRequestDetail {
  return {
    id: 'request-occurrence',
    sequence: 1,
    createdAt: '2026-08-24T00:00:00.000Z',
    status: 'success',
    durationMs: 10,
    provider: 'openai',
    model: 'gpt-5',
    attribution: 'unattributed',
    entities: {},
    requestBodyAvailable: true,
    requestBody: {
      messages: [{ role: 'user', content, reasoning: '不要定位到思考文本' }],
    },
    responseBodyStatus: 'unavailable',
    variables: [],
  }
}

describe('模型请求精确 occurrence', () => {
  it('按请求消息 content 的 UTF-16 范围派生确定 target', () => {
    const conversation = parseModelRequestConversationDetail(detail('前缀😀目标后缀'))
    const occurrence = resolveModelRequestOccurrence(
      conversation,
      'req:message:messages.0',
      { start: 4, end: 6 },
    )

    expect(occurrence).toEqual({
      evidenceId: 'req:message:messages.0',
      messageTarget: 'model-analysis-req:message:messages.0',
      target: 'model-analysis-req:message:messages.0--content-occurrence',
      range: { start: 4, end: 6 },
    })
    expect(modelRequestOccurrenceTargetId('req:message:messages.0')).toBe(occurrence?.target)
  })

  it('拒绝越界、反向、非整数和拆开 surrogate pair 的范围', () => {
    const value = 'A😀B'

    expect(isValidUtf16Range(value, { start: 1, end: 3 })).toBe(true)
    expect(isValidUtf16Range(value, { start: 2, end: 3 })).toBe(false)
    expect(isValidUtf16Range(value, { start: 1, end: 2 })).toBe(false)
    expect(isValidUtf16Range(value, { start: -1, end: 0 })).toBe(false)
    expect(isValidUtf16Range(value, { start: 3, end: 2 })).toBe(false)
    expect(isValidUtf16Range(value, { start: 0, end: 5 })).toBe(false)
    expect(isValidUtf16Range(value, { start: 0.5, end: 1 })).toBe(false)
  })

  it('只允许 request-message content，不能把范围套到其他证据或思考文字', () => {
    const conversation = parseModelRequestConversationDetail(detail('正文'))

    expect(resolveModelRequestOccurrence(conversation, 'req:message:messages.0', { start: 0, end: 2 })).toBeDefined()
    expect(resolveModelRequestOccurrence(conversation, 'req:message:messages.99', { start: 0, end: 0 })).toBeUndefined()
    expect(resolveModelRequestOccurrence(conversation, 'res:content:choices.0.content', { start: 0, end: 0 })).toBeUndefined()
    expect(resolveModelRequestOccurrence(conversation, 'req:message:messages.0', { start: 0, end: 8 })).toBeUndefined()
  })

  it('渲染专用 mark 且不改变 occurrence 前后正文', () => {
    const occurrence = {
      target: 'occurrence-target',
      range: { start: 2, end: 4 },
    }
    const rendered = renderModelRequestOccurrence('前缀目标后缀', occurrence) as any[]

    expect(rendered[0]).toBe('前缀')
    expect(rendered[2]).toBe('后缀')
    expect(rendered[1]).toMatchObject({
      type: 'mark',
      props: {
        id: 'occurrence-target',
        class: 'chatluna-studio-model-analysis-occurrence',
      },
      children: '目标',
    })
  })

  it('零长度范围渲染可见 caret mark，原文本仍只出现一次', () => {
    const rendered = renderModelRequestOccurrence('前后', {
      target: 'caret-target',
      range: { start: 1, end: 1 },
    }) as any[]

    expect(rendered[0]).toBe('前')
    expect(rendered[2]).toBe('后')
    expect(rendered[1]).toMatchObject({
      type: 'mark',
      props: {
        id: 'caret-target',
        class: 'chatluna-studio-model-analysis-occurrence is-caret',
      },
      children: '',
    })
    expect(rendered.filter(node => typeof node === 'string').join('')).toBe('前后')
  })
})
