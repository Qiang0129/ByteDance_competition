import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';

import App from './App';
import './styles/global.css';
import { ThemeProvider, useTheme } from './theme/ThemeProvider';

/**
 * antd ConfigProvider 包装层:
 * 在 ThemeProvider 内部读取当前预设和色彩模式,把 colorPrimary 注入 antd token,
 * 并在 dark 模式下启用 antd 暗色算法.这样 Button / Tag / Input / Table 等 antd
 * 组件的主色和背景层级会跟随主题切换.
 */
function ThemedApp() {
  const { preset, resolvedColorMode } = useTheme();
  const isDark = resolvedColorMode === 'dark';
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: preset.primary,
          borderRadius: 8,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Layout: {
            // 暗色模式让 Layout body 跟随 antd dark token
            headerBg: isDark ? '#1a1d24' : '#ffffff',
            bodyBg: isDark ? '#13151b' : '#f3f5f8',
            siderBg: 'transparent',
          },
          Menu: {
            darkItemBg: 'transparent',
            darkSubMenuItemBg: 'transparent',
            darkItemSelectedBg: 'rgba(47, 123, 255, 0.18)',
            darkItemSelectedColor: '#ffffff',
          },
        },
      }}
      drawer={{
        styles: {
          wrapper: {
            top: 16,
            right: 16,
            bottom: 16,
            height: 'auto',
            borderRadius: 18,
            overflow: 'hidden',
            boxShadow: '0 18px 50px rgba(15,23,42,0.18), 0 4px 10px rgba(15,23,42,0.06)',
          },
          content: {
            borderRadius: 18,
            overflow: 'hidden',
          },
        },
      }}
      table={{
        style: {},
      }}
    >
      <AntdApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  </React.StrictMode>,
);
