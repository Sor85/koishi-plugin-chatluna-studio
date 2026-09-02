/** 见 scope-preflight.mjs：把 Tailwind preflight 限制在本插件渲染根内。 */
export declare function scopePreflight(css: string, roots?: string[]): {
  css: string
  /** 改写了作用域的规则条数。 */
  scopedRules: number
  /** 无法限定作用域而整条丢弃的规则条数（html/:host 与 ::backdrop）。 */
  droppedRules: number
}
