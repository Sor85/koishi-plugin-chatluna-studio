import { ref, type Ref } from 'vue'

/**
 * 错误位：包住一次可能失败的调用，把失败写成一句话。
 *
 * 它只守一条不变量——**每次调用前先清掉上一次的错误**。漏掉这一步不会报错，用户会对着一条
 * 早已不成立的报错发愁，因此这条规则必须由模块持有而不是靠调用点各自记得写。
 *
 * 兜底文案作为参数留在调用点：文案基本互不相同且都是用户可见的，收进模块查表会让改一句话
 * 要跳到另一个文件，而表与调用点之间没有任何东西保证同步。
 *
 * 模块**不做**前置判定。取当前会话标识、问脏值守卫这类判断各不相同且依赖调用方自己的状态，
 * 留在调用方；闸门要做的事只有「包住一次调用」这一件。
 */
export interface ErrorSlot {
  /** 当前错误文案；空串表示没有错误。允许外部直接写入（例如把别处算出的一句话报到这里）。 */
  readonly error: Ref<string>
  /** 吞掉失败，把结果交出；失败时交出 `undefined`。 */
  run<T>(fallback: string, operation: () => Promise<T>): Promise<T | undefined>
  /** 写下文案后把原始失败原样抛给调用方，供它 reject 自己的调用者。 */
  runOrThrow<T>(fallback: string, operation: () => Promise<T>): Promise<T>
}

/**
 * 取错误消息，取不到就用调用点传入的那句兜底。全客户端唯一的一处。
 *
 * 不给空消息的 Error 补上兜底：那会改变今天的可观察行为——空消息的 Error 今天写进错误位的是
 * 空串，也就是不展示任何错误。这一轮只统一写法，不夹带行为变化。
 */
function messageOf(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback
}

export function createErrorSlot(): ErrorSlot {
  const error = ref('')

  async function run<T>(fallback: string, operation: () => Promise<T>) {
    error.value = ''
    try {
      return await operation()
    } catch (cause) {
      error.value = messageOf(cause, fallback)
      return undefined
    }
  }

  async function runOrThrow<T>(fallback: string, operation: () => Promise<T>) {
    error.value = ''
    try {
      return await operation()
    } catch (cause) {
      error.value = messageOf(cause, fallback)
      throw cause
    }
  }

  return { error, run, runOrThrow }
}
