import type { Directive } from 'vue'
import { computeVisibleScrollbarRect } from './scrollbar-track-bounds'
import {
  applyScrollbarCue,
  createScrollbarVisibility,
  isScrollbarThumbWide,
  type ScrollbarCue,
  type ScrollbarVisibility,
} from './scrollbar-visibility'

const edgeGap = 8
const overlayInset = 0
const overlayWidth = 10
const minThumbHeight = 28
/**
 * 指针或滚动停下多久之后收起轨道。取 1.5 秒这一档常见的浮层滚动条自动隐藏时长：短于 1 秒会在
 * 用户还在读位置时就抽走，长过 2 秒又会让轨道显得赖着不走。
 */
const hideDelay = 1500

interface StudioScrollbarState {
  element: HTMLElement
  overlay: HTMLDivElement
  thumb: HTMLDivElement
  showOverlay: boolean
  resizeObserver?: ResizeObserver
  mutationObserver?: MutationObserver
  frame: number
  hideTimer: number
  visibility: ScrollbarVisibility
  dragStartY: number
  dragStartScrollTop: number
  trackHeight: number
  thumbHeight: number
  cleanup: Array<() => void>
}

const states = new WeakMap<HTMLElement, StudioScrollbarState>()

export interface StudioScrollbarOptions {
  disabled?: boolean
  hideOnNarrow?: boolean
  showOverlay?: boolean
  tone?: 'accent' | 'neutral'
  zIndex?: number
}

function addListener(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions,
) {
  target.addEventListener(type, listener, options)
  return () => target.removeEventListener(type, listener, options)
}

function clearHideTimer(state: StudioScrollbarState) {
  if (!state.hideTimer) return
  window.clearTimeout(state.hideTimer)
  state.hideTimer = 0
}

/** 只把判定结果写进 DOM：可见性与滑块加宽态，不碰倒计时。 */
function writeScrollbarClasses(state: StudioScrollbarState) {
  state.overlay.classList.toggle('is-visible', state.visibility.revealed && state.showOverlay)
  state.overlay.classList.toggle('is-wide', isScrollbarThumbWide(state.visibility))
}

/**
 * 写 DOM 并把倒计时对齐到判定：需要倒计时就重排，不需要就清掉。
 *
 * 每次都重排而不是「已有就不动」：指针在滚动区里连续移动时每一次都要把 hideDelay 推后，否则轨道会
 * 在指针还在动的时候到点收起，紧接着又被下一次移动唤醒，表现为持续闪烁。也正因为重排会推后收起
 * 时刻，只有真正的显隐线索才能走这里——组件重渲染那种与指针无关的时机必须只写类名。
 */
function syncScrollbar(state: StudioScrollbarState) {
  writeScrollbarClasses(state)
  clearHideTimer(state)
  if (!state.visibility.hideScheduled) return
  state.hideTimer = window.setTimeout(() => {
    state.hideTimer = 0
    cue(state, 'hide-timeout')
  }, hideDelay)
}

/** 显隐只从这里改：判定给出下一个状态，DOM 与计时器跟着同步，几何顺手校正。 */
function cue(state: StudioScrollbarState, name: ScrollbarCue) {
  state.visibility = applyScrollbarCue(state.visibility, name)
  syncScrollbar(state)
  scheduleUpdate(state)
}

function stopEvent(event: Event) {
  event.stopPropagation()
}

function readAccentColor(element: HTMLElement) {
  // 显式使用主题色的 Portal 浮层不在工作台 DOM 子树内，需要回读当前工作台的强调色。
  const root = element.closest<HTMLElement>('.chatluna-studio-workspace')
    || document.querySelector<HTMLElement>('.chatluna-studio-workspace')
    || element
  return getComputedStyle(root).getPropertyValue('--chatluna-studio-accent').trim()
}

function getVisibleScrollbarRect(element: HTMLElement) {
  const shellElement = element.closest<HTMLElement>('.chatluna-studio-workspace')
  return computeVisibleScrollbarRect(element, shellElement ?? undefined)
}

function updateScrollbar(state: StudioScrollbarState) {
  state.frame = 0
  const { element, overlay } = state
  const rect = getVisibleScrollbarRect(element)
  const trackHeight = Math.max(0, rect.height - edgeGap * 2)
  const maxScrollTop = element.scrollHeight - element.clientHeight
  const isUsable = element.isConnected && rect.width > 0 && trackHeight > 0 && maxScrollTop > 1

  if (!isUsable) {
    // 只在确实还留着可见状态或倒计时时发线索：cue 会再排一帧校正，无条件发会让两者互相唤醒。
    if (state.visibility.revealed || state.visibility.hideScheduled) cue(state, 'unusable')
    return
  }

  const accent = readAccentColor(element)
  if (accent) overlay.style.setProperty('--chatluna-studio-accent', accent)

  state.trackHeight = trackHeight
  state.thumbHeight = Math.max(minThumbHeight, trackHeight * element.clientHeight / element.scrollHeight)
  const maxThumbTop = Math.max(0, trackHeight - state.thumbHeight)
  const thumbTop = maxScrollTop ? element.scrollTop / maxScrollTop * maxThumbTop : 0

  overlay.style.left = `${Math.round(rect.right - overlayWidth - overlayInset)}px`
  overlay.style.top = `${Math.round(rect.top + edgeGap)}px`
  overlay.style.height = `${Math.round(trackHeight)}px`
  overlay.style.setProperty('--chatluna-studio-scrollbar-thumb-top', `${thumbTop}px`)
  overlay.style.setProperty('--chatluna-studio-scrollbar-thumb-height', `${state.thumbHeight}px`)
}

function scheduleUpdate(state: StudioScrollbarState) {
  if (state.frame) return
  state.frame = window.requestAnimationFrame(() => updateScrollbar(state))
}

function updateDraggedScrollTop(state: StudioScrollbarState, clientY: number) {
  const maxScrollTop = state.element.scrollHeight - state.element.clientHeight
  const maxThumbTop = Math.max(1, state.trackHeight - state.thumbHeight)
  const delta = clientY - state.dragStartY
  state.element.scrollTop = state.dragStartScrollTop + delta / maxThumbTop * maxScrollTop
}

function stopDragging(state: StudioScrollbarState) {
  state.thumb.classList.remove('is-dragging')
  cue(state, 'drag-end')
}

function createOverlay() {
  const overlay = document.createElement('div')
  overlay.className = 'chatluna-studio-scrollbar-overlay'
  const thumb = document.createElement('div')
  thumb.className = 'chatluna-studio-scrollbar-thumb'
  overlay.appendChild(thumb)
  document.body.appendChild(overlay)
  return { overlay, thumb }
}

function applyScrollbarOptions(
  state: StudioScrollbarState,
  options: StudioScrollbarOptions | undefined,
) {
  const { overlay } = state
  state.showOverlay = options?.showOverlay !== false
  overlay.classList.toggle('is-hidden-on-narrow', Boolean(options?.hideOnNarrow))
  overlay.classList.toggle('is-accent', options?.tone === 'accent')
  overlay.style.zIndex = String(options?.zIndex ?? 100)
  // 二级页面保留滚动能力，但设计规范要求隐藏挂载到 body 的自定义轨道。showOverlay 是写 DOM 时
  // 的门而不是显隐判定的一部分，因此只重写类名：这里的时机是组件重渲染，推后收起时刻会让轨道
  // 在消息流不断刷新的会话里一直赖着。
  writeScrollbarClasses(state)
}

function attach(element: HTMLElement, options: StudioScrollbarOptions | undefined) {
  if (typeof window === 'undefined' || typeof document === 'undefined' || options?.disabled) return

  const { overlay, thumb } = createOverlay()
  const state: StudioScrollbarState = {
    element,
    overlay,
    thumb,
    showOverlay: options?.showOverlay !== false,
    frame: 0,
    hideTimer: 0,
    visibility: createScrollbarVisibility(),
    dragStartY: 0,
    dragStartScrollTop: 0,
    trackHeight: 0,
    thumbHeight: 0,
    cleanup: [],
  }

  states.set(element, state)
  element.dataset.chatlunaStudioScrollbar = 'true'
  applyScrollbarOptions(state, options)

  const enter = () => cue(state, 'pointer-enter-area')
  const leave = () => cue(state, 'pointer-leave-area')
  const move = () => cue(state, 'pointer-move-area')
  const focusIn = () => cue(state, 'focus-in')
  const focusOut = () => cue(state, 'focus-out')
  const scroll = () => cue(state, 'scroll')
  const update = () => scheduleUpdate(state)
  const pointerDown = (event: Event) => {
    if (!(event instanceof PointerEvent)) return
    event.preventDefault()
    event.stopPropagation()
    state.dragStartY = event.clientY
    state.dragStartScrollTop = element.scrollTop
    thumb.classList.add('is-dragging')
    cue(state, 'drag-start')
  }
  const pointerMove = (event: Event) => {
    if (!state.visibility.dragging) return
    if (!(event instanceof PointerEvent)) return
    event.preventDefault()
    updateDraggedScrollTop(state, event.clientY)
    scheduleUpdate(state)
  }
  const pointerUp = () => {
    if (!state.visibility.dragging) return
    stopDragging(state)
  }
  const thumbEnter = () => cue(state, 'pointer-enter-thumb')
  const thumbLeave = () => cue(state, 'pointer-leave-thumb')

  state.cleanup.push(
    addListener(element, 'mouseenter', enter),
    addListener(element, 'mouseleave', leave),
    addListener(element, 'mousemove', move, { passive: true }),
    addListener(element, 'focusin', focusIn),
    addListener(element, 'focusout', focusOut),
    addListener(element, 'scroll', scroll, { passive: true }),
    addListener(window, 'resize', update),
    addListener(window, 'scroll', update, { capture: true, passive: true }),
    addListener(thumb, 'pointerdown', pointerDown),
    addListener(thumb, 'click', stopEvent),
    addListener(thumb, 'mouseenter', thumbEnter),
    addListener(thumb, 'mouseleave', thumbLeave),
    addListener(document, 'pointermove', pointerMove),
    addListener(document, 'pointerup', pointerUp),
    addListener(document, 'pointercancel', pointerUp),
  )

  if (typeof ResizeObserver !== 'undefined') {
    state.resizeObserver = new ResizeObserver(update)
    state.resizeObserver.observe(element)
  }

  if (typeof MutationObserver !== 'undefined') {
    state.mutationObserver = new MutationObserver(update)
    state.mutationObserver.observe(element, { childList: true, subtree: true, characterData: true })
  }

  scheduleUpdate(state)
}

function refresh(element: HTMLElement, options: StudioScrollbarOptions | undefined) {
  const state = states.get(element)
  if (!state) return
  applyScrollbarOptions(state, options)
  scheduleUpdate(state)
}

function detach(element: HTMLElement) {
  const state = states.get(element)
  if (!state) return
  states.delete(element)
  delete element.dataset.chatlunaStudioScrollbar
  clearHideTimer(state)
  if (state.frame) window.cancelAnimationFrame(state.frame)
  state.resizeObserver?.disconnect()
  state.mutationObserver?.disconnect()
  for (const cleanup of state.cleanup) cleanup()
  state.overlay.remove()
}

export interface StudioScrollbarHandle {
  update(options?: StudioScrollbarOptions): void
  detach(): void
}

/**
 * 命令式挂载，供拿不到滚动容器引用的宿主使用。
 *
 * CodeMirror 的 `.cm-scroller` 由编辑器自己创建，模板里没有对应节点，指令无处可挂。而这种滚动
 * 容器同样不能留原生滚动条：原生轨道固定从滚动容器顶缘起画，无法裁剪，滚动容器一旦为了让毛玻璃
 * 表头有内容可采样而延伸到表头背后（ADR-0024），轨道就会跟着钻进顶栏。
 */
export function attachStudioScrollbar(
  element: HTMLElement,
  options?: StudioScrollbarOptions,
): StudioScrollbarHandle {
  attach(element, options)
  return {
    update: (next) => refresh(element, next),
    detach: () => detach(element),
  }
}

export const vChatlunaStudioScrollbar: Directive<HTMLElement, StudioScrollbarOptions | undefined> = {
  mounted: (element, binding) => attach(element, binding.value),
  updated: (element, binding) => refresh(element, binding.value),
  unmounted: detach,
}
