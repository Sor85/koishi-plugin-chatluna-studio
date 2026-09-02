import type { StudioWorkspaceState } from '../../src/console-contract'
import type { StudioModelRequestRecordedPayload } from '../../src/console-contract'

export type ModelRequestRecordedListener = (payload: StudioModelRequestRecordedPayload) => void

/**
 * 工作区端口：页面挂载时要取的全局事实，以及「有新记录落库了」这条广播的订阅。
 *
 * 与模型请求、预设两个端口分开：那两个端口的输入里都是记录或文件，而这里一个入参都没有。
 * 广播订阅也放这里而不是模型请求端口上：一份广播扇出给多少个页面、以及只向 Koishi 注册一次
 * 回调，都是传输层的事，与「读哪一页记录」不在同一个关注点上。
 */
export interface WorkspacePort {
  getWorkspace(): Promise<StudioWorkspaceState>
  subscribeModelRequestRecorded(listener: ModelRequestRecordedListener): () => void
}

export type WorkspacePortOperation = keyof WorkspacePort
