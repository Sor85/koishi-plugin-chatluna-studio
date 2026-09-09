import {
  MODEL_ANALYSIS_RESPONSE_TARGET,
  MODEL_ANALYSIS_TOOLS_TARGET,
  modelAnalysisTargetId,
  resolveAnalysisEvidenceTarget,
  type ModelRequestAnalysisNavigation,
} from '#client/model-request/analysis'
import type { ModelRequestConversation } from '#client/model-request/conversation'
import {
  modelRequestOccurrenceTargetId,
  resolveModelRequestOccurrence,
  type ModelRequestOccurrence,
  type ModelTextRange,
} from '#client/model-request/occurrence'

/**
 * 证据定位：跳到一条原始模型证据，展开它所在的卡片，并在长文本折叠后保持对齐。
 *
 * 全部决策与帧时序都在本 module 内；DOM、渲染状态与计时一律经由 adapter。
 * 这样定位行为可以在没有布局的 node 环境里被完整驱动——jsdom 的
 * getBoundingClientRect() 恒为 0 且没有真实滚动，恰好测不到本 module 唯一关心的滚动位置。
 */

/**
 * 跨视图触发一次定位的信号。
 *
 * `seq` 只用来触发，不参与证据身份；`evidenceId` 为空字符串表示来源行没有模型证据
 * （例如请求边界行），此时按共享身份表回落到第一条卡片而不是不定位。
 */
export interface LocateRequest {
  evidenceId: string
  seq: number
  /** 服务端匹配出的 occurrence 精确文本范围，使用 JavaScript/JSON 的 UTF-16 offset。 */
  range?: ModelTextRange
}

/** 目标元素与滚动容器的布局读数。adapter 只交数字，不交元素。 */
export interface EvidenceMeasurement {
  elementTop: number
  scrollerTop: number
  scrollTop: number
}

export interface EvidenceLocatorAdapter {
  getConversation(): ModelRequestConversation
  getNavigation(): ModelRequestAnalysisNavigation
  /** 让视图渲染已经由纯 module 验证过的 occurrence；不交 DOM。 */
  setOccurrenceTarget(occurrence: ModelRequestOccurrence | undefined): void
  /** 唯一读取布局的出口。滚动容器的选择规则由视图持有，本 module 只做算术。 */
  measure(target: string): EvidenceMeasurement | undefined
  scrollTo(top: number, behavior: ScrollBehavior): void
  expandCard(target: string): void
  setToolExpanded(evidenceId: string): void
  isMessageRaw(evidenceId: string): boolean
  setMessageRaw(evidenceId: string, raw: boolean): void
  isResponseRaw(): boolean
  setResponseRaw(raw: boolean): void
  getExpandedText(): readonly string[]
  setExpandedText(targets: readonly string[]): void
  setHighlight(target: string | undefined): void
  nextTick(): Promise<void>
  frame(): Promise<void>
  /** 观察内容与滚动容器的尺寸变化；返回停止观察的回调。 */
  observeResize(callback: () => void): () => void
  /** 延时回调；返回取消回调。 */
  schedule(delayMs: number, callback: () => void): () => void
}

export interface EvidenceLocateOptions {
  emphasize?: boolean
}

const SCROLL_MARGIN = 12
const SCROLL_TOLERANCE = 2
const RELOCATE_ANCHOR_TOLERANCE = 8
const RELOCATE_WINDOW_MS = 480
const HIGHLIGHT_MS = 1500

export function createEvidenceLocator(adapter: EvidenceLocatorAdapter) {
  let generation = 0
  let pendingScrollTop: number | undefined
  let stopRelocateObserver: (() => void) | undefined
  let cancelRelocateWindow: (() => void) | undefined
  let cancelHighlight: (() => void) | undefined
  let highlighted: string | undefined
  let occurrenceTarget: string | undefined

  /**
   * 定位一个已经解析好的目标。
   *
   * 返回实际定位到的目标；过期定位返回 undefined，调用方据此决定是否对外广播。
   */
  async function locate(target: string | undefined, options: EvidenceLocateOptions = {}): Promise<string | undefined> {
    setOccurrence(undefined)
    return locatePrepared(target, options)
  }

  async function locatePrepared(
    target: string | undefined,
    options: EvidenceLocateOptions = {},
    requireMeasurement = false,
  ): Promise<string | undefined> {
    if (!target) return undefined
    const current = ++generation
    const forcedTargets = prepareTarget(target)
    await adapter.nextTick()
    // 强制展开长文本是一次性脉冲：目标在同步阶段进入集合，渲染一次后立刻移出。
    // 长文本组件在 forceExpanded 为真时把自身锁定为展开态，所以脉冲足够；
    // 若留在集合里，后续再次定位同一目标就不会产生新的变化，长文本便不再自动展开。
    adapter.setExpandedText(adapter.getExpandedText().filter(candidate => !forcedTargets.includes(candidate)))
    // 长文本折叠发生在下一帧。此时按未折叠高度测量会把目标算到最底端。
    await adapter.nextTick()
    await adapter.frame()
    await adapter.frame()
    if (current !== generation) return undefined
    // 普通证据定位保留“目标暂时测不到也算身份解析成功”的既有语义；
    // 精确 occurrence 必须真的存在，缺失时不能伪装成成功或回落到卡片。
    if (requireMeasurement && !adapter.measure(target)) return undefined
    scrollToTarget(target, 'smooth')
    watchRelocate(target, current)
    if (options.emphasize !== false) emphasize(target)
    return target
  }

  /** 按共享证据身份定位。身份表由分析导航提供，本 module 不重算角色内序号。 */
  function locateEvidence(evidenceId: string, options?: EvidenceLocateOptions) {
    return locate(resolveAnalysisEvidenceTarget(adapter.getNavigation(), evidenceId), options)
  }

  /**
   * 精确范围定位只接受请求消息正文。
   * 先用纯 module 验证 evidence + UTF-16 range，再让视图渲染 occurrence target；
   * 渲染后若 adapter 仍测不到该 target，则明确失败，不回落到消息卡片或其他位置。
   */
  async function locateOccurrence(evidenceId: string, range: ModelTextRange, options?: EvidenceLocateOptions) {
    const occurrence = resolveModelRequestOccurrence(adapter.getConversation(), evidenceId, range)
    if (!occurrence) {
      setOccurrence(undefined)
      return undefined
    }
    setOccurrence(occurrence)
    const located = await locatePrepared(occurrence.target, options, true)
    if (located) return located
    // 后一次精确定位可能已经替换了 occurrence；旧请求失败时不能把新 mark 清掉。
    if (occurrenceTarget === occurrence.target) setOccurrence(undefined)
    return undefined
  }

  /** 按工具名称定位到工具定义。同名工具定义证据不明确时展开全部匹配项。 */
  function locateTool(name: string, options?: EvidenceLocateOptions) {
    setOccurrence(undefined)
    const location = resolveToolDefinitionLocation(adapter.getConversation(), name)
    if (!location) return Promise.resolve(undefined)
    for (const evidenceId of location.toolEvidenceIds) adapter.setToolExpanded(evidenceId)
    return locate(location.target, options)
  }

  /**
   * 切换记录时清除高亮并让在飞的定位失效；展开集合与滚动量由持有它们的视图自行重置。
   *
   * 必须递增 generation：定位要等两个 nextTick 与两帧，切换记录时上一条记录的定位可能仍在等待，
   * 恢复后会按旧目标滚动新记录的内容。
   */
  function reset() {
    generation += 1
    stopRelocate()
    cancelHighlight?.()
    cancelHighlight = undefined
    highlighted = undefined
    setOccurrence(undefined)
    adapter.setHighlight(undefined)
  }

  function dispose() {
    generation += 1
    cancelHighlight?.()
    cancelHighlight = undefined
    stopRelocate()
    setOccurrence(undefined)
  }

  function setOccurrence(occurrence: ModelRequestOccurrence | undefined) {
    occurrenceTarget = occurrence?.target
    adapter.setOccurrenceTarget(occurrence)
  }

  function prepareTarget(target: string): readonly string[] {
    const preparation = prepareModelAnalysisTarget(adapter.getConversation(), target)
    for (const card of preparation.expandCards) adapter.expandCard(card)
    for (const evidenceId of preparation.toolEvidenceIds) adapter.setToolExpanded(evidenceId)
    // 目标停在原始 JSON 上时切回格式化内容，否则定位到的是一棵 JSON 树而不是正文。
    if (preparation.messageEvidenceId !== undefined && adapter.isMessageRaw(preparation.messageEvidenceId)) {
      adapter.setMessageRaw(preparation.messageEvidenceId, false)
    }
    if (preparation.response && adapter.isResponseRaw()) adapter.setResponseRaw(false)
    adapter.setExpandedText([...adapter.getExpandedText(), ...preparation.expandTargets])
    return preparation.expandTargets
  }

  function scrollToTarget(target: string, behavior: ScrollBehavior) {
    const measured = adapter.measure(target)
    if (!measured) return
    const top = targetScrollTop(measured)
    // 记录锚点即使不滚动也要更新，relocate 靠它区分平滑滚动中间帧和真正的位移。
    pendingScrollTop = top
    if (Math.abs(measured.scrollTop - top) < SCROLL_TOLERANCE) return
    adapter.scrollTo(top, behavior)
  }

  function watchRelocate(target: string, current: number) {
    stopRelocate()
    stopRelocateObserver = adapter.observeResize(() => {
      if (current !== generation) return
      const measured = adapter.measure(target)
      if (!measured) return
      const top = targetScrollTop(measured)
      // 锚点没变就是平滑滚动的中间帧。只有折叠把目标挤走时才瞬时校正。
      if (pendingScrollTop !== undefined && Math.abs(pendingScrollTop - top) < RELOCATE_ANCHOR_TOLERANCE) return
      pendingScrollTop = top
      if (Math.abs(measured.scrollTop - top) < SCROLL_TOLERANCE) return
      adapter.scrollTo(top, 'auto')
    })
    cancelRelocateWindow = adapter.schedule(RELOCATE_WINDOW_MS, stopRelocate)
  }

  function stopRelocate() {
    stopRelocateObserver?.()
    stopRelocateObserver = undefined
    cancelRelocateWindow?.()
    cancelRelocateWindow = undefined
  }

  function emphasize(target: string) {
    highlighted = target
    adapter.setHighlight(target)
    cancelHighlight?.()
    cancelHighlight = adapter.schedule(HIGHLIGHT_MS, () => {
      cancelHighlight = undefined
      // 期间又定位到别处时不要清掉新目标的高亮。
      if (highlighted !== target) return
      highlighted = undefined
      adapter.setHighlight(undefined)
    })
  }

  return { locate, locateEvidence, locateOccurrence, locateTool, reset, dispose }
}

function targetScrollTop(measured: EvidenceMeasurement): number {
  return Math.max(0, measured.elementTop - measured.scrollerTop + measured.scrollTop - SCROLL_MARGIN)
}

interface EvidenceTargetPreparation {
  messageEvidenceId?: string
  response: boolean
  toolEvidenceIds: string[]
  expandCards: string[]
  expandTargets: string[]
}

function prepareModelAnalysisTarget(
  conversation: ModelRequestConversation,
  target: string,
): EvidenceTargetPreparation {
  const message = conversation.messages.find(candidate => (
    modelAnalysisTargetId(candidate.evidenceId) === target
    || modelRequestOccurrenceTargetId(candidate.evidenceId) === target
  ))
  const messageTarget = message ? modelAnalysisTargetId(message.evidenceId) : undefined
  const occurrence = Boolean(message && modelRequestOccurrenceTargetId(message.evidenceId) === target)
  const tool = conversation.tools.find(candidate => modelAnalysisTargetId(candidate.evidenceId) === target)
  // 响应正文、思考、结束原因与用量落在响应卡片；响应侧的工具调用与工具结果各自成卡，
  // 因此不再把它们的目标归并到响应卡片上。
  const response = target === MODEL_ANALYSIS_RESPONSE_TARGET
  return {
    ...(message ? { messageEvidenceId: message.evidenceId } : {}),
    response,
    toolEvidenceIds: tool ? [tool.evidenceId] : [],
    // 每条证据的卡片就是它自己的定位目标：消息、响应、工具调用与工具结果都各自折叠。
    // occurrence mark 不是卡片，展开的是它所在的消息卡片。
    // 工具定义目标指向 TOOL DEFS 区块而不是折叠卡片，expandCard 对它是空操作。
    expandCards: [...new Set([
      ...(messageTarget ? [messageTarget] : []),
      ...(occurrence ? [] : [target]),
    ])],
    // occurrence mark 自己负责测量；所属消息 target 负责驱动 AnalysisContentBlock 强制展开。
    expandTargets: occurrence && messageTarget ? [messageTarget, target] : [target],
  }
}

function resolveToolDefinitionLocation(
  conversation: ModelRequestConversation,
  name: string,
): { target: string, toolEvidenceIds: string[] } | undefined {
  const matches = conversation.tools.filter(tool => tool.name === name)
  if (!matches.length) return undefined
  return {
    // 同名工具定义证据不明确时展开全部匹配项，而不是猜测第一项。
    target: matches.length === 1 ? modelAnalysisTargetId(matches[0]!.evidenceId) : MODEL_ANALYSIS_TOOLS_TARGET,
    toolEvidenceIds: matches.map(tool => tool.evidenceId),
  }
}
