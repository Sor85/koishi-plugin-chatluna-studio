import { describe, expect, it } from 'vitest'
import {
  buildModelRequestBodyDownload,
  createModelRequestBodyCopy,
  MODEL_REQUEST_COPY_RESET_DELAY_MS,
  resolveModelRequestBodyText,
  serializeModelRequestBody,
  type ModelRequestBodySource,
} from '../client/model-request/body-transfer'

function source(overrides: Partial<ModelRequestBodySource> = {}): ModelRequestBodySource {
  return {
    id: 'record-1',
    requestBodyAvailable: true,
    requestBody: { model: 'gpt-4.1' },
    responseBodyStatus: 'complete',
    responseBodyRaw: '{"ok":true}',
    responseBodyFormat: 'json',
    ...overrides,
  }
}

function copyHarness(overrides: {
  clipboardWriter?: () => ((text: string) => Promise<void>) | undefined
  fallbackWrite?: (text: string) => void
} = {}) {
  const timers: Array<{ handler: () => void, timeout: number }> = []
  const cleared: number[] = []
  let nextId = 1
  const copier = createModelRequestBodyCopy({
    clipboardWriter: overrides.clipboardWriter ?? (() => undefined),
    fallbackWrite: overrides.fallbackWrite ?? (() => {}),
    setTimer: (handler, timeout) => {
      timers.push({ handler, timeout })
      return nextId++ as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: (id) => { cleared.push(id as unknown as number) },
  })
  return { copier, timers, cleared }
}

describe('模型请求正文取文与下载', () => {
  it('请求页签序列化请求体，响应页签给原文，分析页签没有正文', () => {
    expect(resolveModelRequestBodyText(source(), 'request')).toBe('{\n  "model": "gpt-4.1"\n}')
    expect(resolveModelRequestBodyText(source(), 'response')).toBe('{"ok":true}')
    expect(resolveModelRequestBodyText(source(), 'analysis')).toBe('')
    expect(resolveModelRequestBodyText(undefined, 'request')).toBe('')
  })

  it('请求体未采集或响应体未完成时没有正文，复制与下载据此禁用', () => {
    expect(resolveModelRequestBodyText(source({ requestBodyAvailable: false }), 'request')).toBe('')
    expect(resolveModelRequestBodyText(source({ requestBody: undefined }), 'request')).toBe('')
    expect(resolveModelRequestBodyText(source({ responseBodyStatus: 'pending' }), 'response')).toBe('')
    expect(resolveModelRequestBodyText(source({ responseBodyStatus: 'error' }), 'response')).toBe('')
    expect(resolveModelRequestBodyText(source({ responseBodyStatus: 'complete', responseBodyRaw: undefined }), 'response')).toBe('')
  })

  it('字符串正文原样保留，对象缩进两格，不可序列化的值退回字符串化', () => {
    expect(serializeModelRequestBody('已经是文本')).toBe('已经是文本')
    expect(serializeModelRequestBody({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}')
    expect(serializeModelRequestBody(undefined)).toBe('undefined')
  })

  it('下载文件名带记录标识与半区，扩展名跟着真实格式走', () => {
    expect(buildModelRequestBodyDownload(source(), 'request')).toEqual({
      fileName: 'model-request-record-1-request.json',
      mimeType: 'application/json;charset=utf-8',
      text: '{\n  "model": "gpt-4.1"\n}',
    })
    expect(buildModelRequestBodyDownload(source(), 'response')).toMatchObject({
      fileName: 'model-request-record-1-response.json',
      mimeType: 'application/json;charset=utf-8',
    })
    expect(buildModelRequestBodyDownload(source({
      responseBodyFormat: 'sse',
      responseBodyRaw: 'data: {}',
    }), 'response')).toMatchObject({
      fileName: 'model-request-record-1-response.txt',
      mimeType: 'text/plain;charset=utf-8',
      text: 'data: {}',
    })
  })

  it('记录标识里的路径与冒号收敛成连字符，否则文件名在 Windows 上存不下来', () => {
    expect(buildModelRequestBodyDownload(source({ id: 'space:1/req 88' }), 'request')?.fileName)
      .toBe('model-request-space-1-req-88-request.json')
  })

  it('没有正文时不给下载描述', () => {
    expect(buildModelRequestBodyDownload(source(), 'analysis')).toBeUndefined()
    expect(buildModelRequestBodyDownload(source({ requestBodyAvailable: false }), 'request')).toBeUndefined()
    expect(buildModelRequestBodyDownload(undefined, 'request')).toBeUndefined()
  })
})

describe('模型请求正文复制与降级', () => {
  it('安全上下文下用异步剪贴板，成功后提示一小会儿再自行归位', async () => {
    const written: string[] = []
    const { copier, timers } = copyHarness({
      clipboardWriter: () => async (text) => { written.push(text) },
      fallbackWrite: () => { throw new Error('不该走到降级') },
    })

    await copier.copy('正文')

    expect(written).toEqual(['正文'])
    expect(copier.state.value).toBe('success')
    expect(timers[0]?.timeout).toBe(MODEL_REQUEST_COPY_RESET_DELAY_MS)
    timers[0]?.handler()
    expect(copier.state.value).toBe('idle')
  })

  it('剪贴板被禁用时降级到同步复制，仍然算成功', async () => {
    const fallback: string[] = []
    const { copier } = copyHarness({
      clipboardWriter: () => async () => { throw new Error('NotAllowedError') },
      fallbackWrite: (text) => { fallback.push(text) },
    })

    await copier.copy('正文')

    expect(fallback).toEqual(['正文'])
    expect(copier.state.value).toBe('success')
  })

  it('浏览器根本没有剪贴板 API 时直接走降级，不先报失败', async () => {
    const fallback: string[] = []
    const { copier } = copyHarness({
      clipboardWriter: () => undefined,
      fallbackWrite: (text) => { fallback.push(text) },
    })

    await copier.copy('正文')

    expect(fallback).toEqual(['正文'])
    expect(copier.state.value).toBe('success')
  })

  it('只有降级也失败才报复制失败', async () => {
    const { copier } = copyHarness({
      clipboardWriter: () => async () => { throw new Error('NotAllowedError') },
      fallbackWrite: () => { throw new Error('浏览器拒绝复制') },
    })

    await copier.copy('正文')

    expect(copier.state.value).toBe('error')
  })

  it('空正文不触发任何一条路径', async () => {
    let attempts = 0
    const { copier, timers } = copyHarness({
      clipboardWriter: () => async () => { attempts += 1 },
      fallbackWrite: () => { attempts += 1 },
    })

    await copier.copy('')

    expect(attempts).toBe(0)
    expect(copier.state.value).toBe('idle')
    expect(timers).toHaveLength(0)
  })

  it('连续复制取消上一次的归位计时，reset 立刻回到无状态', async () => {
    const { copier, timers, cleared } = copyHarness({
      clipboardWriter: () => async () => {},
    })

    await copier.copy('第一次')
    await copier.copy('第二次')
    expect(cleared).toEqual([1])
    expect(copier.state.value).toBe('success')

    copier.reset()
    expect(cleared).toEqual([1, 2])
    expect(copier.state.value).toBe('idle')
    // 每次落定只排一个计时器，不会随复制次数堆积。
    expect(timers).toHaveLength(2)
  })
})
