import type {
  ClearStudioModelRequestRecordsResult,
  ListStudioModelRequestRecordsInput,
  ReadStudioModelRequestRecordInput,
  ReadStudioModelRequestTrajectoryInput,
  StudioAppearance,
  StudioModelRequestDetail,
  StudioModelRequestFacets,
  StudioModelRequestRecordsPage,
  StudioModelRequestTrajectory,
  StudioPersistenceStatus,
} from './types'
import type {
  CreatePresetInput,
  DeletePresetInput,
  LocateStudioPresetExpressionInput,
  LocateStudioPresetExpressionResult,
  PresetDocumentKind,
  ReadStudioPresetInput,
  RenamePresetInput,
  StudioPresetDocument,
  SavePresetInput,
} from './presets'

/**
 * Console 契约：前后端之间端点名、入参、出参与广播载荷的唯一声明。
 *
 * 服务端的事件映射、对 `@koishijs/console` 的 `Events` 模块增强与客户端 `send` / `receive`
 * 的签名全部从这里派生，加端点只改这一处。本模块只有类型，不 import 任何服务，因此客户端
 * 引用它不会把服务端运行时拖进前端产物；入参与出参一律引用既有领域类型，不复制一份形状。
 *
 * 分组按客户端端口能力书写，分组只是给读的人用的；端点集合是全体分组的并集。
 * 鉴权级别不进契约：它是注册时的策略，不是端点的形状。
 */

/** 工作区：页面挂载时需要的全局事实，与具体记录无关。 */
export interface StudioWorkspaceConsoleEvents {
  'chatluna-studio/workspace': () => Promise<StudioWorkspaceState>
}

/** 页面一次取齐的全局事实：外观由插件配置决定，持久化状态解释记录能不能活过重启。 */
export interface StudioWorkspaceState {
  appearance: StudioAppearance
  persistence: StudioPersistenceStatus
}

/** 模型请求：记录列表、详情、轨迹、筛选可选值与清理。 */
export interface StudioModelRequestConsoleEvents {
  'chatluna-studio/model-request-records': (input: ListStudioModelRequestRecordsInput) => Promise<StudioModelRequestRecordsPage>
  'chatluna-studio/model-request-record': (input: ReadStudioModelRequestRecordInput) => Promise<StudioModelRequestDetail>
  'chatluna-studio/model-request-trajectory': (input: ReadStudioModelRequestTrajectoryInput) => Promise<StudioModelRequestTrajectory>
  'chatluna-studio/model-request-facets': () => Promise<StudioModelRequestFacets>
  'chatluna-studio/clear-model-request-records': () => Promise<ClearStudioModelRequestRecordsResult>
}

/** 预设：ChatLuna 预设文档的读取、编辑与表达式定位。 */
export interface StudioPresetConsoleEvents {
  'chatluna-studio/preset-catalog': (input?: { kind?: PresetDocumentKind }) => Promise<StudioPresetDocument[]>
  'chatluna-studio/preset-read': (input: ReadStudioPresetInput) => Promise<StudioPresetDocument>
  'chatluna-studio/preset-create': (input: CreatePresetInput) => Promise<StudioPresetDocument>
  'chatluna-studio/preset-save': (input: SavePresetInput) => Promise<StudioPresetDocument>
  'chatluna-studio/preset-rename': (input: RenamePresetInput) => Promise<StudioPresetDocument>
  'chatluna-studio/preset-delete': (input: DeletePresetInput) => Promise<{ deleted: true }>
  'chatluna-studio/preset-locate-expression': (input: LocateStudioPresetExpressionInput) => Promise<LocateStudioPresetExpressionResult>
}

/** 端点集合是全体分组的并集；服务端注册与客户端消费都以它为唯一名单。 */
export interface StudioConsoleEvents extends
  StudioWorkspaceConsoleEvents,
  StudioModelRequestConsoleEvents,
  StudioPresetConsoleEvents {}

export type StudioConsoleEndpoint = keyof StudioConsoleEvents

/**
 * 有新模型请求落库的广播载荷。
 *
 * 只带序号不带记录：列表当前的筛选、排序与分页只有前端知道，推整条记录会让服务端替前端猜
 * 「这条该插在哪」，而序号足够让前端判断自己是不是已经看过这一条。
 */
export interface StudioModelRequestRecordedPayload {
  sequence: number
}

/** 广播频道名到载荷；服务端 `broadcast` 与客户端 `receive` 都从这里取类型。 */
export interface StudioConsoleBroadcasts {
  'chatluna-studio/model-request-recorded': StudioModelRequestRecordedPayload
}

export type StudioConsoleBroadcastChannel = keyof StudioConsoleBroadcasts
