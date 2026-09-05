import { describe, expect, it } from 'vitest'
import {
  projectCompositionFocusBoundary,
  projectCompositionFocusSpan,
  resolveCompositionFocusFlip,
  resolveCompositionFocusWindow,
  type CompositionFocusSlot,
} from '../client/model-request/composition-focus'

/** 四条请求平分整段会话轴，用来断言窗口与投影；每格 25%。 */
const EVEN_SLOTS: readonly CompositionFocusSlot[] = [
  { id: 'r1', left: 0, width: 25 },
  { id: 'r2', left: 25, width: 25 },
  { id: 'r3', left: 50, width: 25 },
  { id: 'r4', left: 75, width: 25 },
]

function focused(...ids: string[]) {
  return new Set(ids)
}

describe('请求组成图焦点窗口', () => {
  it('全部折叠时没有窗口，轨道铺整段会话', () => {
    expect(resolveCompositionFocusWindow(EVEN_SLOTS, focused())).toBeUndefined()
  })

  it('全部展开与全部折叠同义：并集等于整条轴，不给出窗口', () => {
    expect(resolveCompositionFocusWindow(EVEN_SLOTS, focused('r1', 'r2', 'r3', 'r4'))).toBeUndefined()
  })

  it('只展开一条时窗口等于那一格，它的分段因此铺满整条轨道', () => {
    const window = resolveCompositionFocusWindow(EVEN_SLOTS, focused('r2'))

    expect(window).toEqual({ left: 25, width: 25 })
    // 请求内部的分段本来就按字符占比铺满自己那一格，投影后与单请求视图的读法一致。
    expect(projectCompositionFocusSpan(window, { left: 25, width: 10 })).toEqual({ left: 0, width: 40 })
    expect(projectCompositionFocusSpan(window, { left: 35, width: 15 })).toEqual({ left: 40, width: 60 })
  })

  it('展开两条时窗口取并集跨度，夹在中间的请求一起露出来', () => {
    const window = resolveCompositionFocusWindow(EVEN_SLOTS, focused('r2', 'r4'))

    expect(window).toEqual({ left: 25, width: 75 })
    // 中间那条请求落在并集里：窗口是时间轴上的一段，不是被展开项的拼贴。
    const middle = projectCompositionFocusSpan(window, { left: 50, width: 25 })!
    expect(middle.left).toBeCloseTo(100 / 3)
    expect(middle.width).toBeCloseTo(100 / 3)
  })

  it('进行中的请求没有跨度，单独展开它时退回整段会话而不是放大一格空白', () => {
    const slots: readonly CompositionFocusSlot[] = [
      { id: 'r1', left: 0, width: 40 },
      { id: 'r2', left: 40, width: 40 },
      { id: 'pending', left: 99.25, width: 0 },
    ]

    expect(resolveCompositionFocusWindow(slots, focused('pending'))).toBeUndefined()
    // 与一条有跨度的请求一起展开时并集成立，照常放大。
    expect(resolveCompositionFocusWindow(slots, focused('r2', 'pending'))).toEqual({ left: 40, width: 59.25 })
  })

  it('展开清单还带着上一份轨迹的请求标识时退回整段会话', () => {
    expect(resolveCompositionFocusWindow(EVEN_SLOTS, focused('从前一条会话带过来的标识'))).toBeUndefined()
    expect(resolveCompositionFocusWindow([], focused('r1'))).toBeUndefined()
  })
})

describe('请求组成图焦点投影', () => {
  const window = { left: 25, width: 25 }

  it('窗口外的分段不渲染：留着它们会撑出滚动范围，用户能把窗口滚开', () => {
    expect(projectCompositionFocusSpan(window, { left: 0, width: 20 })).toBeUndefined()
    expect(projectCompositionFocusSpan(window, { left: 60, width: 10 })).toBeUndefined()
  })

  it('跨过窗口边缘的分段夹进窗口内，不给滚动范围留余量', () => {
    expect(projectCompositionFocusSpan(window, { left: 20, width: 10 })).toEqual({ left: 0, width: 20 })
    expect(projectCompositionFocusSpan(window, { left: 45, width: 10 })).toEqual({ left: 80, width: 20 })
    expect(projectCompositionFocusSpan(window, { left: 0, width: 100 })).toEqual({ left: 0, width: 100 })
  })

  it('零宽分段留在窗口里：进行中的请求靠它在轨道上标出起点', () => {
    expect(projectCompositionFocusSpan(window, { left: 30, width: 0 })).toEqual({ left: 20, width: 0 })
  })

  it('邻格贴着窗口边缘的残留不画：它会在边缘变成一枚最小宽度的短桩', () => {
    // 前一条请求的末段正好结束在窗口起点上，后一条请求的首段正好从窗口终点开始。
    expect(projectCompositionFocusSpan(window, { left: 24, width: 1 })).toBeUndefined()
    expect(projectCompositionFocusSpan(window, { left: 50, width: 1 })).toBeUndefined()
  })

  it('投影是纯线性缩放，不重新兜最小宽度，因此同一档的厚度关系不变', () => {
    const thin = projectCompositionFocusSpan(window, { left: 25, width: 0.35 })!
    const thick = projectCompositionFocusSpan(window, { left: 30, width: 3.5 })!

    // 焦点里再兜一次最小宽度会让细分段随倍率变厚，读出来的占比比真实值大。
    expect(thick.width / thin.width).toBeCloseTo(10)
  })

  it('没有窗口时分段与边界线原样保留', () => {
    expect(projectCompositionFocusSpan(undefined, { left: 40, width: 5 })).toEqual({ left: 40, width: 5 })
    expect(projectCompositionFocusBoundary(undefined, 40)).toBe(40)
  })

  it('请求边界线按窗口坐标画，窗口外的那几根不画', () => {
    expect(projectCompositionFocusBoundary(window, 25)).toBe(0)
    expect(projectCompositionFocusBoundary(window, 37.5)).toBe(50)
    expect(projectCompositionFocusBoundary(window, 50)).toBe(100)
    expect(projectCompositionFocusBoundary(window, 51)).toBeUndefined()
    expect(projectCompositionFocusBoundary(window, 24)).toBeUndefined()
  })
})

describe('请求组成图焦点动画的起始变换', () => {
  it('放大：新几何先摆回旧窗口里那一格的位置与大小', () => {
    const flip = resolveCompositionFocusFlip(undefined, { left: 25, width: 25 })!

    // 铺满全宽的新几何缩到四分之一、右移到 25%，正是它在整段会话里原本占的那一格。
    expect(flip.scaleX).toBeCloseTo(0.25)
    expect(flip.translateX).toBeCloseTo(25)
  })

  it('缩小：整段会话的新几何先按旧窗口放大，让原来那一格仍然铺满轨道', () => {
    const flip = resolveCompositionFocusFlip({ left: 25, width: 25 }, undefined)!

    expect(flip.scaleX).toBeCloseTo(4)
    expect(flip.translateX).toBeCloseTo(-100)
  })

  it('展开第二条：窗口从一格扩到并集，起始变换按两个窗口的比值求得', () => {
    const flip = resolveCompositionFocusFlip({ left: 25, width: 25 }, { left: 25, width: 75 })!

    expect(flip.scaleX).toBeCloseTo(3)
    expect(flip.translateX).toBeCloseTo(0)
  })

  it('同一个窗口重新求一遍值不产生动画：自动刷新不该打断正在跑的那一段', () => {
    expect(resolveCompositionFocusFlip(undefined, undefined)).toBeUndefined()
    expect(resolveCompositionFocusFlip({ left: 25, width: 25 }, { left: 25, width: 25 })).toBeUndefined()
    expect(resolveCompositionFocusFlip({ left: 0, width: 100 }, undefined)).toBeUndefined()
  })
})
