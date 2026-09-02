import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { scopePreflight } from './scope-preflight.mjs'

/* Tailwind 预编译的唯一入口：build:css 与 scripts/watch-server.mjs 都必须走这里。
   CLI 产物不能直接使用——它的 @layer base（preflight）是无作用域的类型选择器，会重置
   整个 Koishi 控制台和同页其他插件的 UI（详见 docs/adr/0068）。两条链路里漏掉任何一条
   后处理，开发环境或发布产物就会重新开始污染宿主。 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tailwindCli = resolve(root, 'node_modules/@tailwindcss/cli/dist/index.mjs')
const input = 'client/styles/tailwind.source.css'
const output = resolve(root, 'client/styles/tailwind.generated.css')

function runTailwind() {
  return new Promise((fulfil, reject) => {
    const child = spawn(process.execPath, [tailwindCli, '-i', input, '-o', 'client/styles/tailwind.generated.css'], {
      cwd: root,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) fulfil()
      else reject(new Error(`Tailwind CLI 失败（${signal ? `信号 ${signal}` : `退出码 ${code ?? 1}`}）`))
    })
  })
}

await runTailwind()

const generated = await readFile(output, 'utf8')
const { css, scopedRules, droppedRules } = scopePreflight(generated)
await writeFile(output, css)
console.log(`已限定 Tailwind preflight 作用域：改写 ${scopedRules} 条规则，丢弃 ${droppedRules} 条无法限定作用域的规则。`)
