import { useState } from 'react';
import { BulbOutlined, DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { Button, Popover } from 'antd';

import { useTheme } from '../theme/ThemeProvider';
import type { ColorMode } from '../theme/ThemeProvider';

/**
 * 色彩模式切换:Header 右侧图标按钮 + 弹出 4 张模式预览卡.
 * 视觉对齐截图设计稿:跟随系统 / 纯白 / 羊毛纸 / 暗色,选中态加主色描边.
 */

interface ModeOption {
  key: ColorMode;
  label: string;
  /** 预览卡的整体外观:窗口边框色 / 内容区底色 / 内容文字条颜色 */
  card: {
    background: string;
    border: string;
    headerBg: string;
    contentBg: string;
    bar: string;
  };
  /** 跟随系统模式的双色斜切预览 */
  splitPreview?: boolean;
}

const MODES: ModeOption[] = [
  {
    key: 'system',
    label: '跟随系统',
    card: {
      background: '#ffffff',
      border: '#0f172a',
      headerBg: '#ffffff',
      contentBg: '#ffffff',
      bar: '#cbd5e1',
    },
    splitPreview: true,
  },
  {
    key: 'light',
    label: '纯白',
    card: {
      background: '#ffffff',
      border: '#e2e8f0',
      headerBg: '#ffffff',
      contentBg: '#ffffff',
      bar: '#cbd5e1',
    },
  },
  {
    key: 'paper',
    label: '羊毛纸',
    card: {
      background: '#f5f0e6',
      border: '#e0d8c8',
      headerBg: '#faf6ec',
      contentBg: '#f5f0e6',
      bar: '#bfb59f',
    },
  },
  {
    key: 'dark',
    label: '暗色',
    card: {
      background: '#1a1d24',
      border: '#0f1116',
      headerBg: '#13151b',
      contentBg: '#1a1d24',
      bar: '#3f4654',
    },
  },
];

export default function ColorModeSwitcher() {
  const { colorMode, resolvedColorMode, setColorMode } = useTheme();
  const [open, setOpen] = useState(false);

  // 根据当前实际模式决定按钮上显示哪个图标
  const trigger = (() => {
    if (colorMode === 'system') return <DesktopOutlined />;
    if (resolvedColorMode === 'dark') return <MoonOutlined />;
    if (resolvedColorMode === 'paper') return <BulbOutlined />;
    return <SunOutlined />;
  })();

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      arrow={false}
      overlayClassName="color-mode-popover"
      content={
        <div className="color-mode-grid">
          {MODES.map((mode) => {
            const active = colorMode === mode.key;
            return (
              <button
                key={mode.key}
                type="button"
                className={`color-mode-tile ${active ? 'is-active' : ''}`}
                onClick={() => {
                  setColorMode(mode.key);
                  setOpen(false);
                }}
                aria-label={`切换到${mode.label}`}
                aria-pressed={active}
              >
                <ModePreview option={mode} />
                <span className="color-mode-tile-label">{mode.label}</span>
              </button>
            );
          })}
        </div>
      }
    >
      <Button
        type="text"
        className="app-header-color-mode"
        icon={trigger}
        aria-label="色彩模式"
      />
    </Popover>
  );
}

function ModePreview({ option }: { option: ModeOption }) {
  const { card, splitPreview } = option;
  return (
    <div
      className="color-mode-preview"
      style={{
        background: card.background,
        borderColor: card.border,
      }}
    >
      {/* 跟随系统:左半亮 + 右半暗,用对角线切分 */}
      {splitPreview && (
        <span
          className="color-mode-preview-split"
          aria-hidden
          style={{
            background:
              'linear-gradient(135deg, #ffffff 0%, #ffffff 50%, #1a1d24 50%, #1a1d24 100%)',
          }}
        />
      )}
      <span
        className="color-mode-preview-header"
        style={{ background: splitPreview ? 'transparent' : card.headerBg }}
      />
      <span
        className="color-mode-preview-body"
        style={{ background: splitPreview ? 'transparent' : card.contentBg }}
      >
        <span className="color-mode-preview-bar" style={{ background: card.bar }} />
        <span
          className="color-mode-preview-bar short"
          style={{ background: card.bar, opacity: 0.7 }}
        />
      </span>
    </div>
  );
}
