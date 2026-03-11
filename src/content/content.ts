// Content script — must be self-contained (no ES module imports)
// because MV3 content scripts are loaded as classic scripts.

document.addEventListener("mouseup", () => {
  const selection = window.getSelection()?.toString().trim();
  if (selection && selection.length > 0) {
    chrome.runtime.sendMessage({
      action: "SELECTED_TEXT" as const,
      text: selection,
    });
  }
});
