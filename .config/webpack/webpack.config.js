const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

// Hand-built webpack config (no @grafana/create-plugin CLI, since it refuses
// to run on native Windows). Mirrors the externals/output conventions the
// official generator uses so the built dist/ is a normal, portable Grafana
// panel plugin usable on any OS Grafana runs on.

const pluginJson = require('../../src/plugin.json');

module.exports = (env) => {
  const production = !!(env && env.production);

  return {
    context: path.resolve(__dirname, '../../src'),
    mode: production ? 'production' : 'development',
    devtool: production ? 'source-map' : 'eval-source-map',
    entry: {
      module: path.resolve(__dirname, '../../src/module.ts'),
    },
    output: {
      path: path.resolve(__dirname, '../../dist'),
      filename: '[name].js',
      library: { type: 'amd' },
      publicPath: `public/plugins/${pluginJson.id}/`,
      clean: true,
    },
    externals: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react-dom/client',
      '@grafana/data',
      '@grafana/ui',
      '@grafana/runtime',
      '@grafana/schema',
      'lodash',
      'moment',
      'jquery',
      'rxjs',
      'd3',
      { 'amd-module': 'module' },
    ],
    resolve: {
      extensions: ['.ts', '.tsx', '.js'],
      modules: [path.resolve(__dirname, '../../src'), 'node_modules'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: {
            loader: 'ts-loader',
            options: { transpileOnly: true },
          },
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
        {
          test: /\.svg$/,
          type: 'asset/resource',
        },
      ],
    },
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          { from: 'plugin.json', to: '.' },
          { from: 'img', to: 'img', noErrorOnMissing: true },
          { from: '../README.md', to: '.', noErrorOnMissing: true },
        ],
      }),
    ],
  };
};
