import { describe, expect, it } from 'vitest'
import { createErrorSlot } from '../client/workspace/error-slot'
import { deferred } from './helpers/deferred'

describe('错误位', () => {
  it('成功的调用不留下错误，并把结果原样交出', async () => {
    const slot = createErrorSlot()

    expect(await slot.run('读取失败', async () => 'ok')).toBe('ok')
    expect(await slot.runOrThrow('读取失败', async () => 'ok')).toBe('ok')
    expect(slot.error.value).toBe('')
  })

  it('失败时上游给出的错误消息优先于调用点传入的兜底', async () => {
    const slot = createErrorSlot()

    await slot.run('撤回失败', async () => { throw new Error('消息不存在：message-1') })

    expect(slot.error.value).toBe('消息不存在：message-1')
  })

  it('上游给不出错误消息时写入调用点传入的那句兜底', async () => {
    const slot = createErrorSlot()

    await slot.run('撤回失败', async () => { throw '字符串失败' })

    expect(slot.error.value).toBe('撤回失败')
  })

  /**
   * 本模块守的唯一一条不变量。清错误必须发生在调用**之前**：写在调用之后（例如挪进 `finally`）
   * 会把本次刚写下的错误一并擦掉，而写在别处等于不写——用户对着一条早已过期的报错发愁。
   * 因此这里从调用内部读一次错误位，而不是只看调用结束后的值。
   */
  it('每次调用前先清掉上一次的错误，且清在调用之前', async () => {
    const slot = createErrorSlot()
    const observed: string[] = []

    await slot.run('第一次失败', async () => { throw new Error('上一次的错误') })
    expect(slot.error.value).toBe('上一次的错误')

    await slot.run('第二次失败', async () => { observed.push(slot.error.value) })

    expect(observed).toEqual([''])
    expect(slot.error.value).toBe('')
  })

  it('抛出型调用同样先清错误，抛出后错误位留着这一次的文案', async () => {
    const slot = createErrorSlot()
    const observed: string[] = []

    await slot.run('第一次失败', async () => { throw new Error('上一次的错误') })
    await expect(slot.runOrThrow('第二次失败', async () => {
      observed.push(slot.error.value)
      throw new Error('这一次的错误')
    })).rejects.toThrow('这一次的错误')

    expect(observed).toEqual([''])
    expect(slot.error.value).toBe('这一次的错误')
  })

  /** 单错误位只有一个消费方，因此「后一次操作的错误覆盖前一次」是它的可观察语义。 */
  it('后一次失败的文案覆盖前一次，不叠加也不保留更早的那条', async () => {
    const slot = createErrorSlot()

    await slot.run('好友操作失败', async () => { throw new Error('好友不存在') })
    await slot.run('群组操作失败', async () => { throw new Error('群组不存在') })

    expect(slot.error.value).toBe('群组不存在')
  })

  it('run 吞掉失败并交出 undefined，runOrThrow 把原始失败原样抛给调用方', async () => {
    const slot = createErrorSlot()
    const cause = new Error('会话不存在')

    expect(await slot.run('创建会话失败', async () => { throw cause })).toBeUndefined()
    await expect(slot.runOrThrow('创建会话失败', async () => { throw cause })).rejects.toBe(cause)
  })

  it('调用尚未结束时错误位已经是空的，界面不会在重试期间还显示上一条错误', async () => {
    const slot = createErrorSlot()
    await slot.run('读取失败', async () => { throw new Error('第一次就失败') })
    const pending = deferred<string>()

    const running = slot.run('读取失败', () => pending.promise)
    expect(slot.error.value).toBe('')

    pending.settle('ok')
    expect(await running).toBe('ok')
  })
})
