# Chouette Privacy Policy

**Last updated:** March 12, 2026

## Overview

Chouette is a browser extension that translates web pages and text entirely on your device. Your data never leaves your browser.

## Data Collection

Chouette does **not** collect, transmit, or store any personal data. Specifically:

- **No text is sent to external servers.** All translation is performed locally using an AI model (Gemma) that runs in your browser via WebAssembly and WebGPU.
- **No analytics or tracking.** Chouette does not include any analytics, telemetry, or tracking scripts.
- **No accounts or sign-in.** Chouette does not require or support user accounts.

## Data Stored Locally

Chouette stores the following data locally on your device using Chrome's built-in storage APIs:

- **Preferences** (e.g., preferred language, theme) — stored in `chrome.storage.local`.
- **Translation cache** — recently translated page content is temporarily cached in `chrome.storage.session` to avoid re-translating the same page. This cache is automatically cleared when you close your browser.
- **AI model files** — the translation model is downloaded once from Hugging Face and cached locally by the browser for offline use.

None of this data is transmitted to any server.

## Permissions

- **`activeTab`** — Used to detect the language of and translate the current page when you click Translate.
- **`storage`** — Used to save your preferences and cache translations locally.
- **`offscreen`** — Used to run the AI translation model in a background document.
- **`contextMenus`** — Used to add a right-click "Translate selection" option.
- **Host permission (`<all_urls>`)** — Required so the content script can offer translation on any web page. No data from these pages is sent externally.

## Third-Party Services

Chouette downloads the AI model from [Hugging Face](https://huggingface.co) on first use. This is a one-time download. After that, the model runs fully offline. No page content or user text is ever sent to Hugging Face or any other service.

## Changes to This Policy

If this policy is updated, the changes will be noted here with a revised date.

## Contact

If you have questions about this privacy policy, please open an issue at the project's GitHub repository.
