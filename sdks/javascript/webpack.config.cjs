const path = require("node:path");
const CopyWebpackPlugin = require("copy-webpack-plugin");

const shared = {
  mode: "production",
};

module.exports = [
  {
    ...shared,
    name: "esm",
    entry: "./src/index.js",
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
          {
            from: path.resolve(__dirname, "src/index.d.ts"),
            to: path.resolve(__dirname, "dist/index.d.ts"),
          },
          {
            from: path.resolve(__dirname, "src/support.d.ts"),
            to: path.resolve(__dirname, "dist/support.d.ts"),
          },
        ],
      }),
    ],
  },
  {
    ...shared,
    name: "umd",
    dependencies: ["esm"],
    entry: "./src/index.js",
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
  {
    ...shared,
    name: "support-esm",
    dependencies: ["umd"],
    entry: "./src/support/index.js",
    experiments: {
      outputModule: true,
    },
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "support.js",
      library: {
        type: "module",
      },
      module: true,
      publicPath: "/dist/",
    },
  },
  {
    ...shared,
    name: "support-umd",
    dependencies: ["support-esm"],
    entry: "./src/support/index.js",
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "support.umd.cjs",
      library: {
        name: "SuperBoardSupport",
        type: "umd",
      },
      globalObject: "globalThis",
      publicPath: "/dist/",
    },
  },
];
