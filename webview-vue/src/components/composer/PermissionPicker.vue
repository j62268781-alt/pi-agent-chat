<!--
  Permission-gate list: smart approval vs. full access. The trigger pill and the
  popup shell live in `Composer.vue` (only one popup is open at a time there);
  this component renders the list inside it.
-->
<script setup lang="ts">
import type { PermissionMode } from "@protocol/messages";
import { post } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";
import { useComposerStore } from "@/stores/composer.ts";
import { useSessionStore } from "@/stores/session.ts";

interface ModeSpec {
  value: PermissionMode;
  title: string;
  description: string;
  icon: string;
}

const MODES: ModeSpec[] = [
  {
    value: "AskForApproval",
    title: "Smart approval",
    description: "Only high-risk operations require approval",
    icon: "codicon-shield",
  },
  {
    value: "FullAccess",
    title: "Full access",
    description: "Run commands and edit files without asking",
    icon: "codicon-unlock",
  },
];

const composer = useComposerStore();
const session = useSessionStore();

function choose(mode: PermissionMode): void {
  composer.closePopups();
  post({ type: "setPermission", mode });
}
</script>

<template>
  <div id="permission-list" class="permission-list">
    <button
      v-for="mode in MODES"
      :key="mode.value"
      class="permission-item"
      :class="{ selected: mode.value === session.permissionMode }"
      type="button"
      @click="choose(mode.value)"
    >
      <span class="permission-item-icon">
        <span class="codicon" :class="mode.icon"></span>
      </span>
      <span class="permission-item-text">
        <span class="permission-item-title">{{ t(mode.title) }}</span>
        <span class="permission-item-desc">{{ t(mode.description) }}</span>
      </span>
      <span class="permission-item-check">
        <span class="codicon codicon-check"></span>
      </span>
    </button>
  </div>
</template>
