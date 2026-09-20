import { describe, expect, it } from "vitest";
import { toExtensionUiResponse } from "../../../../src/services/rpc/extension-ui-response.ts";

// pi reads one field per dialog method (`"value" in response ? response.value :
// undefined` for select / input / editor, `"confirmed" in response ? …` for
// confirm), and the webview's buttons set `value` and `confirmed` together.
// Regression: `confirmed` used to be mapped first, so a select came back
// without a value at all — pi resolved it to `undefined` and the permission
// gate blocked the command even when the user clicked Allow.
describe("toExtensionUiResponse", () => {
  it("keeps the chosen option for a select, where the button also confirms", () => {
    expect(toExtensionUiResponse("a", { value: "Allow", confirmed: true })).toEqual({
      type: "extension_ui_response",
      id: "a",
      value: "Allow",
    });
  });

  it("keeps an editor answer, which is how the questionnaire form comes back", () => {
    const answer = JSON.stringify({ answers: [{ id: "q1", value: "yes" }] });

    expect(toExtensionUiResponse("b", { value: answer, confirmed: true })).toEqual({
      type: "extension_ui_response",
      id: "b",
      value: answer,
    });
  });

  it("answers a confirm with the boolean alone", () => {
    expect(toExtensionUiResponse("c", { confirmed: true })).toEqual({
      type: "extension_ui_response",
      id: "c",
      confirmed: true,
    });
    expect(toExtensionUiResponse("c", { confirmed: false })).toEqual({
      type: "extension_ui_response",
      id: "c",
      confirmed: false,
    });
  });

  it("lets a dismissal win over whatever else is on the payload", () => {
    expect(toExtensionUiResponse("d", { cancelled: true, value: "Allow" })).toEqual({
      type: "extension_ui_response",
      id: "d",
      cancelled: true,
    });
  });

  it("resolves to cancelled when the payload carries nothing", () => {
    expect(toExtensionUiResponse("e", {})).toEqual({
      type: "extension_ui_response",
      id: "e",
      cancelled: true,
    });
  });
});
