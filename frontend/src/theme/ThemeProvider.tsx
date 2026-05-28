import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  DEFAULT_STYLE_VERSION,
  DEFAULT_THEME_KEY,
  THEME_PRESETS,
  findPreset,
  rgba,
  type StyleVersion,
  type ThemeKey,
  type ThemePreset,
} from './themePresets';

/**
 * 色彩模式:控制整站底色 / 文字色 / 卡片色调
 *   - light: 默认纯白工作台
 *   - paper: 羊毛纸,米色暖底
 *   - dark : 暗色,深灰底浅文字
 *   - system: 跟随操作系统 prefers-color-scheme
 */
export type ColorMode = 'system' | 'light' | 'paper' | 'dark';
export const DEFAULT_COLOR_MODE: ColorMode = 'light';

/**
 * 主题状态 Context。
 * - themeKey 决定当前主色调,影响 CSS 变量与 ConfigProvider.token.colorPrimary。
 * - styleVersion 决定整体视觉版本(默认 / 渐变),目前先存状态,后续若需要再做样式分支。
 * - colorMode 决定整站底色模式(纯白/羊毛纸/暗色/跟随系统)
 * - 通过 setThemeKey / setStyleVersion / setColorMode 切换并落 localStorage 持久化。
 */
interface ThemeContextValue {
  themeKey: ThemeKey;
  styleVersion: StyleVersion;
  colorMode: ColorMode;
  /** 实际渲染时落到 :root 上的色彩模式(把 system 解析成具体 light/dark) */
  resolvedColorMode: 'light' | 'paper' | 'dark';
  preset: ThemePreset;
  setThemeKey: (key: ThemeKey) => void;
  setStyleVersion: (version: StyleVersion) => void;
  setColorMode: (mode: ColorMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY_THEME = 'lh.theme.key';
const STORAGE_KEY_STYLE = 'lh.theme.styleVersion';
const STORAGE_KEY_COLOR_MODE = 'lh.theme.colorMode';

function readPersistedTheme(): ThemeKey {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_THEME);
    if (!raw) return DEFAULT_THEME_KEY;
    const found = THEME_PRESETS.find((p) => p.key === raw);
    return found ? found.key : DEFAULT_THEME_KEY;
  } catch {
    return DEFAULT_THEME_KEY;
  }
}

function readPersistedStyle(): StyleVersion {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_STYLE);
    if (raw === 'gradient' || raw === 'default') return raw;
    return DEFAULT_STYLE_VERSION;
  } catch {
    return DEFAULT_STYLE_VERSION;
  }
}

function readPersistedColorMode(): ColorMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_COLOR_MODE);
    if (raw === 'system' || raw === 'light' || raw === 'paper' || raw === 'dark') {
      return raw;
    }
    return DEFAULT_COLOR_MODE;
  } catch {
    return DEFAULT_COLOR_MODE;
  }
}

/**
 * 把当前主题色写入 :root 的 CSS 变量,所有页面 / 组件通过 var(--lh-*) 自动跟随。
 * 命名约定:
 *   --lh-primary       主色
 *   --lh-primary-light 浅色二级色,常用于胶囊渐变浅端
 *   --lh-primary-hover 主色 hover 态(略加深)
 *   --lh-primary-bg-* 主色低透明度背景,用于 hover 反馈、图标底色等
 *   --lh-primary-gradient 完整线性渐变,用于横幅/胶囊
 */
function applyThemeVars(
  preset: ThemePreset,
  styleVersion: StyleVersion,
  resolvedColorMode: 'light' | 'paper' | 'dark',
) {
  const root = document.documentElement;
  root.style.setProperty('--lh-primary', preset.primary);
  root.style.setProperty('--lh-primary-light', preset.primaryLight);
  root.style.setProperty('--lh-primary-hover', preset.gradientTo);

  // 多档透明度背景,覆盖原代码里所有 rgba(47, 123, 255, X) 的 alpha 取值
  const alphaSteps: Array<[string, number]> = [
    ['4', 0.04],
    ['5', 0.05],
    ['6', 0.06],
    ['8', 0.08],
    ['10', 0.1],
    ['12', 0.12],
    ['14', 0.14],
    ['18', 0.18],
    ['20', 0.2],
    ['25', 0.25],
    ['28', 0.28],
    ['30', 0.3],
    ['32', 0.32],
    ['35', 0.35],
    ['40', 0.4],
    ['45', 0.45],
    ['50', 0.5],
  ];
  for (const [name, alpha] of alphaSteps) {
    root.style.setProperty(`--lh-primary-bg-${name}`, rgba(preset.primary, alpha));
  }

  // 主色渐变:from -> to,135deg 与原 CSS 一致
  root.style.setProperty(
    '--lh-primary-gradient',
    `linear-gradient(135deg, ${preset.gradientFrom} 0%, ${preset.gradientTo} 100%)`,
  );
  root.style.setProperty(
    '--lh-primary-gradient-h',
    `linear-gradient(90deg, ${preset.gradientFrom} 0%, ${preset.gradientTo} 100%)`,
  );

  // 标识当前样式版本与色彩模式,后续 .lh-style-gradient / .lh-color-dark 等
  // 选择器可以按 data-* 属性进行差异化覆盖
  root.dataset.styleVersion = styleVersion;
  root.dataset.themeKey = preset.key;
  root.dataset.colorMode = resolvedColorMode;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeKey, setThemeKeyState] = useState<ThemeKey>(() => readPersistedTheme());
  const [styleVersion, setStyleVersionState] = useState<StyleVersion>(() => readPersistedStyle());
  const [colorMode, setColorModeState] = useState<ColorMode>(() => readPersistedColorMode());

  const preset = useMemo(() => findPreset(themeKey), [themeKey]);

  // system 模式下读取 prefers-color-scheme,只在 system 时跟随系统变化
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (colorMode !== 'system') return;
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const handler = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    setSystemPrefersDark(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else mq.removeListener(handler);
    };
  }, [colorMode]);

  const resolvedColorMode = useMemo<'light' | 'paper' | 'dark'>(() => {
    if (colorMode === 'system') return systemPrefersDark ? 'dark' : 'light';
    return colorMode;
  }, [colorMode, systemPrefersDark]);

  // 主题或样式或色彩模式变化:写入 CSS 变量 + localStorage 持久化
  useEffect(() => {
    applyThemeVars(preset, styleVersion, resolvedColorMode);
    try {
      window.localStorage.setItem(STORAGE_KEY_THEME, preset.key);
      window.localStorage.setItem(STORAGE_KEY_STYLE, styleVersion);
      window.localStorage.setItem(STORAGE_KEY_COLOR_MODE, colorMode);
    } catch {
      // 隐私模式 / 容量爆满时忽略,主题仍在内存中生效
    }
  }, [preset, styleVersion, colorMode, resolvedColorMode]);

  const setThemeKey = useCallback((key: ThemeKey) => {
    setThemeKeyState(key);
  }, []);

  const setStyleVersion = useCallback((version: StyleVersion) => {
    setStyleVersionState(version);
  }, []);

  const setColorMode = useCallback((mode: ColorMode) => {
    setColorModeState(mode);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeKey,
      styleVersion,
      colorMode,
      resolvedColorMode,
      preset,
      setThemeKey,
      setStyleVersion,
      setColorMode,
    }),
    [
      themeKey,
      styleVersion,
      colorMode,
      resolvedColorMode,
      preset,
      setThemeKey,
      setStyleVersion,
      setColorMode,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** 子组件读取主题状态;在 Provider 外调用会抛错,提示放置位置不对 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme 必须在 ThemeProvider 内调用');
  }
  return ctx;
}
