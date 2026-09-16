<!--
  `KEY: VALUE` headers textarea. Values may reference `$ENV` variables or `!cmd`
  substitutions, which pi resolves at request time — so the text is passed
  through untouched. `readHeadersField()` turns the text back into a record.
-->
<script setup lang="ts">
import { t } from "@/lib/i18n.ts";

defineProps<{ placeholder?: string }>();
const text = defineModel<string>({ required: true });
</script>

<template>
  <label class="field-label">{{
    t("Headers (KEY: VALUE, one per line; values support $ENV / !cmd)")
  }}</label>
  <textarea
    v-model="text"
    class="ta"
    style="height: 70px"
    spellcheck="false"
    :placeholder="placeholder ?? 'X-Custom-Header: value\nAuthorization: Bearer $TOKEN'"
  ></textarea>
</template>
