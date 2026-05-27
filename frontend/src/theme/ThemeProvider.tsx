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
 * 主题状态 Context。
 * - themeKey 决定当前主色调,影响 CSS 变量与 ConfigProvider.token.colorPrimary。
 * - styleVersion 决定整体视觉版本(默认 / 渐变),目前先存状态,后续若需要再做样式分支。
 * - 通过 setThemeKey / setStyleVersion 切换并落 localStorage 持久化。
 */
interface ThemeContextValue {
  themeKey: ThemeKey;
  styleVersion: StyleVersion;
  preset: ThemePreset;
  setThemeKey: (key: ThemeKey) => void;
  setStyleVersion: (version: StyleVersion) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY_THEME = 'lh.theme.key';
const STORAGE_KEY_STYLE = 'lh.theme.styleVersion';

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

/**
 * 把当前主题色写入 :root 的 CSS 变量,所有页面 / 组件通过 var(--lh-*) 自动跟随。
 * 命名约定:
 *   --lh-primary       主色
 *   --lh-primary-light 浅色二级色,常用于胶囊渐变浅端
 *   --lh-primary-hover 主色 hover 态(略加深)
 *   --lh-primary-bg-* 主色低透明度背景,用于 hover 反馈、图标底色等
 *   --lh-primary-gradient 完整线性渐变,用于横幅/胶囊
 */
function applyThemeVars(preset: ThemePreset, styleVersion: StyleVersion) {
  const root = document.documentElement;
  root.style.setProperty('--lh-primary', preset.primary);
  root.style.setProperty('--lh-primary-light', preset.primaryLight);
  // hover 态:主色再压深 8% 即可,这里用一个简化策略——直接给一个固定深色
  // 为了避免计算复杂度,直接让 hover 等于 gradientTo(企业蓝以外的预设这样即可保持视觉一致)
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

  // 标识当前样式版本,后续若需要 .lh-style-gradient 分支可在 body 上读取
  root.dataset.styleVersion = styleVersion;
  root.dataset.themeKey = preset.key;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeKey, setThemeKeyState] = useState<ThemeKey>(() => readPersistedTheme());
  const [styleVersion, setStyleVersionState] = useState<StyleVersion>(() => readPersistedStyle());

  const preset = useMemo(() => findPreset(themeKey), [themeKey]);

  // 主题或样式变化:写入 CSS 变量 + localStorage 持久化
  useEffect(() => {
    applyThemeVars(preset, styleVersion);
    try {
      window.localStorage.setItem(STORAGE_KEY_THEME, preset.key);
      window.localStorage.setItem(STORAGE_KEY_STYLE, styleVersion);
    } catch {
      // 隐私模式 / 容量爆满时忽略,主题仍在内存中生效
    }
  }, [preset, styleVersion]);

  const setThemeKey = useCallback((key: ThemeKey) => {
    setThemeKeyState(key);
  }, []);

  const setStyleVersion = useCallback((version: StyleVersion) => {
    setStyleVersionState(version);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ themeKey, styleVersion, preset, setThemeKey, setStyleVersion }),
    [themeKey, styleVersion, preset, setThemeKey, setStyleVersion],
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
