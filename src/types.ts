import type { StudioEvidenceCompositionKind, StudioEvidenceKind } from './evidence-kind'

export type StudioPersistenceMode = 'memory' | 'database'

export interface StudioPersistenceStatus {
  mode: StudioPersistenceMode
  available: boolean
  persisted: boolean
  message?: string
}


/** 工作室外观：颜色模式、强调色、毛玻璃与头像来源，由插件全局配置统一控制。 */
export interface StudioAppearance {
  enableStudioFrostedGlass: boolean
  studioColorMode: 'auto' | 'light' | 'dark'
  studioAccentColor: string
  /** 开启时列表与详情向 QQ 头像 CDN 取真实头像；关闭时只用首字母色块，不发起外部请求。 */
  studioUseQQAvatars: boolean
}

/**
 * 可预期的领域业务拒绝：参数不合法、实体不存在、游标过期这类由领域规则主动作出的判定。
 *
 * 它存在的唯一理由是让上层能把「领域说不」与「实现出错」分开：Console 端点把领域拒绝的消息
 * 原样透出给前端，而基础设施故障（数据库不可用）与内部不变量违背不属于此类，应继续抛普通 `Error`。
 */
export class StudioDomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StudioDomainError'
  }
}


export class StudioModelRequestCursorExpiredError extends StudioDomainError {
  readonly code = 'cursor_expired' as const

  constructor(
    message: string,
    readonly earliestCursor?: number,
  ) {
    super(message)
    this.name = 'StudioModelRequestCursorExpiredError'
  }
}

export type StudioModelRequestStatus = 'pending' | 'success' | 'error'
export type StudioModelResponseBodyStatus = 'pending' | 'complete' | 'unavailable' | 'error'
export type StudioModelResponseBodyFormat = 'json' | 'text' | 'sse'
export type StudioModelRequestAttribution = 'attributed' | 'unattributed'

export interface StudioModelRequestError {
  code: string
  message: string
  retryable: boolean
  traceId: string
}

export interface StudioChatLunaRequestError {
  code?: number
  message?: string
  originMessage?: string
  isTimeout?: boolean
}

/**
 * 一条模型请求归属到的真实 OneBot 会话。
 *
 * 名称随请求一起快照，而不是读取时再查目录：群名与昵称会变，而记录要能复盘当时的现场；
 * 会话被解散或机器人下线后，目录里也已经查不到它们。
 */
export interface StudioModelRequestEntities {
  platform?: string
  botId?: string
  botName?: string
  conversationId?: string
  conversationName?: string
  conversationType?: StudioConversationType
  guildId?: string
  userId?: string
  userName?: string
}

/** 私聊与群聊是真实 OneBot 会话的全部形态；频道等其他平台概念不在本插件范围内。 */
export type StudioConversationType = 'private' | 'group'

export type StudioPresetDocumentKind = 'core' | 'character'
export type StudioPresetTemplateRole = 'system' | 'user' | 'assistant' | 'tool'

export interface StudioPresetRuntimeTemplate {
  path: readonly (string | number)[]
  role: StudioPresetTemplateRole
  template: string
}

export interface StudioPresetRuntimeSnapshot {
  kind: StudioPresetDocumentKind
  presetName: string
  capturedAt: string
  source?: string
  templates: readonly StudioPresetRuntimeTemplate[]
}

export interface StudioPresetRuntimeSnapshotSummary {
  kind: StudioPresetDocumentKind
  presetName: string
  capturedAt: string
  templateCount: number
}

export type StudioModelRequestVariableStatus =
  | 'observed'
  | 'stale'
  | 'not-observed'
  | 'ambiguous'
  | 'unsupported'

export interface StudioModelRequestVariable {
  id: string
  name: string
  presetKind: StudioPresetDocumentKind
  presetName: string
  path: readonly (string | number)[]
  occurrence: number
  status: StudioModelRequestVariableStatus
  value?: string
  evidenceId?: string
  range?: { start: number, end: number }
}

/**
 * 一条模型请求记录被共享模型证据投影读出的计数。
 *
 * 两个字段都是投影派生事实，与模型请求对话视图、模型请求轨迹使用完全相同的消息边界和工具展平规则。
 * 原始请求体的字段数与模型名称不属于这里：它们不是协议事实，见 StudioModelRequestDetail。
 */
export interface StudioModelEvidenceCounts {
  requestMessageCount: number
  toolDefinitionCount: number
}

export interface StudioModelRequestUsage {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cachedTokens?: number
  totalTokens?: number
  ttftMs?: number
  totalMs?: number
  tps?: number
  estimated?: boolean
  source: 'chatluna-usage' | 'response'
}

export interface StudioModelRequestRecord {
  id: string
  sequence: number
  createdAt: string
  status: StudioModelRequestStatus
  durationMs: number
  method?: string
  url?: string
  provider?: string
  model?: string
  headers?: Record<string, string>
  attribution: StudioModelRequestAttribution
  entities: StudioModelRequestEntities
  requestBodyAvailable: boolean
  requestBody?: unknown
  responseBodyStatus: StudioModelResponseBodyStatus
  responseBodyFormat?: StudioModelResponseBodyFormat
  responseStatus?: number
  responseBodyRaw?: string
  responseBodyError?: string
  interactionId?: string
  chatlunaRequestId?: string
  presetSnapshots?: readonly StudioPresetRuntimeSnapshot[]
  usage?: StudioModelRequestUsage
  error?: StudioModelRequestError
  chatlunaError?: StudioChatLunaRequestError
}

export type StudioModelRequestListItem = Omit<StudioModelRequestRecord, 'requestBody' | 'responseBodyRaw' | 'presetSnapshots'> & {
  presetSnapshotSummaries?: readonly StudioPresetRuntimeSnapshotSummary[]
}
export type StudioModelRequestDetail = StudioModelRequestRecord & {
  /** 原始请求体的顶层键数量。这是原始 JSON 事实而不是投影产物；请求体未采集或不是对象时缺省。 */
  requestBodyKeyCount?: number
  /** 共享模型证据投影派生的计数。请求体未采集时缺省，采集到但不是对象时两项均为 0。 */
  evidenceCounts?: StudioModelEvidenceCounts
  variables: readonly StudioModelRequestVariable[]
}

export interface GetStudioModelRequestRecordsInput {
  attribution?: StudioModelRequestAttribution
  botId?: string
  conversationId?: string
  interactionId?: string
  model?: string
  errorsOnly?: boolean
  order?: 'asc' | 'desc'
  limit?: number
  beforeSequence?: number
  beforeCreatedAt?: string
  beforeId?: string
}

export interface StudioModelRequestCapacity {
  recordCount: number
  totalBytes: number
  maxRecords: number
  maxBytes: number
}

export interface StudioModelRequestRecordsPage<T extends StudioModelRequestListItem = StudioModelRequestListItem> {
  records: T[]
  hasMore: boolean
  nextCursor?: number
  nextCreatedAt?: string
  nextId?: string
  earliestCursor?: number
  capacity: StudioModelRequestCapacity
}

/**
 * 轨迹账本的行种类：一维基础证据种类，外加视图特有的请求边界行。
 *
 * 请求边界不是证据，而是「一次模型请求从这里开始」的结构标记；
 * 隐藏全部证据种类后仍要能看出有哪些请求，因此它不并入基础证据种类。
 */
export type StudioModelRequestTrajectoryKind = StudioEvidenceKind | 'request'

export interface StudioModelRequestTrajectoryRow {
  id: string
  index: number
  kind: StudioModelRequestTrajectoryKind
  preview: string
  /** 模型证据投影身份。请求边界行没有对应的原始模型证据，因此不带此字段。 */
  evidenceId?: string
  callId?: string
  toolName?: string
  variableId?: string
  variableName?: string
  variablePresetName?: string
  variableStatus?: StudioModelRequestVariableStatus
  variableValue?: string
  source?: 'request' | 'response'
  durationMs?: number
  startedAt?: string
  requestId?: string
  status?: StudioModelRequestStatus
}

/** 请求组成项的种类：基础证据种类的子集加工具交互聚合，聚合成员由证据种类 module 声明。 */
export type StudioModelRequestPromptKind = StudioEvidenceCompositionKind

/**
 * 请求组成图的粒度。
 *
 * `evidence` 逐条证据一段，`aggregate` 每请求每种类一段。会话轨迹按分段可辨识度选择，
 * 判据与阈值由请求组成 module 独占；单请求轨迹恒为逐条证据。
 */
export type StudioModelRequestPromptCompositionGranularity = 'evidence' | 'aggregate'

export interface StudioModelRequestPromptCompositionItem {
  kind: StudioModelRequestPromptKind
  /** 点击组成分段时定位的轨迹行身份；变量片段使用变量证据身份。聚合粒度下一段覆盖多条证据，因此缺省。 */
  evidenceId?: string
  characters: number
  /** 聚合粒度下这一段合并了多少条逐段证据；逐条证据粒度缺省。 */
  segmentCount?: number
  variableId?: string
  variableName?: string
  requestId?: string
}

export interface StudioModelRequestTrajectory {
  mode: 'request' | 'conversation'
  conversationId?: string
  records: readonly StudioModelRequestListItem[]
  rows: readonly StudioModelRequestTrajectoryRow[]
  promptComposition: readonly StudioModelRequestPromptCompositionItem[]
  complete: boolean
  granularity: StudioModelRequestPromptCompositionGranularity
  /** 整段轨迹的事件行总数，不含请求边界行。账本按请求展开时 `rows` 只含已展开部分，因此计数另算。 */
  eventTotal: number
  /** 已经下发事件行的请求标识；其余请求只有请求边界行。 */
  expandedRequestIds: readonly string[]
}

export interface GetStudioModelRequestRecordInput { recordId: string }
export interface ClearStudioModelRequestRecordsResult { cleared: number }

/**
 * 记录读取的归属范围。
 *
 * 全部记录住在同一个记录库里，范围只是一道归属过滤：真实环境没有互相隔离的记录域，
 * 「未归属」也不是另一个库，而是采集时无法判定是哪一个会话在请求模型的那些记录。
 */
export type StudioModelRequestScope = { scope: 'all' | 'attributed' | 'unattributed' }

export type ListStudioModelRequestRecordsInput = StudioModelRequestScope & GetStudioModelRequestRecordsInput
export type ReadStudioModelRequestRecordInput = GetStudioModelRequestRecordInput
export type ReadStudioModelRequestTrajectoryInput = {
  recordId: string
  mode: 'request' | 'conversation'
  /**
   * 会话模式下要下发事件行的请求标识。缺省或空表示只要请求边界行。
   * 服务端不替调用方补任何一条：补上的那条会永远折不起来。
   */
  expandedRequestIds?: readonly string[]
}

/** 筛选下拉的可选值，由记录库里已经出现过的机器人、会话与模型聚合而成。 */
export interface StudioModelRequestFacets {
  bots: readonly { id: string, name?: string, platform?: string }[]
  conversations: readonly {
    id: string
    name?: string
    type?: StudioConversationType
    botId?: string
  }[]
  models: readonly string[]
}
