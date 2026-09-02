/** 一次假端口调用的记录。 */
export interface FakePortCall<Operation extends string> {
  operation: Operation
  input: unknown
}

/**
 * 七个假端口共用的调用记录与失败注入。集中一份的理由不是省行数，而是失败消费必须
 * 只有一套语义：注入的失败按操作排队、每次调用消费一条，任何一处手抄都可能与其余几处分叉。
 */
export class FakePortRecorder<Operation extends string> {
  readonly calls: FakePortCall<Operation>[] = []
  private readonly failures = new Map<Operation, unknown[]>()

  /** 让该操作的下一次调用失败；同一操作可排队多条，按注入顺序消费。 */
  rejectNext(operation: Operation, error: unknown) {
    this.failures.set(operation, [...this.failures.get(operation) ?? [], error])
  }

  /** 结果与调用无关时用这个。 */
  invoke<T>(operation: Operation, input: unknown, result: T): Promise<T> {
    return this.invokeDeferred(operation, input, () => result)
  }

  /** 结果依赖本次调用造成的状态变更时用这个，`produce` 只在不失败时执行。 */
  invokeDeferred<T>(operation: Operation, input: unknown, produce: () => T | Promise<T>): Promise<T> {
    this.calls.push({ operation, input })
    const [failure, ...remaining] = this.failures.get(operation) ?? []
    if (remaining.length) this.failures.set(operation, remaining)
    else this.failures.delete(operation)
    if (failure) return Promise.reject(failure)
    try {
      return Promise.resolve(produce())
    } catch (error) {
      return Promise.reject(error)
    }
  }
}
