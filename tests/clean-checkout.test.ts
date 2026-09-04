import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 干净检出必须能查类型、能构建。
 *
 * 这条守的是一种只在别人机器上出现的失效形态：`.gitignore` 把构建产物写成不带斜杠的 `lib`
 * 与 `dist` 时，Git 会拿它匹配任意层级的同名目录，于是 `client/lib/utils.ts`（shadcn-vue 的
 * `cn` helper，十七个 UI 组件都在用）被整个吞掉、从未进入版本库。本地工作区里那个文件一直
 * 在，测试、类型检查、构建全绿；CI 和任何新克隆都少了它，vue-tsc 崩在 package.json imports
 * 映射的解析上（`TS2210`，报的是工程根歧义，而不是缺文件）。发布流水线是第一个撞上的地方。
 *
 * 因此这里不看工作区里有没有文件，只问 Git：`#client/*` 指到的每个模块都必须是被跟踪的。
 */

const REPOSITORY_ROOT = resolve(__dirname, '..')
const SCAN_ROOTS = ['client', 'src', 'tests']
const SOURCE_EXTENSIONS = ['.ts', '.vue']

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listSourceFiles(path)
    return SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension)) ? [path] : []
  })
}

function collectClientSpecifiers(): string[] {
  const specifiers = new Set<string>()
  for (const root of SCAN_ROOTS) {
    for (const file of listSourceFiles(resolve(REPOSITORY_ROOT, root))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/['"](#client\/[^'"]+)['"]/g)) {
        specifiers.add(match[1])
      }
    }
  }
  return [...specifiers].sort()
}

/** `#client/*` 在 package.json 的 imports 映射里指向 `./client/*`，可省略扩展名或落在目录索引上。 */
function candidatePaths(specifier: string): string[] {
  const target = `client/${specifier.slice('#client/'.length)}`
  return [target, ...SOURCE_EXTENSIONS.flatMap((extension) => [`${target}${extension}`, `${target}/index${extension}`])]
}

function trackedFiles(): Set<string> {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' })
  return new Set(output.split('\0').filter(Boolean))
}

describe('干净检出', () => {
  it('扫到了全部 #client 导入', () => {
    const specifiers = collectClientSpecifiers()
    expect(specifiers.length).toBeGreaterThan(20)
    expect(specifiers).toContain('#client/lib/utils')
  })

  it('#client 指向的每个模块都已提交，不被忽略规则吞掉', () => {
    const tracked = trackedFiles()
    const missing = collectClientSpecifiers()
      .filter((specifier) => !candidatePaths(specifier).some((path) => tracked.has(path)))
    expect(missing).toEqual([])
  })

  it('构建产物的忽略规则锚定在仓库根，不匹配嵌套的同名目录', () => {
    const patterns = readFileSync(resolve(REPOSITORY_ROOT, '.gitignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))

    // 不带斜杠的 lib/dist/data 会连 client/lib 这类源码目录一起忽略。
    expect(patterns).not.toContain('lib')
    expect(patterns).not.toContain('dist')
    expect(patterns).not.toContain('data')
    expect(patterns).toContain('/lib')
    expect(patterns).toContain('/dist')
  })
})
