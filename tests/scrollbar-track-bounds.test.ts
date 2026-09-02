import { describe, expect, it } from 'vitest'
import {
  computeVisibleScrollbarRect,
  findScrollbarHeaderBottom,
  type ScrollbarBoundsNode,
} from '../client/shared/scrollbar-track-bounds'

/**
 * 最小结构接口的内存替身（ADR 0075）：只实现沿祖先链上行、按选择器认出兄弟、读一个矩形
 * 这三项，不引入 jsdom，也不声明 DOM 类型。
 */
interface FakeNodeInput {
  readonly selector?: string
  readonly rect?: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>
  readonly children?: FakeNode[]
}

class FakeNode implements ScrollbarBoundsNode {
  parentElement: FakeNode | null = null
  readonly children: FakeNode[]
  private readonly selector: string
  private readonly rect: { top: number, right: number, bottom: number, left: number }

  constructor(input: FakeNodeInput = {}) {
    this.selector = input.selector ?? ''
    this.rect = { top: 0, right: 0, bottom: 0, left: 0, ...input.rect }
    this.children = input.children ?? []
    for (const child of this.children) child.parentElement = this
  }

  matches(selector: string) {
    return !!this.selector && selector.split(',').map((part) => part.trim()).includes(this.selector)
  }

  getBoundingClientRect() {
    return this.rect
  }
}

function header(bottom: number, selector = 'header') {
  return new FakeNode({ selector, rect: { top: bottom - 48, bottom } })
}

describe('滚动条轨道边界', () => {
  it('取滚动区域前面那个页内表头的底缘', () => {
    const scroller = new FakeNode({ rect: { top: 100, bottom: 800 } })
    const shell = new FakeNode({ children: [header(148), scroller] })

    expect(findScrollbarHeaderBottom(scroller, shell)).toBe(148)
  })

  it('认得 .chatluna-studio-overlay-header 这种非 header 标签的页内表头', () => {
    const scroller = new FakeNode({ rect: { top: 100, bottom: 800 } })
    const shell = new FakeNode({ children: [header(160, '.chatluna-studio-overlay-header'), scroller] })

    expect(findScrollbarHeaderBottom(scroller, shell)).toBe(160)
  })

  it('沿祖先链上行，表头不必和滚动区域同层', () => {
    const scroller = new FakeNode({ rect: { top: 100, bottom: 800 } })
    const region = new FakeNode({ children: [scroller] })
    const shell = new FakeNode({ children: [header(148), region] })

    expect(findScrollbarHeaderBottom(scroller, shell)).toBe(148)
  })

  /**
   * 表头一定排在滚动区域之前。往后找会把内容区里的次级标题当成表头，
   * 轨道会被无端截掉一大截，而且不会报错。
   */
  it('排在滚动区域后面的表头不算数', () => {
    const scroller = new FakeNode({ rect: { top: 100, bottom: 800 } })
    const shell = new FakeNode({ rect: { top: 60 }, children: [scroller, header(900)] })

    expect(findScrollbarHeaderBottom(scroller, shell)).toBe(60)
  })

  it('一个表头都没有时退回外壳顶缘', () => {
    const scroller = new FakeNode({ rect: { top: 100, bottom: 800 } })
    const shell = new FakeNode({ rect: { top: 60 }, children: [scroller] })

    expect(findScrollbarHeaderBottom(scroller, shell)).toBe(60)
  })

  it('连外壳都没有时不裁剪', () => {
    const scroller = new FakeNode({ rect: { top: 100, bottom: 800 } })

    expect(findScrollbarHeaderBottom(scroller, undefined)).toBe(Number.NEGATIVE_INFINITY)
  })

  /**
   * 毛玻璃表头要求滚动内容用负 margin 延伸到表头背后（ADR 0071）。内容延伸是对的，
   * 轨道跟着延伸就会压在表头上，因此轨道顶缘必须被表头底缘顶下来。
   */
  it('轨道顶缘被表头底缘顶下来，而不是跟着内容延伸到表头背后', () => {
    const scroller = new FakeNode({ rect: { top: 60, right: 400, bottom: 800, left: 0 } })
    const shell = new FakeNode({
      rect: { top: 0, right: 400, bottom: 900, left: 0 },
      children: [header(148), scroller],
    })

    const rect = computeVisibleScrollbarRect(scroller, shell)
    expect(rect.top).toBe(148)
    expect(rect.height).toBe(652)
  })

  it('轨道被工作台外壳四边夹住', () => {
    const scroller = new FakeNode({ rect: { top: 100, right: 500, bottom: 1000, left: -20 } })
    const shell = new FakeNode({
      rect: { top: 60, right: 400, bottom: 900, left: 0 },
      children: [scroller],
    })

    expect(computeVisibleScrollbarRect(scroller, shell)).toEqual({
      top: 100,
      right: 400,
      bottom: 900,
      left: 0,
      width: 400,
      height: 800,
    })
  })

  it('外壳外的浮层滚动区域只截顶，不夹边', () => {
    const scroller = new FakeNode({ rect: { top: 100, right: 500, bottom: 1000, left: -20 } })

    expect(computeVisibleScrollbarRect(scroller, undefined)).toEqual({
      top: 100,
      right: 500,
      bottom: 1000,
      left: -20,
      width: 520,
      height: 900,
    })
  })

  it('区域被完全遮住时高度与宽度收敛到零而不是负数', () => {
    const scroller = new FakeNode({ rect: { top: 900, right: 500, bottom: 1000, left: 450 } })
    const shell = new FakeNode({
      rect: { top: 60, right: 400, bottom: 800, left: 0 },
      children: [scroller],
    })

    const rect = computeVisibleScrollbarRect(scroller, shell)
    expect(rect.width).toBe(0)
    expect(rect.height).toBe(0)
  })
})
