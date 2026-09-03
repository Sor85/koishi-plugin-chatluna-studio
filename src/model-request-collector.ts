import { createRequire } from 'node:module'
import diagnosticsChannel from 'node:diagnostics_channel'
import { resolve } from 'node:path'
import type { ChatLunaTurnResolution } from './chatluna/session-tracker'
import { createModelRequestError, type StudioModelRequestStore } from './model-request'
import type {
  StudioModelRequestRecord,
  StudioPresetRuntimeSnapshot,
} from './types'

export interface ChatLunaPluginLike {
  prototype: {
    fetch: (...args: any[]) => Promise<any>
  }
}

/** 预设运行时快照的查询目标：一次归属成功的模型请求所属的（机器人，会话）。 */
export interface ModelRequestPresetSnapshotTarget {
  botId: string
  conversationId: string
}

const AUTH_QUERY_PATTERN = /^(?:api[_-]?key|key|token|access[_-]?token|auth(?:orization)?|secret|password|signature)$/i
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH'])

export function isKnownChatModelRequestUrl(url: string): boolean {
  const path = readUrlPath(url)
  return /\/chat\/completions\/?$/i.test(path)
    || /\/responses\/?$/i.test(path)
    || /\/v1\/messages\/?$/i.test(path)
    || /:generateContent$/i.test(path)
    || /:streamGenerateContent$/i.test(path)
}

export function sanitizeModelRequestUrl(raw: string): string {
  try {
    const url = new URL(raw)
    // 用户名/密码和认证 query 都属于密钥材料，记录里只保留可复盘的地址本身。
    url.username = ''
    url.password = ''
    for (const key of [...url.searchParams.keys()]) {
      if (AUTH_QUERY_PATTERN.test(key)) url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return raw.split('?')[0] ?? raw
  }
}

export function resolveChatLunaPluginClass(baseDir = process.cwd()): ChatLunaPluginLike | undefined {
  const runtimeRequire = createRequire(resolve(baseDir, 'package.json'))
  try {
    // portal 安装时本插件的真实路径不在宿主 node_modules 下；必须从 Koishi baseDir 解析兄弟插件。
    const loaded = runtimeRequire('koishi-plugin-chatluna/services/chat') as { ChatLunaPlugin?: ChatLunaPluginLike }
    if (typeof loaded.ChatLunaPlugin?.prototype?.fetch === 'function') return loaded.ChatLunaPlugin
  } catch {
    // ChatLuna 不是本插件的硬依赖；未安装时跳过包装，沙盒其余功能仍可用。
  }
}

export interface InstallModelRequestCollectorOptions {
  plugin?: ChatLunaPluginLike
  baseDir?: string
  /** 全部模型请求都写进同一个记录库；归属与否只是记录上的一个字段。 */
  store: StudioModelRequestStore
  /**
   * 这次请求属于哪一轮对话，以及要不要记下来。
   *
   * 判不出归属时记成未归属；确定由虚拟机器人触发时整条记录都不写。
   */
  resolveTurn: () => ChatLunaTurnResolution
  getActivePresetSnapshots?: (target: ModelRequestPresetSnapshotTarget) => StudioPresetRuntimeSnapshot[]
  onRecordAppended?: (record: StudioModelRequestRecord) => void
}

interface CloneableModelResponse {
  ok?: boolean
  status?: number
  bodyUsed?: boolean
  headers?: { get?: (name: string) => string | null }
  clone?: () => { text?: () => Promise<string>, headers?: { get?: (name: string) => string | null } }
}

interface UndiciRequestLike {
  method?: unknown
  origin?: unknown
  path?: unknown
  headers?: unknown
  contentLength?: unknown
}

interface PendingDispatchedRequest {
  method: string
  url: string
  recordId: string
  store: StudioModelRequestStore
}

const pendingDispatchedRequests: PendingDispatchedRequest[] = []
let undiciRequestCollectorReferences = 0
let undiciRequestCollectorSubscribed = false

function captureDispatchedModelRequest(message: unknown): void {
  const request = message && typeof message === 'object'
    ? Reflect.get(message, 'request') as UndiciRequestLike | undefined
    : undefined
  if (!request) return
  const method = String(request.method ?? 'GET').toUpperCase()
  const rawUrl = `${String(request.origin ?? '')}${String(request.path ?? '')}`
  if (!rawUrl || !isKnownChatModelRequestUrl(rawUrl)) return
  const index = pendingDispatchedRequests.findIndex((pending) => (
    pending.method === method && urlsReferToSameRequest(pending.url, rawUrl)
  ))
  if (index < 0) return
  const pending = pendingDispatchedRequests.splice(index, 1)[0]!
  const rawHeaders = message && typeof message === 'object' ? Reflect.get(message, 'headers') : undefined
  const headers = readDispatchedRequestHeaders(request, rawHeaders)
  if (Object.keys(headers).length) pending.store.update(pending.recordId, { headers })
}

function subscribeUndiciRequestCollector(): () => void {
  undiciRequestCollectorReferences += 1
  const channel = diagnosticsChannel.channel('undici:client:sendHeaders')
  if (!undiciRequestCollectorSubscribed) {
    channel.subscribe(captureDispatchedModelRequest)
    undiciRequestCollectorSubscribed = true
  }
  return () => {
    undiciRequestCollectorReferences -= 1
    if (undiciRequestCollectorReferences > 0 || !undiciRequestCollectorSubscribed) return
    channel.unsubscribe(captureDispatchedModelRequest)
    undiciRequestCollectorSubscribed = false
    pendingDispatchedRequests.splice(0)
  }
}

export function inferModelResponseBodyFormat(contentType: string | undefined, raw: string): 'json' | 'text' | 'sse' {
  if (contentType?.toLowerCase().includes('text/event-stream') || /^(?:event|data|id|retry):/m.test(raw)) return 'sse'
  try {
    JSON.parse(raw)
    return 'json'
  } catch {
    return 'text'
  }
}

export function installModelRequestCollector(options: InstallModelRequestCollectorOptions): () => void {
  const plugin = options.plugin ?? resolveChatLunaPluginClass(options.baseDir)
  if (!plugin) return () => {}
  const original = plugin.prototype.fetch
  if (typeof original !== 'function') return () => {}
  const unsubscribeUndiciRequestCollector = subscribeUndiciRequestCollector()

  const wrapped = async function wrappedModelRequestFetch(
    this: unknown,
    info: unknown,
    init?: { method?: string, body?: unknown, headers?: unknown },
    proxy?: unknown,
  ) {
    const request = readRequest(info, init)
    if (!request.url || !MUTATING_METHODS.has(request.method) || !isKnownChatModelRequestUrl(request.url)) {
      return original.call(this, info, init, proxy)
    }

    const resolution = options.resolveTurn()
    // 虚拟机器人（模拟环境类插件注册的 hidden OneBot 机器人）触发的请求不进记录库：本插件的记录
    // 库只收真实会话的证据。这一步必须早于 store.append——记录一旦写进去，列表、筛选可选值聚合、
    // 轨迹与预设证据定位都会把它当成真实请求，而记录上没有任何字段能事后把它认出来。
    if (resolution.virtualOnly) return original.call(this, info, init, proxy)

    const body = parseJsonBody(request.body)
    const store = options.store
    const turn = resolution.turn
    const startedAt = Date.now()
    const configuredHeaders = readRequestHeaders(info, init)
    const presetSnapshots = turn?.entities.botId && turn.entities.conversationId
      ? options.getActivePresetSnapshots?.({
          botId: turn.entities.botId,
          conversationId: turn.entities.conversationId,
        })
      : undefined
    const pending = store.append({
      status: 'pending',
      durationMs: 0,
      method: request.method,
      url: sanitizeModelRequestUrl(request.url),
      ...(inferProvider(request.url) ? { provider: inferProvider(request.url) } : {}),
      ...(inferModel(body.value, request.url) ? { model: inferModel(body.value, request.url) } : {}),
      ...(Object.keys(configuredHeaders).length ? { headers: configuredHeaders } : {}),
      attribution: turn ? 'attributed' : 'unattributed',
      entities: turn?.entities ?? {},
      ...(turn ? { interactionId: turn.interactionId } : {}),
      requestBodyAvailable: body.available,
      ...(body.available ? { requestBody: body.value } : {}),
      ...(presetSnapshots?.length ? { presetSnapshots } : {}),
      responseBodyStatus: 'pending',
    })
    options.onRecordAppended?.(pending)
    // init.headers 只是调用方配置；Accept、User-Agent、Content-Length 等由 Undici
    // 在派发阶段补齐。先登记请求，让 diagnostics_channel 用最终发送头覆盖该记录。
    pendingDispatchedRequests.push({ method: request.method, url: request.url, recordId: pending.id, store })

    try {
      const response = await original.call(this, info, init, proxy) as CloneableModelResponse
      const durationMs = Date.now() - startedAt
      const responseStatus = typeof response?.status === 'number' ? response.status : undefined
      const capture = prepareModelResponseCapture(response)
      if (response && typeof response === 'object' && response.ok === false) {
        store.update(pending.id, {
          status: 'error',
          durationMs,
          responseBodyStatus: capture ? 'pending' : 'unavailable',
          ...(responseStatus !== undefined ? { responseStatus } : {}),
          error: createModelRequestError(new Error(`HTTP ${response.status ?? 'error'}`)),
        })
      } else {
        store.update(pending.id, {
          status: 'success',
          durationMs,
          responseBodyStatus: capture ? 'pending' : 'unavailable',
          ...(responseStatus !== undefined ? { responseStatus } : {}),
        })
      }
      if (capture) {
        // clone 必须在返回给 requester 前同步完成，并立即消费旁路流；否则 requester
        // 锁定原流后无法再 clone，或未消费的 tee 分支持续缓冲并拖慢模型输出。
        store.trackUpdate(capture.then(({ raw, format }) => {
          store.update(pending.id, {
            durationMs: Date.now() - startedAt,
            responseBodyStatus: 'complete',
            responseBodyFormat: format,
            responseBodyRaw: raw,
          })
        }).catch((error) => {
          store.update(pending.id, {
            durationMs: Date.now() - startedAt,
            responseBodyStatus: 'error',
            responseBodyError: error instanceof Error ? error.message : String(error),
          })
        }))
      }
      return response
    } catch (error) {
      store.update(pending.id, {
        status: 'error',
        durationMs: Date.now() - startedAt,
        responseBodyStatus: 'unavailable',
        error: createModelRequestError(error),
      })
      throw error
    }
  }

  plugin.prototype.fetch = wrapped
  return () => {
    if (plugin.prototype.fetch === wrapped) plugin.prototype.fetch = original
    unsubscribeUndiciRequestCollector()
  }
}

function prepareModelResponseCapture(
  response: CloneableModelResponse | undefined,
): Promise<{ raw: string, format: 'json' | 'text' | 'sse' }> | undefined {
  if (!response || typeof response.clone !== 'function' || response.bodyUsed) return
  try {
    const clone = response.clone()
    if (typeof clone.text !== 'function') return
    const contentType = clone.headers?.get?.('content-type') ?? response.headers?.get?.('content-type') ?? undefined
    // 这里立即调用 text()，而不是把 clone 留到下一个 tick，确保 tee 的旁路分支
    // 与 ChatLuna 原始分支同时被消费，避免流式响应在未读取分支上无限缓冲。
    return clone.text().then((raw) => ({
      raw,
      format: inferModelResponseBodyFormat(contentType ?? undefined, raw),
    }))
  } catch {
    return
  }
}

function readUrlPath(raw: string): string {
  try {
    return new URL(raw).pathname
  } catch {
    return raw.split('?')[0] ?? raw
  }
}

function readRequest(info: unknown, init?: { method?: string, body?: unknown }) {
  const url = typeof info === 'string'
    ? info
    : info instanceof URL
      ? info.toString()
      : info && typeof info === 'object' && typeof Reflect.get(info, 'url') === 'string'
        ? String(Reflect.get(info, 'url'))
        : ''
  const method = String(
    init?.method
    ?? (info && typeof info === 'object' ? Reflect.get(info, 'method') : undefined)
    ?? 'GET',
  ).toUpperCase()
  // 只读取 init.body 或 Request 上已经是字符串的 body，避免消费流式 Request 导致真实请求失败。
  const body = init?.body ?? (
    info && typeof info === 'object' && typeof Reflect.get(info, 'body') === 'string'
      ? Reflect.get(info, 'body')
      : undefined
  )
  return { url, method, body }
}

function readRequestHeaders(info: unknown, init?: { headers?: unknown }): Record<string, string> {
  const source = init?.headers ?? (info && typeof info === 'object' ? Reflect.get(info, 'headers') : undefined)
  if (!source) return {}
  const result: Record<string, string> = {}
  if (typeof Headers !== 'undefined' && source instanceof Headers) {
    source.forEach((value, key) => { result[key] = value })
    return result
  }
  if (Array.isArray(source)) {
    for (const entry of source) {
      if (Array.isArray(entry) && entry.length >= 2) result[String(entry[0])] = String(entry[1])
    }
    return result
  }
  if (typeof source === 'object') {
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) result[key] = Array.isArray(value) ? value.join(', ') : String(value)
    }
  }
  return result
}

function readDispatchedRequestHeaders(request: UndiciRequestLike, rawHeaders?: unknown): Record<string, string> {
  const result = typeof rawHeaders === 'string'
    ? parseRawHttpRequestHeaders(rawHeaders)
    : {}
  if (!Object.keys(result).length && Array.isArray(request.headers)) {
    for (let index = 0; index + 1 < request.headers.length; index += 2) {
      result[String(request.headers[index])] = String(request.headers[index + 1])
    }
  }
  if (typeof request.contentLength === 'number' && request.contentLength >= 0 && !hasHeader(result, 'content-length')) {
    result['Content-Length'] = String(request.contentLength)
  }
  return result
}

function parseRawHttpRequestHeaders(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of raw.split('\r\n').slice(1)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key) result[key] = value
  }
  return result
}

function hasHeader(headers: Record<string, string>, expected: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === expected)
}

function urlsReferToSameRequest(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left)
    const rightUrl = new URL(right)
    return leftUrl.origin === rightUrl.origin
      && leftUrl.pathname === rightUrl.pathname
      && leftUrl.search === rightUrl.search
  } catch {
    return left === right
  }
}

function parseJsonBody(body: unknown): { available: boolean, value?: unknown } {
  if (body == null) return { available: false }
  let text: string | undefined
  if (typeof body === 'string') text = body
  else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) text = body.toString('utf8')
  else if (body instanceof Uint8Array) text = Buffer.from(body).toString('utf8')
  else if (body instanceof ArrayBuffer) text = Buffer.from(body).toString('utf8')
  else return { available: false }
  try {
    return { available: true, value: JSON.parse(text) }
  } catch {
    return { available: false }
  }
}

function inferModel(body: unknown, rawUrl?: string): string | undefined {
  if (body && typeof body === 'object') {
    const directModel = Reflect.get(body, 'model')
    if (typeof directModel === 'string' && directModel) return directModel
    const modelVersion = Reflect.get(body, 'modelVersion')
    if (typeof modelVersion === 'string' && modelVersion) return modelVersion
  }
  if (rawUrl) {
    try {
      // Gemini 请求通常没有 body.model；从 /models/<id>:generateContent
      // 回退提取模型，避免详情页把可识别的模型显示为“未识别”。
      const match = new URL(rawUrl).pathname.match(/\/models\/([^/:]+)(?::|$)/i)
      if (match?.[1]) return decodeURIComponent(match[1])
    } catch {
      // 非标准 URL 无法提取模型名时，保留未识别状态。
    }
  }
}

function inferProvider(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes('openai')) return 'openai'
    if (host.includes('anthropic')) return 'anthropic'
    if (host.includes('googleapis') || host.includes('generativelanguage')) return 'gemini'
    if (host.includes('openrouter')) return 'openrouter'
    return host || undefined
  } catch {
    return undefined
  }
}
