# Chouette

A minimalist browser extension for offline translation, powered by on-device AI. Chouette runs translation models locally using WebGPU and ONNX Runtime — no data leaves your browser.

## Features

- Offline-first translation with no external API calls
- Automatic language detection via fastText
- Dark and light theme support
- Context menu integration for translating selected text

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
