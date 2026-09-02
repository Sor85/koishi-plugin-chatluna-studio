import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type {} from '@koishijs/console'
import { lookupChatLunaUsage, type ChatLunaUsageLookup } from './chatluna/usage'
import { buildStudioModelRequestTrajectoryFromStore } from './model-request-trajectory'
import type {
  StudioConsoleBroadcasts,
  StudioConsoleEvents,
  StudioWorkspaceState,
} from './console-contract'
import type { StudioModelRequestStore } from './model-request'
import type { StudioPresetService } from './presets'
import type {
  ClearStudioModelRequestRecordsResult,
  ListStudioModelRequestRecordsInput,
  ReadStudioModelRequestRecordInput,
  ReadStudioModelRequestTrajectoryInput,
  StudioAppearance,
  StudioModelRequestDetail,
  StudioModelRequestRecordsPage,
  StudioModelRequestTrajectory,
  StudioPersistenceStatus,
} from './types'

/** 用量服务可能晚于本插件加载或被热重载；因此按需现取，不缓存实例。 */
type ChatLunaUsageSource = () => ChatLunaUsageLookup | undefined

export function resolveConsoleEntry(workspace = process.cwd()): { dev: string; prod: string } {
  const installedRoot = resolve(workspace, 'node_modules/koishi-plugin-chatluna-studio')
  // 本地软链接会让 __dirname 指向仓库真实路径，Koishi Console 因路径不含 node_modules 而拒绝资源。
  // 优先保留工作区内的安装入口，使安全检查看到合法包路径；普通安装和测试仍回退到模块目录。
  const packageRoot = existsSync(resolve(installedRoot, 'package.json'))
    ? installedRoot
    : resolve(__dirname, '..')
  return {
    dev: resolve(packageRoot, 'client/index.ts'),
    prod: resolve(packageRoot, 'dist'),
  }
}

export interface StudioConsoleRegistrar {
  addEntry(entry: { dev: string; prod: string }): unknown
  addListener<Event extends keyof StudioConsoleEvents>(
    event: Event,
    callback: StudioConsoleEvents[Event],
    options: { authority: number },
  ): unknown
  broadcast<Channel extends keyof StudioConsoleBroadcasts>(
    type: Channel,
    body: StudioConsoleBroadcasts[Channel],
  ): unknown
}

export interface RegisterStudioConsoleOptions {
  modelRequests: StudioModelRequestStore
  presets: StudioPresetService
  appearance: StudioAppearance
  getPersistenceStatus: () => StudioPersistenceStatus
  chatlunaUsage?: ChatLunaUsageSource
}

export function registerConsole(console: StudioConsoleRegistrar, options: RegisterStudioConsoleOptions) {
  const { modelRequests, presets, appearance } = options
  console.addEntry(resolveConsoleEntry())

  const getWorkspace = async (): Promise<StudioWorkspaceState> => ({
    appearance,
    persistence: options.getPersistenceStatus(),
  })
  const listRecords = (input: ListStudioModelRequestRecordsInput): Promise<StudioModelRequestRecordsPage> => {
    const { scope, ...query } = input
    // 范围在契约上是一个词，在记录库里就是归属过滤；「全部」不带过滤条件。
    return modelRequests.getRecords(scope === 'all' ? query : { ...query, attribution: scope })
  }
  const readRecord = async (input: ReadStudioModelRequestRecordInput): Promise<StudioModelRequestDetail> => {
    const detail = await modelRequests.requireRecord(input.recordId)
    const usage = await lookupChatLunaUsage(options.chatlunaUsage?.(), detail)
    return usage ? { ...detail, usage } : detail
  }
  const readTrajectory = async (input: ReadStudioModelRequestTrajectoryInput): Promise<StudioModelRequestTrajectory> => {
    const record = await modelRequests.requireRecord(input.recordId)
    return buildStudioModelRequestTrajectoryFromStore({ record, mode: input.mode, store: modelRequests })
  }
  const clearRecords = async (): Promise<ClearStudioModelRequestRecordsResult> => ({
    cleared: await modelRequests.clear(),
  })

  // Koishi 的 Events 映射规模较大，直接调用泛型 addListener 会让 TypeScript
  // 展开整个事件联合并触发 TS2590；这里保留事件名约束，回调由各领域函数自身类型校验。
  const registerListener = console.addListener.bind(console) as (
    event: keyof StudioConsoleEvents,
    callback: (...args: any[]) => any,
    options: { authority: number },
  ) => unknown
  registerListener('chatluna-studio/workspace', getWorkspace, { authority: 4 })
  registerListener('chatluna-studio/model-request-records', listRecords, { authority: 4 })
  registerListener('chatluna-studio/model-request-record', readRecord, { authority: 4 })
  registerListener('chatluna-studio/model-request-trajectory', readTrajectory, { authority: 4 })
  registerListener('chatluna-studio/model-request-facets', () => modelRequests.getFacets(), { authority: 4 })
  registerListener('chatluna-studio/clear-model-request-records', clearRecords, { authority: 4 })
  registerListener('chatluna-studio/preset-catalog', (input = {}) => presets.catalog(input.kind), { authority: 4 })
  registerListener('chatluna-studio/preset-read', (input) => presets.read(input), { authority: 4 })
  registerListener('chatluna-studio/preset-create', (input) => presets.create(input), { authority: 4 })
  registerListener('chatluna-studio/preset-save', (input) => presets.save(input), { authority: 4 })
  registerListener('chatluna-studio/preset-rename', (input) => presets.rename(input), { authority: 4 })
  registerListener('chatluna-studio/preset-delete', (input) => presets.delete(input), { authority: 4 })
  registerListener('chatluna-studio/preset-locate-expression', (input) => presets.locateExpression(input), { authority: 4 })

  /** 采集器登记一条新记录时调用；页面据此立即刷新，不必等下一轮轮询。 */
  return (sequence: number) => {
    void console.broadcast('chatluna-studio/model-request-recorded', { sequence })
  }
}

/**
 * 对 `@koishijs/console` 的模块增强从契约派生：`Events` 直接继承契约映射，
 * 因此端点名与签名不在这里第二次出现。属性函数类型对方法签名位置可赋值，
 * Koishi 的 `addListener` 与 `send` 因此照旧拿到逐端点的精确签名。
 */
declare module '@koishijs/console' {
  interface Events extends StudioConsoleEvents {}
}
