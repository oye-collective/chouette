const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
  entry: {
    "service-worker": "./src/background/service-worker.ts",
    offscreen: "./src/offscreen/offscreen.ts",
    popup: "./src/popup/popup.ts",
    content: "./src/content/content.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    clean: true,
    publicPath: "",
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, "css-loader"],
      },
      {
        test: /ort-wasm.*\.(wasm|mjs)$/,
        type: "asset/resource",
        generator: { filename: "[name][ext]" },
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "src/manifest.json", to: "manifest.json" },
        { from: "src/popup/popup.html", to: "popup.html" },
        { from: "src/offscreen/offscreen.html", to: "offscreen.html" },
        { from: "public/icons", to: "icons" },
        {
          from: "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.{mjs,wasm}",
          to: "[name][ext]",
        },
      ],
    }),
    new MiniCssExtractPlugin({
      filename: "[name].css",
    }),
  ],
  experiments: {
    asyncWebAssembly: true,
  },
  performance: {
    maxAssetSize: 5 * 1024 * 1024,
    maxEntrypointSize: 5 * 1024 * 1024,
  },
};
