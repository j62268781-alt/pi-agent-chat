<!--
  Webview shell.

  `@page` is a build-time alias (see `vite.config.ts`) pointing at the page this
  bundle was built for, so each webview ships exactly one page's code and CSS.
-->
<script setup lang="ts">
import Page from "@page";
</script>

<template>
  <Page />
</template>
