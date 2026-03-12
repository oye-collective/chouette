import { defineConfig, Plugin } from "vite";
import { resolve } from "path";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "fs";

/**
 * Copy the ONNX Runtime WASM bootstrap (.mjs) and binary (.wasm)
 * from node_modules into dist so the extension can load them locally
 * (the jsdelivr CDN is blocked by the extension's CSP).
 */
function copyOnnxFiles(): Plugin {
  return {
    name: "copy-onnx-files",
    writeBundle(options) {
      const outDir = options.dir ?? resolve(__dirname, "dist");
      const onnxDir = resolve(__dirname, "node_modules/onnxruntime-web/dist");
      if (!existsSync(onnxDir)) return;

      for (const file of readdirSync(onnxDir)) {
        if (
          file.startsWith("ort-wasm-simd-threaded") &&
          (file.endsWith(".mjs") || file.endsWith(".wasm"))
        ) {
          copyFileSync(resolve(onnxDir, file), resolve(outDir, file));
        }
      }
    },
  };
}

/**
 * Copy the fastText WASM binary and language identification model
 * from node_modules into dist so the extension can load them locally.
 */
function copyFastTextFiles(): Plugin {
  return {
    name: "copy-fasttext-files",
    writeBundle(options) {
      const outDir = options.dir ?? resolve(__dirname, "dist");
      const ftPkgDir = resolve(
        __dirname,
        "node_modules/fasttext.wasm.js/dist/fastText"
      );
      if (!existsSync(ftPkgDir)) return;

      const ftOutDir = resolve(outDir, "fastText");
      const modelsOutDir = resolve(ftOutDir, "models");
      mkdirSync(modelsOutDir, { recursive: true });

      const wasmSrc = resolve(ftPkgDir, "fastText.common.wasm");
      if (existsSync(wasmSrc)) {
        copyFileSync(wasmSrc, resolve(ftOutDir, "fastText.common.wasm"));
      }

      const modelSrc = resolve(ftPkgDir, "models/lid.176.ftz");
      if (existsSync(modelSrc)) {
        copyFileSync(modelSrc, resolve(modelsOutDir, "lid.176.ftz"));
      }
    },
  };
}

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        "service-worker": resolve(__dirname, "src/background/service-worker.ts"),
        offscreen: resolve(__dirname, "src/offscreen/offscreen.ts"),
        popup: resolve(__dirname, "src/popup/popup.ts"),
        content: resolve(__dirname, "src/content/content.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "[name][extname]",
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
  },
  plugins: [copyOnnxFiles(), copyFastTextFiles()],
});
