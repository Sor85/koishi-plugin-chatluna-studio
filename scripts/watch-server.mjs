import { spawn } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = resolve(root, 'src')
const clientRoot = resolve(root, 'client')
const tsup = resolve(root, 'node_modules/tsup/dist/cli-default.js')
// Tailwind 必须经 build-css.mjs 调用：CLI 原始产物的 preflight 没有作用域，会重置整个
// 控制台和同页其他插件的 UI。直接在这里调 @tailwindcss/cli 会让开发环境重新开始污染宿主。
const buildCss = resolve(root, 'scripts/build-css.mjs')
// build:css 的输出文件被 gitignore 且由本 watcher 生成，必须排除在监听之外，否则每次重建都会自触发。
const generatedCss = resolve(root, 'client/styles/tailwind.generated.css')

let shuttingDown = false

async function collectSourceTimes(directory, extensions, entries = new Map()) {
  for (const name of await readdir(directory)) {
    const path = join(directory, name)
    const info = await stat(path)
    if (info.isDirectory()) await collectSourceTimes(path, extensions, entries)
    else if (extensions.includes(extname(name)) && path !== generatedCss) entries.set(path, info.mtimeMs)
  }
  return entries
}

function createBuilder(label, args) {
  let building = false
  let rebuildPending = false
  let activeBuild
  const run = () => {
    if (building) {
      rebuildPending = true
      return
    }
    building = true
    activeBuild = spawn(process.execPath, [...args], {
      cwd: root,
      stdio: 'inherit',
    })
    activeBuild.once('exit', (code, signal) => {
      activeBuild = undefined
      building = false
      if (shuttingDown) return
      if (code !== 0) {
        console.error(`${label}失败（${signal ? `信号 ${signal}` : `退出码 ${code ?? 1}`}），继续等待下一次源码修改。`)
      }
      if (rebuildPending) {
        rebuildPending = false
        run()
      }
    })
  }
  return { run, kill: () => activeBuild?.kill('SIGTERM') }
}

const serverBuilder = createBuilder('服务端构建', [tsup, 'src/index.ts', '--format', 'cjs', '--out-dir', 'lib', '--clean', 'false'])
// tailwind.generated.css 不进 git：git 撤回、clean 或新 clone 后若无人重建，
// Console devMode 直接加载 client/ 源码时会缺失全部 Tailwind 工具类（样式整体退化，
// 且宿主 vite 没有 Tailwind 插件无法现场生成，详见 docs/adr/0053）。
// 由本 watcher 在启动时兜底重建，并跟随 client 源码变化持续重建。
const cssBuilder = createBuilder('Tailwind 预编译', [buildCss])

let serverSnapshot = new Map()
let clientSnapshot = new Map()

function changed(previous, next) {
  return next.size !== previous.size
    || [...next].some(([path, mtime]) => previous.get(path) !== mtime)
}

async function poll() {
  const nextServer = await collectSourceTimes(sourceRoot, ['.ts', '.json'])
  if (changed(serverSnapshot, nextServer)) serverBuilder.run()
  serverSnapshot = nextServer

  const nextClient = await collectSourceTimes(clientRoot, ['.ts', '.vue', '.css'])
  if (changed(clientSnapshot, nextClient)) cssBuilder.run()
  clientSnapshot = nextClient
}

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(pollTimer)
  serverBuilder.kill()
  cssBuilder.kill()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

console.log(`正在监听服务端源码：${sourceRoot}`)
console.log(`正在监听客户端源码（Tailwind 预编译）：${clientRoot}`)
serverSnapshot = await collectSourceTimes(sourceRoot, ['.ts', '.json'])
clientSnapshot = await collectSourceTimes(clientRoot, ['.ts', '.vue', '.css'])
serverBuilder.run()
cssBuilder.run()
// macOS 的递归 fs.watch 在 launchd 环境中可能漏掉原位写入；轮询 mtime 可覆盖编辑器保存、Git 切换和脚本修改。
const pollTimer = setInterval(() => void poll().catch((error) => console.error('扫描源码失败：', error)), 250)
