import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 读取 package.json 的 version,后续注入到 import.meta.env.VITE_APP_VERSION,
// 让左侧导航栏底部展示的版本号始终与发布版本一致。
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string };
const frontendRoot = fileURLToPath(new URL('./', import.meta.url));
const repoRoot = fileURLToPath(new URL('../', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const appBasePath = env.VITE_APP_BASE_PATH ?? '/';
  const appVersion = env.VITE_APP_VERSION?.trim() || pkg.version;
  return {
    plugins: [react()],
    base: appBasePath,
    define: {
      // 优先使用 .env 中显式指定的版本,缺省回落到 package.json
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      fs: {
        allow: [frontendRoot, repoRoot],
      },
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
    },
  };
});
