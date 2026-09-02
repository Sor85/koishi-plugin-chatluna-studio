import { receive, send } from '@koishijs/client'
import type { StudioModelRequestRecordedPayload } from '../../src/console-contract'
import type { ModelRequestRecordedListener, WorkspacePort } from './port'

const recordedListeners = new Set<ModelRequestRecordedListener>()
let receiverInstalled = false

function notifyRecordedListeners(payload: StudioModelRequestRecordedPayload) {
  for (const listener of recordedListeners) listener(payload)
}

function installRecordedReceiver() {
  if (receiverInstalled) return
  receiverInstalled = true
  // Koishi receive 对同名事件只保存一个回调；页面反复挂载时若每次都注册，后卸载的页面会
  // 留下失效回调并覆盖存活页面。这里只注册一次，再由适配器扇出给全部订阅者。
  receive('chatluna-studio/model-request-recorded', notifyRecordedListeners)
}

interface ModelRequestRecordedContext {
  on(event: 'chatluna-studio/model-request-recorded', callback: ModelRequestRecordedListener): unknown
}

export function installContextModelRequestReceiver(ctx: unknown) {
  const context = ctx as ModelRequestRecordedContext
  // Console 的预构建入口与插件源码可能各自持有一份 @koishijs/client；主 Context 事件总线
  // 才是服务端广播实际抵达的位置，不能只依赖模块级 receive 单例。
  context.on('chatluna-studio/model-request-recorded', notifyRecordedListeners)
}

export function createKoishiWorkspacePort(): WorkspacePort {
  return {
    getWorkspace: () => send('chatluna-studio/workspace'),
    subscribeModelRequestRecorded: (listener) => {
      installRecordedReceiver()
      recordedListeners.add(listener)
      return () => { recordedListeners.delete(listener) }
    },
  }
}
