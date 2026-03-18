# Chouette

A minimalist browser extension for offline translation, powered by on-device AI. Chouette runs translation models locally using WebGPU and ONNX Runtime — no data leaves your browser.

## Features

- Offline-first translation with no external API calls
- Automatic language detection via fastText
- Dark and light theme support
- Context menu integration for translating selected text
- Shared model cache across Chrome profiles via native messaging host

## Brand Colors

| Name               | Hex       | Swatch                                                     |
|--------------------|-----------|-------------------------------------------------------------|
| Deep Mint          | `#6FA586` | ![#6FA586](https://placehold.co/16x16/6FA586/6FA586.png)   |
| Soft Teal          | `#A5D6BF` | ![#A5D6BF](https://placehold.co/16x16/A5D6BF/A5D6BF.png)  |
| Muted Forest Green | `#27614A` | ![#27614A](https://placehold.co/16x16/27614A/27614A.png)   |
| Tan Leather        | `#C8A375` | ![#C8A375](https://placehold.co/16x16/C8A375/C8A375.png)   |
| Core Digital Cream | `#FEFDF7` | ![#FEFDF7](https://placehold.co/16x16/FEFDF7/FEFDF7.png)  |

## Development

```sh
npm install
npm run dev    # watch mode
npm run build  # production build
```

Load the `dist/` directory as an unpacked extension in `chrome://extensions`.

## Shared Model Cache (Optional)

By default, each Chrome profile downloads the translation model (~2-3GB) independently. If you use multiple profiles, you can install the native messaging host to share a single download across all of them.

1. Note your extension ID from `chrome://extensions`
2. Run the installer:
   ```sh
   CHOUETTE_EXTENSION_ID=<your-id> ./native-host/install.sh
   ```

The host caches model files at `~/.chouette/models/`. Without it, the extension works normally — each profile just downloads its own copy.

To uninstall:
```sh
./native-host/uninstall.sh
```
