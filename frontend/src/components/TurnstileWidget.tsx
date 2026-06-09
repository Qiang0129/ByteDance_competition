import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-script';
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileSize = 'normal' | 'compact' | 'flexible';
type TurnstileTheme = 'light' | 'dark' | 'auto';

interface TurnstileRenderOptions {
  sitekey: string;
  theme: TurnstileTheme;
  size: TurnstileSize;
  language: string;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
}

interface WindowTurnstile {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: WindowTurnstile;
  }
}

export interface TurnstileWidgetHandle {
  reset: () => void;
}

interface TurnstileWidgetProps {
  siteKey: string;
  size?: TurnstileSize;
  theme?: TurnstileTheme;
  language?: string;
  className?: string;
  onTokenChange: (token: string | null) => void;
  onExpire?: () => void;
  onError?: () => void;
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Turnstile is not available without window'));
  }
  if (window.turnstile) {
    return Promise.resolve();
  }
  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => {
        scriptPromise = null;
        reject(new Error('Failed to load Turnstile script'));
      }, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => {
      scriptPromise = null;
      reject(new Error('Failed to load Turnstile script'));
    }, { once: true });
    document.head.appendChild(script);
  });

  return scriptPromise;
}

const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  (
    {
      siteKey,
      size = 'normal',
      theme = 'light',
      language = 'zh-CN',
      className,
      onTokenChange,
      onExpire,
      onError,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);
    const callbacksRef = useRef({ onTokenChange, onExpire, onError });
    const [scriptError, setScriptError] = useState(false);

    useEffect(() => {
      callbacksRef.current = { onTokenChange, onExpire, onError };
    }, [onTokenChange, onExpire, onError]);

    useImperativeHandle(ref, () => ({
      reset() {
        callbacksRef.current.onTokenChange(null);
        if (window.turnstile && widgetIdRef.current) {
          window.turnstile.reset(widgetIdRef.current);
        }
      },
    }), []);

    useEffect(() => {
      let cancelled = false;
      setScriptError(false);
      callbacksRef.current.onTokenChange(null);

      void loadTurnstileScript()
        .then(() => {
          if (cancelled || !window.turnstile || !containerRef.current) {
            return;
          }

          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            theme,
            size,
            language,
            callback: (token) => {
              callbacksRef.current.onTokenChange(token);
            },
            'expired-callback': () => {
              callbacksRef.current.onTokenChange(null);
              callbacksRef.current.onExpire?.();
            },
            'error-callback': () => {
              callbacksRef.current.onTokenChange(null);
              callbacksRef.current.onError?.();
            },
          });
        })
        .catch(() => {
          if (!cancelled) {
            setScriptError(true);
            callbacksRef.current.onTokenChange(null);
            callbacksRef.current.onError?.();
          }
        });

      return () => {
        cancelled = true;
        if (window.turnstile && widgetIdRef.current) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      };
    }, [language, siteKey, size, theme]);

    return (
      <div className={['turnstile-widget', className].filter(Boolean).join(' ')}>
        <div ref={containerRef} className="turnstile-widget-frame" />
        {scriptError ? (
          <div className="turnstile-widget-error">人机验证加载失败，请检查网络后刷新</div>
        ) : null}
      </div>
    );
  },
);

TurnstileWidget.displayName = 'TurnstileWidget';

export default TurnstileWidget;
