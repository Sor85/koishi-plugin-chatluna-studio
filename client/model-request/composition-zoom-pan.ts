import { ref } from 'vue'

/**
 * 请求组成图轨道的缩放与横向拖动。
 *
 * 三处判定原先内联在视图里，只能靠人在浏览器里拖着试：Ctrl 才接管滚轮（否则页面
 * 滚不动）、位移超过阈值才算拖动（否则单击变成 0 像素拖动）、拖完短时间内吃掉一次
 * click（否则松手就顺带选中了指针下的分段）。缩放还要做锚点补偿，让指针底下的内容
 * 保持不动，否则放大后视野会跳到轨道开头。
 */
export const COMPOSITION_ZOOM_MIN = 1
export const COMPOSITION_ZOOM_MAX = 10
export const COMPOSITION_ZOOM_STEP = 0.25
/** 低于这个位移仍算单击：触控板和带手抖的鼠标在按下瞬间几乎总有 1~2 像素漂移。 */
export const COMPOSITION_DRAG_THRESHOLD_PX = 3
export const COMPOSITION_CLICK_SUPPRESSION_MS = 250

/** 视图口的最小形状；HTMLElement 天然满足，测试用内存替身。 */
export interface CompositionPanViewport {
  scrollLeft: number
  clientWidth: number
  getBoundingClientRect(): { left: number }
  setPointerCapture(pointerId: number): void
  releasePointerCapture(pointerId: number): void
  hasPointerCapture(pointerId: number): boolean
}

export interface CompositionWheelInput {
  ctrlKey: boolean
  deltaY: number
  clientX: number
  preventDefault: () => void
}

export interface CompositionPointerInput {
  pointerId: number
  button?: number
  clientX: number
  preventDefault?: () => void
}

export interface CompositionZoomPanOptions {
  viewport: () => CompositionPanViewport | undefined
  /**
   * 缩放后写 scrollLeft 的时机。轨道宽度是倍率的函数，必须等它按新倍率重排完再写，
   * 当拍写入会被随后的布局覆盖，锚点补偿等于没做。
   */
  afterZoom?: (apply: () => void) => void
  now?: () => number
}

export function createCompositionZoomPan(options: CompositionZoomPanOptions) {
  const zoom = ref(COMPOSITION_ZOOM_MIN)
  const dragging = ref(false)
  const afterZoom = options.afterZoom ?? ((apply: () => void) => apply())
  const now = options.now ?? (() => performance.now())
  let drag: { pointerId: number, startX: number, scrollLeft: number, moved: boolean } | undefined
  let suppressClickUntil = 0

  function setZoom(value: number, anchorClientX?: number) {
    const viewport = options.viewport()
    const next = Math.min(Math.max(value, COMPOSITION_ZOOM_MIN), COMPOSITION_ZOOM_MAX)
    if (next === zoom.value) return
    const previous = zoom.value
    const anchor = viewport && anchorClientX !== undefined
      ? Math.min(Math.max(anchorClientX - viewport.getBoundingClientRect().left, 0), viewport.clientWidth)
      : viewport ? viewport.clientWidth / 2 : 0
    // 锚点下的内容坐标在缩放前后必须相同，因此先按旧倍率折算，再按新倍率反解滚动量。
    const contentX = viewport ? (viewport.scrollLeft + anchor) / previous : 0
    zoom.value = next
    if (!viewport) return
    afterZoom(() => {
      viewport.scrollLeft = Math.max(contentX * next - anchor, 0)
    })
  }

  function handleWheel(event: CompositionWheelInput) {
    // 只在按住 Ctrl 时接管滚轮；其余情况保留页面滚动和浏览器自身的缩放。
    if (!event.ctrlKey || event.deltaY === 0) return
    event.preventDefault()
    setZoom(zoom.value + (event.deltaY < 0 ? COMPOSITION_ZOOM_STEP : -COMPOSITION_ZOOM_STEP), event.clientX)
  }

  function handlePointerDown(event: CompositionPointerInput) {
    const viewport = options.viewport()
    if (!viewport || (event.button !== undefined && event.button !== 0)) return
    drag = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: viewport.scrollLeft, moved: false }
    viewport.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: CompositionPointerInput) {
    const viewport = options.viewport()
    if (!viewport || !drag || drag.pointerId !== event.pointerId) return
    const delta = event.clientX - drag.startX
    if (!drag.moved && Math.abs(delta) < COMPOSITION_DRAG_THRESHOLD_PX) return
    drag.moved = true
    dragging.value = true
    event.preventDefault?.()
    viewport.scrollLeft = drag.scrollLeft - delta
  }

  function finishDrag(event: CompositionPointerInput) {
    const viewport = options.viewport()
    if (!viewport || !drag || drag.pointerId !== event.pointerId) return
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
    if (drag.moved) suppressClickUntil = now() + COMPOSITION_CLICK_SUPPRESSION_MS
    drag = undefined
    dragging.value = false
  }

  /** 真发生过拖动才吃掉紧随其后的那一次 click，并且只吃一次。 */
  function consumeSuppressedClick(): boolean {
    if (now() > suppressClickUntil) return false
    suppressClickUntil = 0
    return true
  }

  return {
    zoom,
    dragging,
    setZoom,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    finishDrag,
    consumeSuppressedClick,
  }
}
