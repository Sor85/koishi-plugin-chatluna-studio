import { describe, expect, it } from 'vitest'
import { createModelRequestClearConfirm } from '../client/model-request/clear-confirm'

function harness() {
  let cleared = 0
  const confirm = createModelRequestClearConfirm({ clear: () => { cleared += 1 } })
  return { confirm, cleared: () => cleared }
}

describe('未归属记录清理的二次确认', () => {
  it('打开时停在第一步，只有推进到第二步才执行清理', () => {
    const { confirm, cleared } = harness()

    confirm.begin()
    expect(confirm.open.value).toBe(true)
    expect(confirm.step.value).toBe(1)

    confirm.confirm()
    expect(cleared()).toBe(0)

    confirm.advance()
    expect(confirm.step.value).toBe(2)
    confirm.confirm()
    expect(cleared()).toBe(1)
    expect(confirm.open.value).toBe(false)
  })

  it('取消关闭对话框并退回第一步', () => {
    const { confirm, cleared } = harness()

    confirm.begin()
    confirm.advance()
    confirm.cancel()

    expect(confirm.open.value).toBe(false)
    expect(confirm.step.value).toBe(1)
    expect(cleared()).toBe(0)
  })

  it('按 Esc 或点遮罩关闭后重新打开，仍然从第一步开始', () => {
    const { confirm, cleared } = harness()

    confirm.begin()
    confirm.advance()
    // 对话框组件自己把 open 写回 false，没有经过取消按钮。
    confirm.open.value = false

    confirm.begin()
    expect(confirm.step.value).toBe(1)
    confirm.confirm()
    expect(cleared()).toBe(0)
  })

  it('重新打开总是从第一步开始，即使上一轮停在第二步', () => {
    const { confirm } = harness()

    confirm.begin()
    confirm.advance()
    confirm.begin()

    expect(confirm.step.value).toBe(1)
  })

  it('执行过一次后再次确认不会重复清理', () => {
    const { confirm, cleared } = harness()

    confirm.begin()
    confirm.advance()
    confirm.confirm()
    confirm.confirm()

    expect(cleared()).toBe(1)
  })
})
