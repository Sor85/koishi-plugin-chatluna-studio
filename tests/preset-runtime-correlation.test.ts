import { App } from '@koishijs/core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PresetRuntimeSnapshotTracker,
  type PresetRuntimeSessionTarget,
} from '../src/presets'

const runningApps: App[] = []

afterEach(async () => {
  await Promise.all(runningApps.splice(0).map((app) => app.stop()))
})

function session(botId: string, conversationId: string) {
  return { selfId: botId, channelId: conversationId, bot: { selfId: botId }, channel: { id: conversationId } }
}

/**
 * ChatInterface 携带的上下文在真实环境里是 Cordis 上下文，预设服务按服务名解析。
 *
 * 测试用最小替身：只提供 `get(name)`，不提供 `chatluna` 属性。属性访问会被 Cordis 记一条注入告警
 * （见 `resolveCorePreset` 注释），替身缺少该属性即可让退回属性访问的实现直接失败。
 */
function chatInterface(preset: unknown) {
  return {
    ctx: {
      get: (name: string) => name === 'chatluna' ? { preset: { getPreset: () => ({ value: preset }) } } : undefined,
    },
  }
}

/**
 * 真实环境里（机器人，会话）就是完整身份，跟踪器直接从 session 读出来。
 *
 * 这个包装只是把测试原有的「先声明有哪些目标」写法留住：它不再参与解析，只做断言前的取值。
 */
function createTracker(app: App, _targets?: Record<string, PresetRuntimeSessionTarget | undefined>) {
  return new PresetRuntimeSnapshotTracker(app)
}

function emit(app: App, event: string, ...args: unknown[]): Promise<void> {
  return (app.parallel as unknown as (event: string, ...args: unknown[]) => Promise<void>)(event, ...args)
}

describe('运行时预设快照关联', () => {
  it('从核心公共事件与预设服务立即复制快照，并保持到成功完成', async () => {
    const app = new App()
    runningApps.push(app)
    const target = { botId: '21001', conversationId: 'private:11001:21001' }
    const tracker = createTracker(app, { '21001:private:11001:21001': target })
    await app.start()

    const preset = {
      rawText: 'prompts:\n  - role: system\n    content: Hello {name}.\n',
      messages: [{ content: 'Hello {name}.', _getType: () => 'system' }],
      formatUserPromptString: 'Ask {prompt}',
    }
    const variables = { built: { preset: 'demo' } }
    const currentSession = session(target.botId, target.conversationId)
    await emit(app, 'chatluna/before-chat', 'core-turn', {}, variables, chatInterface(preset), currentSession)

    preset.rawText = 'changed after event'
    preset.messages[0]!.content = 'changed after event'
    variables.built.preset = 'changed-after-event'

    expect(tracker.getActiveSnapshots(target)).toEqual([{
      kind: 'core',
      presetName: 'demo',
      capturedAt: expect.any(String),
      source: 'prompts:\n  - role: system\n    content: Hello {name}.\n',
      templates: [
        { path: ['prompts', 0, 'content'], role: 'system', template: 'Hello {name}.' },
        { path: ['format_user_prompt'], role: 'user', template: 'Ask {prompt}' },
      ],
    }])

    await emit(app, 'chatluna/after-chat', 'core-turn', {}, {}, variables, {}, currentSession)
    expect(tracker.getActiveSnapshots(target)).toEqual([])
    tracker.dispose()
  })

  it('从 Character before-chat 捕获 raw system/input，并按目标和回合隔离到 after-chat', async () => {
    const app = new App()
    runningApps.push(app)
    const first = { botId: '20001', conversationId: 'group:30001' }
    const second = { botId: '22001', conversationId: 'group:33001' }
    const tracker = createTracker(app, {
      '20001:group:30001': first,
      '22001:group:33001': second,
    })
    await app.start()

    const firstPayload = {
      session: session(first.botId, first.conversationId),
      presetName: 'alice',
      preset: {
        name: 'alice',
        system: { rawString: 'System {status}' },
        input: { rawString: 'Input {prompt}' },
      },
    }
    const secondPayload = {
      session: session(second.botId, second.conversationId),
      presetName: 'bob',
      preset: {
        name: 'bob',
        system: { rawString: 'Bob system' },
        input: { rawString: 'Bob {prompt}' },
      },
    }
    await emit(app, 'chatluna_character/before-chat', firstPayload)
    await emit(app, 'chatluna_character/before-chat', secondPayload)
    firstPayload.preset.system.rawString = 'mutated'

    expect(tracker.getActiveSnapshots(first)).toMatchObject([{
      kind: 'character',
      presetName: 'alice',
      templates: [
        { path: ['system'], role: 'system', template: 'System {status}' },
        { path: ['input'], role: 'user', template: 'Input {prompt}' },
      ],
    }])
    expect(tracker.getActiveSnapshots(second)).toMatchObject([{ presetName: 'bob' }])

    await emit(app, 'chatluna_character/after-chat', { ...firstPayload, session: session(first.botId, first.conversationId) })
    expect(tracker.getActiveSnapshots(first)).toEqual([])
    expect(tracker.getActiveSnapshots(second)).toHaveLength(1)
    tracker.dispose()
  })

  it('同一目标重叠的核心与 Character 生命周期会同时附加两个快照', async () => {
    const app = new App()
    runningApps.push(app)
    const target = { botId: '20001', conversationId: 'private:10001:20001' }
    const tracker = createTracker(app, { '20001:private:10001:20001': target })
    await app.start()

    await emit(app, 'chatluna/before-chat', 'core-turn', {}, { built: { preset: 'core-demo' } }, chatInterface({
      rawText: 'prompts:\n  - role: system\n    content: Core {value}\n',
      messages: [{ content: 'Core {value}', _getType: () => 'system' }],
    }), session(target.botId, target.conversationId))
    await emit(app, 'chatluna_character/before-chat', {
      session: session(target.botId, target.conversationId),
      presetName: 'character-demo',
      preset: { name: 'character-demo', system: { rawString: 'Character {value}' } },
    })

    expect(tracker.getActiveSnapshots(target)).toMatchObject([
      { kind: 'core', presetName: 'core-demo' },
      { kind: 'character', presetName: 'character-demo' },
    ])
    tracker.dispose()
  })

  it('同类核心并发回合无法区分时不覆盖或猜测，错误完成也保持保守', async () => {
    const app = new App()
    runningApps.push(app)
    const target = { botId: '20001', conversationId: 'private:10001:20001' }
    const tracker = createTracker(app, { '20001:private:10001:20001': target })
    await app.start()

    const makeInterface = (name: string) => chatInterface({
      rawText: `prompts:\n  - role: system\n    content: ${name} {value}\n`,
      messages: [{ content: `${name} {value}`, _getType: () => 'system' }],
    })
    const currentSession = session(target.botId, target.conversationId)
    await emit(app, 'chatluna/before-chat', 'same-upstream-turn', {}, { built: { preset: 'first' } }, makeInterface('First'), currentSession)
    await emit(app, 'chatluna/before-chat', 'same-upstream-turn', {}, { built: { preset: 'second' } }, makeInterface('Second'), currentSession)

    expect(tracker.getActiveSnapshots(target)).toEqual([])
    await emit(app, 'chatluna/after-chat-error', new Error('failed'), 'same-upstream-turn')
    expect(tracker.getActiveSnapshots(target)).toEqual([])
    tracker.dispose()
  })

  it('核心成功完成按 session 目标清理，缺少 session 的错误完成在跨目标歧义时不清理', async () => {
    const app = new App()
    runningApps.push(app)
    const first = { botId: '20001', conversationId: 'group:30001' }
    const second = { botId: '22001', conversationId: 'group:33001' }
    const tracker = createTracker(app, {
      '20001:group:30001': first,
      '22001:group:33001': second,
    })
    await app.start()

    const makeInterface = (name: string) => chatInterface({
      rawText: `prompts:\n  - role: system\n    content: ${name} {value}\n`,
      messages: [{ content: `${name} {value}`, _getType: () => 'system' }],
    })
    await emit(app, 'chatluna/before-chat', 'shared-upstream-turn', {}, { built: { preset: 'first' } }, makeInterface('First'), session(first.botId, first.conversationId))
    await emit(app, 'chatluna/before-chat', 'shared-upstream-turn', {}, { built: { preset: 'second' } }, makeInterface('Second'), session(second.botId, second.conversationId))

    await emit(app, 'chatluna/after-chat-error', new Error('failed'), 'shared-upstream-turn')
    expect(tracker.getActiveSnapshots(first)).toMatchObject([{ presetName: 'first' }])
    expect(tracker.getActiveSnapshots(second)).toMatchObject([{ presetName: 'second' }])

    await emit(app, 'chatluna/after-chat', 'shared-upstream-turn', {}, {}, {}, {}, session(first.botId, first.conversationId))
    expect(tracker.getActiveSnapshots(first)).toEqual([])
    expect(tracker.getActiveSnapshots(second)).toMatchObject([{ presetName: 'second' }])
    tracker.dispose()
  })

  it('按服务名解析预设服务，不在对话链路上留下注入告警', async () => {
    const app = new App()
    runningApps.push(app)
    const warnings: string[] = []
    app.on('internal/warning', (error) => {
      warnings.push(error instanceof Error ? error.message : String(error))
    })
    app.provide('chatluna')
    app.set('chatluna', {
      preset: {
        getPreset: () => ({ value: {
          rawText: 'prompts:\n  - role: system\n    content: Hello {name}.\n',
          messages: [{ content: 'Hello {name}.', _getType: () => 'system' }],
        } }),
      },
    })
    const target = { botId: '20001', conversationId: 'group:30001' }
    // 注入告警只在有插件归属的上下文里上报，因此跟踪器必须装进真实插件作用域，根上下文测不出问题。
    let tracker: PresetRuntimeSnapshotTracker | undefined
    app.plugin((inner) => {
      tracker = new PresetRuntimeSnapshotTracker(inner)
    })
    await app.start()

    // ChatInterface 不带上下文，解析退回插件自己的上下文；真实运行时里两条候选都会被走到。
    await emit(app, 'chatluna/before-chat', 'core-turn', {}, { built: { preset: 'demo' } }, {}, session(target.botId, target.conversationId))

    expect(tracker?.getActiveSnapshots(target)).toMatchObject([{ kind: 'core', presetName: 'demo' }])
    expect(warnings).toEqual([])
    tracker?.dispose()
  })
})
