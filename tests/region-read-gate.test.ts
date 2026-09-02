import { describe, expect, it } from 'vitest'
import { createErrorSlot } from '../client/workspace/error-slot'
import { createRegionReadGate } from '../client/workspace/region-read-gate'
import { deferred } from './helpers/deferred'

function createGate<Channel extends string>(...channels: Channel[]) {
  const slot = createErrorSlot()
  return { slot, gate: createRegionReadGate(slot, channels) }
}

describe('区域读取闸门', () => {
  it('调用期间通道进行中为真，成功后复位', async () => {
    const { gate } = createGate('list', 'detail')
    const pending = deferred<void>()

    const running = gate.read('list', '读取记录失败', () => pending.promise)
    expect(gate.loading.list.value).toBe(true)

    pending.settle()
    await running
    expect(gate.loading.list.value).toBe(false)
  })

  /**
   * 本模块守的唯一一条不变量。漏掉复位不会报错，界面只会一直转圈——因此成功、吞掉的失败与
   * 抛给调用方的失败三条路径都要各自断言，少一条就有一条路径能静默把界面卡住。
   */
  it('失败路径同样复位进行中，界面不会一直转圈', async () => {
    const { gate } = createGate('list')

    await gate.read('list', '读取记录失败', async () => { throw new Error('上游失败') })

    expect(gate.loading.list.value).toBe(false)
  })

  it('把失败抛给调用方时也复位进行中', async () => {
    const { gate } = createGate('detail')

    await expect(gate.readOrThrow('detail', '读取详情失败', async () => {
      throw new Error('上游失败')
    })).rejects.toThrow('上游失败')

    expect(gate.loading.detail.value).toBe(false)
  })

  /**
   * 四个区域里唯一形状不一致的地方就在这条通道独立性上：三个区域各有列表与详情两条通道，
   * 预设只有一条读取通道。用一个进行中计数器代替两个布尔会让并发读取时的表现与今天不同。
   */
  it('两条通道互不影响：详情通道进行中时列表通道不为真', async () => {
    const { gate } = createGate('list', 'detail')
    const pending = deferred<void>()

    const running = gate.read('detail', '读取详情失败', () => pending.promise)

    expect(gate.loading.detail.value).toBe(true)
    expect(gate.loading.list.value).toBe(false)

    pending.settle()
    await running
  })

  it('两条通道可以同时进行中，各自结束各自复位', async () => {
    const { gate } = createGate('list', 'detail')
    const list = deferred<void>()
    const detail = deferred<void>()

    const readingList = gate.read('list', '读取记录失败', () => list.promise)
    const readingDetail = gate.read('detail', '读取详情失败', () => detail.promise)
    expect([gate.loading.list.value, gate.loading.detail.value]).toEqual([true, true])

    detail.settle()
    await readingDetail
    expect([gate.loading.list.value, gate.loading.detail.value]).toEqual([true, false])

    list.settle()
    await readingList
    expect([gate.loading.list.value, gate.loading.detail.value]).toEqual([false, false])
  })

  it('失败写文案：上游给出的错误消息优先于调用点传入的兜底', async () => {
    const { gate } = createGate('list')

    await gate.read('list', '读取测试调用记录失败', async () => { throw new Error('实例不存在') })
    expect(gate.error.value).toBe('实例不存在')

    await gate.read('list', '读取测试调用记录失败', async () => { throw ' ' })
    expect(gate.error.value).toBe('读取测试调用记录失败')
  })

  it('两条通道共用一个错误位：详情读取失败后列表也看到同一条错误', async () => {
    const { slot, gate } = createGate('list', 'detail')

    await gate.read('detail', '读取详情失败', async () => { throw new Error('记录不存在') })

    expect(gate.error.value).toBe('记录不存在')
    expect(slot.error.value).toBe('记录不存在')
  })

  it('重试：失败后再读一次，错误位在新的一次调用开始时就被清掉', async () => {
    const { gate } = createGate('list')
    const observed: string[] = []

    await gate.read('list', '读取记录失败', async () => { throw new Error('第一次就失败') })
    expect(gate.error.value).toBe('第一次就失败')

    await gate.read('list', '读取记录失败', async () => { observed.push(gate.error.value) })

    expect(observed).toEqual([''])
    expect(gate.error.value).toBe('')
  })

  it('声明了几条通道就有几条通道，形状差异写在声明上', () => {
    const { gate: twoChannels } = createGate('list', 'detail')
    const { gate: oneReadChannel } = createGate('loading')

    expect(Object.keys(twoChannels.loading)).toEqual(['list', 'detail'])
    expect(Object.keys(oneReadChannel.loading)).toEqual(['loading'])
    expect(Object.values(twoChannels.loading).map((channel) => channel.value)).toEqual([false, false])
  })

  it('闸门交出调用结果，不把成功值吞掉', async () => {
    const { gate } = createGate('detail')

    expect(await gate.read('detail', '读取详情失败', async () => ({ id: 'record-1' })))
      .toEqual({ id: 'record-1' })
    expect(await gate.readOrThrow('detail', '读取详情失败', async () => ({ id: 'record-1' })))
      .toEqual({ id: 'record-1' })
  })
})
