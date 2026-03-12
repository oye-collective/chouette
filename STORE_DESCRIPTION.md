# Chrome Web Store Listing

## Short Description (132 chars max)
Private, offline page translation powered by AI running entirely in your browser.

## Detailed Description

Chouette translates web pages and text privately, no cloud, no API keys, no data ever leaving your browser.

Unlike traditional translation extensions that send every word to a remote server, Chouette runs a full AI translation model (Gemma) directly in your browser using WebGPU and WebAssembly. Your text stays on your device at all times.

**Features**

• Full page translation — Detects foreign-language pages and offers one-click translation with a subtle, non-intrusive prompt
• Text translation — Translate selected text or type directly in the popup
• 50+ languages — Supports all major languages including Chinese, Japanese, Korean, Arabic, Hindi, and European languages
• Completely private — Zero data sent to external servers, ever
• Works offline — After the one-time model download, translations work without an internet connection
• Smart caching — Translated pages are cached so revisiting is instant
• Light and dark themes — Matches your preference

**How It Works**

1. Install the extension and download the translation model (~4 GB, one-time)
2. Visit any page in a foreign language — Chouette detects it and shows a translate bar
3. Click Translate — the page is translated in place, starting with visible content first
4. Toggle between the original and translated text anytime

**Privacy First**

Chouette uses the Gemma model by Google, running entirely on-device. No text, no page content, and no personal information is collected or transmitted. See our full privacy policy for details.

**Requirements**

• Chrome 113 or later
• A WebGPU-capable device (required for running the AI model)
• ~4 GB of storage for the translation model

**WebGPU Supported Devices**

WebGPU is available on most modern hardware. Examples of supported devices:
• Desktop — Windows/Mac/ChromeOS with integrated or discrete GPUs (e.g., Intel UHD 630+, Apple M1/M2/M3/M4, NVIDIA GTX 1060+, AMD RX 580+)
• Laptop — Most laptops from 2018 or later with Chrome 113+
• Chromebook — Higher-end Chromebooks with dedicated GPUs or recent Intel/AMD processors

To check if your device supports WebGPU, visit chrome://gpu and look for "WebGPU" under Graphics Feature Status. It should say "Hardware accelerated."

## Single Purpose

Translate web pages and selected text from foreign languages into your preferred language, entirely on-device using a local AI model.

## Permission Justifications

**activeTab** — Used to read the text content of the current page so it can be translated in place when the user clicks Translate.

**storage** — Used to save user preferences (preferred language, theme) and temporarily cache translated pages locally so they don't need to be re-translated on revisit.

**offscreen** — Used to create an offscreen document that loads and runs the AI translation model (ONNX Runtime + Gemma) in the background, since WebGPU and WASM model inference cannot run directly in the service worker.

**contextMenus** — Used to add a "Translate selection" option to the right-click context menu, allowing users to translate highlighted text on any page.

**Host permission (`<all_urls>`)** — The content script needs to run on any web page to detect the page language and offer translation. No page data is sent to any external server; all translation happens locally.

**Open Source**

Chouette is open source under the MIT license. The Gemma model is provided under Google's Gemma Terms of Use (https://ai.google.dev/gemma/terms).
