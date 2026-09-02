import { watch, type Ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { createAnalysisExpansion } from '../client/model-request/analysis-expansion'
import { MODEL_ANALYSIS_RESPONSE_TARGET, modelAnalysisTargetId } from '../client/model-request/analysis'

const SYSTEM_TARGET = modelAnalysisTargetId('req:message:messages.0')
const USER_TARGET = modelAnalysisTargetId('req:message:messages.1')

/**
 * 数一个反应式引用被真的写了几次。
 *
 * 「用集合替换而不是逐条展开」是成本结构而不是结果：逐条展开得到的集合内容一样，
 * 但会为每一条命中复制一次整个集合。只有写入次数能把这两种写法区分开。
 */
function countWrites<T>(source: Ref<T>) {
  let writes = 0
  const stop = watch(source, () => { writes += 1 }, { flush: 'sync' })
  return { writes: () => writes, stop }
}

describe('模型请求分析的展开态与原文态', () => {
  it('默认没有折叠的卡片、没有展开的工具、没有原文', () => {
    const expansion = createAnalysisExpansion()

    expect(expansion.isCardCollapsed(SYSTEM_TARGET)).toBe(false)
    expect(expansion.isToolExpanded('req:tool-definition:tools.0.function')).toBe(false)
    expect(expansion.isMessageRaw('req:message:messages.0')).toBe(false)
    expect(expansion.isMessageRawMounted('req:message:messages.0')).toBe(false)
    expect(expansion.responseRaw.value).toBe(false)
    expect(expansion.responseRawMounted.value).toBe(false)
    expect(expansion.isHistoryVariableRaw('variable-1')).toBe(false)
    expect(expansion.getExpandedText()).toEqual([])
  })

  it('折叠一张卡再展开，只影响被切换的那一张', () => {
    const expansion = createAnalysisExpansion()

    expansion.toggleCard(SYSTEM_TARGET)
    expect(expansion.isCardCollapsed(SYSTEM_TARGET)).toBe(true)
    expect(expansion.isCardCollapsed(USER_TARGET)).toBe(false)

    expansion.toggleCard(SYSTEM_TARGET)
    expect(expansion.isCardCollapsed(SYSTEM_TARGET)).toBe(false)
  })

  it('展开一张已经展开的卡片不产生写入', () => {
    const expansion = createAnalysisExpansion()
    const counter = countWrites(expansion.collapsedCards)

    expansion.expandCard(SYSTEM_TARGET)
    expect(counter.writes()).toBe(0)

    expansion.toggleCard(SYSTEM_TARGET)
    expansion.expandCard(SYSTEM_TARGET)
    expect(expansion.isCardCollapsed(SYSTEM_TARGET)).toBe(false)
    expect(counter.writes()).toBe(2)
    counter.stop()
  })

  it('展开与收起一个工具，重复展开同一个不产生写入', () => {
    const expansion = createAnalysisExpansion()
    const counter = countWrites(expansion.expandedTools)

    expansion.toggleTool('req:tool-definition:tools.0.function')
    expect(expansion.isToolExpanded('req:tool-definition:tools.0.function')).toBe(true)

    expansion.expandTool('req:tool-definition:tools.0.function')
    expect(counter.writes()).toBe(1)

    expansion.toggleTool('req:tool-definition:tools.0.function')
    expect(expansion.isToolExpanded('req:tool-definition:tools.0.function')).toBe(false)
    counter.stop()
  })

  it('切某条消息看原文时顺带展开那张卡', () => {
    // 卡片折叠着时切原文，如果不一起展开，用户点了「查看原始 JSON」界面上什么都不会变。
    const expansion = createAnalysisExpansion()
    expansion.toggleCard(USER_TARGET)

    expansion.toggleMessageRaw('req:message:messages.1')

    expect(expansion.isMessageRaw('req:message:messages.1')).toBe(true)
    expect(expansion.isCardCollapsed(USER_TARGET)).toBe(false)
  })

  it('切响应原文时顺带展开响应卡片', () => {
    const expansion = createAnalysisExpansion()
    expansion.toggleCard(MODEL_ANALYSIS_RESPONSE_TARGET)

    expansion.toggleResponseRaw()

    expect(expansion.responseRaw.value).toBe(true)
    expect(expansion.isCardCollapsed(MODEL_ANALYSIS_RESPONSE_TARGET)).toBe(false)
  })

  it('原文一旦挂载就留着：切回格式化内容后仍在已挂载集合里', () => {
    // 已挂载集合决定原始 JSON 树是否留在 DOM 里；不留就会丢掉树内已经展开的层级。
    const expansion = createAnalysisExpansion()

    expansion.toggleMessageRaw('req:message:messages.1')
    expect(expansion.isMessageRawMounted('req:message:messages.1')).toBe(true)

    expansion.toggleMessageRaw('req:message:messages.1')
    expect(expansion.isMessageRaw('req:message:messages.1')).toBe(false)
    expect(expansion.isMessageRawMounted('req:message:messages.1')).toBe(true)
  })

  it('响应原文同样一旦挂载就留着', () => {
    const expansion = createAnalysisExpansion()

    expansion.toggleResponseRaw()
    expansion.toggleResponseRaw()

    expect(expansion.responseRaw.value).toBe(false)
    expect(expansion.responseRawMounted.value).toBe(true)
  })

  it('从未切开的消息不进已挂载集合', () => {
    // 读取代价的另一半：每条消息都急切建树时，打开一条大请求的分析会随请求体线性变慢。
    const expansion = createAnalysisExpansion()

    expansion.toggleMessageRaw('req:message:messages.1')
    expansion.toggleCard(SYSTEM_TARGET)
    expansion.expandCard(SYSTEM_TARGET)

    expect(expansion.isMessageRawMounted('req:message:messages.0')).toBe(false)
    expect(expansion.isMessageRawMounted('req:message:messages.1')).toBe(true)
  })

  it('定位把某条消息切回格式化内容时不会把它登记成已挂载', () => {
    const expansion = createAnalysisExpansion()

    expansion.setMessageRaw('req:message:messages.0', false)

    expect(expansion.isMessageRawMounted('req:message:messages.0')).toBe(false)
  })

  it('搜索命中时展开卡片与工具，各自只做一次集合替换', () => {
    const expansion = createAnalysisExpansion()
    expansion.toggleCard(SYSTEM_TARGET)
    expansion.toggleCard(USER_TARGET)
    expansion.toggleCard(MODEL_ANALYSIS_RESPONSE_TARGET)
    const cards = countWrites(expansion.collapsedCards)
    const tools = countWrites(expansion.expandedTools)

    expansion.expandSearchMatches({
      cardTargets: [SYSTEM_TARGET, USER_TARGET, MODEL_ANALYSIS_RESPONSE_TARGET],
      toolEvidenceIds: ['req:tool-definition:tools.0.function', 'req:tool-definition:tools.1.function'],
    })

    expect(expansion.isCardCollapsed(SYSTEM_TARGET)).toBe(false)
    expect(expansion.isCardCollapsed(USER_TARGET)).toBe(false)
    expect(expansion.isCardCollapsed(MODEL_ANALYSIS_RESPONSE_TARGET)).toBe(false)
    expect(expansion.isToolExpanded('req:tool-definition:tools.0.function')).toBe(true)
    expect(expansion.isToolExpanded('req:tool-definition:tools.1.function')).toBe(true)
    // 三条卡片命中、两条工具命中，各自一次写入；逐条展开会是 3 次与 2 次。
    expect(cards.writes()).toBe(1)
    expect(tools.writes()).toBe(1)
    cards.stop()
    tools.stop()
  })

  it('搜索命中没带来变化时一次写入都没有', () => {
    const expansion = createAnalysisExpansion()
    expansion.toggleTool('req:tool-definition:tools.0.function')
    const cards = countWrites(expansion.collapsedCards)
    const tools = countWrites(expansion.expandedTools)

    expansion.expandSearchMatches({
      cardTargets: [SYSTEM_TARGET],
      toolEvidenceIds: ['req:tool-definition:tools.0.function'],
    })

    expect(cards.writes()).toBe(0)
    expect(tools.writes()).toBe(0)
    cards.stop()
    tools.stop()
  })

  it('强制展开长文本按整份集合读写，供定位的一次性脉冲使用', () => {
    const expansion = createAnalysisExpansion()

    expansion.setExpandedText([USER_TARGET, `${USER_TARGET}--content-occurrence`])
    expect(expansion.isTextForceExpanded(USER_TARGET)).toBe(true)
    expect(expansion.getExpandedText()).toEqual([USER_TARGET, `${USER_TARGET}--content-occurrence`])

    expansion.setExpandedText(expansion.getExpandedText().filter(target => target !== USER_TARGET))
    expect(expansion.isTextForceExpanded(USER_TARGET)).toBe(false)
  })

  it('切换历史变量的原文，只影响被切换的那一个变量', () => {
    const expansion = createAnalysisExpansion()

    expansion.toggleHistoryVariableRaw('variable-history-new')
    expect(expansion.isHistoryVariableRaw('variable-history-new')).toBe(true)
    expect(expansion.isHistoryVariableRaw('variable-history-last')).toBe(false)

    expansion.toggleHistoryVariableRaw('variable-history-new')
    expect(expansion.isHistoryVariableRaw('variable-history-new')).toBe(false)
  })

  it('导航分组默认全部展开，折叠一个再展开只影响被切换的那一个', () => {
    const expansion = createAnalysisExpansion()

    expect(expansion.isNavigationGroupCollapsed('tool')).toBe(false)
    expect(expansion.isNavigationGroupCollapsed('system')).toBe(false)

    expansion.toggleNavigationGroup('tool')
    expect(expansion.isNavigationGroupCollapsed('tool')).toBe(true)
    expect(expansion.isNavigationGroupCollapsed('system')).toBe(false)

    expansion.toggleNavigationGroup('tool')
    expect(expansion.isNavigationGroupCollapsed('tool')).toBe(false)
  })

  it('折叠导航分组不改变当前导航目标', () => {
    const expansion = createAnalysisExpansion()
    expansion.focusNavigationTarget(USER_TARGET)

    expansion.toggleNavigationGroup('user')

    expect(expansion.activeNavigationTarget.value).toBe(USER_TARGET)
  })

  it('当前导航目标只在真的变了时才改变，空目标不清掉它', () => {
    const expansion = createAnalysisExpansion()

    expect(expansion.focusNavigationTarget(USER_TARGET)).toBe(true)
    expect(expansion.activeNavigationTarget.value).toBe(USER_TARGET)
    // 没变就不必把左侧条目再滚一次。
    expect(expansion.focusNavigationTarget(USER_TARGET)).toBe(false)
    // 滚过最后一个锚点后探针算不出目标；清掉它会让左侧高亮在页尾闪掉一下。
    expect(expansion.focusNavigationTarget(undefined)).toBe(false)
    expect(expansion.activeNavigationTarget.value).toBe(USER_TARGET)
  })

  it('切换到另一条记录时十项状态全部回到初始', () => {
    // 这一条此前是十四行手写赋值，漏掉其中一项不报错，只表现为上一条记录的展开态残留到下一条。
    const expansion = createAnalysisExpansion()
    expansion.toggleCard(SYSTEM_TARGET)
    expansion.toggleTool('req:tool-definition:tools.0.function')
    expansion.setExpandedText([USER_TARGET])
    expansion.toggleMessageRaw('req:message:messages.1')
    expansion.toggleHistoryVariableRaw('variable-history-new')
    expansion.toggleResponseRaw()
    expansion.toggleNavigationGroup('tool')
    expansion.focusNavigationTarget(USER_TARGET)

    expansion.reset()

    expect(expansion.collapsedCards.value.size).toBe(0)
    expect(expansion.expandedTools.value.size).toBe(0)
    expect(expansion.expandedTextTargets.value.size).toBe(0)
    expect(expansion.rawMessages.value.size).toBe(0)
    expect(expansion.rawMountedMessages.value.size).toBe(0)
    expect(expansion.rawHistoryVariables.value.size).toBe(0)
    expect(expansion.responseRaw.value).toBe(false)
    expect(expansion.responseRawMounted.value).toBe(false)
    expect(expansion.collapsedNavigationGroups.value.size).toBe(0)
    expect(expansion.activeNavigationTarget.value).toBe('')
  })
})
