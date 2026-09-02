import { describe, expect, it, vi } from 'vitest'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('@koishijs/client', () => ({ send }))

import { createKoishiModelRequestPort } from '../client/model-request/koishi-port'

describe('Koishi 模型请求端口', () => {
  /**
   * 适配器只做协议翻译：范围由调用方显式给出，端点名与入参一字不改地转成一次 send。
   *
   * 详情、轨迹与清理都不带范围——记录标识本身就是唯一的定位方式，把当前列表的筛选混进详情读取
   * 会让「筛完之后点不开另一类记录」这种耦合悄悄成立。
   */
  it('把每个端口方法翻译成对应端点的一次 send', async () => {
    send.mockClear()
    send.mockResolvedValue({ records: [], hasMore: false, capacity: { recordCount: 0, totalBytes: 0, maxRecords: 500, maxBytes: 1 } })
    const port = createKoishiModelRequestPort()

    await port.getModelRequestRecords({ scope: 'unattributed', limit: 50 })
    await port.getModelRequestRecord({ recordId: 'record-1' })
    await port.getModelRequestTrajectory({ recordId: 'record-1', mode: 'conversation' })
    await port.getModelRequestFacets()
    await port.clearModelRequestRecords()

    expect(send.mock.calls).toEqual([
      ['chatluna-studio/model-request-records', { scope: 'unattributed', limit: 50 }],
      ['chatluna-studio/model-request-record', { recordId: 'record-1' }],
      ['chatluna-studio/model-request-trajectory', { recordId: 'record-1', mode: 'conversation' }],
      ['chatluna-studio/model-request-facets'],
      ['chatluna-studio/clear-model-request-records'],
    ])
  })
})
