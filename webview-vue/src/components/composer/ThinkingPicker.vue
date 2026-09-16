<!--
  Thinking-effort row. It is the last row of the model popup and expands the
  level list in place (`.thinking-wrap.is-open`), which is what keeps the control
  bar down to `+ / model / permission / ring / send`.
-->
<script setup lang="ts">
import { computed } from "vue";
import { post } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";
import { useComposerStore } from "@/stores/composer.ts";
import { useSessionStore } from "@/stores/session.ts";

const composer = useComposerStore();
const session = useSessionStore();

const DESCRIPTIONS: Record<string, string> = {
  off: "No reasoning, replies directly",
  minimal: "Minimal reasoning",
  low: "Light reasoning",
  medium: "Balanced reasoning and speed",
  high: "Deep reasoning",
  xhigh: "Extra deep reasoning",
  max: "Maximum reasoning budget",
};

/** Used until the host reports the levels the current model supports. */
const FALLBACK_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const levels = computed<string[]>(() =>
  session.thinkingLevels.length > 0 ? session.thinkingLevels : FALLBACK_LEVELS,
);

const current = computed(() => {
  const available = levels.value;
  const level = session.thinkingLevel;
  if (level && available.includes(level)) return level;
  return available[0] ?? "off";
});

const open = computed(() => composer.modelSubview === "thinking");

function description(level: string): string {
  return t(DESCRIPTIONS[level] ?? level);
}

function toggle(): void {
  composer.modelSubview = open.value ? "list" : "thinking";
}

function choose(level: string): void {
  composer.modelSubview = "list";
  post({ type: "setThinking", level });
}
</script>

<template>
  <div id="thinking-wrap" class="select-wrap thinking-wrap" :class="{ 'is-open': open }">
    <button
      id="thinking-trigger"
      class="thinking-trigger"
      type="button"
      :aria-expanded="open ? 'true' : 'false'"
      :title="`${t('Thinking effort')}: ${current}`"
      @click="toggle"
    >
      <span class="codicon codicon-sparkle thinking-icon"></span>
      <span id="thinking-row-label" class="thinking-row-label">{{ t("Thinking effort") }}</span>
      <span id="thinking-trigger-label" class="thinking-trigger-label">{{ current }}</span>
      <!-- The gear at the far right is the expand affordance; the whole row toggles. -->
      <span class="codicon codicon-settings-gear thinking-row-gear" aria-hidden="true"></span>
    </button>
    <div id="thinking-panel" class="thinking-panel">
      <div id="thinking-list" class="thinking-list">
        <button
          v-for="level in levels"
          :key="level"
          class="thinking-item"
          :class="{ selected: level === current }"
          type="button"
          @click="choose(level)"
        >
          <span class="thinking-item-text">
            <span class="thinking-item-title">{{ level }}</span>
            <span class="thinking-item-desc">{{ description(level) }}</span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
