import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';

import App from './App';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2f7bff',
          borderRadius: 8,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Layout: {
            headerBg: '#ffffff',
            bodyBg: '#f3f5f8',
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
  </React.StrictMode>,
);
