import { Context, Schema } from 'koishi'
import { archiveChatLunaModelRequestError } from './chatluna/error'
import { ChatLunaSessionTracker } from './chatluna/session-tracker'
import { linkChatLunaUsageRequest, type ChatLunaUsageLookup } from './chatluna/usage'
import { registerConsole } from './console'
import { DEFAULT_MODEL_REQUEST_RECORD_LIMIT, StudioModelRequestStore, type StudioModelRequestPersistence } from './model-request'
import { installModelRequestCollector, resolveChatLunaPluginClass } from './model-request-collector'
import { KoishiDatabaseModelRequestPersistence, registerStudioModelRequestModel } from './persistence'
import { PresetRuntimeSnapshotTracker, StudioPresetService } from './presets'
import type { StudioAppearance, StudioPersistenceMode, StudioPersistenceStatus } from './types'

export * from './console'
export * from './console-contract'
export * from './chatluna/error'
export * from './chatluna/session-tracker'
export * from './chatluna/usage'
export * from './evidence-kind'
export * from './model-evidence'
export * from './model-request'
export * from './model-request-collector'
export * from './model-request-trajectory'
export * from './model-request-variables'
export * from './persistence'
export * from './presets'
export * from './record-store'
export * from './types'

export const name = 'chatluna-studio'

export const usage = `
在 Koishi 控制台里查看 ChatLuna 的真实模型请求，并直接编辑 ChatLuna 与 chatluna-character 的预设文件。

- 模型请求页面记录每次真实对话触发的模型调用：请求体、响应原文、用量、轨迹与预设变量展开。
- 预设页面直接读写\`data/chathub/presets\`与\`data/chathub/character/presets\`下的 YAML 文件，保存后由 ChatLuna 自己热重载。
- 点击预设里的表达式可以跳到它在真实模型请求中的展开位置，需要先有一次用到该预设的成功请求。

模型请求的采集在 ChatLuna 的 fetch 边界完成，因此需要与 ChatLuna 装在同一个 Koishi 实例里。
`

/**
 * `chatluna_usage` 刻意不出现在这里。
 *
 * chatluna-usage 的用量服务是 Console `DataService`，Cordis 里的真实服务名是
 * `console.services.chatluna_usage`，根上下文永远没有 `chatluna_usage`。把它写进 `inject.optional`
 * 或 `koishi.service.optional`，只会让插件配置页一直显示「可选服务: chatluna_usage (未加载)」——即使
 * 用量插件已启用、用量也读得到。用量按服务名现取（见 `findChatLunaUsage`），不进 `inject`。
 */
export const inject = {
  required: ['console'],
  optional: ['database'],
}

export interface Config extends StudioAppearance {
  persistenceMode: StudioPersistenceMode
  modelRequestRecordLimit: number
}

export const Config: Schema<Config> = Schema.object({
  persistenceMode: Schema.union([
    Schema.const('memory').description('服务端内存'),
    Schema.const('database').description('Koishi Database'),
  ]).default('memory').role('radio').description('模型请求记录的存储方式。内存模式重启后记录清空'),
  modelRequestRecordLimit: Schema.number().min(1).default(DEFAULT_MODEL_REQUEST_RECORD_LIMIT)
    .description('保留的模型请求记录条数上限，超出后从最旧记录开始丢弃'),
  studioColorMode: Schema.union([
    Schema.const('auto').description('自动'),
    Schema.const('light').description('明亮'),
    Schema.const('dark').description('暗色'),
  ]).default('auto').role('radio').description('页面颜色模式。自动时跟随 Koishi 控制台'),
  studioAccentColor: Schema.string().default('#2563eb').role('color').description('页面强调色'),
  enableStudioFrostedGlass: Schema.boolean().default(true).description('启用浮层毛玻璃效果'),
  studioUseQQAvatars: Schema.boolean().default(true)
    .description('从 QQ 头像 CDN 加载机器人与会话头像。关闭后只显示首字母色块，浏览器不会向`q.qlogo.cn`发起请求'),
}).description('ChatLuna Studio')

declare module 'koishi' {
  interface Events {
    'chatluna/model-usage'(payload: import('./chatluna/usage').ChatLunaModelUsageEvent): void
  }
}

function findChatLunaUsage(ctx: Context): ChatLunaUsageLookup | undefined {
  for (const runtime of ctx.registry.values()) {
    const service = runtime.ctx.get('console.services.chatluna_usage') as ChatLunaUsageLookup | undefined
    if (service) return service
  }
}

export function apply(ctx: Context, config: Config) {
  ctx.inject({
    console: { required: true },
    database: { required: false },
  }, (inner) => {
    const logger = inner.logger('chatluna-studio')
    let persistence: StudioModelRequestPersistence | undefined
    if (config.persistenceMode === 'database') {
      registerStudioModelRequestModel(inner)
      // database 是可选注入，可能在本插件之后加载；必须传 getter 延迟解析，不能在此刻取值。
      persistence = new KoishiDatabaseModelRequestPersistence(() => inner.database)
    }
    const modelRequests = new StudioModelRequestStore({
      ...(persistence ? { persistence } : {}),
      maxRecords: config.modelRequestRecordLimit,
    })
    const presetSnapshots = new PresetRuntimeSnapshotTracker(inner)
    const sessions = new ChatLunaSessionTracker(inner, {
      // ChatLuna 规范错误只出现在对话链路的错误事件里，而模型请求记录只看得到 HTTP 层的失败；
      // 把它回填到本轮最近一条失败记录上，详情页才能给出错误码与可能原因。
      onTurnFailed: (error, turn) => {
        const conversationId = turn.entities.conversationId
        if (conversationId) archiveChatLunaModelRequestError(modelRequests, error, { conversationId })
      },
    })
    const presets = new StudioPresetService({ baseDir: inner.baseDir, modelRequests })
    const getPersistenceStatus = (): StudioPersistenceStatus => {
      if (config.persistenceMode !== 'database') {
        return { mode: 'memory', available: true, persisted: false }
      }
      const available = Boolean(inner.database)
      return {
        mode: 'database',
        available,
        persisted: available,
        ...(available ? {} : { message: 'Koishi Database 服务未安装或不可用，模型请求记录不会落盘' }),
      }
    }
    const notifyRecorded = registerConsole(inner.console, {
      modelRequests,
      presets,
      appearance: {
        enableStudioFrostedGlass: config.enableStudioFrostedGlass,
        studioColorMode: config.studioColorMode,
        studioAccentColor: config.studioAccentColor,
        studioUseQQAvatars: config.studioUseQQAvatars,
      },
      getPersistenceStatus,
      // chatluna-usage 位于另一个 loader group，Cordis 会为服务建立隔离映射；
      // 复用 usage 插件的 Context 才能解析到同一实例。
      chatlunaUsage: () => findChatLunaUsage(inner),
    })
    const chatLunaPlugin = resolveChatLunaPluginClass(inner.baseDir)
    const disposeCollector = installModelRequestCollector({
      ...(chatLunaPlugin ? { plugin: chatLunaPlugin } : {}),
      baseDir: inner.baseDir,
      store: modelRequests,
      resolveTurn: () => sessions.resolveActiveTurn(),
      getActivePresetSnapshots: (target) => presetSnapshots.getActiveSnapshots(target),
      onRecordAppended: ({ sequence }) => notifyRecorded(sequence),
    })
    logger.info(chatLunaPlugin
      ? 'ChatLuna 模型请求采集器已安装。'
      : '未找到 ChatLuna 运行时，模型请求采集器未安装。')
    inner.on('chatluna/model-usage', (payload) => {
      // 记录库读取是异步的，事件回调不可等待；失败只写日志，不影响 ChatLuna 主流程。
      void linkChatLunaUsageRequest([modelRequests], payload).catch((error) => {
        logger.warn('ChatLuna 用量事件关联模型请求失败。', error)
      })
    })
    inner.on('dispose', () => {
      disposeCollector()
      presetSnapshots.dispose()
      sessions.dispose()
      // Koishi 的 dispose 不可等待（cordis scope.reset 不 await disposer），
      // 这里只保证收尾写入的失败进日志，而不是被静默丢弃。
      void modelRequests.waitForPersistence().catch((error) => {
        logger.error('模型请求记录关机收尾持久化失败。', error)
      })
    })
  })
}
