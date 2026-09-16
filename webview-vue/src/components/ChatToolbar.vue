<!--
  Chat header: new session, session name (with inline rename), streaming status,
  reload, session switcher and the settings entry point.
-->
<script setup lang="ts">
import { nextTick, ref } from "vue";
import { post } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";
import { useComposerStore } from "@/stores/composer";
import { useSessionStore } from "@/stores/session";
import { useTranscriptStore } from "@/stores/transcript";
import { formatTime } from "@/lib/format.ts";

const session = useSessionStore();
const transcript = useTranscriptStore();
const composer = useComposerStore();

const editing = ref(false);
const draftName = ref("");
const nameInput = ref<HTMLInputElement | null>(null);

async function beginRename(): Promise<void> {
  draftName.value = session.sessionName;
  editing.value = true;
  await nextTick();
  nameInput.value?.select();
}

function commitRename(): void {
  if (!editing.value) return;
  editing.value = false;
  const name = draftName.value.trim();
  if (name && name !== session.sessionName) post({ type: "setSessionName", name });
}

function newChat(): void {
  post({ type: "prompt", message: "/new" });
}

function reload(): void {
  post({ type: "reload" });
}

function openSessions(): void {
  composer.togglePopup("sessions");
}

function openSettings(): void {
  post({ type: "openSettings" });
}

const statusLabel = (): string => {
  if (transcript.statusText === "compacting") return t("Compacting…");
  if (transcript.retryAttempt > 0) return t("Retrying {0}/{1}…", transcript.retryAttempt, 3);
  if (session.isStreaming) return t("Working…");
  return "";
};

const recentSessions = () => session.sessionList.slice(0, 5);
</script>

<template>
  <header class="toolbar">
    <button class="icon-btn" type="button" :title="t('New chat')" @click="newChat">
      <span class="codicon codicon-add"></span>
    </button>

    <div id="session-info">
      <input
        v-if="editing"
        id="name-input"
        ref="nameInput"
        v-model="draftName"
        type="text"
        @blur="commitRename"
        @keydown.enter.prevent="commitRename"
        @keydown.esc.prevent="editing = false"
      />
      <template v-else>
        <span class="session-name" :title="session.sessionName" @dblclick="beginRename">
          {{ session.sessionName || t("New session") }}
        </span>
        <button class="icon-btn" type="button" :title="t('Rename')" @click="beginRename">
          <span class="codicon codicon-edit"></span>
        </button>
      </template>
    </div>

    <span id="status">{{ statusLabel() }}</span>

    <div class="toolbar-spacer"></div>

    <div class="select-wrap">
      <button class="icon-btn" type="button" :title="t('Sessions')" @click="openSessions">
        <span class="codicon codicon-history"></span>
      </button>
      <div v-if="composer.openPopup === 'sessions'" id="sessions-popup">
        <div v-if="recentSessions().length === 0" class="popup-empty">{{ t("No sessions") }}</div>
        <button
          v-for="item in recentSessions()"
          :key="item.file"
          class="session-item"
          type="button"
          @click="post({ type: 'switchSession', file: item.file })"
        >
          <span class="session-item-name">{{ item.name || item.firstMessage || item.file }}</span>
          <span class="session-item-time">{{
            item.modified ? formatTime(Date.parse(item.modified)) : ""
          }}</span>
        </button>
      </div>
    </div>

    <button class="icon-btn" type="button" :title="t('Reload session')" @click="reload">
      <span class="codicon codicon-refresh"></span>
    </button>

    <button
      id="settings-btn"
      class="icon-btn"
      type="button"
      :title="t('Settings')"
      @click="openSettings"
    >
      <span class="codicon codicon-settings-gear"></span>
    </button>
  </header>
</template>
