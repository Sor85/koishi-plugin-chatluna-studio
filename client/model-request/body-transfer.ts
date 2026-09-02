import { ref } from 'vue'
import type { ModelRequestBodyTab } from './detail-view'
import type { StudioModelRequestDetail } from '../../src/types'

/**
 * 请求体与响应体的取文、复制与下载。
 *
 * 复制有两条路径：安全上下文下用异步剪贴板，局域网 HTTP 下 Clipboard API 被禁用，
 * 必须降级到同步复制。两条路径的选择原先只能靠人在 HTTP 页面上手点验证——一旦有人
 * 把 try/catch 收成一层，降级路径会静默消失，而在 HTTPS 开发机上永远看不出来。
 * 这里把「什么时候降级、降级失败算不算失败」变成可执行的判定；textarea 那套 DOM
 * 机械动作仍留在视图里，由 fallbackWrite 注入。
 */
export type ModelRequestCopyState = 'idle' | 'success' | 'error'

export const MODEL_REQUEST_COPY_RESET_DELAY_MS = 1600

export type ModelRequestBodySource = Pick<
  StudioModelRequestDetail,
  'id' | 'requestBodyAvailable' | 'requestBody' | 'responseBodyStatus' | 'responseBodyRaw' | 'responseBodyFormat'
>

export interface ModelRequestBodyDownload {
  fileName: string
  mimeType: string
  text: string
}

export interface ModelRequestBodyCopyOptions {
  /** 安全上下文下的异步剪贴板；返回 undefined 表示浏览器没有提供。 */
  clipboardWriter: () => ((text: string) => Promise<void>) | undefined
  /** 同步降级复制；抛错表示浏览器拒绝了这次复制。 */
  fallbackWrite: (text: string) => void
  setTimer?: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void
  resetDelayMs?: number
}

/** 当前页签对应的正文。取不到就是空串，由调用方据此禁用复制与下载。 */
export function resolveModelRequestBodyText(
  detail: ModelRequestBodySource | undefined,
  bodyView: ModelRequestBodyTab,
): string {
  if (!detail) return ''
  if (bodyView === 'request') {
    if (!detail.requestBodyAvailable || detail.requestBody === undefined) return ''
    return serializeModelRequestBody(detail.requestBody)
  }
  if (bodyView !== 'response') return ''
  return detail.responseBodyStatus === 'complete' ? detail.responseBodyRaw ?? '' : ''
}

export function serializeModelRequestBody(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? String(value)
}

/**
 * 下载描述：文件名要能在文件管理器里认出是哪条记录的哪一半，扩展名要跟真实格式一致。
 * 记录 id 直接进文件名会带上冒号和斜杠，在 Windows 上根本存不下来，因此先收敛字符集。
 */
export function buildModelRequestBodyDownload(
  detail: ModelRequestBodySource | undefined,
  bodyView: ModelRequestBodyTab,
): ModelRequestBodyDownload | undefined {
  const text = resolveModelRequestBodyText(detail, bodyView)
  if (!detail || !text) return undefined
  const isRequest = bodyView === 'request'
  const isJson = isRequest || detail.responseBodyFormat === 'json'
  const safeId = detail.id.replace(/[^a-zA-Z0-9_-]+/g, '-')
  return {
    fileName: `model-request-${safeId}-${isRequest ? 'request' : 'response'}.${isJson ? 'json' : 'txt'}`,
    mimeType: isJson ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8',
    text,
  }
}

export function createModelRequestBodyCopy(options: ModelRequestBodyCopyOptions) {
  const state = ref<ModelRequestCopyState>('idle')
  const resetDelayMs = options.resetDelayMs ?? MODEL_REQUEST_COPY_RESET_DELAY_MS
  const setTimer = options.setTimer ?? ((handler, timeout) => globalThis.setTimeout(handler, timeout))
  const clearTimer = options.clearTimer ?? ((id) => globalThis.clearTimeout(id))
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy(text: string): Promise<void> {
    if (!text) return
    const writer = options.clipboardWriter()
    if (writer) {
      try {
        await writer(text)
        settle('success')
        return
      } catch {
        // 局域网 HTTP 不属于安全上下文，Clipboard API 会被禁用；这不算失败，继续降级。
      }
    }
    try {
      options.fallbackWrite(text)
      settle('success')
    } catch {
      settle('error')
    }
  }

  /** 结果只提示一小会儿：切页签、换记录或超时都要回到无状态，避免旧结果贴在新正文上。 */
  function settle(next: Exclude<ModelRequestCopyState, 'idle'>) {
    if (timer !== undefined) clearTimer(timer)
    state.value = next
    timer = setTimer(() => {
      state.value = 'idle'
      timer = undefined
    }, resetDelayMs)
  }

  function reset() {
    if (timer !== undefined) clearTimer(timer)
    timer = undefined
    state.value = 'idle'
  }

  return { state, copy, reset }
}
