import { describe, expect, it } from 'vitest'
import { resolvePresetExpressionObservedValue } from '../client/preset/expression-value'
import type { LocateStudioPresetExpressionResult } from '../src/presets'
import type { StudioModelRequestDetail } from '../src/types'

const located = {
  status: 'matched',
  recordId: 'record-1',
  evidenceId: 'req:message:contents.0',
  range: { start: 6, end: 11 },
} satisfies LocateStudioPresetExpressionResult

const detail: StudioModelRequestDetail = {
  id: 'record-1',
  sequence: 1,
  createdAt: '2026-08-23T04:28:13.000Z',
  status: 'success',
  durationMs: 10,
  attribution: 'attributed',
  entities: { botId: '20001', conversationId: 'group:30001' },
  requestBodyAvailable: true,
  requestBody: { contents: [{ role: 'user', parts: [{ text: 'Hello Alice.' }] }] },
  responseBodyStatus: 'complete',
  variables: [],
}

describe('预设表达式观察值', () => {
  it('从定位结果所指向的模型请求详情中读取观察值和请求时间', () => {
    expect(resolvePresetExpressionObservedValue(located, detail)).toEqual({
      status: 'matched',
      value: 'Alice',
      requestCreatedAt: '2026-08-23T04:28:13.000Z',
    })
  })

  it('定位失败时保留服务端说明，不读取请求详情', () => {
    expect(resolvePresetExpressionObservedValue({
      status: 'failed', code: 'request-not-observed', message: '没有匹配请求',
    })).toEqual({ status: 'failed', message: '没有匹配请求' })
  })
})
