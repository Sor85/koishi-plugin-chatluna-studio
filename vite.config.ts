import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  // Tailwind 不走 vite 插件：工具类由 build:css 预编译成
  // client/styles/tailwind.generated.css（详见该目录 tailwind.source.css 的说明），
  // 这里只把它当普通 CSS 打包，保证控制台 devMode 与产物构建观感一致。
  plugins: [vue()],
  // 这里不声明客户端路径别名。控制台 devMode 用宿主自己的 vite 直接加载 client/ 源码
  // （同 ADR 0053），本文件根本不会被读取，写在这里的 resolve.alias 只在产物构建生效，
  // devMode 下同一份源码会解析失败。客户端跨目录导入统一走 package.json 的 imports
  // 字段声明的 #client/*：那是包自带的声明，宿主 vite、产物构建、vitest 与 vue-tsc 都认。
  // lib 模式下 Vite 会保留 process.env.NODE_ENV 交给下游打包器替换，
  // 但本产物直接由控制台浏览器加载（无下游构建），reka-ui 等依赖中的
  // process 引用会抛 ReferenceError（表现为 Dialog 弹窗渲染失败），必须显式替换。
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: 'client/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['vue', '@koishijs/client'],
      output: {
        assetFileNames: 'style.css',
      },
    },
    cssCodeSplit: false,
  },
})
