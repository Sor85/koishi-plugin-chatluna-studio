import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildModelRequestAnalysisNavigation,
  exceedsAnalysisLineLimit,
  isPreviewableConversationImage,
  matchesAnalysisSearch,
  modelAnalysisTargetId,
  normalizeAnalysisQuery,
  resolveActiveAnalysisTarget,
  resolveAnalysisEvidenceTarget,
  shouldExpandAnalysisText,
} from '../client/model-request/analysis'
import { parseModelRequestConversationDetail } from '../client/model-request/conversation'
import { modelRequestVariableStatusLabel } from '../src/model-request-variables'
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
    variables: [],
    responseBodyStatus: 'complete',
    responseBodyFormat: 'json',
    responseBodyRaw: JSON.stringify({ choices: [{ message: { content: '北京晴朗' }, finish_reason: 'stop' }] }),
  }
}

describe('模型请求分析展示模型', () => {
  it('把请求边界、角色消息、工具交互和响应映射到共享证据身份', () => {
    const request = detail()
    const navigation = buildModelRequestAnalysisNavigation(parseModelRequestConversationDetail(request), request)

    expect(navigation.boundary).toMatchObject({
      label: '请求 9',
      status: 'success',
      model: 'gpt-5',
      provider: 'openai',
      durationMs: 245,
      target: 'model-analysis-response',
    })
    expect(navigation.groups.map(({ key, count }) => ({ key, count }))).toEqual([
      { key: 'system', count: 1 },
      { key: 'user', count: 1 },
      { key: 'response', count: 1 },
      { key: 'assistant', count: 2 },
      { key: 'tool', count: 2 },
    ])

    request.variables = [{
      id: 'variable-1',
      name: 'weather',
      presetKind: 'character',
      presetName: 'koishi',
      path: ['system'],
      occurrence: 0,
      status: 'observed',
      value: '晴朗',
      evidenceId: 'req:message:messages.0',
      range: { start: 0, end: 2 },
    }]
    const navigationWithVariables = buildModelRequestAnalysisNavigation(parseModelRequestConversationDetail(request), request)
    expect(navigationWithVariables.groups.map(({ key }) => key)).toEqual([
      'system', 'user', 'variable', 'response', 'assistant', 'tool',
    ])

    expect(navigation.groups.find(({ key }) => key === 'assistant')?.items[1]).toMatchObject({
      kind: 'tool-call',
      label: 'TOOL CALL',
      preview: 'weather',
      evidenceId: 'req:tool-call:messages.2.tool_calls.0',
      target: 'model-analysis-req:tool-call:messages.2.tool_calls.0',
    })
    expect(navigation.groups.find(({ key }) => key === 'tool')?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'TOOL RESULT', evidenceId: 'req:message:messages.3' }),
      expect.objectContaining({ label: 'TOOL DEFS', target: 'model-analysis-tools' }),
    ]))
    expect(navigation.groups.every(({ items }) => items.every(({ evidenceId, target }) => (
      evidenceId === undefined || navigation.targets[evidenceId] === target
    )))).toBe(true)
  })

  it('按阅读探针追踪右侧具体卡片对应的左侧条目', () => {
    const positions = [
      { target: 'model-analysis-system-0', top: -500 },
      { target: 'model-analysis-variable-time', top: 40 },
      { target: 'model-analysis-variable-groupShutList', top: 100 },
      { target: 'model-analysis-response', top: 900 },
    ]

    expect(resolveActiveAnalysisTarget(positions, 0, 800)).toBe('model-analysis-variable-groupShutList')
    expect(resolveActiveAnalysisTarget(positions, 0, 200)).toBe('model-analysis-variable-time')
    expect(resolveActiveAnalysisTarget([], 0, 800)).toBeUndefined()
  })

  it('按模型证据身份把轨迹行和组成分段定位到同一分析目标', () => {
    const request = detail()
    const navigation = buildModelRequestAnalysisNavigation(parseModelRequestConversationDetail(request), request)

    expect(resolveAnalysisEvidenceTarget(navigation, 'req:message:messages.0')).toBe('model-analysis-req:message:messages.0')
    expect(resolveAnalysisEvidenceTarget(navigation, 'req:message:messages.1')).toBe('model-analysis-req:message:messages.1')
    expect(resolveAnalysisEvidenceTarget(navigation, 'req:message:messages.2')).toBe('model-analysis-req:message:messages.2')
    expect(resolveAnalysisEvidenceTarget(navigation, 'req:tool-definition:tools.0.function')).toBe('model-analysis-tools')
    expect(resolveAnalysisEvidenceTarget(navigation, 'req:tool-call:messages.2.tool_calls.0'))
      .toBe('model-analysis-req:tool-call:messages.2.tool_calls.0')
    expect(resolveAnalysisEvidenceTarget(navigation, 'req:message:messages.3')).toBe('model-analysis-req:message:messages.3')
    // 请求边界行没有证据身份；回落到第一条卡片而不是猜测顺序。
    expect(resolveAnalysisEvidenceTarget(navigation, undefined)).toBe('model-analysis-req:message:messages.0')
    // 展示文案改变不影响定位：目标来自证据身份表，不来自导航排序或标签。
    for (const item of navigation.groups.flatMap(group => group.items)) item.label = '展示文案已修改'
    expect(resolveAnalysisEvidenceTarget(navigation, 'req:tool-definition:tools.0.function')).toBe('model-analysis-tools')
  })

  it('响应正文、思考与工具事件按证据身份定位到响应卡片和工具卡片', () => {
    const request = detail()
    request.responseBodyRaw = JSON.stringify({
      choices: [{
        message: {
          content: '北京晴朗',
          tool_calls: [{ id: 'call-2', function: { name: 'weather', arguments: '{"city":"上海"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
    })
    const conversation = parseModelRequestConversationDetail(request)
    const navigation = buildModelRequestAnalysisNavigation(conversation, request)

    expect(conversation.response?.cardEvidenceIds).toEqual([
      'res:content:choices.0.content',
      'res:finish-reason:choices.0.finish_reason',
    ])
    for (const evidenceId of conversation.response!.cardEvidenceIds) {
      expect(resolveAnalysisEvidenceTarget(navigation, evidenceId)).toBe('model-analysis-response')
    }
    expect(resolveAnalysisEvidenceTarget(navigation, 'res:tool-call:choices.0.tool_calls.0'))
      .toBe('model-analysis-res:tool-call:choices.0.tool_calls.0')
  })

  it('把 Gemini 组成图 System 分段定位到 systemInstruction.parts', () => {
    const request = detail()
    request.provider = 'gemini'
    request.model = 'gemini-pro'
    request.requestBody = {
      systemInstruction: {
        parts: [
          { text: 'Gemini 系统一' },
          { text: 'Gemini 系统二' },
        ],
      },
      contents: [{ role: 'user', parts: [{ text: '查询天气' }] }],
      tools: [{ functionDeclarations: [{ name: 'weather', description: '查询天气' }] }],
    }
    const navigation = buildModelRequestAnalysisNavigation(parseModelRequestConversationDetail(request), request)

    expect(navigation.groups.map(({ key, count }) => ({ key, count }))).toEqual([
      { key: 'system', count: 2 },
      { key: 'user', count: 1 },
      { key: 'response', count: 1 },
      { key: 'tool', count: 1 },
    ])
    expect(resolveAnalysisEvidenceTarget(navigation, 'req:message:systemInstruction.parts.0'))
      .toBe(modelAnalysisTargetId('req:message:systemInstruction.parts.0'))
    expect(resolveAnalysisEvidenceTarget(navigation, 'req:message:systemInstruction.parts.1'))
      .toBe(modelAnalysisTargetId('req:message:systemInstruction.parts.1'))
    expect(resolveAnalysisEvidenceTarget(navigation, 'req:message:contents.0'))
      .toBe(modelAnalysisTargetId('req:message:contents.0'))
    expect(resolveAnalysisEvidenceTarget(navigation, 'req:tool-definition:tools.0.functionDeclarations.0'))
      .toBe('model-analysis-tools')
  })

  it('搜索文本覆盖正文、工具参数、工具定义 Schema 和响应', () => {
    const request = detail()
    const navigation = buildModelRequestAnalysisNavigation(parseModelRequestConversationDetail(request), request)

    const weather = navigation.groups.flatMap(({ items }) => items).filter(({ searchText }) => searchText.includes(normalizeAnalysisQuery('北京')))
    expect(weather.map(({ label }) => label)).toEqual(['RESPONSE', 'ASSISTANT', 'TOOL CALL'])
    expect(navigation.searchText).toContain('查询天气')
    expect(navigation.searchText).toContain('北京晴朗')
    expect(navigation.searchText).toContain('weather')
  })

  it('按实际排版高度在超过 12 行时折叠，正好 12 行保持完整', () => {
    expect(exceedsAnalysisLineLimit(12 * 22.1, 22.1)).toBe(false)
    expect(exceedsAnalysisLineLimit(12 * 22.1 + 1, 22.1)).toBe(true)
    expect(shouldExpandAnalysisText(false, true, '', 'x')).toBe(true)
  })

  it('分析页、组成图、轨迹台账和响应分段共用角色色', () => {
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')
    const view = readFileSync(resolve('client/model-request/analysis-view.vue'), 'utf8')
    const trajectory = readFileSync(resolve('client/model-request/trajectory.vue'), 'utf8')

    expect(styles).toContain('--chatluna-studio-role-system: #737985')
    expect(styles).toContain('--chatluna-studio-role-user: #2f76c9')
    expect(styles).toContain('--chatluna-studio-role-assistant: #a13d76')
    expect(styles).toContain('--chatluna-studio-role-response: #0f766e')
    expect(styles).toContain('--chatluna-studio-role-response: #5eead4')
    expect(styles).toContain('--chatluna-studio-role-tool: #c46b00')
    expect(styles).toContain('--chatluna-studio-role-tool-interaction: #8f5aa8')
    expect(styles).not.toContain('--chatluna-studio-model-analysis-system')
    expect(styles).not.toContain('#087c9f')
    expect(styles).not.toContain('#0891b2')
    expect(styles).toContain('.chatluna-studio-model-analysis-card.is-response { --chatluna-studio-role: var(--chatluna-studio-role-response); }')
    expect(styles).toContain('.chatluna-studio-model-analysis-nav-group.is-response { --chatluna-studio-role: var(--chatluna-studio-role-response); }')
    expect(styles).toContain('.chatluna-studio-model-analysis-card.is-tool-result { --chatluna-studio-role: var(--chatluna-studio-role-tool-interaction); }')
    expect(styles).toContain('.chatluna-studio-model-analysis-tool-card { --chatluna-studio-role: var(--chatluna-studio-role-tool); }')
    expect(styles).toContain('color: var(--chatluna-studio-role);')
    expect(styles).toContain('.chatluna-studio-model-trajectory-row.is-tool-definition .chatluna-studio-model-trajectory-kind')
    expect(view).toContain('class="chatluna-studio-model-analysis-nav-group"')
    expect(view).toContain('`is-${group.key}`')
    expect(view).toContain(':class="`is-${item.kind}`"')
    expect(view).toContain('class="chatluna-studio-model-analysis-tool-call is-call"')
    expect(view).toContain('class="chatluna-studio-model-analysis-tool-call is-result"')
    expect(trajectory).toContain("row.source === 'response' ? 'is-response' : ''")
    expect(styles).toContain('.chatluna-studio-model-trajectory-row.is-tool-call .chatluna-studio-model-trajectory-kind,')
  })

  it('左侧 Variables 列出预设表达式名，并定位右侧变量值卡片', () => {
    const request = detail()
    request.variables = [{
      id: 'character:0:["system"]#0',
      name: 'weather',
      presetKind: 'character',
      presetName: 'koishi',
      path: ['system'],
      occurrence: 0,
      status: 'observed',
      value: '长沙晴朗',
      evidenceId: 'req:message:messages.0',
      range: { start: 0, end: 4 },
    }]
    const navigation = buildModelRequestAnalysisNavigation(parseModelRequestConversationDetail(request), request)
    const variables = navigation.groups.find(({ key }) => key === 'variable')

    expect(variables).toMatchObject({ label: 'Variable', count: 1 })
    expect(variables?.items[0]).toMatchObject({
      kind: 'variable', label: 'VARIABLE', preview: 'weather', searchText: expect.stringContaining('长沙晴朗'),
    })

    const view = readFileSync(resolve('client/model-request/analysis-view.vue'), 'utf8')
    expect(view).toContain(':id="modelAnalysisVariableTargetId(variable.id)"')
    expect(view).toContain(':value="variable.name"')
    expect(view).toContain(':value="variable.value ?? \'\'"')
    expect(view).toContain('variablesVisible')
    expect(view).toContain("isEvidenceVisible(evidenceFilter.value, 'variable')")
  })

  it('变量状态不是已观察时，搜索状态说明文案在导航项与右侧卡片两侧结论一致', () => {
    const request = detail()
    request.variables = [{
      id: 'character:0:["system"]#0',
      name: 'weather',
      presetKind: 'character',
      presetName: 'koishi',
      path: ['system'],
      occurrence: 0,
      status: 'ambiguous',
    }]
    const navigation = buildModelRequestAnalysisNavigation(parseModelRequestConversationDetail(request), request)
    const item = navigation.groups.find(({ key }) => key === 'variable')!.items[0]!
    // 卡片正文显示的状态说明与导航项的搜索文本必须是同一份文案，否则搜到的词在正文里找不到。
    const status = normalizeAnalysisQuery(modelRequestVariableStatusLabel('ambiguous'))
    const query = normalizeAnalysisQuery('歧义')

    expect(status).toContain(query)
    expect(item.searchText).toContain(status)
    // 左侧导航项与右侧卡片读同一张搜索文本表：不可能出现导航说有、正文说没有。
    expect(matchesAnalysisSearch(navigation, item.id, query)).toBe(true)
    expect(matchesAnalysisSearch(navigation, 'character:0:["system"]#0', query)).toBe(true)
  })

  it('搜索已观察变量的展开值或不命中的词时，导航与卡片同时命中或同时置灰', () => {
    const request = detail()
    request.variables = [{
      id: 'character:0:["system"]#0',
      name: 'weather',
      presetKind: 'character',
      presetName: 'koishi',
      path: ['system'],
      occurrence: 0,
      status: 'observed',
      value: '长沙晴朗',
      evidenceId: 'req:message:messages.0',
      range: { start: 0, end: 4 },
    }]
    const navigation = buildModelRequestAnalysisNavigation(parseModelRequestConversationDetail(request), request)
    const item = navigation.groups.find(({ key }) => key === 'variable')!.items[0]!

    for (const [word, matched] of [['长沙', true], ['koishi', true], ['weather', true], ['不存在的词', false]] as const) {
      const query = normalizeAnalysisQuery(word)
      expect(item.searchText.includes(query), word).toBe(matched)
      expect(matchesAnalysisSearch(navigation, item.id, query), word).toBe(matched)
    }
    // 空查询不置灰任何一侧。
    expect(matchesAnalysisSearch(navigation, item.id, '')).toBe(true)
    // 状态是已观察时不再混入状态说明文案，两侧同样不命中。
    expect(matchesAnalysisSearch(navigation, item.id, normalizeAnalysisQuery('歧义'))).toBe(false)
  })

  /**
   * 「切原文」这个转换本身已经下沉到 `analysis-expansion`；这里保留的
   * `@click="toggleHistoryVariableRaw(variable.id)"` 与那条 `v-else-if` 守的是**接线**而不是判定
   * ——切原文按钮接到的是不是那个转换、预览与原文两个分支读的是不是同一个变量身份。
   * 少接这根线不会报错，表现为点了「查看原始 XML」界面上什么都不变（ADR 0073 第 4 类）。
   */
  it('history_new 和 history_last 默认渲染消息预览，并保留原始 XML 切换', () => {
    const view = readFileSync(resolve('client/model-request/analysis-view.vue'), 'utf8')
    const preview = readFileSync(resolve('client/model-request/history-preview.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    expect(view).toContain('isHistoryVariableName(variable.name)')
    expect(view).toContain('parseModelRequestHistory(variable.value)')
    expect(view).toContain('v-else-if="historyPreview(variable) && !isHistoryVariableRaw(variable.id)"')
    expect(view).toContain(':messages="historyPreview(variable)!"')
    expect(view).toContain(':bot-id="detail.entities.botId"')
    expect(view).toContain(':characters="variable.value?.length"')
    expect(view).toContain("'查看原始 XML'")
    expect(view).toContain('@click="toggleHistoryVariableRaw(variable.id)"')
    expect(preview).toContain('v-for="item in entry.metadata"')
    expect(preview).toContain(':class="{ \'is-collapsed\': collapsible && !expanded }"')
    expect(preview).toContain("`展开全部（${characters} 字符）`")
    expect(preview).toContain("expanded ? '收起'")
    expect(preview).toContain(':aria-expanded="expanded"')
    expect(preview).toContain('preview.scrollHeight > props.maxHeight + 1')
    expect(preview).toContain(':class="{ \'is-bot\': entry.isBot }"')
    expect(preview).toContain('<TooltipTrigger as-child>')
    expect(preview).toContain('<TooltipContent>{{ item.label }}：{{ item.value }}</TooltipContent>')
    expect(preview).not.toContain('MessageJumpButton')
    expect(preview).not.toContain('openMessage')
    expect(preview).not.toContain('navigable')
    expect(preview).not.toContain(':title=')
    expect(preview).toContain('variant="secondary"')
    expect(preview).toContain(':class="metadataClass(entry, item)"')
    expect(preview).toContain('v-for="(line, lineIndex) in entry.lines"')
    expect(preview).toContain("'is-single-visual-line': singleVisualLines.has(entry.lineKeys[lineIndex]!)")
    expect(preview).toContain(':data-history-content-line="entry.lineKeys[lineIndex]"')
    expect(preview).toContain(".split(/\\r\\n|\\r|\\n/)")
    expect(preview).toContain("'[data-history-content-line]'")
    expect(preview).toContain('range.getClientRects()')
    expect(preview).toContain('const cardCenter = previewRect.left + previewRect.width / 2')
    expect(preview).toContain('lineRect.right - cardCenter')
    expect(preview).toContain('cardCenter - lineRect.left')
    expect(preview).toContain("'--chatluna-studio-model-history-content-max-width'")
    expect(preview).toContain('message.id === props.botId')
    expect(preview).toContain('metadata: isBot ? items.reverse() : items')
    expect(preview).toContain("entry.isBot ? 'is-name is-bot' : 'is-name is-user'")
    expect(preview).toContain('class: \'chatluna-studio-message-quote chatluna-studio-model-history-quote\'')
    expect(styles).toMatch(/\.chatluna-studio-model-history-preview \{[^}]*container-type: inline-size;/s)
    expect(styles).toMatch(/\.chatluna-studio-model-history-preview-wrap\.is-collapsed \.chatluna-studio-model-history-preview \{[^}]*max-height: var\(--chatluna-studio-model-history-collapse-height\);[^}]*overflow: hidden;/s)
    expect(styles).toContain('.chatluna-studio-model-history-preview-wrap:not(.is-collapsed) .chatluna-studio-model-history-expand svg')
    expect(styles).toContain('.chatluna-studio-model-history-meta .studio-badge.is-name.is-user')
    expect(styles).toContain('.chatluna-studio-model-history-meta .studio-badge.is-name.is-bot')
    expect(styles).toContain('.chatluna-studio-model-history-meta .studio-badge.is-id')
    expect(styles).not.toContain('.studio-badge.is-timestamp')
    expect(styles).toMatch(/\.chatluna-studio-model-history-line \{[^}]*flex-direction: column;[^}]*width: min\(78%, 760px\);/s)
    expect(styles).toContain('.chatluna-studio-model-history-message.is-bot { justify-items: end; }')
    expect(styles).toContain('.chatluna-studio-model-history-message.is-bot .chatluna-studio-model-history-line { align-items: flex-end; }')
    expect(styles).toContain('.chatluna-studio-model-history-message.is-bot .chatluna-studio-model-history-content { text-align: right; }')
    expect(styles).toMatch(/\.chatluna-studio-model-history-content \{[^}]*width: fit-content;[^}]*max-width: min\(100%, var\(--chatluna-studio-model-history-content-max-width, 100%\)\);/s)
    expect(styles).toMatch(/\.chatluna-studio-model-history-content-line \{[^}]*overflow-wrap: anywhere;[^}]*white-space: pre-wrap;/s)
    expect(styles).toMatch(/\.chatluna-studio-model-history-message\.is-bot \.chatluna-studio-model-history-content-line \{[^}]*align-self: flex-end;[^}]*text-align: left;/s)
    expect(styles).toMatch(/\.chatluna-studio-model-history-message\.is-bot \.chatluna-studio-model-history-content-line\.is-single-visual-line \{[^}]*text-align: right;/s)
    expect(styles).not.toContain('.chatluna-studio-model-history-jump')
    expect(styles).toMatch(/\.chatluna-studio-model-history-message\.is-bot > \.chatluna-studio-model-history-quote \{[^}]*border-right: 3px[^}]*border-left: 0;[^}]*text-align: right;/s)
    expect(styles).not.toMatch(/\.chatluna-studio-model-history-message \{[^}]*border-top:/s)
    expect(styles).toContain('.chatluna-studio-model-history-quote.chatluna-studio-message-quote')
    expect(styles).toMatch(/\.chatluna-studio-model-history-quote\.chatluna-studio-message-quote > span \{[^}]*overflow: visible;[^}]*text-overflow: clip;[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;/s)

    const trajectory = readFileSync(resolve('client/model-request/trajectory.vue'), 'utf8')
    const workspace = readFileSync(resolve('client/model-request/workspace.vue'), 'utf8')
    expect(view).not.toContain('StudioMessageNavigationTarget')
    expect(view).not.toContain('@open-message=')
    expect(trajectory).not.toContain('@open-message=')
    expect(workspace).not.toContain('@open-message=')
  })

  /**
   * 折叠这个转换已经下沉到 `analysis-expansion`；这里保留三类断言。
   * 一是**接线**：头部与折叠按钮接到的是不是同一个变量卡片目标——少接一根线不会报错，
   * 表现为点了头部空白或箭头没反应，或者点头部折叠的是另一张卡。
   * 二是指针与选区守卫的判定，它读窗口选区与事件目标，属于留在视图里的 DOM 细节
   * （`event.detail < 2`、`event.preventDefault()`）。三是结构与样式契约（ADR 0073 第 2、3、4 类）。
   */
  it('变量卡片正文保持卡片内边距，支持头部和按钮折叠，并标注空值', () => {
    const view = readFileSync(resolve('client/model-request/analysis-view.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    expect(view).toContain("'is-collapsed': isCardCollapsed(modelAnalysisVariableTargetId(variable.id))")
    expect(view).toContain('@click="toggleCardFromHeader($event, modelAnalysisVariableTargetId(variable.id))"')
    expect(view).toContain('@mousedown="preventCardHeaderDoubleClickSelection"')
    expect(view).toContain('if (event.detail < 2) return')
    expect(view).toContain('event.preventDefault()')
    expect(view).toContain('@click="toggleCard(modelAnalysisVariableTargetId(variable.id))"')
    expect(view).toContain('v-show="!isCardCollapsed(modelAnalysisVariableTargetId(variable.id))"')
    expect(view).toContain("variable.status === 'observed' && !variable.value")
    expect(view).toContain('<span>空值</span>该表达式在本次模型请求中展开为空字符串')
    expect(styles).toMatch(/\.chatluna-studio-model-analysis-variable-body > \.chatluna-studio-model-analysis-section \{[^}]*padding: 14px 16px;/s)
    expect(styles).toContain('.chatluna-studio-model-analysis-variable-card.is-collapsed > header { border-bottom: 0; }')
    expect(styles).toContain('.chatluna-studio-model-analysis-variable-card:not(.is-collapsed) .chatluna-studio-model-analysis-collapse svg { transform: rotate(180deg); }')
  })

  it('工具列表图标锁死 18px，避免 flex 把扳手挤成不同大小', () => {
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')
    const view = readFileSync(resolve('client/model-request/analysis-view.vue'), 'utf8')

    expect(styles).toMatch(/\.chatluna-studio-model-analysis-tool-summary > svg \{[^}]*flex: 0 0 auto;[^}]*width: 18px;[^}]*height: 18px;/s)
    expect(view).toContain('class="chatluna-studio-model-analysis-tool-copy"')
    expect(view).toContain('class="chatluna-studio-model-analysis-tool-desc"')
    expect(view).toContain('class="chatluna-studio-model-analysis-tool-chevron"')
    expect(styles).toMatch(/\.chatluna-studio-model-analysis-tool-summary \{[^}]*grid-template-columns: 18px minmax\(0, 1fr\) 18px;/s)
    expect(styles).toMatch(/\.chatluna-studio-model-analysis-tool-copy \{[^}]*grid-template-columns: max-content minmax\(0, 1fr\) max-content;/s)
    expect(styles).toMatch(/\.chatluna-studio-model-analysis-tool-copy > strong \{[^}]*min-width: 0;[^}]*max-width: 100%;/s)
    expect(styles).toMatch(/\.chatluna-studio-model-analysis-tool-copy > \.chatluna-studio-model-analysis-tool-desc \{[^}]*container-type: inline-size/s)
    expect(styles).toMatch(/@container \(max-width: 3em\) \{[^}]*\.chatluna-studio-model-analysis-tool-desc > span \{ display: none; \}/s)
    expect(styles).toMatch(/\.chatluna-studio-model-trajectory-inspector \{[^}]*container-type: inline-size;[^}]*container-name: chatluna-studio-trajectory-inspector;/s)
    expect(styles).toMatch(/@container chatluna-studio-trajectory-inspector \(max-width: 500px\) \{[^}]*\.chatluna-studio-model-analysis-tool-desc > span \{ display: none; \}/s)
    expect(styles).toMatch(/\.chatluna-studio-model-analysis-tool-summary > \.chatluna-studio-model-analysis-tool-chevron \{[^}]*flex: 0 0 18px;[^}]*min-width: 18px;[^}]*min-height: 18px;/s)
    expect(styles).toMatch(/\.chatluna-studio-model-analysis-collapse svg \{[^}]*min-width: 16px;[^}]*min-height: 16px;/s)
  })

  it('工具列表卡片头与消息卡片头同高，不再额外垫高', () => {
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    expect(styles).toMatch(/\.chatluna-studio-model-analysis-tool-summary \{[^}]*min-height: 44px;[^}]*padding: 8px 12px;/s)
    expect(styles).not.toMatch(/\.chatluna-studio-model-analysis-tool-summary \{[^}]*min-height: 58px;/s)
  })

  // 定位的算术与帧时序已经进入 evidence-locator 并由行为测试覆盖；
  // 这里只保留无法进入 module 的 DOM 契约：滚动容器选择规则留在视图侧。
  it('工作台分析的导航与卡片共用外层详情滚动，检查器仍滚动 inspector-body', () => {
    const view = readFileSync(resolve('client/model-request/analysis-view.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    expect(view).toContain("content.closest<HTMLElement>('.chatluna-studio-model-request-detail')")
    expect(view).toContain("content.closest<HTMLElement>('.chatluna-studio-model-trajectory-inspector-body')")
    expect(view).toContain('createEvidenceLocator')
    expect(view).not.toContain("scrollIntoView({ behavior: 'smooth', block: 'start' })")
    expect(styles).toMatch(/\.chatluna-studio-model-request-analysis \.chatluna-studio-model-analysis-content \{[^}]*max-height: none[^}]*overflow: visible/s)
  })

  // 「默认展开、各自独立折叠、切换记录后回到默认」三条已由 analysis-expansion 的行为断言执行；
  // 这里只保留无从进入 module 的结构契约：折叠按钮的 aria 与正文的显隐都绑在同一个分组键上。
  it('单一左侧导航保持吸顶，折叠按钮的 aria 与条目显隐绑在同一个分组键上', () => {
    const view = readFileSync(resolve('client/model-request/analysis-view.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    expect(view).toContain('@click="toggleNavigationGroup(group.key)"')
    expect(view).toContain(':aria-expanded="!isNavigationGroupCollapsed(group.key)"')
    expect(view).toContain('v-show="!isNavigationGroupCollapsed(group.key)"')
    expect(styles).toMatch(/\.chatluna-studio-model-request-analysis \.chatluna-studio-model-analysis-nav \{[^}]*position: sticky;[^}]*top: var\(--chatluna-studio-model-trajectory-sticky-height[^}]*max-height: calc\(var\(--chatluna-studio-model-analysis-nav-height[^}]*- var\(--chatluna-studio-model-trajectory-sticky-height[^}]*overflow: auto;/s)
  })

  it('分析页的过滤工具栏和请求组成轨道一起保持吸顶', () => {
    const trajectory = readFileSync(resolve('client/model-request/trajectory.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    expect(trajectory).toMatch(/chatluna-studio-model-trajectory-header[\s\S]*chatluna-studio-model-trajectory-scope[\s\S]*chatluna-studio-model-trajectory-sticky-header[\s\S]*chatluna-studio-model-trajectory-controls[\s\S]*chatluna-studio-model-trajectory-composition-shell/)
    expect(trajectory).toContain('ref="stickyHeaderElement" class="chatluna-studio-model-trajectory-header chatluna-studio-overlay-header"')
    expect(trajectory).toContain("style.setProperty('--chatluna-studio-model-trajectory-sticky-height'")
    const stickyRule = styles.slice(styles.indexOf('.chatluna-studio-model-request-analysis .chatluna-studio-model-trajectory-header {')).split('}')[0]
    // 背景层与毛玻璃已收敛到 .chatluna-studio-overlay-header 共享 ::before（由 chatluna-studio-region-css 用例守卫），
    // 组件局部的 ::before 只补自己的分隔线，不再重复声明背景。
    const stickyDividerRule = styles.slice(styles.indexOf('\n.chatluna-studio-model-trajectory-header::before {')).split('}')[0]
    expect(stickyRule).toContain('top: 0')
    expect(stickyRule).toContain('overflow: clip')
    expect(stickyRule).toContain('border-radius: 7px 7px 0 0')
    expect(stickyRule).not.toContain('backdrop-filter:')
    expect(stickyDividerRule).toContain('border-bottom: 1px solid')
    expect(stickyDividerRule).not.toContain('box-shadow:')
    expect(styles).toContain('.chatluna-studio-workspace.is-frosted .chatluna-studio-model-trajectory-header :is(')
    expect(styles).toMatch(/\.chatluna-studio-workspace\.is-frosted \.chatluna-studio-model-trajectory-header :is\([\s\S]*?\.chatluna-studio-model-trajectory-scope,[\s\S]*?\.chatluna-studio-model-trajectory-controls,[\s\S]*?\.chatluna-studio-model-trajectory-composition-shell/)
    // ADR 0024：吸顶头部的毛玻璃必须保留——顶边那条接缝由 pane 上的遮盖条负责，
    // 不得为了压接缝把这一层改成实心。
    expect(styles).not.toContain('.chatluna-studio-workspace.is-frosted .chatluna-studio-model-trajectory-header::before')
  })

  it('详情外壳的滚动视口顶边由 pane 上的遮盖条压住子像素接缝', () => {
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    // ADR 0024：遮盖条必须挂在滚动容器之外的 pane 上——挂进详情外壳就会跟着进同一个滚动层，
    // 与接缝一起取整，压不住。左右让出 17px 才不会在面板边框上切出缺口。
    expect(styles).toMatch(/\.chatluna-studio-model-request-detail-pane \{\s*position: relative;\s*\}/)
    const seamRule = styles.slice(styles.indexOf('.chatluna-studio-model-request-detail-pane::after {')).split('}')[0]
    expect(seamRule).toContain('position: absolute')
    expect(seamRule).toContain('inset: 0 17px auto')
    expect(seamRule).toContain('background: var(--chatluna-studio-surface)')
    expect(seamRule).toContain('pointer-events: none')
    expect(seamRule).toMatch(/height: [1-9]px/)
    expect(styles).not.toContain('.chatluna-studio-model-request-detail::after')
  })

  it('滚动阅读右侧时只跟随当前条目，不自动改变左侧分类折叠状态', () => {
    const view = readFileSync(resolve('client/model-request/analysis-view.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    expect(view).not.toContain('chatluna-studio-model-analysis-nav-fallback')
    expect(view).not.toContain('fallbackNavigationVisible')
    expect(view).not.toContain('navigationSourceElement')
    expect(styles).not.toContain('.chatluna-studio-model-analysis-nav-fallback')
    expect(view).not.toContain('resolveCollapsedAnalysisGroups')
    expect(view).not.toContain('resolveActiveAnalysisGroup')
    expect(view).toContain('resolveActiveAnalysisTarget')
    expect(view).toContain(":data-target=\"item.target\"")
    expect(view).toContain("'is-current': activeNavigationTarget === item.target")
    expect(view).toContain('const NAVIGATION_TARGET_SCROLL_TOP_MARGIN = 12')
    expect(view).toContain('const NAVIGATION_TARGET_SCROLL_BOTTOM_MARGIN = 32')
    expect(view).toMatch(/const visibleBottom = navigationRect\.bottom - NAVIGATION_TARGET_SCROLL_BOTTOM_MARGIN/)
    expect(view).toMatch(/navigation\.scrollTo\(\{ top: navigation\.scrollTop \+ itemRect\.bottom - visibleBottom, behavior: 'smooth' \}\)/)
    expect(styles).toMatch(/\.chatluna-studio-model-request-analysis \.chatluna-studio-model-analysis-nav \{[^}]*padding-bottom: 44px;/s)
    expect(styles).toContain('.chatluna-studio-model-analysis-nav-item.is-current')
    expect(view).not.toContain('collapsedNavigationGroups.value = new Set(resolveCollapsedAnalysisGroups(')
    expect(view).toContain("navigationScroller.addEventListener('scroll', scheduleNavigationTracking")
    expect(view).toContain("style.setProperty('--chatluna-studio-model-analysis-nav-height', `${scroller.clientHeight}px`)")
  })

  it('TOOL DEFS 强调框与消息卡片一样是圆角矩形', () => {
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    expect(styles).toMatch(/\.chatluna-studio-model-analysis-tools \{[^}]*overflow: hidden;[^}]*border-radius: 8px;/s)
    expect(styles).toContain('.chatluna-studio-model-analysis-tools.is-located')
  })

  it('字符数徽章保持单行，不被窄栏折成两行', () => {
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    expect(styles).toMatch(/\.chatluna-studio-model-analysis-chars \{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap;/s)
  })

  it('工具 Schema 使用请求页 JSON 树，而不是纯文本', () => {
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')
    const view = readFileSync(resolve('client/model-request/analysis-view.vue'), 'utf8')

    expect(view).toContain('class="chatluna-studio-model-analysis-tool-schema chatluna-studio-model-request-json-viewer"')
    expect(view).toContain(':node="toolParametersJsonTree(tool)"')
    expect(view).toContain("cachedJsonTree(`parameters:${tool.evidenceId}`, 'parameters', () => tool.parameters || {})")
    expect(view).not.toContain('formatJson(tool.parameters')
    expect(styles).toMatch(/\.chatluna-studio-model-analysis-tool-schema\.chatluna-studio-model-request-json-viewer \{[^}]*min-height: 0;[^}]*padding: 12px;/s)
  })

  /**
   * 工具载荷（工具调用参数、工具结果、请求里携带的工具结果消息）默认走 JSON 树。
   *
   * 三处都要接线，而漏掉一处不会报错：那一处的载荷会继续挤成一行、字符串里的换行仍停在 `\n`
   * 转义上，只在肉眼比对另外两处时才看得出来。`v-else` 分支同样是契约的一部分——截断的参数与
   * 纯文本结果必须仍能按原文读到。
   */
  it('三处工具载荷默认按结构显示，解析不出结构时退回原文', () => {
    const view = readFileSync(resolve('client/model-request/analysis-view.vue'), 'utf8')
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')

    for (const accessor of ['callArgumentsTree(call)', 'toolResultTree(result)']) {
      expect(view).toContain(`v-if="${accessor}"`)
      expect(view).toContain(`:node="${accessor}!"`)
    }
    // 工具结果消息排在精确 occurrence 之后：occurrence 的范围按正文偏移量算，只有原文能标出来。
    expect(view).toContain('v-else-if="messagePayloadTree(message)"')
    expect(view).toContain(':node="messagePayloadTree(message)!"')
    expect(view).toContain('class="chatluna-studio-model-analysis-tool-payload chatluna-studio-model-request-json-viewer"')
    // 请求侧与响应侧的工具调用各有一个原文退路，工具结果一个，合计三处 v-else。
    expect(view.match(/<AnalysisTextBlock\s+v-else(?!-)/g)).toHaveLength(3)
    expect(view).not.toContain('parseAnalysisJson')
    expect(styles).toMatch(/\.chatluna-studio-model-analysis-tool-payload\.chatluna-studio-model-request-json-viewer \{[^}]*max-height: 420px;/s)
  })

  /**
   * 搜索命中的载荷退回原文。
   *
   * 命中高亮由正文那棵 pre 画出来，结构树里没有 `<mark>`；不退回原文，命中的卡片会一边不被静音、
   * 一边看不出命中在哪。
   */
  it('搜索命中的工具载荷退回原文', () => {
    const view = readFileSync(resolve('client/model-request/analysis-view.vue'), 'utf8')

    expect(view).toContain('payloadMatchesSearch(call.arguments)')
    expect(view).toContain('payloadMatchesSearch(result.content)')
    expect(view).toContain('payloadMatchesSearch(message.content)')
    expect(view).toMatch(/resolveModelRequestToolPayload\(value, \{ revealText \}\)\.kind !== 'json'/)
  })

  /**
   * 两条 `toggleCardFromHeader` 是**接线**：消息卡片与响应卡片的头部空白各自接到自己那个折叠目标。
   * 少接一根线不会报错，表现为其中一类卡片点头部空白没反应，或者折叠了另一张卡。
   * `event.target.closest('button')` 是留在视图里的守卫判定：不加它，点头部里的按钮会连着折叠一次
   * （ADR 0073 第 4 类）。其余是否定式的已删实现守卫与布局分支契约。
   */
  it('去掉完整请求 JSON 入口，卡片正文不再标「内容」，头部空白可折叠', () => {
    const view = readFileSync(resolve('client/model-request/analysis-view.vue'), 'utf8')

    expect(view).not.toContain('完整请求 JSON')
    expect(view).not.toContain('返回对话')
    expect(view).not.toContain('toggleRawRequest')
    expect(view).not.toContain('label="内容"')
    expect(view).not.toContain("index === 0 ? '内容'")
    expect(view).toContain('@click="toggleCardFromHeader($event, modelAnalysisTargetId(message.evidenceId))"')
    expect(view).toContain('@click="toggleCardFromHeader($event, MODEL_ANALYSIS_RESPONSE_TARGET)"')
    expect(view).toContain('event.target.closest(\'button\')')
    expect(view).toContain("v-if=\"layout !== 'inspector'\"")
    expect(view).toContain("layout === 'inspector'")
  })

  it('折叠长文本用渐隐遮罩并居中展开按钮，避免半透明实色透出字形', () => {
    const styles = readFileSync(resolve('client/model-request/styles.css'), 'utf8')
    const view = readFileSync(resolve('client/model-request/analysis-view.vue'), 'utf8')

    expect(view).toContain("class: 'chatluna-studio-model-analysis-expand'")
    expect(view).toContain('展开全部（${blockProps.value.length} 字符）')
    expect(view).toContain("h(IconChevronDown, { size: 12, 'aria-hidden': 'true' })")
    expect(styles).toMatch(/\.chatluna-studio-model-analysis-expand \{[^}]*display: flex;[^}]*justify-content: center;/s)
    expect(styles).toContain('.chatluna-studio-model-analysis-section:not(.is-collapsed) .chatluna-studio-model-analysis-expand svg { transform: rotate(180deg); }')
    expect(styles).toContain('-webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 48px), transparent);')
    expect(styles).toContain('mask-image: linear-gradient(to bottom, #000 calc(100% - 48px), transparent);')
    expect(styles).not.toContain('.chatluna-studio-model-analysis-text-wrap::after')
    expect(styles).not.toContain('opacity: 0.92')
  })

  it('只允许 HTTP(S) 与非 SVG 图片 Data URL 进入图片预览', () => {
    expect(isPreviewableConversationImage('https://example.com/image.png')).toBe(true)
    expect(isPreviewableConversationImage('data:image/png;base64,aGVsbG8=')).toBe(true)
    expect(isPreviewableConversationImage('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isPreviewableConversationImage('data:text/html;base64,PGgxPng8L2gxPg==')).toBe(false)
    expect(isPreviewableConversationImage('javascript:alert(1)')).toBe(false)
  })
})
