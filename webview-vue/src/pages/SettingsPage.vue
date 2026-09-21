<!--
  Settings webview page: the sidebar shell plus the nine tabs.

  `nav` mirrors the legacy `index.html` — a title with its reload control beside
  it, then the tabs grouped under a quiet `.nav-group` heading per section. The
  grouping is read off `store.tabs`, so that list stays the one source of both
  the order and the sections.

  Boot order: `connect()` posts `ready`, the host answers `init`, and `init`
  triggers the first `tabLoad`. Until that first dataset lands the placeholder
  stays up; afterwards a tab renders from cache while its refresh is in flight,
  so switching back to a visited tab never flashes an empty page.
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import AgentsTab from "@/components/settings/AgentsTab.vue";
import CommitTab from "@/components/settings/CommitTab.vue";
import GeneralTab from "@/components/settings/GeneralTab.vue";
import McpTab from "@/components/settings/McpTab.vue";
import ModelsTab from "@/components/settings/ModelsTab.vue";
import PromptsTab from "@/components/settings/PromptsTab.vue";
import SkillsTab from "@/components/settings/SkillsTab.vue";
import SysPromptTab from "@/components/settings/SysPromptTab.vue";
import { CHAT_SETTING_GROUPS } from "@/components/settings/general-fields.ts";
import { useSettingsLink } from "@/composables/useSettingsLink.ts";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";
import type { TabDescriptor } from "@/stores/settings.ts";
import "@/styles/settings.css";

const store = useSettingsStore();
const { connect } = useSettingsLink();

// One accessor per tab: the props are required, so each is narrowed against its
// own `tabData` before the component is rendered. Models needs none — it reads
// its slice inside `ModelsTab`.
const agents = computed(() => store.tabData("agents"));
const prompts = computed(() => store.tabData("prompts"));
const skills = computed(() => store.tabData("skills"));
const mcp = computed(() => store.tabData("mcp"));
const commit = computed(() => store.tabData("commit"));
const sysprompt = computed(() => store.tabData("sysprompt"));
/** 常规: our own VS Code settings. */
const general = computed(() => store.tabData("general"));
/** 设置: pi's settings.json. */
const piSettings = computed(() => store.tabData("settings"));

/** Covers both "never loaded" and "the first load of this tab is in flight". */
const showPlaceholder = computed(
  () => !store.ready || (store.loading && store.data[store.activeTab] === undefined),
);

/**
 * The sidebar in sections. Consecutive tabs that share a group render under one
 * heading, so `store.tabs` stays the single source of both the order and the
 * grouping — no second list to keep in step.
 */
const navSections = computed(() => {
  const sections: { label: string; tabs: TabDescriptor[] }[] = [];
  for (const tab of store.tabs) {
    const last = sections[sections.length - 1];
    if (last && last.label === tab.group) last.tabs.push(tab);
    else sections.push({ label: tab.group, tabs: [tab] });
  }
  return sections;
});

let detach: (() => void) | undefined;

onMounted(() => {
  detach = connect();
});

onUnmounted(() => detach?.());
</script>

<template>
  <div class="app">
    <nav class="nav">
      <div class="nav-head">
        <span class="nav-title">{{ t("Pi Settings") }}</span>
        <button class="nav-icon-btn" type="button" :title="t('Reload')" @click="store.refresh()">
          <span class="codicon codicon-refresh"></span>
        </button>
      </div>
      <template v-for="section in navSections" :key="section.label">
        <div class="nav-group">{{ section.label }}</div>
        <button
          v-for="tab in section.tabs"
          :key="tab.id"
          class="nav-tab"
          :class="{ active: tab.id === store.activeTab }"
          type="button"
          @click="store.selectTab(tab.id)"
        >
          <span class="codicon" :class="tab.icon"></span>
          <span class="nav-label">{{ tab.label }}</span>
        </button>
      </template>
    </nav>

    <main class="content">
      <div v-if="showPlaceholder" class="tab-placeholder">{{ t("Loading…") }}</div>
      <template v-else>
        <ModelsTab v-if="store.activeTab === 'models'" />
        <AgentsTab v-else-if="store.activeTab === 'agents' && agents" :data="agents" />
        <PromptsTab v-else-if="store.activeTab === 'prompts' && prompts" :data="prompts" />
        <SkillsTab v-else-if="store.activeTab === 'skills' && skills" :data="skills" />
        <McpTab v-else-if="store.activeTab === 'mcp' && mcp" :data="mcp" />
        <CommitTab v-else-if="store.activeTab === 'commit' && commit" :data="commit" />
        <SysPromptTab v-else-if="store.activeTab === 'sysprompt' && sysprompt" :data="sysprompt" />
        <GeneralTab
          v-else-if="store.activeTab === 'general' && general"
          :data="general"
          :groups="CHAT_SETTING_GROUPS"
          tab="general"
          save-type="saveChatSettings"
        />
        <GeneralTab v-else-if="store.activeTab === 'settings' && piSettings" :data="piSettings" />
        <div v-else class="tab-placeholder">{{ t("Select a tab to get started") }}</div>
      </template>
    </main>
  </div>

  <div v-if="store.toast" class="toast" :class="[store.toast.kind, { show: store.toast.show }]">
    {{ store.toast.text }}
  </div>
</template>
