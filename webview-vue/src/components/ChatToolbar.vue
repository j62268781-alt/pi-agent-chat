<!--
  Chat header: new session, session name (with inline rename), streaming status,
  the session switcher and the reload / settings entries.

  Layout contract with `chat.css`: `.session-info` is the `flex: 1 1 auto` slot
  for the session name, so the name sits left and everything after it — status,
  rename, refresh, the session switcher and settings — is pushed to the right
  edge. Without that class the whole header bunches up on the left. The switcher
  is the legacy `.select-wrap > #sessions-btn + .sessions-popup` pair; the popup
  itself lives in `./composer/SessionsPopup.vue`, which `chat.css` styles by its
  own class names (`.sessions-list`, `.session-item-*`), so an inline list here
  would render unstyled.
-->
<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { post } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";
import { useComposerStore } from "@/stores/composer";
import { useSessionStore } from "@/stores/session";
import { useTranscriptStore } from "@/stores/transcript";
import SessionsPopup from "./composer/SessionsPopup.vue";

const session = useSessionStore();
const transcript = useTranscriptStore();
const composer = useComposerStore();

const editing = ref(false);
const draftName = ref("");
const nameInput = ref<HTMLInputElement | null>(null);

async function beginRename(): Promise<void> {
  // Nothing to rename while the guide is up: pi has no session for it yet, and
  // `setSessionName` would land on whatever session pi is still holding.
  if (session.pendingNew) return;
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

/**
 * A session that holds no messages is already a new session: starting another
 * one is a no-op for the user but not for pi, which writes a fresh (empty)
 * transcript every time. The `+` is disabled there instead.
 *
 * `session.messageCount` is the host's own count — the same field the host's
 * guard reads — so button and host can never disagree; the transcript is only a
 * fallback for a host that has not reported a count yet.
 */
const sessionHasMessages = computed(() =>
  typeof session.messageCount === "number" ? session.messageCount > 0 : !transcript.isEmpty,
);
const canStartNew = computed(() => !session.isStreaming && sessionHasMessages.value);

const newChatTitle = computed(() => {
  if (session.isStreaming) return t("Stop the agent before starting a new session");
  if (!sessionHasMessages.value) return t("Already in a new session");
  return t("New chat");
});

function newChat(): void {
  if (!canStartNew.value) return;
  // Enter the guide immediately; the session itself is only created when the
  // first message is sent (the host holds a pending marker until then), so
  // clicking "+" never writes an empty transcript to disk. The draft survives:
  // it lives in the composer, not the transcript.
  session.pendingNew = true;
  transcript.reset();
  composer.closePopups();
  post({ type: "newSession" });
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
</script>

<template>
  <header class="toolbar">
    <button
      id="new-chat-btn"
      class="icon-btn"
      type="button"
      :disabled="!canStartNew"
      :title="newChatTitle"
      @click="newChat"
    >
      <span class="codicon codicon-add"></span>
    </button>

    <!-- The name slot holds bare text (the legacy `#session-info` contract): it
         is the `flex: 1 1 auto` item of `.toolbar` and ellipsises on its own, so
         the rename button lives in the trailing icon cluster instead. -->
    <span
      v-show="!editing"
      id="session-info"
      class="session-info"
      :title="session.pendingNew ? t('New chat') : session.sessionName"
      @dblclick="beginRename"
      >{{ session.pendingNew ? t("New chat") : session.sessionName || t("New session") }}</span
    >
    <input
      v-show="editing"
      id="name-input"
      ref="nameInput"
      v-model="draftName"
      class="name-input"
      type="text"
      @blur="commitRename"
      @keydown.enter.prevent="commitRename"
      @keydown.esc.prevent="editing = false"
    />

    <span id="status" class="status">{{ statusLabel() }}</span>

    <button
      id="name-btn"
      class="icon-btn"
      type="button"
      :disabled="session.pendingNew"
      :title="session.pendingNew ? t('Already in a new session') : t('Rename session')"
      @click="beginRename"
    >
      <span class="codicon codicon-edit"></span>
    </button>

    <button
      id="refresh-btn"
      class="icon-btn"
      type="button"
      :title="t('Reload session')"
      @click="reload"
    >
      <span class="codicon codicon-refresh"></span>
    </button>

    <div
      id="sessions-wrap"
      class="select-wrap sessions-wrap"
      :class="{ 'is-open': composer.openPopup === 'sessions' }"
    >
      <button
        id="sessions-btn"
        class="icon-btn"
        type="button"
        :title="t('Sessions')"
        @click="openSessions"
      >
        <span class="codicon codicon-server"></span>
      </button>
      <SessionsPopup />
    </div>

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
