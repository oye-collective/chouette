import { MessageAction } from "../shared/messages";

document.addEventListener("mouseup", () => {
  const selection = window.getSelection()?.toString().trim();
  if (selection && selection.length > 0) {
    chrome.runtime.sendMessage({
      action: MessageAction.SELECTED_TEXT,
      text: selection,
    });
  }
});
