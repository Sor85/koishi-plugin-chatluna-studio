import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * 客户端全部样式源码的观察面。
 *
 * 区域样式表按能力归属散进了 `client/<能力>/`（ADR-0090），因此「全仓样式表」不再等于
 * 「`client/styles/` 下的文件」。凡是按目录扫样式的守卫都必须走这里：留在原地读
 * `client/styles/` 的扫描不会报错，只会静默缩小到剩下的几张跨能力表，而那正是它要拦的东西
 * 搬走之后的形态。
 *
 * `tailwind.generated.css` 是构建产物而不是源码，一律排除。
 */
export function listClientStylesheets(directory = 'client'): string[] {
  return readdirSync(resolve(directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listClientStylesheets(path)
    if (!entry.name.endsWith('.css') || entry.name.endsWith('.generated.css')) return []
    return [path]
  }).sort()
}

/** 同上，直接返回内容；顺序按路径排序，与 `listClientStylesheets()` 一致。 */
export function readClientStylesheets(): string[] {
  return listClientStylesheets().map((path) => readFileSync(resolve(path), 'utf8'))
}
