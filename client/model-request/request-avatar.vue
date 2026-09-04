<template>
  <span
    v-if="unattributed"
    class="chatluna-studio-identity-avatar chatluna-studio-model-request-unattributed-avatar"
  >
    <!-- 形状取自 koishi-plugin-chatluna-sandbox 的内置机器人头像（builtin-avatar-options.ts
         的 bot()）：同一枚机头、同一对眼睛、同一条嘴、同一根天线，去掉圆角底板、改描边、
         收成单色，两个插件的未归属头像因此长得一样。
         机头必须是描边而不是实底：实底机头上压一条同色斜线会整片糊在一起，只能靠底色
         垫一道白缝把它切开，那道缝比斜线本身还显眼。
         viewBox 的 min-y 下移 10：去掉底板后天线上方只剩 8.5 的余量、机头下方还剩 28，
         照原坐标渲染机器人会明显偏上，和相邻两行文案对不齐。
         斜线两端只比机头轮廓多出一点，和虚线环留出 5px 以上空隙，不贴环也不拖出长尾。 -->
    <svg viewBox="0 -10 128 128" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M64 32V16M55 12h18" />
        <rect x="24" y="32" width="80" height="68" rx="22" />
        <path d="M45 82h38" />
        <path d="M26 16L110 100" />
      </g>
      <g fill="currentColor">
        <circle cx="49" cy="62" r="8" />
        <circle cx="79" cy="62" r="8" />
      </g>
    </svg>
  </span>
  <StudioAvatar v-else kind="bot" :name="name" :avatar="avatar" />
</template>

<script setup lang="ts">
import StudioAvatar from '#client/shared/avatar.vue'

/**
 * 一条模型请求的身份头像。
 *
 * 未归属请求没有机器人可显示：共享身份头像只会把名称首字母画进同一枚灰底圆形，
 * 「未」和任意真实机器人的首字母长得完全一样，列表里认不出这条记录根本没有归属。
 * 因此未归属走专属头像——虚线圆里放一枚机器人形状，但没有头像图、只有单色描边，
 * 再划一道斜线，「有头像的是真机器人，无图无色又被划掉的是找不到的那一个」这一读法
 * 由此成立。
 *
 * 图标是装饰：归属名称就在同一行的标题里，头像再报一次会让读屏念两遍。
 */
defineProps<{
  /** 记录的归属判定结果，不是「有没有 botId」：归属口径归采集器所有，视图不再自己推一遍。 */
  unattributed: boolean
  name: string
  avatar?: string
}>()
</script>
