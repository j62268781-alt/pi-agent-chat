// The stylesheets the webview ships. The preview renders the real thing — there
// is no separate "proposed" copy any more, which is the point: what you look at
// in the preview is what the extension loads.
import "@/tokens.css";
import "@/styles/chat.css";
// Harness-only viewport rules, last so they win over the app's own.
import "../preview.css";
