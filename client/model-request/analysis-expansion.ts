import { ref } from 'vue'
import {
  MODEL_ANALYSIS_RESPONSE_TARGET,
  modelAnalysisTargetId,
} from './analysis'
import type { StudioEvidenceReadingGroup } from '../../src/evidence-reading-order'

/**
 * 模型请求分析视图的展开态与原文态：哪张卡折叠着、哪个工具展开着、哪几段看原文、
 * 哪一处强制展开长文本、哪个导航分组折叠着、当前停在哪个导航目标，以及原文一旦挂载就留着
 * 这条规则。
 *
 * 形态是反应式 module 而不是组件里的十个 ref 加两个 watcher，先例是这个视图旁边的三个 module
 * ——证据定位（ADR-0062）、证据导航（ADR-0065）与模型请求分析投影：有状态但与 DOM 无关的行为
 * 住在 module 里（ADR-0075）。本 module 一行 DOM、一个帧时序原语都不碰，因此下面五条规则可以在
 * 没有组件的环境里逐条驱动。
 *
 * 与证据定位的分工：定位器拥有「展开决策」（什么时候该展开、什么时候该切回格式化内容），
 * 本 module 只拥有「展开态」。定位高亮与当前 occurrence 不在这里——它们的写入与复位都属于
 * 定位器，搬过来会把定位器的复位拆到两个主人手里。
 *
 * 展开态是分析视图的本地状态：不进工作区状态、不持久化，切换到另一条模型请求记录时全部回到初始。
 */

/** 一次搜索命中要展开的东西。命中判定读搜索文本表，属于视图；这里只做状态转换。 */
export interface AnalysisSearchMatches {
  /** 命中的卡片目标：消息卡片、响应卡片与变量卡片共用一套目标标识。 */
  readonly cardTargets: readonly string[]
  /** 命中的工具定义证据身份。 */
  readonly toolEvidenceIds: readonly string[]
}

/**
 * 翻转一个集合成员，交出替换用的新集合。
 *
 * 卡片、工具、历史变量原文与导航分组四处切换是同一个形状，各自抄一份会让其中一处在后续改动里
 * 悄悄分叉——例如某一处改成「只加不删」，界面上表现为那一类东西再也收不起来。
 */
function toggled<T>(members: ReadonlySet<T>, member: T): Set<T> {
  const next = new Set(members)
  next.has(member) ? next.delete(member) : next.add(member)
  return next
}

export function createAnalysisExpansion() {
  const collapsedCards = ref(new Set<string>())
  const expandedTools = ref(new Set<string>())
  const expandedTextTargets = ref(new Set<string>())
  const rawMessages = ref(new Set<string>())
  /**
   * 已经被切开过原文的消息。原始 JSON 树只在这个集合里才挂载：
   * 一旦挂载就留在 DOM 里，因此切回格式化内容不会丢掉树内已经展开的层级；
   * 而从未被切开的消息不会为它构造整棵树，打开一条大请求的分析才不会随请求体线性变慢。
   */
  const rawMountedMessages = ref(new Set<string>())
  const rawHistoryVariables = ref(new Set<string>())
  const responseRaw = ref(false)
  const responseRawMounted = ref(false)
  const collapsedNavigationGroups = ref(new Set<StudioEvidenceReadingGroup>())
  const activeNavigationTarget = ref('')

  function isCardCollapsed(target: string): boolean {
    return collapsedCards.value.has(target)
  }

  /** 折叠仅隐藏正文而不卸载内容，避免原文模式与长文本展开状态在再次展开时丢失。 */
  function toggleCard(target: string): void {
    collapsedCards.value = toggled(collapsedCards.value, target)
  }

  function expandCard(target: string): void {
    if (!collapsedCards.value.has(target)) return
    const next = new Set(collapsedCards.value)
    next.delete(target)
    collapsedCards.value = next
  }

  function isToolExpanded(evidenceId: string): boolean {
    return expandedTools.value.has(evidenceId)
  }

  function expandTool(evidenceId: string): void {
    if (expandedTools.value.has(evidenceId)) return
    expandedTools.value = new Set([...expandedTools.value, evidenceId])
  }

  function toggleTool(evidenceId: string): void {
    expandedTools.value = toggled(expandedTools.value, evidenceId)
  }

  function isMessageRaw(evidenceId: string): boolean {
    return rawMessages.value.has(evidenceId)
  }

  function isMessageRawMounted(evidenceId: string): boolean {
    return rawMountedMessages.value.has(evidenceId)
  }

  /** 定位到正文时用它切回格式化内容；切回不登记挂载，从未切开的消息因此不会进已挂载集合。 */
  function setMessageRaw(evidenceId: string, raw: boolean): void {
    const next = new Set(rawMessages.value)
    raw ? next.add(evidenceId) : next.delete(evidenceId)
    rawMessages.value = next
    if (!raw || rawMountedMessages.value.has(evidenceId)) return
    rawMountedMessages.value = new Set([...rawMountedMessages.value, evidenceId])
  }

  /** 切原文顺带展开那张卡：卡片折叠着时不展开，用户点了按钮界面上什么都不会变。 */
  function toggleMessageRaw(evidenceId: string): void {
    expandCard(modelAnalysisTargetId(evidenceId))
    setMessageRaw(evidenceId, !rawMessages.value.has(evidenceId))
  }

  function setResponseRaw(raw: boolean): void {
    responseRaw.value = raw
    if (raw) responseRawMounted.value = true
  }

  function toggleResponseRaw(): void {
    expandCard(MODEL_ANALYSIS_RESPONSE_TARGET)
    setResponseRaw(!responseRaw.value)
  }

  function isHistoryVariableRaw(variableId: string): boolean {
    return rawHistoryVariables.value.has(variableId)
  }

  function toggleHistoryVariableRaw(variableId: string): void {
    rawHistoryVariables.value = toggled(rawHistoryVariables.value, variableId)
  }

  function isTextForceExpanded(target: string): boolean {
    return expandedTextTargets.value.has(target)
  }

  /** 整份读写：定位的强制展开是一次性脉冲，进集合渲染一次后立刻整份移出。 */
  function getExpandedText(): readonly string[] {
    return [...expandedTextTargets.value]
  }

  function setExpandedText(targets: readonly string[]): void {
    expandedTextTargets.value = new Set(targets)
  }

  function isNavigationGroupCollapsed(group: StudioEvidenceReadingGroup): boolean {
    return collapsedNavigationGroups.value.has(group)
  }

  /** 左侧导航分组默认全部展开，各自独立折叠；折叠一个分组不改变当前导航目标。 */
  function toggleNavigationGroup(group: StudioEvidenceReadingGroup): void {
    collapsedNavigationGroups.value = toggled(collapsedNavigationGroups.value, group)
  }

  /**
   * 阅读探针给出新的当前导航目标。返回是否真的变了，调用方据此决定要不要把左侧条目滚进视野。
   *
   * 空目标不清掉当前目标：滚过最后一个锚点之后探针会算不出目标，清掉它会让左侧高亮在
   * 页尾闪掉一下。
   */
  function focusNavigationTarget(target: string | undefined): boolean {
    if (!target || target === activeNavigationTarget.value) return false
    activeNavigationTarget.value = target
    return true
  }

  /**
   * 按搜索命中展开卡片与工具。
   *
   * 展开是一次集合替换而不是逐条调用 `expandCard` / `expandTool`：逐条会为每一条命中复制一次
   * 整个集合，代价随命中数与集合大小相乘，搜索一个很长的请求体时输入会掉帧。
   * 集合大小没变就不写回，避免一次没有变化的命中触发整段重渲染。
   */
  function expandSearchMatches(matches: AnalysisSearchMatches): void {
    const cards = new Set(collapsedCards.value)
    for (const target of matches.cardTargets) cards.delete(target)
    if (cards.size !== collapsedCards.value.size) collapsedCards.value = cards
    const tools = new Set(expandedTools.value)
    for (const evidenceId of matches.toolEvidenceIds) tools.add(evidenceId)
    if (tools.size !== expandedTools.value.size) expandedTools.value = tools
  }

  /**
   * 切换到另一条模型请求记录：十项状态全部回到初始。
   *
   * 这十项就是本 module 拥有的全部状态，因此复位是一次调用而不是十次赋值——逐项赋值漏掉
   * 其中一项不会报错，只表现为上一条记录的展开态残留到下一条。
   * 定位高亮与当前 occurrence 不在这里：它们由证据定位自己的复位清掉。
   */
  function reset(): void {
    collapsedCards.value = new Set()
    expandedTools.value = new Set()
    expandedTextTargets.value = new Set()
    rawMessages.value = new Set()
    rawMountedMessages.value = new Set()
    rawHistoryVariables.value = new Set()
    responseRaw.value = false
    responseRawMounted.value = false
    collapsedNavigationGroups.value = new Set()
    activeNavigationTarget.value = ''
  }

  return {
    activeNavigationTarget,
    collapsedCards,
    collapsedNavigationGroups,
    expandCard,
    expandSearchMatches,
    expandTool,
    expandedTextTargets,
    expandedTools,
    focusNavigationTarget,
    getExpandedText,
    isCardCollapsed,
    isHistoryVariableRaw,
    isMessageRaw,
    isMessageRawMounted,
    isNavigationGroupCollapsed,
    isTextForceExpanded,
    isToolExpanded,
    rawHistoryVariables,
    rawMessages,
    rawMountedMessages,
    reset,
    responseRaw,
    responseRawMounted,
    setExpandedText,
    setMessageRaw,
    setResponseRaw,
    toggleCard,
    toggleHistoryVariableRaw,
    toggleMessageRaw,
    toggleNavigationGroup,
    toggleResponseRaw,
    toggleTool,
  }
}

export type AnalysisExpansion = ReturnType<typeof createAnalysisExpansion>
