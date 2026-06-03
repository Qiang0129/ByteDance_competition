import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CopyOutlined,
  InfoCircleOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import { App, Button } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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

type PublicNavKey = 'home' | 'docs' | 'about';

const navItems: Array<{ key: PublicNavKey; label: string; path: string }> = [
  { key: 'home', label: '首页', path: '/' },
  { key: 'docs', label: '文档', path: '/docs' },
  { key: 'about', label: '关于', path: '/about' },
];

function usePublicPageClass() {
  useEffect(() => {
    document.documentElement.classList.add('lh-public-page');
    return () => {
      document.documentElement.classList.remove('lh-public-page');
    };
  }, []);
}

function PublicHeader({ activeKey }: { activeKey: PublicNavKey }) {
  return (
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
  );
}

function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-footer-main">
        <span>© 2026 SCU-肖强. 版权所有</span>
        <span>
          设计与开发由 <strong>肖强 | Codex | Claude</strong>
        </span>
      </div>
      <div className="landing-footer-record">
        Copyright © SCU-肖强 | 蜀ICP备2026020302号-1
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
  const [endpointStep, setEndpointStep] = useState(0);
  const [isEndpointResetting, setIsEndpointResetting] = useState(false);
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

  return (
    <main className="landing-page">
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
              className="landing-action-button landing-action-primary"
              icon={<img className="landing-action-icon" src={loginIconUrl} alt="" aria-hidden="true" />}
              onClick={() => navigate('/login')}
            >
              登录
            </Button>
            <Button
              size="large"
              className="landing-action-button landing-action-secondary"
              icon={<img className="landing-action-icon" src={signupIconUrl} alt="" aria-hidden="true" />}
              onClick={() => navigate('/login#signup')}
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
  return (
    <PublicPlaceholderPage
      activeKey="about"
      icon={<InfoCircleOutlined />}
      title="关于 Label Hub"
      description="这里已预留系统介绍入口，后续可展示平台定位、核心能力和团队信息。"
    />
  );
}
