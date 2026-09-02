<script setup lang="ts">
import type { DialogTitleProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { DialogTitle } from 'reka-ui'
import { cn } from '#client/lib/utils'

const props = defineProps<DialogTitleProps & { class?: HTMLAttributes['class'] }>()
const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <DialogTitle data-slot="dialog-title" class="studio-dialog-title" v-bind="delegatedProps" :class="cn('text-base font-semibold', props.class)">
    <slot />
  </DialogTitle>
</template>

<style scoped>
.studio-dialog-title {
  margin: 0;
}
</style>
