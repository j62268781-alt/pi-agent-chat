<!--
  Password field with a reveal toggle (legacy `data-action="toggle-secret"`):
  the input swaps between `password` and `text` and the eye glyph follows. The
  `.input-action` wrapper positions the button inside the field.
-->
<script setup lang="ts">
import { ref } from "vue";
import { t } from "@/lib/i18n.ts";

defineProps<{ placeholder?: string }>();
const value = defineModel<string>({ required: true });

const reveal = ref(false);
</script>

<template>
  <span class="input-action">
    <input v-model="value" :type="reveal ? 'text' : 'password'" :placeholder="placeholder" />
    <button
      class="btn-icon"
      type="button"
      :title="reveal ? t('Hide') : t('Show')"
      @click="reveal = !reveal"
    >
      <span class="codicon" :class="reveal ? 'codicon-eye-closed' : 'codicon-eye'"></span>
    </button>
  </span>
</template>
