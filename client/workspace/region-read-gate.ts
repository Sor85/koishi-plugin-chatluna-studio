import { ref, type Ref } from 'vue'
import type { ErrorSlot } from './error-slot'

/**
 * 区域读取闸门：一个共享错误位 ＋ 若干命名进行中通道。
 *
 * 它只守一条不变量——**无论成败都要复位进行中**。漏掉复位不会报错，界面只会一直转圈，
 * 因此这条规则必须由模块持有。错误位那条不变量（每次调用前先清掉上一次的错误）由
 * {@link ErrorSlot} 持有，闸门把它接过来共用，两个模块各守一条，不合成一个。
 *
 * 通道是命名的而不是数出来的：调试记录、测试调用、模型请求各声明列表与详情两条通道，预设只有
 * 一条读取通道（读目录与读单个预设共用它）。四个区域的形状差异因此写在声明上，而不是表现为
 * 「少了一个引用」。两条通道必须各自独立且共用一个错误位——读某条详情时列表不该跟着转圈。
 *
 * 「读取」是这一族的名字而不是它的边界：清理记录与保存预设是同一个形状——置进行中、清错误、调用、
 * 失败写文案、无论成败都复位——因此它们也走这里，各自占一条通道（清理与列表共用，保存独占）。
 *
 * 不用一个进行中计数器代替若干布尔：计数器在并发读取时的表现与今天不同。
 */
export interface RegionReadGate<Channel extends string> {
  /** 本区域共享的错误位，区域内所有通道共用它。 */
  readonly error: Ref<string>
  /** 按通道名索引的进行中标志。 */
  readonly loading: Readonly<Record<Channel, Ref<boolean>>>
  /** 吞掉失败，把结果交出；失败时交出 `undefined`。 */
  read<T>(channel: Channel, fallback: string, operation: () => Promise<T>): Promise<T | undefined>
  /** 写下文案后把原始失败原样抛给调用方。 */
  readOrThrow<T>(channel: Channel, fallback: string, operation: () => Promise<T>): Promise<T>
}

export function createRegionReadGate<Channel extends string>(
  errorSlot: ErrorSlot,
  channels: readonly Channel[],
): RegionReadGate<Channel> {
  const loading = Object.fromEntries(channels.map((channel) => [channel, ref(false)])) as Record<Channel, Ref<boolean>>

  // 置位与清错误都发生在第一个 await 之前，因此界面在一次读取开始的那一帧就同时看到
  // 「正在转圈」与「没有错误」；复位写在 finally 里，成败两条路径都经过它。
  async function withChannel<T>(channel: Channel, run: () => Promise<T>) {
    const flag = loading[channel]
    flag.value = true
    try {
      return await run()
    } finally {
      flag.value = false
    }
  }

  return {
    error: errorSlot.error,
    loading,
    read: (channel, fallback, operation) => withChannel(channel, () => errorSlot.run(fallback, operation)),
    readOrThrow: (channel, fallback, operation) => withChannel(channel, () => errorSlot.runOrThrow(fallback, operation)),
  }
}
