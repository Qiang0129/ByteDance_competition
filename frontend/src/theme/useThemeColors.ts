import { useMemo } from 'react';

import { useTheme } from './ThemeProvider';

/**
 * 取出当前主题的 hex 颜色组,用于 antd Progress.strokeColor 等
 * 必须接收字符串字面量(不接受 CSS 变量)的 prop。
 *
 * 直接读 ThemeProvider 暴露的 preset,避免读取 getComputedStyle
 * 后续要触发额外的渲染。
 */
export function useThemeColors() {
  const { preset } = useTheme();
  return useMemo(
    () => ({
      primary: preset.primary,
      primaryLight: preset.primaryLight,
      gradientFrom: preset.gradientFrom,
      gradientTo: preset.gradientTo,
      /** 给 Progress.strokeColor 的 from -> to 渐变对象 */
      progress: { from: preset.gradientFrom, to: preset.gradientTo },
    }),
    [preset],
  );
}
