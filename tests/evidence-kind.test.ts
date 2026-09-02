import { describe, expect, it } from 'vitest'
import {
  STUDIO_EVIDENCE_AGGREGATE_IDS,
  STUDIO_EVIDENCE_KINDS,
  isStudioEvidenceAggregateMember,
  studioEvidenceAggregate,
  studioEvidenceLabels,
  type StudioEvidenceKind,
} from '../src/evidence-kind'

describe('证据种类', () => {
  it('基础证据种类取最细一档，与领域词汇表的证据词条一一对应', () => {
    expect(STUDIO_EVIDENCE_KINDS).toEqual([
      'system',
      'user',
      'assistant',
      'variable',
      'tool-definition',
      'tool-call',
      'tool-result',
      'response',
    ])
  })

  it('请求边界不是证据种类：它是「一次模型请求从这里开始」的结构标记', () => {
    expect(STUDIO_EVIDENCE_KINDS).not.toContain('request')
  })

  it('每种基础证据种类成对交出徽标与标题两个标签变体', () => {
    for (const kind of STUDIO_EVIDENCE_KINDS) {
      const labels = studioEvidenceLabels(kind)
      expect(labels.badge, kind).toBeTruthy()
      expect(labels.title, kind).toBeTruthy()
      // 成对声明：徽标变体永远是标题变体的全大写形式，两者不可能各自漂移。
      expect(labels.badge, kind).toBe(labels.title.toUpperCase())
    }
  })

  it('徽标变体全大写，标题变体词首大写', () => {
    for (const id of [...STUDIO_EVIDENCE_KINDS, ...STUDIO_EVIDENCE_AGGREGATE_IDS]) {
      const { badge, title } = studioEvidenceLabels(id)
      expect(badge, id).toBe(badge.toUpperCase())
      expect(title.split(' ').map(word => word[0]), id).toEqual(title.split(' ').map(word => word[0]?.toUpperCase()))
      expect(title, id).not.toBe(title.toUpperCase())
    }
  })

  it('标签全部是英文，同一张表里不混入中文', () => {
    for (const id of [...STUDIO_EVIDENCE_KINDS, ...STUDIO_EVIDENCE_AGGREGATE_IDS]) {
      const { badge, title } = studioEvidenceLabels(id)
      expect(`${badge}${title}`, id).not.toMatch(/[一-鿿]/)
    }
  })

  it('工具交互聚合恰好包含工具调用与工具结果', () => {
    expect(studioEvidenceAggregate('tool-interaction').members).toEqual(['tool-call', 'tool-result'])
    expect(isStudioEvidenceAggregateMember('tool-interaction', 'tool-call')).toBe(true)
    expect(isStudioEvidenceAggregateMember('tool-interaction', 'tool-result')).toBe(true)
    // 工具定义按字符占比独立成轨，不与工具交互合并统计。
    expect(isStudioEvidenceAggregateMember('tool-interaction', 'tool-definition')).toBe(false)
    expect(isStudioEvidenceAggregateMember('tool-interaction', 'assistant')).toBe(false)
  })

  it('工具分组聚合恰好包含三种工具证据', () => {
    expect(studioEvidenceAggregate('tool').members).toEqual(['tool-definition', 'tool-call', 'tool-result'])
    for (const kind of ['tool-definition', 'tool-call', 'tool-result'] as const) {
      expect(isStudioEvidenceAggregateMember('tool', kind), kind).toBe(true)
    }
    expect(isStudioEvidenceAggregateMember('tool', 'variable')).toBe(false)
  })

  it('聚合成员既不重复也不遗漏，且全部是基础证据种类', () => {
    for (const id of STUDIO_EVIDENCE_AGGREGATE_IDS) {
      const { members } = studioEvidenceAggregate(id)
      expect(new Set(members).size, id).toBe(members.length)
      expect(members.filter(kind => !STUDIO_EVIDENCE_KINDS.includes(kind)), id).toEqual([])
      expect(members.length, id).toBeGreaterThan(1)
    }
    const kinds = STUDIO_EVIDENCE_KINDS as readonly string[]
    expect(STUDIO_EVIDENCE_AGGREGATE_IDS.filter(id => kinds.includes(id))).toEqual([])
  })

  it('聚合有自己的标签，不与基础种类的标签混用', () => {
    const baseLabels = STUDIO_EVIDENCE_KINDS.flatMap((kind) => {
      const { badge, title } = studioEvidenceLabels(kind)
      return [badge, title]
    })
    for (const id of STUDIO_EVIDENCE_AGGREGATE_IDS) {
      const { badge, title } = studioEvidenceAggregate(id).labels
      expect(baseLabels, id).not.toContain(badge)
      expect(baseLabels, id).not.toContain(title)
    }
  })

  it('取标签只需一个参数，聚合与基础种类走同一个入口', () => {
    expect(studioEvidenceLabels('tool-definition')).toEqual({ badge: 'TOOL DEFS', title: 'Tool Defs' })
    expect(studioEvidenceLabels('tool-interaction')).toEqual({ badge: 'TOOL I/O', title: 'Tool I/O' })
    expect(studioEvidenceLabels('tool')).toEqual({ badge: 'TOOL', title: 'Tool' })
    expect(studioEvidenceLabels('response')).toEqual({ badge: 'RESPONSE', title: 'Response' })
  })

  /**
   * 浏览器安全的行为证据：整个 module 在没有 DOM、没有 Vue 实例的环境里完成全部工作。
   * 真正的 Node / Koishi 依赖会在客户端构建时炸掉，那由构建验收兜住。
   */
  it('不依赖 DOM 就能交出全部分类与标签', () => {
    expect(typeof document).toBe('undefined')
    const labels = STUDIO_EVIDENCE_KINDS.map(kind => studioEvidenceLabels(kind).badge)
    expect(new Set(labels).size).toBe(STUDIO_EVIDENCE_KINDS.length)
  })

  it('聚合成员表不可被调用方改写', () => {
    const members = studioEvidenceAggregate('tool-interaction').members as StudioEvidenceKind[]
    expect(() => members.push('assistant')).toThrow()
    expect(studioEvidenceAggregate('tool-interaction').members).toEqual(['tool-call', 'tool-result'])
  })
})
