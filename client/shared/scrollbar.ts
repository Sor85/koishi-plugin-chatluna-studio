import type { Directive, DirectiveBinding } from 'vue'
import { computeVisibleScrollbarRect } from './scrollbar-track-bounds'

const edgeGap = 8
const overlayInset = 0
const overlayWidth = 10
const minThumbHeight = 28
const hideDelay = 680

interface StudioScrollbarState {
  element: HTMLElement
  overlay: HTMLDivElement
  thumb: HTMLDivElement
  showOverlay: boolean
  resizeObserver?: ResizeObserver
  mutationObserver?: MutationObserver
  frame: number
  hideTimer: number
  hovering: boolean
  focused: boolean
  dragging: boolean
  dragStartY: number
  dragStartScrollTop: number
  trackHeight: number
  thumbHeight: number
  cleanup: Array<() => void>
}

const states = new WeakMap<HTMLElement, StudioScrollbarState>()

interface StudioScrollbarOptions {
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

function setVisible(state: StudioScrollbarState, visible: boolean) {
  // 工作区缩放会从静止指针下方经过并触发 mouseenter/scroll；若此时保留 is-visible，
  // 全局动画遮罩移除后轨道会在最终位置补闪一次，因此缩放期间必须连可见状态也拒绝写入。
  const workspaceZooming = document.documentElement.classList.contains('chatluna-studio-workspace-zooming')
  state.overlay.classList.toggle('is-visible', visible && state.showOverlay && !workspaceZooming)
}

function clearHideTimer(state: StudioScrollbarState) {
  if (!state.hideTimer) return
  window.clearTimeout(state.hideTimer)
  state.hideTimer = 0
}

function stopEvent(event: Event) {
  event.stopPropagation()
}

function scheduleHide(state: StudioScrollbarState) {
  clearHideTimer(state)
  state.hideTimer = window.setTimeout(() => {
    if (state.hovering || state.focused || state.dragging) return
    setVisible(state, false)
    state.overlay.classList.remove('is-wide')
  }, hideDelay)
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
    setVisible(state, false)
    overlay.classList.remove('is-wide')
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

function showScrollbar(state: StudioScrollbarState) {
  clearHideTimer(state)
  scheduleUpdate(state)
  setVisible(state, true)
}

function showScrollbarBriefly(state: StudioScrollbarState) {
  showScrollbar(state)
  scheduleHide(state)
}

function updateDraggedScrollTop(state: StudioScrollbarState, clientY: number) {
  const maxScrollTop = state.element.scrollHeight - state.element.clientHeight
  const maxThumbTop = Math.max(1, state.trackHeight - state.thumbHeight)
  const delta = clientY - state.dragStartY
  state.element.scrollTop = state.dragStartScrollTop + delta / maxThumbTop * maxScrollTop
}

function stopDragging(state: StudioScrollbarState) {
  state.dragging = false
  state.thumb.classList.remove('is-dragging')
  state.overlay.classList.remove('is-wide')
  scheduleHide(state)
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
  binding: DirectiveBinding<StudioScrollbarOptions | undefined>,
) {
  const { overlay } = state
  state.showOverlay = binding.value?.showOverlay !== false
  // 二级页面保留滚动能力，但设计规范要求隐藏挂载到 body 的自定义轨道。
  if (!state.showOverlay) setVisible(state, false)
  overlay.classList.toggle('is-hidden-on-narrow', Boolean(binding.value?.hideOnNarrow))
  overlay.classList.toggle('is-accent', binding.value?.tone === 'accent')
  overlay.style.zIndex = String(binding.value?.zIndex ?? 100)
}

export const vStudioScrollbar: Directive<HTMLElement, StudioScrollbarOptions | undefined> = {
  mounted(element, binding) {
    if (typeof window === 'undefined' || typeof document === 'undefined' || binding.value?.disabled) return

    const { overlay, thumb } = createOverlay()
    const state: StudioScrollbarState = {
      element,
      overlay,
      thumb,
      showOverlay: binding.value?.showOverlay !== false,
      frame: 0,
      hideTimer: 0,
      hovering: false,
      focused: false,
      dragging: false,
      dragStartY: 0,
      dragStartScrollTop: 0,
      trackHeight: 0,
      thumbHeight: 0,
      cleanup: [],
    }

    states.set(element, state)
    element.dataset.chatlunaStudioScrollbar = 'true'
    applyScrollbarOptions(state, binding)

    const enter = () => {
      state.hovering = true
      showScrollbar(state)
    }
    const leave = () => {
      state.hovering = false
      scheduleHide(state)
    }
    const focusIn = () => {
      state.focused = true
      showScrollbar(state)
    }
    const focusOut = () => {
      state.focused = false
      scheduleHide(state)
    }
    const scroll = () => {
      showScrollbarBriefly(state)
    }
    const update = () => scheduleUpdate(state)
    const pointerDown = (event: Event) => {
      if (!(event instanceof PointerEvent)) return
      event.preventDefault()
      event.stopPropagation()
      state.dragging = true
      state.dragStartY = event.clientY
      state.dragStartScrollTop = element.scrollTop
      thumb.classList.add('is-dragging')
      overlay.classList.add('is-visible', 'is-wide')
      scheduleUpdate(state)
    }
    const pointerMove = (event: Event) => {
      if (!state.dragging) return
      if (!(event instanceof PointerEvent)) return
      event.preventDefault()
      updateDraggedScrollTop(state, event.clientY)
      scheduleUpdate(state)
    }
    const pointerUp = () => {
      if (!state.dragging) return
      stopDragging(state)
    }
    const thumbEnter = () => {
      state.hovering = true
      showScrollbar(state)
      overlay.classList.add('is-wide')
    }
    const thumbLeave = () => {
      state.hovering = false
      if (!state.dragging) overlay.classList.remove('is-wide')
      scheduleHide(state)
    }

    state.cleanup.push(
      addListener(element, 'mouseenter', enter),
      addListener(element, 'mouseleave', leave),
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
  },
  updated(element, binding) {
    const state = states.get(element)
    if (!state) return
    applyScrollbarOptions(state, binding)
    scheduleUpdate(state)
  },
  unmounted(element) {
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
  },
}
