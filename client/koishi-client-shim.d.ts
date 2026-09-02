declare module '@koishijs/client' {
  import type { Component } from 'vue'
  import type {
    StudioConsoleBroadcasts,
    StudioConsoleEvents,
  } from '../src/console-contract'

  export interface Context {
    page(options: {
      name: string
      path: string
      icon: string
      order?: number
      authority?: number
      component: Component
    }): unknown
  }

  export const icons: {
    register(name: string, component: Component): void
  }

  /**
   * 一条泛型签名替掉逐端点的重载：端点名、入参与出参都从 Console 契约取，
   * 因此加端点不必再改这份补丁，端点名拼错也在编译期就报错。
   * 服务端可以同步返回，客户端拿到的一律是 Promise。
   */
  export function send<Event extends keyof StudioConsoleEvents>(
    event: Event,
    ...args: Parameters<StudioConsoleEvents[Event]>
  ): Promise<Awaited<ReturnType<StudioConsoleEvents[Event]>>>

  /** 广播频道同样按频道名取载荷：订阅一个不存在的频道不能通过编译。 */
  export function receive<Channel extends keyof StudioConsoleBroadcasts>(
    event: Channel,
    listener: (payload: StudioConsoleBroadcasts[Channel]) => void,
  ): void

  export function useColorMode(): import('vue').ComputedRef<'light' | 'dark'>
}
