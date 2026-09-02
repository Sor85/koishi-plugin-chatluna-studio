import { describe, expect, it, vi } from 'vitest'
import { ChatLunaSessionTracker, readStudioSessionEntities } from '../src/chatluna/session-tracker'

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

    expect(tracker.resolveActiveTurn()).toBeUndefined()
    emit('chatluna/before-chat', 'core-1', undefined, undefined, undefined, groupSession())
    const turn = tracker.resolveActiveTurn()
    expect(turn?.entities.conversationId).toBe('20002')
    expect(turn?.interactionId).toBeTruthy()

    emit('chatluna/after-chat', 'core-1', undefined, undefined, undefined, undefined, groupSession())
    expect(tracker.resolveActiveTurn()).toBeUndefined()
  })

  it('同一轮里的多次请求共享一个交互标识', () => {
    const { ctx, emit } = createFakeContext()
    const tracker = new ChatLunaSessionTracker(ctx as never)
    emit('chatluna/before-chat', 'core-1', undefined, undefined, undefined, groupSession())
    const first = tracker.resolveActiveTurn()?.interactionId
    // chatluna-character 会为同一轮再报一次；后一次只刷新实体，不换交互标识。
    emit('chatluna_character/before-chat', { session: groupSession(), presetName: '默认' })
    expect(tracker.resolveActiveTurn()?.interactionId).toBe(first)
  })

  it('两轮并发时不归属，其中一轮结束后恢复归属', () => {
    const { ctx, emit } = createFakeContext()
    const tracker = new ChatLunaSessionTracker(ctx as never)
    emit('chatluna/before-chat', 'core-1', undefined, undefined, undefined, groupSession('10001', '20002'))
    emit('chatluna/before-chat', 'core-2', undefined, undefined, undefined, groupSession('10001', '20009'))
    expect(tracker.activeTurnCount).toBe(2)
    expect(tracker.resolveActiveTurn()).toBeUndefined()

    emit('chatluna/after-chat', 'core-2', undefined, undefined, undefined, undefined, groupSession('10001', '20009'))
    expect(tracker.resolveActiveTurn()?.entities.conversationId).toBe('20002')
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
    expect(tracker.resolveActiveTurn()).toBeUndefined()
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
    expect(tracker.resolveActiveTurn()?.entities.conversationType).toBe('private')

    emit('chatluna_character/after-chat', { session: privateSession() })
    expect(tracker.resolveActiveTurn()).toBeUndefined()

    expect(listenerCount()).toBeGreaterThan(0)
    tracker.dispose()
    expect(listenerCount()).toBe(0)
  })
})
