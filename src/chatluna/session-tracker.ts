import { Random, type Context } from 'koishi'
import type { StudioConversationType, StudioModelRequestEntities } from '../types'

/**
 * 真实 OneBot 会话跟踪器：回答「现在是谁在请求模型」。
 *
 * 模型请求是在 ChatLuna 的 fetch 边界上被采集的，那一层看不到任何会话信息（ADR-0055 在沙盒里
 * 已经是这个形状）。真实环境里唯一可靠的会话来源是 ChatLuna 自己发出的对话生命周期事件：它们
 * 带着触发这轮对话的 Koishi session，而一轮对话里的全部模型请求都发生在 before-chat 与
 * after-chat 之间。
 *
 * 跟踪器只在「当前恰好只有一轮对话在跑」时给出归属。群聊高峰期多轮并发时宁可记成未归属，
 * 也不把请求挂到错误的会话上——错误的归属会让预设证据定位、轨迹聚合与会话筛选同时说谎。
 *
 * 虚拟机器人触发的对话轮是第三种结果：既不归属，也不该被记下来。模拟环境类插件（AI 测试空间、
 * 开发者观察窗）会注册 hidden 的 OneBot 机器人并派发真实 Koishi session，ChatLuna 照常发出
 * 生命周期事件，于是它们的模型请求和真实会话在 fetch 边界上完全一样。跟踪器因此额外报告
 * 「在跑的对话轮是否全是虚拟的」，让采集器整条丢弃（ADR-0023）。
 */

/** 一轮对话：会话实体 + 这一轮的交互标识，同一轮里的多次模型请求共享后者。 */
export interface ChatLunaTurn {
  entities: StudioModelRequestEntities
  interactionId: string
}

/**
 * 「现在是谁在请求模型」的完整回答。
 *
 * 归属与「要不要记」是两件独立的事：判不出归属的请求照样要记成未归属，而确定由虚拟机器人触发的
 * 请求根本不进记录库。两者由同一次解析一起给出，调用方因此不必分两次读同一份状态——那两次读之间
 * 状态可能已经变了。
 */
export interface ChatLunaTurnResolution {
  /** 归属到的对话轮；判不出来时缺省。 */
  turn?: ChatLunaTurn
  /** 当前在跑的对话轮非空、且全部来自虚拟机器人。 */
  virtualOnly: boolean
}

/** 跟踪器内部的对话轮：多带一个「这轮来自虚拟机器人」的判定，不对外暴露。 */
interface TrackedChatLunaTurn extends ChatLunaTurn {
  virtual: boolean
}

interface ChatLunaSessionEventRegistrar {
  (event: 'chatluna/before-chat', listener: (
    conversationId: string,
    message: unknown,
    variables: unknown,
    chatInterface: unknown,
    session: unknown,
  ) => void): () => void
  (event: 'chatluna/after-chat', listener: (
    conversationId: string,
    sourceMessage: unknown,
    responseMessage: unknown,
    variables: unknown,
    chatInterface: unknown,
    session: unknown,
  ) => void): () => void
  (event: 'chatluna/after-chat-error', listener: (error: unknown, conversationId: string) => void): () => void
  (event: 'chatluna_character/before-chat', listener: (payload: unknown) => void): () => void
  (event: 'chatluna_character/after-chat', listener: (payload: unknown) => void): () => void
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/** 逐层读取而不是声明 Session 类型：事件载荷来自第三方插件，形状变化不该让采集整条链路失败。 */
function readNested(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const key of path) current = readRecord(current)?.[key]
  return current
}

function readFirstString(value: unknown, paths: readonly (readonly string[])[]): string | undefined {
  for (const path of paths) {
    const found = readString(readNested(value, path))
    if (found) return found
  }
}

/** OneBot 私聊的 channelId 形如 `private:123456`，群聊直接是群号。 */
function resolveConversationType(session: unknown, conversationId: string): StudioConversationType {
  if (readNested(session, ['isDirect']) === true) return 'private'
  if (readString(readNested(session, ['subtype'])) === 'private') return 'private'
  if (conversationId.startsWith('private:')) return 'private'
  return readFirstString(session, [['guildId'], ['event', 'guild', 'id']]) ? 'group' : 'private'
}

/**
 * 从 Koishi session 快照出一条模型请求的会话实体。
 *
 * 机器人与会话标识缺一不可：少了任何一个，这条记录就无法在列表里被指认，也无法参与预设证据
 * 定位，那种「知道是私聊但不知道是谁」的半条归属比明确的未归属更容易误导人。
 */
export function readStudioSessionEntities(session: unknown): StudioModelRequestEntities | undefined {
  const botId = readFirstString(session, [['selfId'], ['bot', 'selfId'], ['bot', 'userId']])
  const conversationId = readFirstString(session, [['channelId'], ['channel', 'id'], ['event', 'channel', 'id']])
  if (!botId || !conversationId) return
  const platform = readFirstString(session, [['platform'], ['bot', 'platform']])
  const botName = readFirstString(session, [['bot', 'user', 'name'], ['bot', 'user', 'nick'], ['bot', 'nickname']])
  const guildId = readFirstString(session, [['guildId'], ['event', 'guild', 'id']])
  const userId = readFirstString(session, [['userId'], ['author', 'id'], ['event', 'user', 'id']])
  const conversationName = readFirstString(session, [
    ['channel', 'name'],
    ['event', 'channel', 'name'],
    ['guild', 'name'],
    ['event', 'guild', 'name'],
  ])
  const userName = readFirstString(session, [
    ['author', 'nick'],
    ['author', 'nickname'],
    ['author', 'name'],
    ['username'],
    ['event', 'user', 'name'],
  ])
  return {
    ...(platform ? { platform } : {}),
    botId,
    ...(botName ? { botName } : {}),
    conversationId,
    ...(conversationName ? { conversationName } : {}),
    conversationType: resolveConversationType(session, conversationId),
    ...(guildId ? { guildId } : {}),
    ...(userId ? { userId } : {}),
    ...(userName ? { userName } : {}),
  }
}

/**
 * 这轮对话是虚拟 OneBot 机器人发起的。
 *
 * 模拟环境类插件注册的机器人一律是同一个形状：`platform` 为 `onebot`、`hidden` 为真，OneBot
 * action 通道由注册它的插件在自己的场景里实现。认这个通用形状而不是某个具体插件的包名或 selfId：
 * 包名会随插件更换静默失效，selfId 则是用户可改的配置。
 *
 * 真实适配器不会把 `hidden` 置真——控制台需要在机器人列表里显示它们，因此这个判据不会误伤真实会话。
 */
export function isVirtualOneBotSession(session: unknown): boolean {
  if (readNested(session, ['bot', 'hidden']) !== true) return false
  return readFirstString(session, [['bot', 'platform'], ['platform']]) === 'onebot'
}

export interface ChatLunaSessionTrackerOptions {
  /**
   * 一轮对话在上游报错时的回调。
   *
   * 由跟踪器发出而不是由调用方自己监听同一个事件：错误事件只带 ChatLuna 内部会话标识，能把它
   * 还原成（机器人，会话）的映射住在跟踪器里，而收尾会紧接着删掉那份映射。两个监听器的执行
   * 顺序不受控，因此「先解析再收尾」必须在同一处完成。
   */
  onTurnFailed?: (error: unknown, turn: ChatLunaTurn) => void
}

export class ChatLunaSessionTracker {
  /** 正在进行的对话轮，按（机器人，会话）索引；同一会话重复开始时以后一次为准。 */
  private readonly turns = new Map<string, TrackedChatLunaTurn>()
  /**
   * ChatLuna 内部会话标识到本地键的映射。
   *
   * 核心链路的结束事件只带内部会话标识，不带 session：出错时 `after-chat-error` 连 session
   * 都没有，只有这张映射能把它还原成具体的（机器人，会话）。
   */
  private readonly coreKeys = new Map<string, Set<string>>()
  private readonly disposers: Array<() => void> = []

  constructor(ctx: Context, private readonly options: ChatLunaSessionTrackerOptions = {}) {
    const on = ctx.on.bind(ctx) as unknown as ChatLunaSessionEventRegistrar
    this.disposers.push(on('chatluna/before-chat', (conversationId, _message, _variables, _chatInterface, session) => {
      const key = this.begin(session)
      if (!key) return
      const keys = this.coreKeys.get(conversationId) ?? new Set<string>()
      keys.add(key)
      this.coreKeys.set(conversationId, keys)
    }))
    this.disposers.push(on('chatluna/after-chat', (conversationId, _source, _response, _variables, _chatInterface, session) => {
      this.finishCore(conversationId, session)
    }))
    this.disposers.push(on('chatluna/after-chat-error', (error, conversationId) => {
      const turn = this.resolveCoreTurn(conversationId)
      // 虚拟机器人的模型请求从未进过记录库，回填错误只会白扫一遍记录库；这里直接不发。
      if (turn && !turn.virtual) this.options.onTurnFailed?.(error, turn)
      this.finishCore(conversationId)
    }))
    this.disposers.push(on('chatluna_character/before-chat', (payload) => {
      this.begin(readRecord(payload)?.session)
    }))
    this.disposers.push(on('chatluna_character/after-chat', (payload) => {
      this.finish(readRecord(payload)?.session)
    }))
  }

  /** 内部会话标识唯一对应一轮时才认；映射到多轮时这次错误归属不明。 */
  private resolveCoreTurn(conversationId: string): TrackedChatLunaTurn | undefined {
    const keys = this.coreKeys.get(conversationId)
    if (keys?.size !== 1) return
    const [key] = keys
    return key ? this.turns.get(key) : undefined
  }

  /**
   * 归属候选，外加「这次请求是否确定来自虚拟机器人」。
   *
   * 归属恰好一轮时才交出：多轮并发或没有任何一轮在跑时，这次模型请求归属不明。
   *
   * `virtualOnly` 只在「在跑的对话轮非空且全部虚拟」时为真。虚拟轮与真实轮并发时它为假：fetch
   * 边界分不出这次请求是哪一边发的，把整对都丢掉会连真实会话的证据一起丢，只能记成未归属留给
   * 人工按时间对照。反过来两轮都虚拟时不能只看「恰好一轮」，否则模拟环境里跑多轮就又漏进来了。
   *
   * 判定留在这里而不是采集器里：采集器只知道「拿到候选就写归属」，而「几轮算可判定」「哪种机器人
   * 不该记」都是会话跟踪自己的规则，两个模块因此不必共享一份并发假设。
   */
  resolveActiveTurn(): ChatLunaTurnResolution {
    const active = [...this.turns.values()]
    const virtualOnly = active.length > 0 && active.every(({ virtual }) => virtual)
    if (active.length !== 1) return { virtualOnly }
    const [turn] = active
    if (!turn || turn.virtual) return { virtualOnly }
    return { virtualOnly, turn: { entities: { ...turn.entities }, interactionId: turn.interactionId } }
  }

  /** 当前正在进行的对话轮数；诊断与测试用。 */
  get activeTurnCount(): number {
    return this.turns.size
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose()
    this.turns.clear()
    this.coreKeys.clear()
  }

  private begin(session: unknown): string | undefined {
    const entities = readStudioSessionEntities(session)
    if (!entities) return
    const key = turnKey(entities)
    // chatluna-character 与核心链路可能为同一轮各报一次；后一次只刷新实体，不换交互标识，
    // 否则同一轮的模型请求会被拆进两个交互里。
    const existing = this.turns.get(key)
    this.turns.set(key, {
      entities,
      interactionId: existing?.interactionId ?? Random.id(),
      virtual: isVirtualOneBotSession(session),
    })
    return key
  }

  private finish(session: unknown): void {
    const entities = readStudioSessionEntities(session)
    if (entities) this.turns.delete(turnKey(entities))
  }

  private finishCore(conversationId: string, session?: unknown): void {
    const entities = readStudioSessionEntities(session)
    if (entities) {
      const key = turnKey(entities)
      this.turns.delete(key)
      const keys = this.coreKeys.get(conversationId)
      keys?.delete(key)
      if (keys && !keys.size) this.coreKeys.delete(conversationId)
      return
    }
    const keys = this.coreKeys.get(conversationId)
    if (!keys) return
    // 一个内部会话标识只对应一对（机器人，会话）时才收尾；映射到多对时无法判断是哪一轮结束了，
    // 留给下一次 before-chat 覆盖，而不是把还在跑的那一轮也一起清掉。
    if (keys.size === 1) for (const key of keys) this.turns.delete(key)
    this.coreKeys.delete(conversationId)
  }
}

function turnKey(entities: StudioModelRequestEntities): string {
  return `${entities.botId ?? ''}\u0000${entities.conversationId ?? ''}`
}
