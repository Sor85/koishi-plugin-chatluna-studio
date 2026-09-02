import { describe, expect, it } from 'vitest'
import { buildModelRequestAnalysisNavigation, modelAnalysisTargetId } from '../client/model-request/analysis'
import { parseModelRequestConversationDetail } from '../client/model-request/conversation'
import { createEvidenceLocator, type EvidenceMeasurement } from '../client/shared/evidence-locator'
import type { StudioModelRequestDetail } from '../src/types'

function detail(): StudioModelRequestDetail {
  return {
    id: 'request-9',
    sequence: 9,
    createdAt: '2026-08-20T02:00:00.000Z',
    status: 'success',
    durationMs: 245,
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
    responseBodyStatus: 'complete',
    responseBodyFormat: 'json',
    responseBodyRaw: JSON.stringify({ choices: [{ message: { content: '北京晴朗' }, finish_reason: 'stop' }] }),
    variables: [],
  }
}

const SYSTEM_TARGET = modelAnalysisTargetId('req:message:messages.0')
const USER_TARGET = modelAnalysisTargetId('req:message:messages.1')
const ASSISTANT_TARGET = modelAnalysisTargetId('req:message:messages.2')
const TOOL_CALL_TARGET = modelAnalysisTargetId('req:tool-call:messages.2.tool_calls.0')
const RESPONSE_TARGET = 'model-analysis-response'
const TOOLS_TARGET = 'model-analysis-tools'

/**
 * 假 adapter：把布局换成一张数字表，把 nextTick、帧、ResizeObserver 与定时器换成可手动推进的队列。
 * 真实浏览器里这些都由 analysis-view.vue 提供，jsdom 无法替代（getBoundingClientRect 恒为 0）。
 */
function createHarness(request: StudioModelRequestDetail = detail()) {
  const conversation = parseModelRequestConversationDetail(request)
  const navigation = buildModelRequestAnalysisNavigation(conversation, request)

  const elementTops = new Map<string, number>()
  const scroller = { top: 100, scrollTop: 0 }
  const scrolls: Array<{ top: number, behavior: ScrollBehavior }> = []
  const expandedCards = new Set<string>()
  const expandedTools = new Set<string>()
  const rawMessages = new Set<string>()
  let responseRaw = false
  let expandedText: readonly string[] = []
  let occurrenceTarget: string | undefined
  let highlight: string | undefined
  const resizeListeners = new Set<() => void>()
  const timers: Array<{ delayMs: number, callback: () => void, cancelled: boolean }> = []

  const locator = createEvidenceLocator({
    getConversation: () => conversation,
    getNavigation: () => navigation,
    setOccurrenceTarget: (occurrence) => {
      occurrenceTarget = occurrence?.target
    },
    measure: (target): EvidenceMeasurement | undefined => {
      const elementTop = elementTops.get(target)
      if (elementTop === undefined) return undefined
      return { elementTop, scrollerTop: scroller.top, scrollTop: scroller.scrollTop }
    },
    scrollTo: (top, behavior) => {
      scrolls.push({ top, behavior })
      scroller.scrollTop = top
    },
    // 视图侧的展开是幂等的 Set 写入；这里同样用 Set，避免把重复写入误判成行为差异。
    expandCard: target => expandedCards.add(target),
    setToolExpanded: evidenceId => expandedTools.add(evidenceId),
    isMessageRaw: evidenceId => rawMessages.has(evidenceId),
    setMessageRaw: (evidenceId, raw) => {
      raw ? rawMessages.add(evidenceId) : rawMessages.delete(evidenceId)
    },
    isResponseRaw: () => responseRaw,
    setResponseRaw: (raw) => {
      responseRaw = raw
    },
    getExpandedText: () => expandedText,
    setExpandedText: (targets) => {
      expandedText = [...targets]
    },
    setHighlight: (target) => {
      highlight = target
    },
    nextTick: () => Promise.resolve(),
    frame: () => Promise.resolve(),
    observeResize: (callback) => {
      resizeListeners.add(callback)
      return () => resizeListeners.delete(callback)
    },
    schedule: (delayMs, callback) => {
      const timer = { delayMs, callback, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  })

  return {
    locator,
    scrolls,
    scroller,
    timers,
    rawMessages,
    get expandedCards() {
      return [...expandedCards]
    },
    get expandedTools() {
      return [...expandedTools]
    },
    get responseRaw() {
      return responseRaw
    },
    get expandedText() {
      return expandedText
    },
    get occurrenceTarget() {
      return occurrenceTarget
    },
    get highlight() {
      return highlight
    },
    /** 仍然有效的高亮到期回调数量；被新定位取消的不计入。 */
    pendingHighlightTimers() {
      return timers.filter(timer => timer.delayMs === 1500 && !timer.cancelled).length
    },
    setElementTop(target: string, top: number) {
      elementTops.set(target, top)
    },
    markMessageRaw(evidenceId: string) {
      rawMessages.add(evidenceId)
    },
    markResponseRaw() {
      responseRaw = true
    },
    resize() {
      for (const listener of [...resizeListeners]) listener()
    },
    fire(delayMs: number) {
      for (const timer of timers.filter(candidate => candidate.delayMs === delayMs && !candidate.cancelled)) {
        timer.cancelled = true
        timer.callback()
      }
    },
  }
}

describe('证据定位', () => {
  it('展开目标卡片并滚动到按测量数字算出的位置', async () => {
    const harness = createHarness()
    harness.setElementTop(USER_TARGET, 500)

    expect(await harness.locator.locate(USER_TARGET)).toBe(USER_TARGET)
    expect(harness.expandedCards).toEqual([USER_TARGET])
    // 500（元素顶）- 100（容器顶）+ 0（当前滚动量）- 12（留白）
    expect(harness.scrolls).toEqual([{ top: 388, behavior: 'smooth' }])
  })

  it('定位到工具调用时展开它所在的消息卡片', async () => {
    const harness = createHarness()
    harness.setElementTop(TOOL_CALL_TARGET, 900)

    await harness.locator.locate(TOOL_CALL_TARGET)

    expect(harness.expandedCards).toEqual([ASSISTANT_TARGET])
    expect(harness.scrolls).toEqual([{ top: 788, behavior: 'smooth' }])
  })

  it('目标停在原始 JSON 上时切回格式化内容', async () => {
    const harness = createHarness()
    harness.setElementTop(ASSISTANT_TARGET, 300)
    harness.markMessageRaw('req:message:messages.2')

    await harness.locator.locate(ASSISTANT_TARGET)

    expect(harness.rawMessages.has('req:message:messages.2')).toBe(false)
  })

  it('定位响应卡片时展开响应并退出原文视图', async () => {
    const harness = createHarness()
    harness.setElementTop(RESPONSE_TARGET, 1200)
    harness.markResponseRaw()

    await harness.locator.locate(RESPONSE_TARGET)

    expect(harness.expandedCards).toEqual([RESPONSE_TARGET])
    expect(harness.responseRaw).toBe(false)
  })

  it('强制展开长文本是一次性脉冲，渲染一次后移出集合', async () => {
    const harness = createHarness()
    harness.setElementTop(USER_TARGET, 500)

    const located = harness.locator.locate(USER_TARGET)
    // 同步阶段就要进入集合，长文本组件才能在这一次渲染里锁定展开态。
    expect(harness.expandedText).toEqual([USER_TARGET])
    await located
    // 留在集合里会让下一次定位同一目标不再产生变化，长文本便不会自动展开。
    expect(harness.expandedText).toEqual([])
  })

  it('目标已经在正确位置时不再滚动', async () => {
    const harness = createHarness()
    // 元素刚好停在容器顶部下方 12px 留白处，算出的目标滚动量等于当前滚动量。
    harness.setElementTop(USER_TARGET, 112)
    harness.scroller.scrollTop = 300

    await harness.locator.locate(USER_TARGET)

    expect(harness.scrolls).toEqual([])
  })

  it('测不到目标时不滚动', async () => {
    const harness = createHarness()

    expect(await harness.locator.locate(USER_TARGET)).toBe(USER_TARGET)
    expect(harness.scrolls).toEqual([])
  })

  it('折叠把目标挤走时瞬时校正', async () => {
    const harness = createHarness()
    harness.setElementTop(USER_TARGET, 500)
    await harness.locator.locate(USER_TARGET)

    // 滚动后元素本应停在 112；上方长文本折叠 300px 把它挤到 -188，锚点 388 已经不再对准目标。
    harness.setElementTop(USER_TARGET, -188)
    harness.resize()

    expect(harness.scrolls).toEqual([
      { top: 388, behavior: 'smooth' },
      { top: 88, behavior: 'auto' },
    ])
  })

  it('锚点几乎没变时视为平滑滚动中间帧，不校正', async () => {
    const harness = createHarness()
    harness.setElementTop(USER_TARGET, 500)
    await harness.locator.locate(USER_TARGET)

    // 滚动完成后元素已经上移到容器顶部附近；重新测量得到 393，与锚点 388 相差 5px，小于 8px 阈值。
    harness.setElementTop(USER_TARGET, 117)
    harness.resize()

    expect(harness.scrolls).toEqual([{ top: 388, behavior: 'smooth' }])
  })

  it('校正窗口结束后不再跟随尺寸变化', async () => {
    const harness = createHarness()
    harness.setElementTop(USER_TARGET, 500)
    await harness.locator.locate(USER_TARGET)

    harness.fire(480)
    harness.setElementTop(USER_TARGET, 200)
    harness.resize()

    expect(harness.scrolls).toEqual([{ top: 388, behavior: 'smooth' }])
  })

  it('后一次定位让前一次失效，页面不会在两个目标之间来回跳', async () => {
    const harness = createHarness()
    harness.setElementTop(SYSTEM_TARGET, 300)
    harness.setElementTop(USER_TARGET, 900)

    const first = harness.locator.locate(SYSTEM_TARGET)
    const second = harness.locator.locate(USER_TARGET)

    expect(await first).toBeUndefined()
    expect(await second).toBe(USER_TARGET)
    expect(harness.scrolls).toEqual([{ top: 788, behavior: 'smooth' }])
  })

  it('按共享证据身份定位到对应目标', async () => {
    const harness = createHarness()
    harness.setElementTop(ASSISTANT_TARGET, 400)

    expect(await harness.locator.locateEvidence('req:message:messages.2')).toBe(ASSISTANT_TARGET)
    expect(harness.scrolls).toEqual([{ top: 288, behavior: 'smooth' }])
  })

  it('证据身份不在当前记录里时不定位', async () => {
    const harness = createHarness()

    expect(await harness.locator.locateEvidence('req:message:messages.99')).toBeUndefined()
    expect(harness.expandedCards).toEqual([])
    expect(harness.scrolls).toEqual([])
  })

  it('精确范围定位测量 occurrence mark，并展开卡片、正文和退出原始模式', async () => {
    const harness = createHarness()
    const occurrenceTarget = `${USER_TARGET}--content-occurrence`
    harness.setElementTop(occurrenceTarget, 640)
    harness.markMessageRaw('req:message:messages.1')

    expect(await harness.locator.locateOccurrence('req:message:messages.1', { start: 2, end: 4 }))
      .toBe(occurrenceTarget)
    expect(harness.occurrenceTarget).toBe(occurrenceTarget)
    expect(harness.expandedCards).toEqual([USER_TARGET])
    expect(harness.rawMessages.has('req:message:messages.1')).toBe(false)
    expect(harness.expandedText).toEqual([])
    expect(harness.scrolls).toEqual([{ top: 528, behavior: 'smooth' }])
    expect(harness.highlight).toBe(occurrenceTarget)
  })

  it('精确范围只接受请求消息 content 的有效 UTF-16 边界', async () => {
    const request = detail()
    request.requestBody = {
      messages: [{ role: 'user', content: 'A😀B', reasoning: '这里也有文字' }],
    }
    const harness = createHarness(request)

    expect(await harness.locator.locateOccurrence('req:message:messages.0', { start: 2, end: 3 })).toBeUndefined()
    expect(await harness.locator.locateOccurrence('req:message:messages.0', { start: 0, end: 9 })).toBeUndefined()
    expect(await harness.locator.locateOccurrence('req:tool-call:messages.0.tool_calls.0', { start: 0, end: 0 })).toBeUndefined()
    expect(harness.occurrenceTarget).toBeUndefined()
    expect(harness.expandedCards).toEqual([])
    expect(harness.scrolls).toEqual([])
  })

  it('occurrence target 未渲染时不伪装成精确成功，也不回落到消息卡片', async () => {
    const harness = createHarness()
    harness.setElementTop(USER_TARGET, 500)

    expect(await harness.locator.locateOccurrence('req:message:messages.1', { start: 2, end: 4 })).toBeUndefined()
    expect(harness.occurrenceTarget).toBeUndefined()
    expect(harness.scrolls).toEqual([])
    expect(harness.highlight).toBeUndefined()
  })

  it('普通证据定位会清除旧 occurrence，既有卡片定位语义不变', async () => {
    const harness = createHarness()
    const occurrenceTarget = `${USER_TARGET}--content-occurrence`
    harness.setElementTop(occurrenceTarget, 640)
    harness.setElementTop(SYSTEM_TARGET, 300)
    await harness.locator.locateOccurrence('req:message:messages.1', { start: 2, end: 4 })

    expect(await harness.locator.locateEvidence('req:message:messages.0')).toBe(SYSTEM_TARGET)
    expect(harness.occurrenceTarget).toBeUndefined()
    expect(harness.highlight).toBe(SYSTEM_TARGET)
  })

  it('过期 occurrence 失败不会清掉后一次精确定位的 mark', async () => {
    const harness = createHarness()
    const firstTarget = `${SYSTEM_TARGET}--content-occurrence`
    const secondTarget = `${USER_TARGET}--content-occurrence`
    harness.setElementTop(secondTarget, 640)

    const first = harness.locator.locateOccurrence('req:message:messages.0', { start: 0, end: 2 })
    const second = harness.locator.locateOccurrence('req:message:messages.1', { start: 2, end: 4 })

    expect(await first).toBeUndefined()
    expect(await second).toBe(secondTarget)
    expect(harness.occurrenceTarget).toBe(secondTarget)
    expect(harness.highlight).toBe(secondTarget)
    expect(harness.scrolls).toEqual([{ top: 528, behavior: 'smooth' }])
    expect(firstTarget).not.toBe(secondTarget)
  })

  it('按工具名称定位到唯一工具定义', async () => {
    const harness = createHarness()
    const toolTarget = modelAnalysisTargetId('req:tool-definition:tools.0.function')
    harness.setElementTop(toolTarget, 1500)

    expect(await harness.locator.locateTool('weather')).toBe(toolTarget)
    expect(harness.expandedTools).toEqual(['req:tool-definition:tools.0.function'])
  })

  it('同名工具定义证据不明确时展开全部匹配项并定位到 TOOL DEFS 区块', async () => {
    const request = detail()
    request.requestBody = {
      messages: [{ role: 'assistant', tool_calls: [{ function: { name: 'weather', arguments: '{}' } }] }],
      tools: [
        { type: 'function', function: { name: 'weather', description: '第一个', parameters: { type: 'object' } } },
        { type: 'function', function: { name: 'weather', description: '第二个', parameters: { type: 'object' } } },
      ],
    }
    const harness = createHarness(request)
    harness.setElementTop(TOOLS_TARGET, 800)

    expect(await harness.locator.locateTool('weather')).toBe(TOOLS_TARGET)
    expect(harness.expandedTools).toEqual([
      'req:tool-definition:tools.0.function',
      'req:tool-definition:tools.1.function',
    ])
  })

  it('请求未声明该工具时不定位', async () => {
    const harness = createHarness()

    expect(await harness.locator.locateTool('unknown')).toBeUndefined()
    expect(harness.expandedTools).toEqual([])
    expect(harness.scrolls).toEqual([])
  })

  it('短暂高亮到期后清除', async () => {
    const harness = createHarness()
    harness.setElementTop(USER_TARGET, 500)

    await harness.locator.locate(USER_TARGET)
    expect(harness.highlight).toBe(USER_TARGET)

    harness.fire(1500)
    expect(harness.highlight).toBeUndefined()
  })

  it('定位到别处后旧的高亮到期回调不再生效', async () => {
    const harness = createHarness()
    harness.setElementTop(USER_TARGET, 500)
    harness.setElementTop(SYSTEM_TARGET, 200)

    await harness.locator.locate(USER_TARGET)
    await harness.locator.locate(SYSTEM_TARGET)
    expect(harness.highlight).toBe(SYSTEM_TARGET)
    // 第一次定位的到期回调已被取消，不会中途清掉第二次的高亮。
    expect(harness.pendingHighlightTimers()).toBe(1)

    harness.fire(1500)
    expect(harness.highlight).toBeUndefined()
  })

  it('不强调时不产生高亮', async () => {
    const harness = createHarness()
    harness.setElementTop(USER_TARGET, 500)

    await harness.locator.locate(USER_TARGET, { emphasize: false })

    expect(harness.highlight).toBeUndefined()
    expect(harness.scrolls).toEqual([{ top: 388, behavior: 'smooth' }])
  })

  it('切换记录时清除高亮', async () => {
    const harness = createHarness()
    harness.setElementTop(USER_TARGET, 500)
    await harness.locator.locate(USER_TARGET)

    harness.locator.reset()

    expect(harness.highlight).toBeUndefined()
  })

  it('切换记录让在飞的定位失效，不会按旧目标滚动新记录', async () => {
    const harness = createHarness()
    harness.setElementTop(USER_TARGET, 500)

    const pending = harness.locator.locate(USER_TARGET)
    harness.locator.reset()

    expect(await pending).toBeUndefined()
    expect(harness.scrolls).toEqual([])
  })

  it('切换记录同时停止上一次定位的校正观察', async () => {
    const harness = createHarness()
    harness.setElementTop(USER_TARGET, 500)
    await harness.locator.locate(USER_TARGET)

    harness.locator.reset()
    harness.setElementTop(USER_TARGET, -188)
    harness.resize()

    expect(harness.scrolls).toEqual([{ top: 388, behavior: 'smooth' }])
  })

  it('卸载后尺寸变化不再触发校正', async () => {
    const harness = createHarness()
    harness.setElementTop(USER_TARGET, 500)
    await harness.locator.locate(USER_TARGET)

    harness.locator.dispose()
    harness.setElementTop(USER_TARGET, 200)
    harness.resize()

    expect(harness.scrolls).toEqual([{ top: 388, behavior: 'smooth' }])
  })
})
