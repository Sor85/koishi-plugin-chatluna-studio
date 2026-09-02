import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Koishi 的 ESM 元包会加载 CLI Loader；测试只需要插件运行时核心。
    alias: {
      koishi: '@koishijs/core',
    },
  },
})
