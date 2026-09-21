<!--
  The OAuth sub-tab: provider status rows, or — while a login is running — a
  single progress card driven by the `oauthProgress` events the host relays from
  pi's auth flow.

  The card is a state machine over `OAuthProgressEvent.type`; `auth_url` /
  `prompt` / `select` each carry the token that ties the answer back to the
  promise the SDK is awaiting, which is why every submit handler reads it from
  the event instead of keeping local state.
-->
<script setup lang="ts">
import { ref } from "vue";
import type { ModelsTabData } from "@protocol/settings";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";
import ItemRow from "../ItemRow.vue";

defineProps<{ data: ModelsTabData }>();
const store = useSettingsStore();

/** Shared answer box for `auth_url` and `prompt`. */
const answer = ref("");

function respond(token: string | undefined, value: string): void {
  if (!token) return;
  store.send({ type: "oauthRespond", token, value });
  answer.value = "";
}

function cancel(): void {
  store.send({ type: "oauthCancel" });
  store.dismissOAuth();
}
</script>

<template>
  <div class="item-list">
    <div v-if="store.oauth" class="editor-card oauth-progress">
      <template v-if="store.oauth.type === 'auth_url'">
        <strong>{{ t("Authorize") }}</strong>
        <div class="url">
          <a :href="store.oauth.url ?? ''" target="_blank">{{ store.oauth.url ?? "" }}</a>
        </div>
        <p v-if="store.oauth.instructions" class="dim">{{ store.oauth.instructions }}</p>
        <label class="field-label">{{ t("Or paste authorization code:") }}</label>
        <input v-model="answer" :placeholder="t('Authorization code')" />
        <div class="btn-row">
          <button
            class="btn-primary"
            type="button"
            @click="respond(store.oauth.token, answer.trim())"
          >
            <span class="codicon codicon-check"></span> {{ t("Submit") }}
          </button>
          <button class="btn-secondary" type="button" :title="t('Cancel')" @click="cancel">
            <span class="codicon codicon-close"></span>
          </button>
        </div>
      </template>

      <template v-else-if="store.oauth.type === 'device_code'">
        <strong>{{ t("Device Code") }}</strong>
        <p style="font-size: var(--pi-fs-title); font-weight: bold; letter-spacing: 2px">
          {{ store.oauth.userCode ?? "" }}
        </p>
        <p v-if="store.oauth.verificationUri">
          <a :href="store.oauth.verificationUri" target="_blank">
            {{ store.oauth.verificationUri }}
          </a>
        </p>
        <div class="btn-row">
          <button class="btn-secondary" type="button" :title="t('Cancel')" @click="cancel">
            <span class="codicon codicon-close"></span>
          </button>
        </div>
      </template>

      <template v-else-if="store.oauth.type === 'prompt'">
        <strong>{{ store.oauth.message || t("Input required") }}</strong>
        <div><input v-model="answer" :placeholder="store.oauth.placeholder ?? ''" /></div>
        <div class="btn-row">
          <button
            class="btn-primary"
            type="button"
            @click="respond(store.oauth.token, answer.trim())"
          >
            <span class="codicon codicon-check"></span> {{ t("Submit") }}
          </button>
          <button class="btn-secondary" type="button" :title="t('Cancel')" @click="cancel">
            <span class="codicon codicon-close"></span>
          </button>
        </div>
      </template>

      <template v-else-if="store.oauth.type === 'select'">
        <strong>{{ store.oauth.message || t("Select") }}</strong>
        <div v-for="option in store.oauth.options ?? []" :key="option.id" class="btn-row">
          <button class="btn-primary" type="button" @click="respond(store.oauth.token, option.id)">
            {{ option.label }}
          </button>
        </div>
        <div class="btn-row">
          <button class="btn-secondary" type="button" :title="t('Cancel')" @click="cancel">
            <span class="codicon codicon-close"></span>
          </button>
        </div>
      </template>

      <template v-else-if="store.oauth.type === 'progress'">
        <p>{{ store.oauth.message || t("Working...") }}</p>
      </template>

      <template v-else-if="store.oauth.type === 'success'">
        <p class="oauth-ok">
          <span class="codicon codicon-check"></span> {{ t("Connected successfully!") }}
        </p>
        <div class="btn-row">
          <button
            class="btn-secondary"
            type="button"
            :title="t('Dismiss')"
            @click="store.dismissOAuth()"
          >
            <span class="codicon codicon-close"></span>
          </button>
        </div>
      </template>

      <template v-else-if="store.oauth.type === 'error'">
        <p class="oauth-fail">{{ t("Error: {0}", store.oauth.message ?? "") }}</p>
        <div class="btn-row">
          <button
            class="btn-secondary"
            type="button"
            :title="t('Dismiss')"
            @click="store.dismissOAuth()"
          >
            <span class="codicon codicon-close"></span>
          </button>
        </div>
      </template>

      <template v-else>
        <p>{{ t("Login cancelled.") }}</p>
        <div class="btn-row">
          <button
            class="btn-secondary"
            type="button"
            :title="t('Dismiss')"
            @click="store.dismissOAuth()"
          >
            <span class="codicon codicon-close"></span>
          </button>
        </div>
      </template>
    </div>

    <span v-else-if="data.oauthStatuses.length === 0" class="dim">
      {{ t("No OAuth providers available") }}
    </span>

    <template v-else>
      <ItemRow
        v-for="provider in data.oauthStatuses"
        :key="provider.id"
        :name="provider.name"
        :description="provider.id"
      >
        <template #badges>
          <span class="status-dot" :class="provider.connected ? 'on' : 'off'"></span>
          <span class="badge" :class="provider.connected ? 'badge-cli' : 'badge-other'">
            {{ provider.connected ? t("connected") : t("not connected") }}
          </span>
        </template>
        <template #actions>
          <button
            v-if="provider.connected"
            class="btn-icon"
            type="button"
            :title="t('Logout')"
            @click="store.send({ type: 'oauthLogout', providerId: provider.id })"
          >
            <span class="codicon codicon-sign-out"></span>
          </button>
          <button
            v-else
            class="btn-icon"
            type="button"
            :title="t('Login')"
            @click="store.send({ type: 'oauthLogin', providerId: provider.id })"
          >
            <span class="codicon codicon-sign-in"></span>
          </button>
        </template>
      </ItemRow>
    </template>
  </div>
</template>
