/**
 * 主题色预设 + 样式版本。
 * 主题色覆盖:整站主色 (`--lh-primary`) + 渐变 (`--lh-primary-gradient`),
 * 同时通过 ConfigProvider.token.colorPrimary 让 antd 组件自动适配。
 *
 * 11 个色卡参考用户提供的设计稿,色值与命名贴合后台风格。
 */

export type ThemeKey =
  | 'enterprise'
  | 'galaxy'
  | 'midnight'
  | 'amber'
  | 'jade'
  | 'sunset'
  | 'mystic'
  | 'ocean'
  | 'forest'
  | 'rose'
  | 'graphite'
  | 'mint';

export type StyleVersion = 'default' | 'gradient';

export interface ThemePreset {
  key: ThemeKey;
  label: string;
  /** 主色 */
  primary: string;
  /** 浅色二级色,渐变浅端用 */
  primaryLight: string;
  /** 用作大色块/横幅渐变的两端 */
  gradientFrom: string;
  gradientTo: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    key: 'enterprise',
    label: '企业蓝',
    primary: '#2f7bff',
    primaryLight: '#6fb6ff',
    gradientFrom: '#6fb6ff',
    gradientTo: '#2f7bff',
  },
  {
    key: 'galaxy',
    label: '银河黑',
    primary: '#111827',
    primaryLight: '#374151',
    gradientFrom: '#1f2937',
    gradientTo: '#030712',
  },
  {
    key: 'midnight',
    label: '深夜蓝',
    primary: '#1e3a8a',
    primaryLight: '#3b82f6',
    gradientFrom: '#1e40af',
    gradientTo: '#0c1d4f',
  },
  {
    key: 'amber',
    label: '琥珀金',
    primary: '#c0820c',
    primaryLight: '#f59e0b',
    gradientFrom: '#f59e0b',
    gradientTo: '#c0820c',
  },
  {
    key: 'jade',
    label: '翡翠绿',
    primary: '#059669',
    primaryLight: '#34d399',
    gradientFrom: '#34d399',
    gradientTo: '#059669',
  },
  {
    key: 'sunset',
    label: '夕阳橙',
    primary: '#ea580c',
    primaryLight: '#fb923c',
    gradientFrom: '#fb923c',
    gradientTo: '#ea580c',
  },
  {
    key: 'mystic',
    label: '魅紫梦影',
    primary: '#7c3aed',
    primaryLight: '#a78bfa',
    gradientFrom: '#a78bfa',
    gradientTo: '#7c3aed',
  },
  {
    key: 'ocean',
    label: '海洋蓝',
    primary: '#0284c7',
    primaryLight: '#38bdf8',
    gradientFrom: '#38bdf8',
    gradientTo: '#0284c7',
  },
  {
    key: 'forest',
    label: '松林绿',
    primary: '#15803d',
    primaryLight: '#4ade80',
    gradientFrom: '#4ade80',
    gradientTo: '#15803d',
  },
  {
    key: 'rose',
    label: '玫瑰粉',
    primary: '#e11d48',
    primaryLight: '#fb7185',
    gradientFrom: '#fb7185',
    gradientTo: '#e11d48',
  },
  {
    key: 'graphite',
    label: '石板灰',
    primary: '#475569',
    primaryLight: '#94a3b8',
    gradientFrom: '#94a3b8',
    gradientTo: '#475569',
  },
  {
    key: 'mint',
    label: '极光青',
    primary: '#0d9488',
    primaryLight: '#5eead4',
    gradientFrom: '#5eead4',
    gradientTo: '#0d9488',
  },
];

export const DEFAULT_THEME_KEY: ThemeKey = 'enterprise';
export const DEFAULT_STYLE_VERSION: StyleVersion = 'gradient';

export function findPreset(key: ThemeKey): ThemePreset {
  return THEME_PRESETS.find((p) => p.key === key) ?? THEME_PRESETS[0];
}

/** 把 hex 转成 rgba 串,便于在 CSS 里组合不透明度 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace('#', '');
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  const num = parseInt(full, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
