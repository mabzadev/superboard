const path = require("node:path");
const CopyWebpackPlugin = require("copy-webpack-plugin");

const shared = {
  mode: "production",
  entry: "./src/index.js",
};

module.exports = [
  {
    ...shared,
    name: "esm",
    experiments: {
      outputModule: true,
    },
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "opengrow.js",
      library: {
        type: "module",
      },
      module: true,
      clean: true,
      publicPath: "/dist/",
    },
    devServer: {
      static: {
        directory: path.join(__dirname, "public"),
      },
      compress: true,
      port: 9000,
    },
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, "src/html/messages_list.html"),
            to: path.resolve(__dirname, "dist/html/messages_list.html"),
          },
        ],
      }),
    ],
  },
  {
    ...shared,
    name: "umd",
    dependencies: ["esm"],
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "opengrow.umd.cjs",
      library: {
        name: "OpenGrow",
        type: "umd",
        export: "default",
      },
      globalObject: "globalThis",
      publicPath: "/dist/",
    },
  },
];
