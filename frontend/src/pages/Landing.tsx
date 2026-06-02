import { useEffect, type ReactNode } from 'react';
import {
  CaretRightOutlined,
  CopyOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  PictureOutlined,
  ReadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { App, Button } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.1.6';
const LOGIN_BASE_URL = 'http://localhost:5173';
const LOGIN_ENDPOINT = '/login';
const LOGIN_URL = `${LOGIN_BASE_URL}${LOGIN_ENDPOINT}`;

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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(LOGIN_URL);
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
            <span className="landing-url-endpoint">{LOGIN_ENDPOINT}</span>
            <button
              type="button"
              className="landing-copy-button"
              onClick={() => void handleCopy()}
              aria-label="复制登录访问地址"
            >
              <CopyOutlined />
            </button>
          </div>

          <div className="landing-actions">
            <Button
              type="primary"
              size="large"
              className="landing-action-button landing-action-primary"
              icon={<CaretRightOutlined />}
              onClick={() => navigate('/login')}
            >
              登录
            </Button>
            <Button
              size="large"
              className="landing-action-button landing-action-secondary"
              icon={<FileTextOutlined />}
              onClick={() => navigate('/login#signup')}
            >
              注册
            </Button>
          </div>

          <section className="landing-support" aria-labelledby="landing-support-title">
            <h2 id="landing-support-title">支持主流数据标注</h2>
            <div className="landing-support-icons">
              <div className="landing-support-item">
                <FileTextOutlined />
                <span>文本</span>
              </div>
              <div className="landing-support-item">
                <PictureOutlined />
                <span>图片</span>
              </div>
              <div className="landing-support-item">
                <VideoCameraOutlined />
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
