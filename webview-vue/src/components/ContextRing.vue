<!--
  The context-usage ring. `pathLength="100"` lets the stroke dash be expressed
  directly in percent instead of in path units.
-->
<script setup lang="ts">
import { computed } from "vue";
import { formatTokens } from "@/lib/format.ts";
import { t } from "@/lib/i18n.ts";
import { useSessionStore } from "@/stores/session";

const session = useSessionStore();

const percent = computed(() => session.contextPercent);
const dash = computed(() => `${percent.value} ${100 - percent.value}`);

const tooltip = computed(() => {
  const usage = session.contextUsage;
  if (!usage) return t("Context usage unavailable");
  const used = usage.tokens != null ? formatTokens(usage.tokens) : "?";
  const total = formatTokens(usage.contextWindow);
  return `${t("Context")}: ${used} / ${total}`;
});
</script>

<template>
  <div id="ctx-ring" :title="tooltip">
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle class="ctx-track" cx="18" cy="18" r="15.9155" fill="none" />
      <circle
        class="ctx-value"
        cx="18"
        cy="18"
        r="15.9155"
        fill="none"
        pathLength="100"
        :stroke-dasharray="dash"
      />
    </svg>
  </div>
</template>
