<!--
  The user/project scope picker shared by agents, prompts, skills and MCP
  servers. The project option only exists inside a workspace, which is why the
  host reports `hasWorkspace` on every one of those tabs.
-->
<script setup lang="ts">
import { t } from "@/lib/i18n.ts";

defineProps<{
  /** Omit to suppress the `.field-label` above the select. */
  label?: string;
  hasWorkspace: boolean;
  userLabel?: string;
  projectLabel?: string;
}>();

const scope = defineModel<string>({ required: true });
</script>

<template>
  <label v-if="label" class="field-label">{{ label }}</label>
  <select v-model="scope">
    <option value="user">{{ userLabel ?? t("user") }}</option>
    <option v-if="hasWorkspace" value="project">{{ projectLabel ?? t("project") }}</option>
  </select>
</template>
