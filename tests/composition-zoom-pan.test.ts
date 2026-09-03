import { describe, expect, it } from 'vitest'
import {
  COMPOSITION_CLICK_SUPPRESSION_MS,
  COMPOSITION_DRAG_THRESHOLD_PX,
  COMPOSITION_ZOOM_MAX,
  COMPOSITION_ZOOM_MIN,
  COMPOSITION_ZOOM_STEP,
  createCompositionZoomPan,
  type CompositionPanViewport,
} from '../client/model-request/composition-zoom-pan'

class FakeViewport implements CompositionPanViewport {
  scrollLeft = 0
  clientWidth = 400
  left = 100
  readonly captured = new Set<number>()

  getBoundingClientRect() {
    return { left: this.left }
  }

  setPointerCapture(pointerId: number) {
    this.captured.add(pointerId)
  }

  releasePointerCapture(pointerId: number) {
    this.captured.delete(pointerId)
  }

  hasPointerCapture(pointerId: number) {
    return this.captured.has(pointerId)
  }
}

function harness(overrides: { viewport?: CompositionPanViewport | undefined } = {}) {
  const viewport = 'viewport' in overrides ? overrides.viewport : new FakeViewport()
  let clock = 1000
  const pan = createCompositionZoomPan({
    viewport: () => viewport,
    // 真实实现要等轨道按新倍率重排，测试直接同步执行以便断言最终滚动量。
    afterZoom: (apply) => apply(),
    now: () => clock,
  })
  return { pan, viewport, advance: (ms: number) => { clock += ms } }
}

function wheel(input: { ctrlKey?: boolean, deltaY: number, clientX?: number }) {
  let prevented = false
  return {
    event: {
      ctrlKey: input.ctrlKey ?? true,
      deltaY: input.deltaY,
      clientX: input.clientX ?? 0,
      preventDefault: () => { prevented = true },
    },
    wasPrevented: () => prevented,
  }
}

describe('请求组成图轨道缩放', () => {
  it('缩放夹在上下界之间，到界后不再变化', () => {
    const { pan } = harness()

    pan.setZoom(COMPOSITION_ZOOM_MIN - 5)
    expect(pan.zoom.value).toBe(COMPOSITION_ZOOM_MIN)

    pan.setZoom(COMPOSITION_ZOOM_MAX + 5)
    expect(pan.zoom.value).toBe(COMPOSITION_ZOOM_MAX)

    pan.setZoom(Number.POSITIVE_INFINITY)
    expect(pan.zoom.value).toBe(COMPOSITION_ZOOM_MAX)
  })

  it('锚点下的内容在缩放前后保持不动', () => {
    const { pan, viewport } = harness()
    const fake = viewport as FakeViewport
    fake.scrollLeft = 0

    // 指针停在视图口左边 100px 处（clientX 200 − 容器左边界 100）。
    pan.setZoom(2, 200)

    expect(pan.zoom.value).toBe(2)
    // 原来贴在锚点上的内容坐标 100，放大两倍后位于 200，减去锚点偏移仍要露在同一位置。
    expect(fake.scrollLeft).toBe(100)
  })

  it('不给锚点时以视图口中心为锚点', () => {
    const { pan, viewport } = harness()
    const fake = viewport as FakeViewport
    fake.scrollLeft = 0

    pan.setZoom(2)

    expect(fake.scrollLeft).toBe(200)
  })

  it('锚点被夹在视图口两端，指针跑到容器外时按最近的边界补偿', () => {
    const left = harness()
    const leftViewport = left.viewport as FakeViewport
    leftViewport.scrollLeft = 100

    left.pan.setZoom(2, -9999)

    // 锚点夹到 0：内容坐标 100 放大两倍后应露在 200，而不是按 −9999 算成负数再夹到 0。
    expect(leftViewport.scrollLeft).toBe(200)

    const right = harness()
    const rightViewport = right.viewport as FakeViewport
    rightViewport.scrollLeft = 0

    right.pan.setZoom(2, 9999)

    // 锚点夹到视图口右边界 400：内容坐标 400 放大后为 800，减去锚点仍是 400。
    expect(rightViewport.scrollLeft).toBe(400)
  })

  it('没有视图口时仍然改倍率，只是没有滚动补偿', () => {
    const { pan } = harness({ viewport: undefined })

    pan.setZoom(3)

    expect(pan.zoom.value).toBe(3)
  })
})

describe('请求组成图滚轮与拖动', () => {
  it('只有按住 Ctrl 才接管滚轮，否则保留页面滚动', () => {
    const { pan } = harness()
    const plain = wheel({ ctrlKey: false, deltaY: -120 })

    pan.handleWheel(plain.event)

    expect(pan.zoom.value).toBe(COMPOSITION_ZOOM_MIN)
    expect(plain.wasPrevented()).toBe(false)
  })

  it('横向滚轮不改倍率，纵向按步进放大与缩小', () => {
    const { pan } = harness()

    pan.handleWheel(wheel({ deltaY: 0 }).event)
    expect(pan.zoom.value).toBe(COMPOSITION_ZOOM_MIN)

    const zoomIn = wheel({ deltaY: -120 })
    pan.handleWheel(zoomIn.event)
    expect(pan.zoom.value).toBe(COMPOSITION_ZOOM_MIN + COMPOSITION_ZOOM_STEP)
    expect(zoomIn.wasPrevented()).toBe(true)

    pan.handleWheel(wheel({ deltaY: 120 }).event)
    expect(pan.zoom.value).toBe(COMPOSITION_ZOOM_MIN)
  })

  it('位移不到阈值仍算单击：不进入拖动态、不滚动轨道，也不接住指针', () => {
    const { pan, viewport } = harness()
    const fake = viewport as FakeViewport
    fake.scrollLeft = 50

    pan.handlePointerDown({ pointerId: 1, button: 0, clientX: 300 })
    // 按下当拍就捕获指针会把 click 改派到视图口，分段按钮因此收不到自己的点击。
    expect(fake.hasPointerCapture(1)).toBe(false)

    pan.handlePointerMove({ pointerId: 1, clientX: 300 + COMPOSITION_DRAG_THRESHOLD_PX - 1 })

    expect(pan.dragging.value).toBe(false)
    expect(fake.hasPointerCapture(1)).toBe(false)
    expect(fake.scrollLeft).toBe(50)

    pan.finishDrag({ pointerId: 1, clientX: 302 })
    expect(pan.consumeSuppressedClick()).toBe(false)
  })

  it('越过阈值后按位移反向滚动，并在那一拍接住指针', () => {
    const { pan, viewport } = harness()
    const fake = viewport as FakeViewport
    fake.scrollLeft = 50

    pan.handlePointerDown({ pointerId: 1, button: 0, clientX: 300 })
    pan.handlePointerMove({ pointerId: 1, clientX: 260 })

    expect(pan.dragging.value).toBe(true)
    expect(fake.hasPointerCapture(1)).toBe(true)
    expect(fake.scrollLeft).toBe(90)

    // 接住之后指针移出视图口仍要继续拖动。
    pan.handlePointerMove({ pointerId: 1, clientX: 100 })
    expect(fake.scrollLeft).toBe(250)

    pan.finishDrag({ pointerId: 1, clientX: 100 })
    expect(pan.dragging.value).toBe(false)
    expect(fake.hasPointerCapture(1)).toBe(false)
  })

  it('右键与另一个指针的移动都不参与拖动', () => {
    const { pan, viewport } = harness()
    const fake = viewport as FakeViewport
    fake.scrollLeft = 50

    pan.handlePointerDown({ pointerId: 1, button: 2, clientX: 300 })
    pan.handlePointerMove({ pointerId: 1, clientX: 200 })
    expect(fake.scrollLeft).toBe(50)

    pan.handlePointerDown({ pointerId: 1, button: 0, clientX: 300 })
    pan.handlePointerMove({ pointerId: 2, clientX: 200 })
    expect(fake.scrollLeft).toBe(50)
  })

  it('拖动结束后吃掉紧随其后的一次 click，且只吃一次', () => {
    const { pan } = harness()

    pan.handlePointerDown({ pointerId: 1, button: 0, clientX: 300 })
    pan.handlePointerMove({ pointerId: 1, clientX: 200 })
    pan.finishDrag({ pointerId: 1, clientX: 200 })

    expect(pan.consumeSuppressedClick()).toBe(true)
    expect(pan.consumeSuppressedClick()).toBe(false)
  })

  it('抑制窗口过期后的 click 照常放行', () => {
    const { pan, advance } = harness()

    pan.handlePointerDown({ pointerId: 1, button: 0, clientX: 300 })
    pan.handlePointerMove({ pointerId: 1, clientX: 200 })
    pan.finishDrag({ pointerId: 1, clientX: 200 })

    advance(COMPOSITION_CLICK_SUPPRESSION_MS + 1)
    expect(pan.consumeSuppressedClick()).toBe(false)
  })
})
