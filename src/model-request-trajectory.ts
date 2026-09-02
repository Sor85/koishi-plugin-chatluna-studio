import type {
  StudioModelRequestDetail,
  StudioModelRequestPromptCompositionItem,
  StudioModelRequestPromptKind,
  StudioModelRequestRecord,
  StudioModelRequestStatus,
  StudioModelRequestTrajectory,
  StudioModelRequestTrajectoryKind,
  StudioModelRequestTrajectoryRow,
  StudioModelRequestVariable,
} from './types'
import { presentModelRequestListItem, type StudioModelRequestStore } from './model-request'
import { normalizeEvidencePreviewText } from './evidence-preview-text'
import { deriveModelRequestVariables, modelRequestVariableStatusLabel } from './model-request-variables'
import { studioEvidenceAggregate } from './evidence-kind'
import {
  countMessageCharacters,
  countToolCallCharacters,
  countToolDefinitionCharacters,
  projectModelEvidence,
  type ModelEvidenceMessage,
  type ModelEvidenceProjection,
} from './model-evidence'

interface BuildStudioModelRequestTrajectoryOptions {
  record: StudioModelRequestDetail
  mode: 'request' | 'conversation'
  /** 会话模式下同会话的原始记录，按 sequence 正序；缺省表示无法聚合，只呈现当前请求。 */
  conversationRecords?: readonly StudioModelRequestRecord[]
}

interface ProjectedRow {
  evidenceId: string
  kind: StudioModelRequestTrajectoryKind
  preview: string
  callId?: string
  toolName?: string
  variableId?: string
  variableName?: string
  variablePresetName?: string
  variableStatus?: StudioModelRequestVariable['status']
  variableValue?: string
}

const CONVERSATION_RECORD_LIMIT = 200
const TRAJECTORY_PREVIEW_LENGTH = 180
/** 组成图的工具交互档。合并了哪两种基础证据由证据种类 module 声明，这里只引用聚合身份。 */
const TOOL_INTERACTION_KIND = studioEvidenceAggregate('tool-interaction').id

/**
 * 读取会话模式需要的同会话记录。记录库的读取是异步的，而轨迹投影本身是纯函数；
 * 这个薄封装是唯一需要 Store 的地方，投影因此保持可单测、可复用。
 */
export async function readStudioModelRequestConversationRecords(
  record: Pick<StudioModelRequestDetail, 'entities'>,
  store: StudioModelRequestStore | undefined,
): Promise<StudioModelRequestRecord[] | undefined> {
  const conversationId = record.entities.conversationId
  if (!store || !conversationId) return
  return store.getRawRecords({ conversationId, order: 'asc', limit: CONVERSATION_RECORD_LIMIT })
}

export async function buildStudioModelRequestTrajectoryFromStore(options: {
  record: StudioModelRequestDetail
  mode: 'request' | 'conversation'
  store?: StudioModelRequestStore
}): Promise<StudioModelRequestTrajectory> {
  const conversationRecords = options.mode === 'conversation'
    ? await readStudioModelRequestConversationRecords(options.record, options.store)
    : undefined
  return buildStudioModelRequestTrajectory({
    record: options.record,
    mode: options.mode,
    ...(conversationRecords ? { conversationRecords } : {}),
  })
}

export function buildStudioModelRequestTrajectory(
  options: BuildStudioModelRequestTrajectoryOptions,
): StudioModelRequestTrajectory {
  const sourceRecords = options.mode === 'conversation' && options.conversationRecords
    ? options.conversationRecords
    : [options.record]
  const records = sourceRecords.map(record => presentModelRequestListItem(record))
  const rows: StudioModelRequestTrajectoryRow[] = []
  const promptComposition: StudioModelRequestPromptCompositionItem[] = []
  let index = 1

  for (const record of sourceRecords) {
    // 轨迹只负责会话聚合、请求边界、时间与组成统计；协议语义全部来自共享模型证据投影。
    const projection = projectModelEvidence({
      requestBody: record.requestBody,
      ...(record.responseBodyStatus === 'complete' && record.responseBodyRaw !== undefined
        ? { responseBodyRaw: record.responseBodyRaw, responseBodyFormat: record.responseBodyFormat }
        : {}),
    })
    // 变量派生只读投影的请求消息，因此可以直接复用这一份投影。会话模式下每条记录都要派生变量，
    // 经由详情投影绕一圈会让同一条记录被重复投影三次、重复派生变量两次。
    const variables = record.requestBody !== undefined && record.presetSnapshots?.length
      ? deriveModelRequestVariables(record.presetSnapshots, projection)
      : []

    rows.push({
      id: `${record.id}:request`,
      index: index++,
      kind: 'request',
      preview: requestPreview(record),
      durationMs: record.durationMs,
      startedAt: record.createdAt,
      requestId: record.id,
      status: record.status,
    })

    for (const row of projectRequestRows(projection, variables)) {
      rows.push({
        id: `${record.id}:${row.evidenceId}`,
        index: index++,
        requestId: record.id,
        source: 'request',
        ...row,
      })
    }
    for (const row of projectResponseRows(projection)) {
      rows.push({ id: `${record.id}:${row.evidenceId}`, index: index++, requestId: record.id, source: 'response', ...row })
    }
    for (const item of projectPromptComposition(projection, variables)) {
      promptComposition.push(options.mode === 'conversation' ? { ...item, requestId: record.id } : item)
    }
  }

  return {
    mode: options.mode,
    ...(options.record.entities.conversationId
      ? { conversationId: options.record.entities.conversationId }
      : {}),
    records,
    rows,
    promptComposition,
    complete: options.mode === 'request' || !options.conversationRecords || sourceRecords.length < CONVERSATION_RECORD_LIMIT,
  }
}

function projectRequestRows(
  projection: ModelEvidenceProjection,
  variables: readonly StudioModelRequestVariable[],
): ProjectedRow[] {
  const rows: ProjectedRow[] = projection.toolDefinitions.map(definition => ({
    evidenceId: definition.evidenceId,
    kind: 'tool-definition' as const,
    preview: `工具定义 · ${definition.name}`,
    toolName: definition.name,
  }))
  for (const message of projection.requestMessages) {
    rows.push(...messageRows(message))
  }
  for (const variable of variables) {
    rows.push({
      evidenceId: `variable:${variable.id}`,
      kind: 'variable',
      preview: `${variable.name} · ${variable.status === 'observed' ? compactText(variable.value ?? '') || '空值' : modelRequestVariableStatusLabel(variable.status)}`,
      variableId: variable.id,
      variableName: variable.name,
      variablePresetName: variable.presetName,
      variableStatus: variable.status,
      ...(variable.value !== undefined ? { variableValue: variable.value } : {}),
    })
  }
  return rows.sort((left, right) => requestRowOrder(left.kind) - requestRowOrder(right.kind))
}

function requestRowOrder(kind: StudioModelRequestTrajectoryKind): number {
  if (kind === 'system') return 0
  if (kind === 'user') return 1
  if (kind === 'variable') return 2
  if (kind === 'assistant') return 3
  return 4
}

function messageRows(message: ModelEvidenceMessage): ProjectedRow[] {
  const rows: ProjectedRow[] = []
  if (message.role === 'tool') {
    rows.push({
      evidenceId: message.evidenceId,
      kind: 'tool-result',
      preview: `${message.toolName ?? '工具结果'} · ${compactText(message.text) || '无输出'}`,
      ...(message.toolName ? { toolName: message.toolName } : {}),
      ...(message.toolCallId ? { callId: message.toolCallId } : {}),
    })
    return rows
  }
  const reasoning = message.reasoning ? compactText(message.reasoning) : ''
  const text = compactText(message.text)
  if (text || reasoning) {
    rows.push({
      evidenceId: message.evidenceId,
      kind: message.role,
      preview: text || `思考 · ${reasoning}`,
    })
  }
  for (const call of message.toolCalls) {
    rows.push({
      evidenceId: call.evidenceId,
      kind: 'tool-call',
      preview: `${call.name} · ${compactText(call.arguments ?? '') || '无参数'}`,
      toolName: call.name,
      ...(call.callId ? { callId: call.callId } : {}),
    })
  }
  return rows
}

function projectResponseRows(projection: ModelEvidenceProjection): ProjectedRow[] {
  return projection.responseEvents.flatMap<ProjectedRow>((event) => {
    if (event.kind === 'reasoning') {
      return [{ evidenceId: event.evidenceId, kind: 'assistant', preview: `思考 · ${compactText(event.text ?? '')}` }]
    }
    if (event.kind === 'content') {
      return [{ evidenceId: event.evidenceId, kind: 'assistant', preview: compactText(event.text ?? '') }]
    }
    if (event.kind === 'tool-call') {
      return [{
        evidenceId: event.evidenceId,
        kind: 'tool-call',
        preview: `${event.name ?? '工具调用'} · ${compactText(event.arguments ?? '') || '无参数'}`,
        ...(event.name ? { toolName: event.name } : {}),
        ...(event.callId ? { callId: event.callId } : {}),
      }]
    }
    if (event.kind === 'tool-result') {
      return [{
        evidenceId: event.evidenceId,
        kind: 'tool-result',
        preview: `${event.name ?? '工具结果'} · ${compactText(event.text ?? '') || '无输出'}`,
        ...(event.name ? { toolName: event.name } : {}),
        ...(event.callId ? { callId: event.callId } : {}),
      }]
    }
    return []
  })
}

function projectPromptComposition(
  projection: ModelEvidenceProjection,
  variables: readonly StudioModelRequestVariable[],
): StudioModelRequestPromptCompositionItem[] {
  const sequence: StudioModelRequestPromptCompositionItem[] = []
  const variablesByEvidenceId = groupObservedVariablesByEvidenceId(variables)
  for (const message of projection.requestMessages) {
    // 请求消息里的工具结果与工具调用成对出现，组成图按字符占比把它们统计为同一档工具交互；
    // 合并规则本身由证据种类 module 的工具交互聚合声明。
    const kind: StudioModelRequestPromptKind = message.role === 'tool' ? TOOL_INTERACTION_KIND : message.role
    const messageCharacters = countMessageCharacters(message)
    if (kind === 'system' || kind === 'user') {
      pushMessageComposition(sequence, kind, message.evidenceId, messageCharacters, variablesByEvidenceId.get(message.evidenceId) ?? [])
    } else {
      push(sequence, kind, message.evidenceId, messageCharacters)
    }
    for (const call of message.toolCalls) {
      push(sequence, TOOL_INTERACTION_KIND, call.evidenceId, countToolCallCharacters(call))
    }
  }

  const tools = projection.toolDefinitions.map(definition => ({
    kind: 'tool-definition' as const,
    evidenceId: definition.evidenceId,
    characters: Math.max(countToolDefinitionCharacters(definition), 1),
  }))

  // 工具声明不是对话轮次，但属于请求前缀。变量片段仍使用原请求消息的角色，
  // 因此和 leading system/user 一起自然保留在工具声明之前。
  let split = 0
  while (split < sequence.length && (sequence[split]!.kind === 'system' || sequence[split]!.kind === 'user')) {
    split += 1
  }
  return [...sequence.slice(0, split), ...tools, ...sequence.slice(split)]
}

function groupObservedVariablesByEvidenceId(
  variables: readonly StudioModelRequestVariable[],
): Map<string, StudioModelRequestVariable[]> {
  const grouped = new Map<string, StudioModelRequestVariable[]>()
  for (const variable of variables) {
    if (variable.status !== 'observed' || !variable.evidenceId || !variable.range) continue
    if (variable.range.end <= variable.range.start) continue
    const items = grouped.get(variable.evidenceId) ?? []
    items.push(variable)
    grouped.set(variable.evidenceId, items)
  }
  for (const items of grouped.values()) {
    items.sort((left, right) => left.range!.start - right.range!.start || left.range!.end - right.range!.end)
  }
  return grouped
}

function pushMessageComposition(
  target: StudioModelRequestPromptCompositionItem[],
  kind: 'system' | 'user',
  evidenceId: string,
  characters: number,
  variables: readonly StudioModelRequestVariable[],
): void {
  if (!variables.length || characters <= 0) {
    push(target, kind, evidenceId, characters)
    return
  }

  let offset = 0
  for (const variable of variables) {
    const range = variable.range!
    if (range.start < offset || range.start > characters || range.end > characters) continue
    push(target, kind, evidenceId, range.start - offset)
    target.push({
      // 模型请求变量在组成图中统一投影到 User 轨道，和工具定义一样按变量逐段展示。
      kind: 'user',
      evidenceId: `variable:${variable.id}`,
      characters: range.end - range.start,
      variableId: variable.id,
      variableName: variable.name,
    })
    offset = range.end
  }
  push(target, kind, evidenceId, characters - offset)
}

function push(
  target: StudioModelRequestPromptCompositionItem[],
  kind: StudioModelRequestPromptKind,
  evidenceId: string,
  count: number,
): void {
  if (count > 0) target.push({ kind, evidenceId, characters: count })
}

function requestPreview(record: StudioModelRequestRecord): string {
  const provider = record.provider || '未知渠道'
  const model = record.model || '未知模型'
  if (record.status === 'pending') return `${provider} / ${model} · 进行中`
  if (record.status === 'error') return `${provider} / ${model} · 请求失败`
  return `${provider} / ${model} · ${record.durationMs} ms`
}

function compactText(value: string): string {
  const normalized = normalizeEvidencePreviewText(value, TRAJECTORY_PREVIEW_LENGTH)
  return normalized.length > TRAJECTORY_PREVIEW_LENGTH ? `${normalized.slice(0, 177)}…` : normalized
}

export function statusLabel(status: StudioModelRequestStatus): string {
  if (status === 'pending') return '进行中'
  if (status === 'error') return '错误'
  return '已完成'
}
