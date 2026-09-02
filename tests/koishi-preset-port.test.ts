import { describe, expect, it, vi } from 'vitest'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('@koishijs/client', () => ({ send }))

import { createKoishiPresetPort } from '../client/preset/koishi-port'

describe('Koishi 预设端口', () => {
  /** 这道端口的工厂根本不收「解析当前空间标识」的函数，因此不存在被隐式定域盖掉的可能。 */
  it('预设文件调用保持全局，表达式定位使用调用方提供的显式 scope', async () => {
    send.mockClear()
    send.mockResolvedValue({})
    const port = createKoishiPresetPort()

    await port.getPresetCatalog()
    await port.readPreset({ kind: 'core', fileName: 'assistant.yml' })
    await port.locatePresetExpression({
      document: { kind: 'core', fileName: 'assistant.yml', revision: 'rev-1' },
      expression: { stableId: 'expression-1' },
    })

    expect(send).toHaveBeenNthCalledWith(1, 'chatluna-studio/preset-catalog', {})
    expect(send).toHaveBeenNthCalledWith(2, 'chatluna-studio/preset-read', { kind: 'core', fileName: 'assistant.yml' })
    expect(send).toHaveBeenNthCalledWith(3, 'chatluna-studio/preset-locate-expression', {
      document: { kind: 'core', fileName: 'assistant.yml', revision: 'rev-1' },
      expression: { stableId: 'expression-1' },
    })
  })
})
