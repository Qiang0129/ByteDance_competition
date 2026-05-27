import { useNavigate } from 'react-router-dom';
import { ArrowLeftOutlined, CheckOutlined, SkinOutlined } from '@ant-design/icons';
import { Button, Card, Space, Typography } from 'antd';

import { useTheme } from '../../theme/ThemeProvider';
import {
  THEME_PRESETS,
  type StyleVersion,
  type ThemeKey,
  type ThemePreset,
} from '../../theme/themePresets';

const { Title, Paragraph, Text } = Typography;

/**
 * 系统设置 · 外观:
 * 当前阶段只做"外观"一项,不再使用 Tabs 包一层。
 * 上半部分:样式版本(默认 / 渐变)。
 * 下半部分:界面主题色卡(11 个圆形色卡)。
 */
export default function AppearanceSettings() {
  const navigate = useNavigate();
  const { themeKey, styleVersion, setThemeKey, setStyleVersion } = useTheme();

  return (
    <div className="appearance-page">
      <div className="appearance-header">
        <Space size={12} align="center">
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(-1)}
            className="appearance-back"
          />
          <SkinOutlined className="appearance-title-icon" />
          <Title level={3} style={{ margin: 0 }}>
            外观设置
          </Title>
        </Space>
        <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          调整 LabelHub 工作台的视觉风格,设置会保存在本机浏览器,所有页面都会自动跟随。
        </Paragraph>
      </div>

      <StyleVersionSection value={styleVersion} onChange={setStyleVersion} />
      <ThemePaletteSection value={themeKey} onChange={setThemeKey} />
    </div>
  );
}

/**
 * 样式版本卡:两张并排的大预览,左侧默认(纯色),右侧渐变。
 * 鼠标悬停时浮起,选中态用紫色描边 + 右上角对勾徽章。
 */
function StyleVersionSection({
  value,
  onChange,
}: {
  value: StyleVersion;
  onChange: (next: StyleVersion) => void;
}) {
  const items: Array<{ key: StyleVersion; title: string; desc: string }> = [
    { key: 'default', title: '默认版本', desc: '纯色填充,简洁高效,长时间作业不易疲劳。' },
    { key: 'gradient', title: '渐变版本', desc: '主色渐变,横幅与按钮更具品牌感和层次感。' },
  ];

  return (
    <Card className="appearance-card" title="样式版本" bordered={false}>
      <div className="style-version-grid">
        {items.map((item) => {
          const active = value === item.key;
          return (
            <div
              key={item.key}
              role="button"
              tabIndex={0}
              className={`style-version-tile ${active ? 'is-active' : ''}`}
              onClick={() => onChange(item.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onChange(item.key);
                }
              }}
            >
              {active && (
                <span className="appearance-check">
                  <CheckOutlined />
                </span>
              )}
              <div className={`style-version-preview style-version-preview--${item.key}`}>
                <div className="style-version-preview-header">
                  <span className="style-version-preview-dot" />
                  <span className="style-version-preview-dot" />
                  <span className="style-version-preview-dot" />
                </div>
                <div className="style-version-preview-body">
                  <span className="style-version-preview-bar long" />
                  <span className="style-version-preview-bar mid" />
                  <span className="style-version-preview-button" />
                </div>
              </div>
              <div className="style-version-meta">
                <Text strong className="style-version-title">
                  {item.title}
                </Text>
                <Text type="secondary" className="style-version-desc">
                  {item.desc}
                </Text>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/**
 * 11 圆形色卡;选中态用紫色描边 + 右上对勾徽章。
 */
function ThemePaletteSection({
  value,
  onChange,
}: {
  value: ThemeKey;
  onChange: (next: ThemeKey) => void;
}) {
  return (
    <Card className="appearance-card" title="界面主题" bordered={false}>
      <Paragraph type="secondary" style={{ marginBottom: 20 }}>
        选择整站强调色,导航选中态、按钮、Tag、KPI 图标和报表都会随之变化。
      </Paragraph>
      <div className="theme-palette-grid">
        {THEME_PRESETS.map((preset) => (
          <ThemePaletteTile
            key={preset.key}
            preset={preset}
            active={preset.key === value}
            onClick={() => onChange(preset.key)}
          />
        ))}
      </div>
    </Card>
  );
}

function ThemePaletteTile({
  preset,
  active,
  onClick,
}: {
  preset: ThemePreset;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`theme-tile ${active ? 'is-active' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`选择主题 ${preset.label}`}
    >
      <span
        className="theme-tile-circle"
        style={{
          background: `linear-gradient(135deg, ${preset.gradientFrom} 0%, ${preset.gradientTo} 100%)`,
        }}
      >
        {active && (
          <span className="theme-tile-check">
            <CheckOutlined />
          </span>
        )}
      </span>
      <span className="theme-tile-label">{preset.label}</span>
    </div>
  );
}
