import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeEvidencePreviewText } from '../src/evidence-preview-text'

function read(path: string): string {
  return readFileSync(resolve(path), 'utf8')
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1
}

function naive(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

describe('证据预览文本归一化', () => {
  it('与整段归一化的结果在预览长度内完全一致', () => {
    const samples = [
      '',
      '   ',
      '短文本',
      '  前后有空白  ',
      'a\n\n\nb\t\tc',
      `${' '.repeat(20_000)}折叠后才出现的正文${'x'.repeat(500)}`,
      `${'词 '.repeat(30_000)}尾巴`,
      'x'.repeat(50_000),
      `第一行\n${'内容 '.repeat(10_000)}`,
    ]
    for (const sample of samples) {
      for (const minLength of [0, 1, 80, 180, 1000]) {
        const normalized = normalizeEvidencePreviewText(sample, minLength)
        const expected = naive(sample)
        if (normalized.length <= minLength) expect(normalized).toBe(expected)
        else expect(expected.slice(0, minLength)).toBe(normalized.slice(0, minLength))
      }
    }
  })

  it('空白折叠让前缀不够长时继续扩大扫描范围', () => {
    // 前 40000 个字符全是空白；只扫固定长度的前缀会得到空预览。
    const value = `${' '.repeat(40_000)}${'正文'.repeat(200)}`
    expect(normalizeEvidencePreviewText(value, 180).length).toBeGreaterThan(180)
  })
})

describe('模型请求视图的重复计算', () => {
  it('轨迹派生不再经由详情投影绕路', () => {
    const source = read('src/model-request-trajectory.ts')

    expect(source).not.toContain('presentModelRequestRecord')
    expect(source).toContain('deriveModelRequestVariables(record.presetSnapshots, projection)')
    expect(source).toContain('projectRequestRows(projection, variables)')
    expect(source).toContain('projectPromptComposition(projection, variables)')
    expect(count(source, 'projectModelEvidence(')).toBe(1)
    expect(source).toContain('normalizeEvidencePreviewText')
  })

  /**
   * 这一组守的是**成本结构**而不是判定：原文树按需挂载、JSON 树按证据身份缓存、搜索文本按会话
   * 折叠一次、一个 Tooltip Provider、滚动跟随只量导航锚点。少哪一条都不会报错，只表现为打开一条
   * 大请求的分析变慢、搜索时输入掉帧——没有任何红灯，因此这些肯定式断言按 ADR 0073 第 4 类保留。
   *
   * 「原文一旦挂载就留着」与「从未切开的消息不进已挂载集合」这两条**行为**已经下沉到
   * `client/model-request/analysis-expansion.ts`，由 `tests/analysis-expansion.test.ts` 断言；
   * 这里只剩「已挂载才挂载」这一处渲染面的接线。
   */
  it('分析页的原始 JSON 树按需挂载并缓存', () => {
    const view = read('client/model-request/analysis-view.vue')

    expect(view).toContain('v-if="isMessageRawMounted(message.evidenceId)"')
    expect(view).toContain('v-if="responseRawMounted"')
    expect(view).toContain(':node="messageJsonTree(message)"')
    expect(view).toContain(':node="responseJsonTree()"')
    // 模板里直接构树会在每次重渲染时重建整棵树。
    expect(view).not.toContain(':node="buildModelRequestJsonTree(')
    expect(view).toContain('let jsonTrees = new Map<string, ModelRequestJsonNode>()')
    // 搜索文本按会话折叠一次，而不是每次渲染重新 toLocaleLowerCase 整段会话。
    expect(view).toContain('const messageSearchTexts = computed(')
    expect(view).toContain('const toolSearchTexts = computed(')
    // 变量的搜索文本由导航项派生一次，卡片按 id 读回来，而不是每次渲染再拼一遍。
    expect(view).toContain('matchesAnalysisSearch(navigation.value, variable.id, normalizedSearch.value)')
    expect(view).not.toContain('const variableSearchTexts = computed(')
    // 一个 Provider 覆盖整段分析。
    expect(count(view, '<TooltipProvider')).toBe(1)
    // 滚动跟随只量导航条目指向的锚点，并缓存解析结果。
    expect(view).toContain('resolveNavigationTargetElements(content)')
    expect(view).toContain('navigationTargetsDirty')
  })

  it('轨迹账本按身份表定位请求，不再逐行扫描记录', () => {
    const view = read('client/model-request/trajectory.vue')

    expect(view).toContain('const requestOrderById = computed(')
    expect(view).toContain('const requestLabelById = computed(')
    expect(view).toContain('const rowById = computed(')
    expect(view).toContain('requestOrderById.value.get(requestId)')
    expect(view).toContain('requestLabelById.value.get(requestId)')
    expect(view).not.toContain('records.findIndex(')
    expect(view).not.toContain('requestRows.value.indexOf(')
    // 行搜索文本预先折叠成小写，过滤只查一次集合。
    expect(view).toContain('const rowSearchTexts = computed(')
    expect(view).toContain('const searchMutedRowIds = computed(')
    expect(view).toContain('searchMutedRowIds.value?.has(row.id)')
  })

  it('历史消息预览分趟量测并合并到一帧', () => {
    const preview = read('client/model-request/history-preview.vue')
    const clear = preview.indexOf("content.style.removeProperty('--chatluna-studio-model-history-content-max-width')")
    const measureRect = preview.indexOf('const previewRect = preview.getBoundingClientRect()')
    const write = preview.indexOf("content.style.setProperty('--chatluna-studio-model-history-content-max-width'")

    // 清除、读取、写回必须分成三趟；读写交替会让每条消息各触发一次强制重排。
    expect(clear).toBeGreaterThan(0)
    expect(measureRect).toBeGreaterThan(clear)
    expect(write).toBeGreaterThan(measureRect)
    expect(preview).toContain('function scheduleMeasure()')
    expect(preview).toContain('new ResizeObserver(scheduleMeasure)')
    // 折行判断用行高，不再逐行建 Range。
    expect(preview).toContain('lineHeight * 1.5')
    // 渲染事实预先算好，模板里不再逐条调用函数。
    expect(preview).toContain('const displayMessages = computed<HistoryDisplayMessage[]>')
    expect(preview).not.toContain('{ deep: true }')
    expect(count(preview, '<TooltipProvider')).toBe(1)
  })

  it('会话身份从记录自带的实体派生，列表不逐行扫目录', () => {
    const workspace = read('client/model-request/workspace.vue')

    // 名称与头像随请求一起快照在 entities 上，因此每一行只做一次纯函数换算；
    // 逐行去筛一份机器人目录会让一页记录扫上百遍。
    expect(workspace).toContain("resolveBotIdentity(record.entities")
    expect(workspace).not.toContain('props.bots')
    // 会话下拉的可选值来自服务端聚合，只在机器人变化时重算一次。
    expect(workspace).toContain('const selectableConversations = computed(')
  })
})
