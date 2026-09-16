<!--
  Settings webview page.

  NOTE: baseline scaffold. The eight tabs (models, agents, prompts, skills, mcp,
  commit, sysprompt, settings) are ported from the legacy vanilla implementation
  next; this page currently proves the host <-> webview protocol round trip.
-->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { onHostMessage, post } from "@/lib/bridge";
import { t } from "@/lib/i18n";
import "@/styles/settings.css";

interface TabDescriptor {
  id: string;
  label: string;
}

const tabs = ref<TabDescriptor[]>([]);
const active = ref("");
const ready = ref(false);

let dispose: (() => void) | undefined;

onMounted(() => {
  dispose = onHostMessage((message) => {
    // The settings host uses a bespoke message shape; see
    // `src/providers/settings/settings-panel.ts` for the producer side.
    const data = message as { type: string; tabs?: TabDescriptor[]; initialTab?: string };
    if (data.type === "init") {
      tabs.value = data.tabs ?? [];
      active.value = data.initialTab ?? tabs.value[0]?.id ?? "";
      ready.value = true;
    }
  });
  post({ type: "webviewReady" });
});

onUnmounted(() => dispose?.());
</script>

<template>
  <div class="app">
    <nav class="nav">
      <div class="nav-head">
        <span class="nav-title">Pi Settings</span>
      </div>
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="nav-tab"
        :class="{ active: tab.id === active }"
        type="button"
        @click="active = tab.id"
      >
        <span class="nav-label">{{ tab.label }}</span>
      </button>
    </nav>
    <main class="content">
      <div v-if="!ready" class="tab-placeholder">{{ t("Loading…") }}</div>
    </main>
  </div>
</template>
