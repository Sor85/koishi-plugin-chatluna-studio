import { describe, expect, it } from 'vitest'
import {
  applyScrollbarCue,
  createScrollbarVisibility,
  isScrollbarThumbWide,
  type ScrollbarCue,
  type ScrollbarVisibility,
} from '../client/shared/scrollbar-visibility'

/** 依次喂一串线索，返回最终状态。 */
function play(...cues: readonly ScrollbarCue[]): ScrollbarVisibility {
  return cues.reduce(applyScrollbarCue, createScrollbarVisibility())
}

describe('自定义滚动条的显隐时序', () => {
  it('初始不可见，也不留倒计时', () => {
    const state = createScrollbarVisibility()

    expect(state.revealed).toBe(false)
    expect(state.hideScheduled).toBe(false)
  })

  it('指针进入滚动区只换来一次现身，倒计时到点照常收起', () => {
    const entered = play('pointer-enter-area')

    expect(entered.revealed).toBe(true)
    expect(entered.hideScheduled).toBe(true)

    // 指针一直停在滚动区里、一动不动：停在区里不等于正在用滚动条，到点必须收。
    const timedOut = applyScrollbarCue(entered, 'hide-timeout')

    expect(timedOut.revealed).toBe(false)
    expect(timedOut.hideScheduled).toBe(false)
  })

  it('指针在滚动区内移动会重新现身，但每次仍留着倒计时', () => {
    const moved = play('pointer-enter-area', 'hide-timeout', 'pointer-move-area')

    expect(moved.revealed).toBe(true)
    expect(moved.hideScheduled).toBe(true)
    expect(applyScrollbarCue(moved, 'hide-timeout').revealed).toBe(false)
  })

  it('滚动与聚焦同样只是提示位置，不会把轨道钉住', () => {
    for (const cue of ['scroll', 'focus-in'] as const) {
      const state = play(cue)

      expect(state.revealed).toBe(true)
      expect(applyScrollbarCue(state, 'hide-timeout').revealed).toBe(false)
    }
  })

  it('指针落在滑块上才钉住轨道：不排倒计时，强行到点也不收', () => {
    const onThumb = play('pointer-enter-area', 'pointer-leave-area', 'pointer-enter-thumb')

    expect(onThumb.revealed).toBe(true)
    expect(onThumb.hideScheduled).toBe(false)
    expect(isScrollbarThumbWide(onThumb)).toBe(true)

    const timedOut = applyScrollbarCue(onThumb, 'hide-timeout')

    expect(timedOut.revealed).toBe(true)
  })

  it('指针离开滑块后恢复成会自动收起', () => {
    const left = play('pointer-enter-thumb', 'pointer-leave-thumb')

    expect(left.hideScheduled).toBe(true)
    expect(isScrollbarThumbWide(left)).toBe(false)
    expect(applyScrollbarCue(left, 'hide-timeout').revealed).toBe(false)
  })

  it('滚动区的 mouseleave 不抹掉已经认下的滑块落点', () => {
    // 浏览器把滑块的 mouseenter 派发在滚动区的 mouseleave 之前时，落点不能被倒序的 leave 打回
    // outside，否则刚钉住的轨道会立刻排上倒计时。
    const state = play('pointer-enter-area', 'pointer-enter-thumb', 'pointer-leave-area')

    expect(state.pointer).toBe('thumb')
    expect(applyScrollbarCue(state, 'hide-timeout').revealed).toBe(true)
  })

  it('滑块从静止指针下方移走时，滚动区的下一次移动把落点纠正回来', () => {
    // 内容变化让滑块缩短或移位，浏览器要等下一次指针移动才补发滑块的 mouseleave；只认 leave 会
    // 让轨道一直以为指针还在滑块上，从此永不收起。
    const corrected = play('pointer-enter-thumb', 'pointer-move-area')

    expect(corrected.pointer).toBe('area')
    expect(corrected.hideScheduled).toBe(true)
    expect(applyScrollbarCue(corrected, 'hide-timeout').revealed).toBe(false)
  })

  it('拖动期间不收，松手后由指针落点决定', () => {
    const dragging = play('pointer-enter-thumb', 'drag-start')

    expect(dragging.hideScheduled).toBe(false)
    expect(applyScrollbarCue(dragging, 'hide-timeout').revealed).toBe(true)

    // 松手时指针还停在滑块上：继续留着，别把用户手底下的东西抽走。
    const releasedOnThumb = applyScrollbarCue(dragging, 'drag-end')

    expect(releasedOnThumb.hideScheduled).toBe(true)
    expect(applyScrollbarCue(releasedOnThumb, 'hide-timeout').revealed).toBe(true)

    // 拖动中指针已经甩出滑块：松手后照常收起。
    const releasedOutside = play('pointer-enter-thumb', 'drag-start', 'pointer-leave-thumb', 'drag-end')

    expect(applyScrollbarCue(releasedOutside, 'hide-timeout').revealed).toBe(false)
  })

  it('滚动时指针已在滑块上就保持钉住，不排到点也不生效的倒计时', () => {
    const state = play('pointer-enter-thumb', 'scroll')

    expect(state.revealed).toBe(true)
    expect(state.hideScheduled).toBe(false)
  })

  it('几何不可用时无条件收起，并且不留倒计时', () => {
    const state = play('pointer-enter-area', 'unusable')

    expect(state.revealed).toBe(false)
    expect(state.hideScheduled).toBe(false)

    // 拖动中被收起也不能留下倒计时，否则轨道恢复可用后会凭空排上一次收起。
    const whileDragging = play('pointer-enter-thumb', 'drag-start', 'unusable')

    expect(whileDragging.revealed).toBe(false)
    expect(whileDragging.hideScheduled).toBe(false)
  })

  it('焦点离开只排倒计时，不立刻收起', () => {
    const state = play('focus-in', 'focus-out')

    expect(state.revealed).toBe(true)
    expect(state.hideScheduled).toBe(true)
  })
})
