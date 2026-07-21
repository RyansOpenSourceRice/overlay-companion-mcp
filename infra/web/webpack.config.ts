import path from 'path';
import { fileURLToPath } from 'url';
import { Configuration, WebpackOptionsNormalized } from 'webpack';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';

// Resolve __dirname for both ESM and CommonJS config-loading contexts.
// In ESM, __dirname/__filename are not defined; fall back to import.meta.url.
const __dirname = ((): string => {
  try {
    // CommonJS path
    return typeof (globalThis as any).__dirname === 'string'
      ? (globalThis as any).__dirname
      : path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
})();

// webpack-dev-server options live on the config object at runtime even though
// they are typed by a separate package; declare the shape we use.
type WebpackConfigWithDevServer = Configuration & {
  devServer?: {
    static?: { directory: string };
    compress?: boolean;
    port?: number;
    hot?: boolean;
    historyApiFallback?: boolean;
    proxy?: Record<string, unknown>;
  };
};

type WebpackEnv = Record<string, unknown> & { mode?: 'production' | 'development' | 'none' };

const config = (env: WebpackEnv, argv: WebpackOptionsNormalized): WebpackConfigWithDevServer => {
  const isProduction = argv.mode === 'production';

  return {
    entry: './src/index.ts',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isProduction ? '[name].[contenthash].js' : '[name].js',
      clean: true,
      publicPath: '/',
    },
    module: {
      rules: [
        {
          test: /\.ts$/i,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/i,
          use: ['style-loader', 'css-loader'],
        },
        {
          test: /\.(png|svg|jpg|jpeg|gif)$/i,
          type: 'asset/resource',
        },
        {
          test: /\.(woff|woff2|eot|ttf|otf)$/i,
          type: 'asset/resource',
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/index.html',
        title: 'Overlay Companion MCP',
        inject: 'body',
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: 'src/assets',
            to: 'assets',
            noErrorOnMissing: true,
          },
        ],
      }),
    ],
    devServer: {
      static: {
        directory: path.join(__dirname, 'dist'),
      },
      compress: true,
      port: 3000,
      hot: true,
      historyApiFallback: true,
      proxy: {
        '/api': 'http://localhost:8080',
        '/health': 'http://localhost:8080',
        '/mcp-config': 'http://localhost:8080',
        '/ws': {
          target: 'ws://localhost:8080',
          ws: true,
        },
      },
    },
    optimization: {
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
          },
        },
      },
    },
    resolve: {
      extensions: ['.ts', '.js', '.json'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  };
};

export default config;
