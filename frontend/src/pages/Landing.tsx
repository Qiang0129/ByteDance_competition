import {
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  CopyOutlined,
  InfoCircleOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import { App, Button } from 'antd';
import ReactMarkdown from 'react-markdown';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import readmeSource from '../../../README.md?raw';
import imageIconUrl from '../../images/图片.svg';
import loginIconUrl from '../../images/登陆账号.svg';
import signupIconUrl from '../../images/注册账号.svg';
import textIconUrl from '../../images/文本.svg';
import videoIconUrl from '../../images/视频.svg';

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.1.6';
const LOGIN_BASE_URL = 'http://localhost:5173';
const LOGIN_ENDPOINTS = ['/login', '/login#signup'] as const;
const LOGIN_ENDPOINT_CYCLE = [...LOGIN_ENDPOINTS, LOGIN_ENDPOINTS[0]];
const ENDPOINT_SWITCH_INTERVAL = 4000;
const LANDING_ROUTE_ANIMATION_MS = 500;
const PUBLIC_NAV_ANIMATION_MS = 360;

type PublicNavKey = 'home' | 'docs' | 'about';
type LandingTransitionKind = 'login' | 'signup';

type LandingRouteTransition = {
  kind: LandingTransitionKind;
  target: string;
  x: number;
  y: number;
};

const navItems: Array<{ key: PublicNavKey; label: string; path: string }> = [
  { key: 'home', label: '首页', path: '/' },
  { key: 'docs', label: '文档', path: '/docs' },
  { key: 'about', label: '关于', path: '/about' },
];

type ReadmeHeading = {
  id: string;
  text: string;
  level: number;
};

const README_HEADINGS = createReadmeHeadings(readmeSource);

function normalizeHeadingText(text: string) {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]/g, '')
    .trim();
}

function createHeadingBaseId(text: string) {
  const base = normalizeHeadingText(text)
    .trim()
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+=[\]{}|\\:;"'<>,.?/]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return base || 'section';
}

function createHeadingId(text: string, occurrence = 1) {
  const base = createHeadingBaseId(text);
  return occurrence > 1 ? `${base}-${occurrence}` : base;
}

function createReadmeHeadings(source: string): ReadmeHeading[] {
  const counts = new Map<string, number>();
  return source
    .split(/\r?\n/)
    .map((line) => {
      const match = /^(#{2,3})\s+(.+)$/.exec(line.trim());
      if (!match) return null;

      const text = normalizeHeadingText(match[2]);
      const level = match[1].length;
      const key = `${level}:${createHeadingBaseId(text)}`;
      const occurrence = (counts.get(key) ?? 0) + 1;
      counts.set(key, occurrence);

      return {
        id: createHeadingId(text, occurrence),
        text,
        level,
      };
    })
    .filter((item): item is ReadmeHeading => Boolean(item));
}

function getNodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(getNodeText).join('');
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return getNodeText(node.props.children);
  }
  return '';
}

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function usePublicPageClass() {
  useEffect(() => {
    document.documentElement.classList.add('lh-public-page');
    return () => {
      document.documentElement.classList.remove('lh-public-page');
    };
  }, []);
}

function PublicHeader({ activeKey }: { activeKey: PublicNavKey }) {
  const navigate = useNavigate();
  const location = useLocation();
  const navTimerRef = useRef<number | null>(null);
  const [navTransition, setNavTransition] = useState<PublicNavKey | null>(null);

  useEffect(() => {
    return () => {
      if (navTimerRef.current !== null) {
        window.clearTimeout(navTimerRef.current);
      }
    };
  }, []);

  const handleNavClick = (event: MouseEvent<HTMLAnchorElement>, item: (typeof navItems)[number]) => {
    if (item.key !== 'about' || location.pathname === item.path || !isPlainLeftClick(event)) {
      return;
    }

    event.preventDefault();
    if (navTransition !== null) {
      return;
    }

    setNavTransition(item.key);
    navTimerRef.current = window.setTimeout(() => {
      navigate(item.path);
      navTimerRef.current = null;
    }, PUBLIC_NAV_ANIMATION_MS);
  };

  return (
    <>
      <header className="landing-header">
        <Link to="/" className="landing-brand" aria-label="Label Hub 首页">
          <span className="landing-logo-mark">LH</span>
          <span className="landing-brand-name">Label Hub</span>
        </Link>

        <nav className="landing-nav" aria-label="公开页导航">
          {navItems.map((item) => (
            <Link
              key={item.key}
              to={item.path}
              className={`landing-nav-link${activeKey === item.key ? ' is-active' : ''}`}
              onClick={(event) => handleNavClick(event, item)}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="landing-version-pill" aria-label={`当前版本 ${APP_VERSION}`}>
          <span className="landing-version-dot">L</span>
          <span>v{APP_VERSION}</span>
        </div>
      </header>
      {navTransition ? (
        <div className="landing-nav-transition" aria-hidden="true">
          <span />
        </div>
      ) : null}
    </>
  );
}

function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-footer-main">
        <span>© 2026 SCU-肖强. 版权所有</span>
        <span>
          设计与开发由{' '}
          <a
            className="landing-footer-link"
            href="https://github.com/Qiang0129/ByteDance_competition"
            target="_blank"
            rel="noreferrer"
          >
            肖强
          </a>
          {' | '}
          <a
            className="landing-footer-link"
            href="https://openai.com/zh-Hans-CN/codex/"
            target="_blank"
            rel="noreferrer"
          >
            Codex
          </a>
          {' | '}
          <a
            className="landing-footer-link"
            href="https://claude.com/"
            target="_blank"
            rel="noreferrer"
          >
            Claude
          </a>
        </span>
      </div>
      <div className="landing-footer-record">
        <a
          className="landing-footer-record-link"
          href="https://beian.miit.gov.cn/#/Integrated/recordQuery"
          target="_blank"
          rel="noreferrer"
        >
          Copyright © SCU-肖强 | 蜀ICP备2026020302号-1
        </a>
      </div>
    </footer>
  );
}

export default function Landing() {
  usePublicPageClass();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const resetFrameRef = useRef<number | null>(null);
  const resetReleaseFrameRef = useRef<number | null>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const transitionLockRef = useRef(false);
  const [endpointStep, setEndpointStep] = useState(0);
  const [isEndpointResetting, setIsEndpointResetting] = useState(false);
  const [routeTransition, setRouteTransition] = useState<LandingRouteTransition | null>(null);
  const currentEndpoint = LOGIN_ENDPOINTS[endpointStep % LOGIN_ENDPOINTS.length];
  const currentLoginUrl = `${LOGIN_BASE_URL}${currentEndpoint}`;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setEndpointStep((previousStep) => previousStep + 1);
    }, ENDPOINT_SWITCH_INTERVAL);

    return () => {
      window.clearInterval(timer);
      if (resetFrameRef.current !== null) {
        window.cancelAnimationFrame(resetFrameRef.current);
      }
      if (resetReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(resetReleaseFrameRef.current);
      }
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  const handleEndpointTransitionEnd = () => {
    if (endpointStep !== LOGIN_ENDPOINTS.length) {
      return;
    }

    setIsEndpointResetting(true);
    setEndpointStep(0);
    resetFrameRef.current = window.requestAnimationFrame(() => {
      resetReleaseFrameRef.current = window.requestAnimationFrame(() => {
        setIsEndpointResetting(false);
        resetFrameRef.current = null;
        resetReleaseFrameRef.current = null;
      });
    });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentLoginUrl);
      message.success('访问地址已复制');
    } catch {
      message.warning('当前浏览器不支持自动复制，请手动复制地址');
    }
  };

  const handleRouteTransition = (
    event: MouseEvent<HTMLElement>,
    target: string,
    kind: LandingTransitionKind,
  ) => {
    if (transitionLockRef.current) {
      return;
    }

    transitionLockRef.current = true;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    setRouteTransition({ kind, target, x, y });
    transitionTimerRef.current = window.setTimeout(() => {
      navigate(target);
      transitionTimerRef.current = null;
    }, LANDING_ROUTE_ANIMATION_MS);
  };

  return (
    <main className={`landing-page${routeTransition ? ' is-route-transitioning' : ''}`}>
      <PublicHeader activeKey="home" />

      <section className="landing-hero" aria-labelledby="landing-title">
        <span className="landing-hero-glow landing-hero-glow-indigo" aria-hidden />
        <span className="landing-hero-glow landing-hero-glow-teal" aria-hidden />

        <div className="landing-hero-content">
          <h1 id="landing-title" className="landing-title">
            <span>Ai Agent</span>
            <span className="landing-title-shine">Label Hub 数据标注平台</span>
          </h1>

          <p className="landing-subtitle">
            更好的体验，更高的效率，只需要访问下面网址
          </p>

          <div className="landing-url-pill" role="group" aria-label="登录访问地址">
            <span className="landing-url-text">{LOGIN_BASE_URL}</span>
            <span
              className="landing-url-endpoint"
              aria-live="polite"
              aria-label={`当前入口路径 ${currentEndpoint}`}
            >
              <span
                className={`landing-url-endpoint-track${isEndpointResetting ? ' is-resetting' : ''}`}
                style={{ transform: `translateY(calc(-${endpointStep} * var(--landing-url-row-height)))` }}
                onTransitionEnd={handleEndpointTransitionEnd}
                aria-hidden="true"
              >
                {LOGIN_ENDPOINT_CYCLE.map((endpoint, index) => (
                  <span className="landing-url-endpoint-item" key={`${endpoint}-${index}`}>
                    {endpoint}
                  </span>
                ))}
              </span>
            </span>
            <button
              type="button"
              className="landing-copy-button"
              onClick={() => void handleCopy()}
              aria-label={`复制访问地址 ${currentLoginUrl}`}
            >
              <CopyOutlined />
            </button>
          </div>

          <div className="landing-actions">
            <Button
              type="primary"
              size="large"
              className={`landing-action-button landing-action-primary${
                routeTransition?.kind === 'login' ? ' is-transition-source' : ''
              }`}
              icon={<img className="landing-action-icon" src={loginIconUrl} alt="" aria-hidden="true" />}
              onClick={(event) => handleRouteTransition(event, '/login', 'login')}
            >
              登录
            </Button>
            <Button
              size="large"
              className={`landing-action-button landing-action-secondary${
                routeTransition?.kind === 'signup' ? ' is-transition-source' : ''
              }`}
              icon={<img className="landing-action-icon" src={signupIconUrl} alt="" aria-hidden="true" />}
              onClick={(event) => handleRouteTransition(event, '/login#signup', 'signup')}
            >
              注册
            </Button>
          </div>

          <section className="landing-support" aria-labelledby="landing-support-title">
            <h2 id="landing-support-title">支持主流数据标注</h2>
            <div className="landing-support-icons">
              <div className="landing-support-item">
                <img className="landing-support-icon" src={textIconUrl} alt="" aria-hidden="true" />
                <span>文本</span>
              </div>
              <div className="landing-support-item">
                <img className="landing-support-icon" src={imageIconUrl} alt="" aria-hidden="true" />
                <span>图片</span>
              </div>
              <div className="landing-support-item">
                <img className="landing-support-icon" src={videoIconUrl} alt="" aria-hidden="true" />
                <span>视频</span>
              </div>
            </div>
          </section>
        </div>
      </section>

      <LandingFooter />
      {routeTransition ? (
        <div
          className={`landing-route-transition landing-route-transition-${routeTransition.kind}`}
          style={
            {
              '--landing-transition-x': `${routeTransition.x}px`,
              '--landing-transition-y': `${routeTransition.y}px`,
            } as CSSProperties
          }
          aria-hidden="true"
        />
      ) : null}
    </main>
  );
}

function PublicPlaceholderPage({
  activeKey,
  icon,
  title,
  description,
}: {
  activeKey: PublicNavKey;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  usePublicPageClass();
  const location = useLocation();

  return (
    <main className="landing-page landing-placeholder-page">
      <PublicHeader activeKey={activeKey} />
      <section className="landing-placeholder" aria-labelledby="placeholder-title">
        <div className="landing-placeholder-icon">{icon}</div>
        <p className="landing-placeholder-path">{location.pathname}</p>
        <h1 id="placeholder-title">{title}</h1>
        <p>{description}</p>
        <Link className="landing-placeholder-back" to="/">
          返回首页
        </Link>
      </section>
      <LandingFooter />
    </main>
  );
}

export function DocsPlaceholder() {
  return (
    <PublicPlaceholderPage
      activeKey="docs"
      icon={<ReadOutlined />}
      title="文档中心建设中"
      description="这里已预留 Label Hub 文档入口，后续可接入使用说明、接口说明和部署文档。"
    />
  );
}

export function AboutPlaceholder() {
  const readmeBodyRef = useRef<HTMLDivElement | null>(null);
  const tocRef = useRef<HTMLElement | null>(null);
  const { message } = App.useApp();
  const [activeReadmeHeadingId, setActiveReadmeHeadingId] = useState(README_HEADINGS[0]?.id ?? '');
  const intro = useMemo(() => {
    const lines = readmeSource.split(/\r?\n/);
    const firstParagraph = lines.find((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('```');
    });
    return firstParagraph ?? 'Label Hub 是一个面向数据标注协作流程的 Web 平台。';
  }, []);
  const getMarkdownHeadingId = (children: ReactNode) => {
    const text = getNodeText(children);
    return createHeadingId(text);
  };

  const findReadmeHeadingElement = (headingId: string) => {
    const container = readmeBodyRef.current;
    if (!container) {
      return null;
    }

    return Array.from(container.querySelectorAll<HTMLElement>('[data-readme-heading-id]')).find(
      (element) => element.dataset.readmeHeadingId === headingId,
    ) ?? null;
  };

  const scrollToReadmeHeading = (
    heading: ReadmeHeading,
    behavior: ScrollBehavior = 'smooth',
    updateHash = true,
  ) => {
    const container = readmeBodyRef.current;
    const target = findReadmeHeadingElement(heading.id);
    if (!container || !target) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = container.scrollTop + targetRect.top - containerRect.top - 20;
    container.scrollTo({ top: Math.max(nextTop, 0), behavior });
    setActiveReadmeHeadingId(heading.id);

    if (updateHash) {
      window.history.replaceState(null, '', `#${heading.id}`);
    }

    const toc = tocRef.current;
    const escapedHeadingId =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(heading.id)
        : heading.id.replace(/"/g, '\\"');
    const activeLink = toc?.querySelector<HTMLAnchorElement>(`a[href="#${escapedHeadingId}"]`);
    activeLink?.scrollIntoView({ block: 'nearest', behavior });
  };

  const handleReadmeTocClick = (event: MouseEvent<HTMLAnchorElement>, heading: ReadmeHeading) => {
    event.preventDefault();
    scrollToReadmeHeading(heading);
  };

  const handleCopyCodeBlock = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const codeBlock = event.currentTarget
      .closest('.landing-about-code-block')
      ?.querySelector('pre');
    const codeText = codeBlock?.textContent ?? '';

    if (!codeText.trim()) {
      message.warning('当前代码块没有可复制内容');
      return;
    }

    try {
      await navigator.clipboard.writeText(codeText);
      message.success('代码已复制');
    } catch {
      message.warning('当前浏览器不支持自动复制，请手动复制代码');
    }
  };

  useEffect(() => {
    const hashText = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    if (!hashText) {
      return;
    }

    const targetHeading = README_HEADINGS.find(
      (heading) => heading.id === hashText || heading.text === hashText,
    );
    if (!targetHeading) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollToReadmeHeading(targetHeading, 'auto', false);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    const container = readmeBodyRef.current;
    if (!container) {
      return;
    }

    let frameId: number | null = null;
    const updateActiveHeading = () => {
      frameId = null;
      const tocHeadingIds = new Set(README_HEADINGS.map((heading) => heading.id));
      const headings = Array.from(
        container.querySelectorAll<HTMLElement>('[data-readme-heading-id]'),
      ).filter((heading) => {
        const headingId = heading.dataset.readmeHeadingId;
        return Boolean(headingId && tocHeadingIds.has(headingId));
      });
      if (headings.length === 0) {
        return;
      }

      const containerTop = container.getBoundingClientRect().top;
      let nextActiveId = headings[0].dataset.readmeHeadingId ?? '';
      for (const heading of headings) {
        const offset = heading.getBoundingClientRect().top - containerTop;
        if (offset <= 32) {
          nextActiveId = heading.dataset.readmeHeadingId ?? nextActiveId;
        } else {
          break;
        }
      }

      setActiveReadmeHeadingId((previousId) => (
        previousId === nextActiveId ? previousId : nextActiveId
      ));
    };

    const handleScroll = () => {
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(updateActiveHeading);
    };

    updateActiveHeading();
    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  usePublicPageClass();

  return (
    <main className="landing-page landing-about-page">
      <PublicHeader activeKey="about" />

      <section className="landing-about-hero" aria-labelledby="about-title">
        <span className="landing-hero-glow landing-hero-glow-indigo" aria-hidden />
        <span className="landing-hero-glow landing-hero-glow-teal" aria-hidden />

        <div className="landing-about-hero-inner">
          <div className="landing-about-kicker">
            <InfoCircleOutlined />
            <span>About Label Hub</span>
          </div>
          <h1 id="about-title">关于 Label Hub</h1>
          <p>{intro}</p>
          <div className="landing-about-summary-grid" aria-label="平台能力摘要">
            <article>
              <span>协作角色</span>
              <strong>Owner / Labeler / Reviewer</strong>
              <p>覆盖任务创建、认领、标注、审核和角色切换的核心协作链路。</p>
            </article>
            <article>
              <span>技术栈</span>
              <strong>React + Spring Boot</strong>
              <p>前端使用 Vite 与 Ant Design，后端使用 Java 21 与 Spring Boot。</p>
            </article>
            <article>
              <span>AI 扩展</span>
              <strong>Agent 预审流程</strong>
              <p>预留并接入 AI 预审、模型配置和独立 Worker 的演进方向。</p>
            </article>
          </div>
        </div>
      </section>

      <section className="landing-about-docs" aria-labelledby="about-readme-title">
        <div className="landing-about-docs-shell">
          <aside className="landing-about-toc" aria-label="README 目录" ref={tocRef}>
            <div className="landing-about-toc-title">README</div>
            <nav>
              {README_HEADINGS.map((heading) => (
                <a
                  key={`${heading.id}-${heading.text}`}
                  className={`landing-about-toc-link landing-about-toc-level-${heading.level}${
                    activeReadmeHeadingId === heading.id ? ' is-active' : ''
                  }`}
                  href={`#${heading.id}`}
                  onClick={(event) => handleReadmeTocClick(event, heading)}
                >
                  {heading.text}
                </a>
              ))}
            </nav>
          </aside>

          <article className="landing-about-readme" aria-labelledby="about-readme-title">
            <div className="landing-about-readme-header">
              <span>Repository README</span>
              <h2 id="about-readme-title">项目说明文档</h2>
              <p>以下内容直接来自仓库根目录 README.md，便于公开页与项目文档保持同步。</p>
            </div>
            <div className="landing-about-readme-body" ref={readmeBodyRef} tabIndex={0}>
              <div className="landing-about-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children, node: _node, ...props }) => {
                      const id = getMarkdownHeadingId(children);
                      return (
                        <h1 {...props} id={id} data-readme-heading-id={id}>
                          {children}
                        </h1>
                      );
                    },
                    h2: ({ children, node: _node, ...props }) => {
                      const id = getMarkdownHeadingId(children);
                      return (
                        <h2 {...props} id={id} data-readme-heading-id={id}>
                          {children}
                        </h2>
                      );
                    },
                    h3: ({ children, node: _node, ...props }) => {
                      const id = getMarkdownHeadingId(children);
                      return (
                        <h3 {...props} id={id} data-readme-heading-id={id}>
                          {children}
                        </h3>
                      );
                    },
                    a: ({ children, href, node: _node, ...props }) => (
                      <a
                        href={href}
                        target={href?.startsWith('http') ? '_blank' : undefined}
                        rel={href?.startsWith('http') ? 'noreferrer' : undefined}
                        {...props}
                      >
                        {children}
                      </a>
                    ),
                    table: ({ children, node: _node, ...props }) => (
                      <div className="landing-about-table-scroll">
                        <table {...props}>{children}</table>
                      </div>
                    ),
                    pre: ({ children, node: _node, ...props }) => (
                      <div className="landing-about-code-block">
                        <button
                          type="button"
                          className="landing-about-code-copy"
                          onClick={handleCopyCodeBlock}
                          aria-label="复制代码块"
                          title="复制代码块"
                        >
                          <CopyOutlined />
                        </button>
                        <pre {...props}>{children}</pre>
                      </div>
                    ),
                  }}
                >
                  {readmeSource}
                </ReactMarkdown>
              </div>
            </div>
          </article>
        </div>
      </section>

      <LandingFooter />
    </main>
  );
}
