import { describe, expect, it, vi } from 'vitest'
import {
  ChatLunaSessionTracker,
  isVirtualOneBotSession,
  readStudioSessionEntities,
} from '../src/chatluna/session-tracker'

/**
 * 会话跟踪器：把 ChatLuna 的对话生命周期事件翻译成「现在是谁在请求模型」。
 *
 * 事件载荷来自第三方插件，因此这里用最小形状的假 session 驱动，而不是构造真实 Koishi Session：
 * 跟踪器本来就只逐层读取它认识的那几个字段，用真实对象反而会把断言绑到 Koishi 的内部结构上。
 */

type Listener = (...args: unknown[]) => void

function createFakeContext() {
  const listeners = new Map<string, Set<Listener>>()
  const ctx = {
    on(event: string, listener: Listener) {
      const bucket = listeners.get(event) ?? new Set<Listener>()
      bucket.add(listener)
      listeners.set(event, bucket)
      return () => { bucket.delete(listener) }
    },
  }
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args)
  }
  const listenerCount = () => [...listeners.values()].reduce((total, bucket) => total + bucket.size, 0)
  return { ctx, emit, listenerCount }
}

function groupSession(botId = '10001', channelId = '20002') {
  return {
    platform: 'onebot',
    selfId: botId,
    channelId,
    guildId: channelId,
    userId: '30003',
    username: '提问的人',
    bot: { selfId: botId, platform: 'onebot', user: { name: '小助手' } },
    event: { channel: { id: channelId, name: '测试群' } },
  }
}

function privateSession(botId = '10001', userId = '30003') {
  return {
    platform: 'onebot',
    selfId: botId,
    channelId: `private:${userId}`,
    userId,
    isDirect: true,
    author: { id: userId, nick: '好友' },
    bot: { selfId: botId, platform: 'onebot' },
  }
}

/**
 * 虚拟 OneBot 机器人：`platform` 为 `onebot` 且 `hidden` 为真，模拟环境类插件用的就是这个形状。
 * 沙盒会派发真实 Koishi session，所以除了这两个字段以外它和真实会话长得完全一样。
 */
function virtualSession(botId = '90001', channelId = '90002') {
  return {
    platform: 'onebot',
    selfId: botId,
    channelId,
    guildId: channelId,
    userId: '90003',
    bot: { selfId: botId, platform: 'onebot', hidden: true, user: { name: '模拟机器人' } },
    event: { channel: { id: channelId, name: '模拟群' } },
  }
}

describe('会话实体快照', () => {
  it('从群聊 session 读出平台、机器人、会话与发言者', () => {
    expect(readStudioSessionEntities(groupSession())).toEqual({
      platform: 'onebot',
      botId: '10001',
      botName: '小助手',
      conversationId: '20002',
      conversationName: '测试群',
      conversationType: 'group',
      guildId: '20002',
      userId: '30003',
      userName: '提问的人',
    })
  })

  it('私聊按 isDirect 与 private: 前缀判定，不因为没有群号而落到群聊', () => {
    const entities = readStudioSessionEntities(privateSession())
    expect(entities?.conversationType).toBe('private')
    expect(entities?.conversationId).toBe('private:30003')
    expect(entities?.userName).toBe('好友')
  })

  it('缺少机器人或会话标识时不给出半条归属', () => {
    expect(readStudioSessionEntities({ selfId: '10001' })).toBeUndefined()
    expect(readStudioSessionEntities({ channelId: '20002' })).toBeUndefined()
    expect(readStudioSessionEntities(undefined)).toBeUndefined()
  })
})

describe('会话跟踪器', () => {
  it('核心链路一轮对话期间给出归属，结束后不再归属', () => {
    const { ctx, emit } = createFakeContext()
    const tracker = new ChatLunaSessionTracker(ctx as never)

    expect(tracker.resolveActiveTurn().turn).toBeUndefined()
    emit('chatluna/before-chat', 'core-1', undefined, undefined, undefined, groupSession())
    const { turn } = tracker.resolveActiveTurn()
    expect(turn?.entities.conversationId).toBe('20002')
    expect(turn?.interactionId).toBeTruthy()

    emit('chatluna/after-chat', 'core-1', undefined, undefined, undefined, undefined, groupSession())
    expect(tracker.resolveActiveTurn().turn).toBeUndefined()
  })

  it('同一轮里的多次请求共享一个交互标识', () => {
    const { ctx, emit } = createFakeContext()
    const tracker = new ChatLunaSessionTracker(ctx as never)
    emit('chatluna/before-chat', 'core-1', undefined, undefined, undefined, groupSession())
    const first = tracker.resolveActiveTurn().turn?.interactionId
    // chatluna-character 会为同一轮再报一次；后一次只刷新实体，不换交互标识。
    emit('chatluna_character/before-chat', { session: groupSession(), presetName: '默认' })
    expect(tracker.resolveActiveTurn().turn?.interactionId).toBe(first)
  })

  it('两轮并发时不归属，其中一轮结束后恢复归属', () => {
    const { ctx, emit } = createFakeContext()
    const tracker = new ChatLunaSessionTracker(ctx as never)
    emit('chatluna/before-chat', 'core-1', undefined, undefined, undefined, groupSession('10001', '20002'))
    emit('chatluna/before-chat', 'core-2', undefined, undefined, undefined, groupSession('10001', '20009'))
    expect(tracker.activeTurnCount).toBe(2)
    expect(tracker.resolveActiveTurn().turn).toBeUndefined()

    emit('chatluna/after-chat', 'core-2', undefined, undefined, undefined, undefined, groupSession('10001', '20009'))
    expect(tracker.resolveActiveTurn().turn?.entities.conversationId).toBe('20002')
  })

  it('出错事件没有 session，靠内部会话映射收尾并通知失败', () => {
    const { ctx, emit } = createFakeContext()
    const onTurnFailed = vi.fn()
    const tracker = new ChatLunaSessionTracker(ctx as never, { onTurnFailed })
    emit('chatluna/before-chat', 'core-1', undefined, undefined, undefined, groupSession())

    const error = new Error('上游返回 429')
    emit('chatluna/after-chat-error', error, 'core-1')
    expect(onTurnFailed).toHaveBeenCalledTimes(1)
    expect(onTurnFailed.mock.calls[0]?.[0]).toBe(error)
    expect(onTurnFailed.mock.calls[0]?.[1].entities.conversationId).toBe('20002')
    expect(tracker.resolveActiveTurn().turn).toBeUndefined()
  })

  it('一个内部会话标识映射到多轮时，出错不清掉还在跑的那一轮', () => {
    const { ctx, emit } = createFakeContext()
    const onTurnFailed = vi.fn()
    const tracker = new ChatLunaSessionTracker(ctx as never, { onTurnFailed })
    emit('chatluna/before-chat', 'core-shared', undefined, undefined, undefined, groupSession('10001', '20002'))
    emit('chatluna/before-chat', 'core-shared', undefined, undefined, undefined, groupSession('10002', '20002'))

    emit('chatluna/after-chat-error', new Error('失败'), 'core-shared')
    expect(onTurnFailed).not.toHaveBeenCalled()
    expect(tracker.activeTurnCount).toBe(2)
  })

  it('character 链路自己收尾，dispose 摘掉全部监听', () => {
    const { ctx, emit, listenerCount } = createFakeContext()
    const tracker = new ChatLunaSessionTracker(ctx as never)
    emit('chatluna_character/before-chat', { session: privateSession(), presetName: '默认' })
    expect(tracker.resolveActiveTurn().turn?.entities.conversationType).toBe('private')

    emit('chatluna_character/after-chat', { session: privateSession() })
    expect(tracker.resolveActiveTurn().turn).toBeUndefined()

    expect(listenerCount()).toBeGreaterThan(0)
    tracker.dispose()
    expect(listenerCount()).toBe(0)
  })
})

/**
 * 虚拟机器人对话轮：模拟环境插件（AI 测试空间、开发者观察窗）注册 hidden 的 OneBot 机器人并派发
 * 真实 Koishi session，ChatLuna 照常发生命周期事件。这些请求不该进记录库，跟踪器负责把它们指出来。
 */
describe('虚拟机器人判定', () => {
  it('认 platform 为 onebot 且 hidden 为真的形状，真实会话与半个形状都不算', () => {
    expect(isVirtualOneBotSession(virtualSession())).toBe(true)
    expect(isVirtualOneBotSession(groupSession())).toBe(false)
    // 只有 hidden 或只有 onebot 都不算：漏掉任何一半都会把真实会话的记录一起丢掉。
    expect(isVirtualOneBotSession({ bot: { platform: 'discord', hidden: true } })).toBe(false)
    expect(isVirtualOneBotSession({ bot: { platform: 'onebot' } })).toBe(false)
    expect(isVirtualOneBotSession(undefined)).toBe(false)
  })
})

describe('虚拟机器人对话轮', () => {
  it('只有虚拟轮在跑时报 virtualOnly，且不给出归属', () => {
    const { ctx, emit } = createFakeContext()
    const tracker = new ChatLunaSessionTracker(ctx as never)
    emit('chatluna/before-chat', 'core-1', undefined, undefined, undefined, virtualSession())

    const resolution = tracker.resolveActiveTurn()
    expect(resolution.virtualOnly).toBe(true)
    // 归属必须一起为空：留着归属就意味着「这条要记，而且属于模拟会话」，正是要避免的结果。
    expect(resolution.turn).toBeUndefined()
  })

  it('多轮虚拟并发仍然报 virtualOnly，不因为「不止一轮」漏进记录库', () => {
    const { ctx, emit } = createFakeContext()
    const tracker = new ChatLunaSessionTracker(ctx as never)
    emit('chatluna/before-chat', 'core-1', undefined, undefined, undefined, virtualSession('90001', '90002'))
    emit('chatluna/before-chat', 'core-2', undefined, undefined, undefined, virtualSession('90001', '90009'))

    expect(tracker.activeTurnCount).toBe(2)
    expect(tracker.resolveActiveTurn().virtualOnly).toBe(true)
  })

  it('虚拟轮与真实轮并发时不报 virtualOnly，也不归属到真实那一轮', () => {
    const { ctx, emit } = createFakeContext()
    const tracker = new ChatLunaSessionTracker(ctx as never)
    emit('chatluna/before-chat', 'core-1', undefined, undefined, undefined, groupSession())
    emit('chatluna/before-chat', 'core-2', undefined, undefined, undefined, virtualSession())

    const resolution = tracker.resolveActiveTurn()
    // fetch 边界分不出这次请求是哪一边发的：丢掉会连真实会话的证据一起丢，归属会把模拟请求
    // 挂到真实会话上。两个都不做，记成未归属。
    expect(resolution.virtualOnly).toBe(false)
    expect(resolution.turn).toBeUndefined()
  })

  it('虚拟轮结束后真实轮恢复归属', () => {
    const { ctx, emit } = createFakeContext()
    const tracker = new ChatLunaSessionTracker(ctx as never)
    emit('chatluna/before-chat', 'core-1', undefined, undefined, undefined, groupSession())
    emit('chatluna/before-chat', 'core-2', undefined, undefined, undefined, virtualSession())
    emit('chatluna/after-chat', 'core-2', undefined, undefined, undefined, undefined, virtualSession())

    const resolution = tracker.resolveActiveTurn()
    expect(resolution.virtualOnly).toBe(false)
    expect(resolution.turn?.entities.conversationId).toBe('20002')
  })

  it('虚拟轮出错不回填错误：那一轮的请求根本没进记录库', () => {
    const { ctx, emit } = createFakeContext()
    const onTurnFailed = vi.fn()
    const tracker = new ChatLunaSessionTracker(ctx as never, { onTurnFailed })
    emit('chatluna/before-chat', 'core-1', undefined, undefined, undefined, virtualSession())

    emit('chatluna/after-chat-error', new Error('上游返回 429'), 'core-1')
    expect(onTurnFailed).not.toHaveBeenCalled()
    expect(tracker.activeTurnCount).toBe(0)
  })

  it('character 链路的虚拟轮同样报 virtualOnly', () => {
    const { ctx, emit } = createFakeContext()
    const tracker = new ChatLunaSessionTracker(ctx as never)
    emit('chatluna_character/before-chat', { session: virtualSession(), presetName: '默认' })
    expect(tracker.resolveActiveTurn().virtualOnly).toBe(true)

    emit('chatluna_character/after-chat', { session: virtualSession() })
    expect(tracker.resolveActiveTurn().virtualOnly).toBe(false)
  })
})
