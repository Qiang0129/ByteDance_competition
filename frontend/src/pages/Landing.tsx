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
  ApiOutlined,
  ArrowLeftOutlined,
  CopyOutlined,
  DownloadOutlined,
  FileTextOutlined,
  FileWordOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  GithubOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PictureOutlined,
  ReadOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { App, Button } from 'antd';
import { renderAsync } from 'docx-preview';
import ReactMarkdown from 'react-markdown';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import architectureSource from '../../../docs/architecture.md?raw';
import apiDocsSource from '../../../docs/api-docs.md?raw';
import demoScriptSource from '../../../docs/demo-script.md?raw';
import stateMachineSource from '../../../docs/state-machine.md?raw';
import submissionDemoSource from '../../../submission/demo-video.md?raw';
import interfaceDocsSource from '../../../接口文档.md?raw';
import readmeSource from '../../../README.md?raw';
import phaseImplementationSource from '../../../阶段实现.md?raw';
import phasePlanSource from '../../../阶段计划.md?raw';
import courseRequirementDocxUrl from '../../../LabelHub 数据标注平台 · AI全栈课题实现要求.docx?url';
import englishImplementationPlanDocxUrl from '../../../LabelHub_Project_Implementation_Plan_EN.docx?url';
import implementationPlanDocxUrl from '../../../项目实施计划书.docx?url';
import docsCenterPreviewUrl from '../../images/文档中心.png';
import imageIconUrl from '../../images/图片.svg';
import loginIconUrl from '../../images/登陆账号.svg';
import signupIconUrl from '../../images/注册账号.svg';
import textIconUrl from '../../images/文本.svg';
import videoIconUrl from '../../images/视频.svg';
import '../styles/landing-docs.css';

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.1.6';
const LOGIN_BASE_URL = 'http://localhost:5173';
const LOGIN_ENDPOINTS = ['/login', '/login#signup'] as const;
const LOGIN_ENDPOINT_CYCLE = [...LOGIN_ENDPOINTS, LOGIN_ENDPOINTS[0]];
const ENDPOINT_SWITCH_INTERVAL = 4000;
const LANDING_ROUTE_ANIMATION_MS = 500;
const PUBLIC_NAV_ANIMATION_MS = 360;
const DOCS_FULLSCREEN_ANIMATION_MS = 320;

type PublicNavKey = 'home' | 'docs' | 'about';
type LandingTransitionKind = 'login' | 'signup';

type LandingRouteTransition = {
  kind: LandingTransitionKind;
  target: string;
  x: number;
  y: number;
};

type DocsCategoryKey = 'project' | 'technical' | 'demo' | 'coding' | 'external';
type DocsResourceKind = 'markdown' | 'docx' | 'image' | 'external' | 'missing';
type DocsPanelMode = 'categories' | 'resources';
type DocsPanelTransition = 'forward' | 'back';
type DocsFullscreenTransition = 'entering' | 'leaving' | null;

type DocsResource = {
  id: string;
  category: DocsCategoryKey;
  title: string;
  description: string;
  kind: DocsResourceKind;
  status: 'available' | 'missing' | 'external';
  badge: string;
  source?: string;
  fileUrl?: string;
  externalUrl?: string;
  downloadName?: string;
  meta?: string;
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

type ReadmeTocGroup = {
  heading: ReadmeHeading;
  children: ReadmeHeading[];
};

const README_HEADINGS = createReadmeHeadings(readmeSource);
const README_TOC_GROUPS = createReadmeTocGroups(README_HEADINGS);
const README_PARENT_HEADING_ID_BY_ID = createReadmeParentHeadingIdMap(README_TOC_GROUPS);
const SWAGGER_URL = 'http://127.0.0.1:8080/swagger-ui/index.html';

const docsCategories: Array<{ key: DocsCategoryKey; label: string; description: string }> = [
  { key: 'project', label: '项目资料', description: '计划书、课题要求与项目总览' },
  { key: 'technical', label: '技术文档', description: '架构、状态机与关键技术点' },
  { key: 'demo', label: '演示素材', description: '演示脚本、Demo 截图与视频记录' },
  { key: 'coding', label: 'AI Coding 记录', description: '阶段计划、实现和接口记录' },
  { key: 'external', label: '外部接口', description: 'Swagger 与外部调试入口' },
];

const docsResources: DocsResource[] = [
  {
    id: 'implementation-plan-docx',
    category: 'project',
    title: '项目实施计划书.docx',
    description: '项目实施计划、阶段目标和交付范围的 Word 原文档。',
    kind: 'docx',
    status: 'available',
    badge: 'DOCX',
    fileUrl: implementationPlanDocxUrl,
    downloadName: '项目实施计划书.docx',
    meta: '根目录',
  },
  {
    id: 'course-requirement-docx',
    category: 'project',
    title: 'AI 全栈课题实现要求',
    description: 'LabelHub 数据标注平台课题要求原始 Word 文档。',
    kind: 'docx',
    status: 'available',
    badge: 'DOCX',
    fileUrl: courseRequirementDocxUrl,
    downloadName: 'LabelHub 数据标注平台 · AI全栈课题实现要求.docx',
    meta: '根目录',
  },
  {
    id: 'implementation-plan-en-docx',
    category: 'project',
    title: 'Implementation Plan EN',
    description: '英文版项目实施计划文档，便于对外交付和说明。',
    kind: 'docx',
    status: 'available',
    badge: 'DOCX',
    fileUrl: englishImplementationPlanDocxUrl,
    downloadName: 'LabelHub_Project_Implementation_Plan_EN.docx',
    meta: '根目录',
  },
  {
    id: 'basic-tech-docx',
    category: 'project',
    title: '基础技术文档.docx',
    description: '基础技术文档资源尚未放入仓库，保留预览与下载接入位置。',
    kind: 'missing',
    status: 'missing',
    badge: '待补充',
    meta: '待补充',
  },
  {
    id: 'readme',
    category: 'project',
    title: 'README.md',
    description: '仓库根目录说明文档，包含项目状态、环境要求和启动方式。',
    kind: 'markdown',
    status: 'available',
    badge: 'MD',
    source: readmeSource,
    downloadName: 'README.md',
    meta: '根目录',
  },
  {
    id: 'architecture',
    category: 'technical',
    title: '架构说明',
    description: '系统架构说明入口，后续可继续补充架构图和模块边界。',
    kind: 'markdown',
    status: 'available',
    badge: 'MD',
    source: architectureSource,
    downloadName: 'architecture.md',
    meta: 'docs/architecture.md',
  },
  {
    id: 'architecture-diagram',
    category: 'technical',
    title: '系统架构图',
    description: '架构图图片资源尚未放入仓库，保留图片预览入口。',
    kind: 'missing',
    status: 'missing',
    badge: '待补充',
    meta: '图片资源',
  },
  {
    id: 'state-machine',
    category: 'technical',
    title: '状态机与核心流程',
    description: '任务状态、审核流转和协作流程说明。',
    kind: 'markdown',
    status: 'available',
    badge: 'MD',
    source: stateMachineSource,
    downloadName: 'state-machine.md',
    meta: 'docs/state-machine.md',
  },
  {
    id: 'api-docs-local',
    category: 'technical',
    title: 'API 文档说明',
    description: '本地 API 文档说明 Markdown，Swagger 入口在外部接口分类中打开。',
    kind: 'markdown',
    status: 'available',
    badge: 'MD',
    source: apiDocsSource,
    downloadName: 'api-docs.md',
    meta: 'docs/api-docs.md',
  },
  {
    id: 'demo-script',
    category: 'demo',
    title: 'Demo 演示脚本',
    description: '演示路径、讲解顺序和录制说明。',
    kind: 'markdown',
    status: 'available',
    badge: 'MD',
    source: demoScriptSource,
    downloadName: 'demo-script.md',
    meta: 'docs/demo-script.md',
  },
  {
    id: 'demo-video-record',
    category: 'demo',
    title: 'Demo 视频记录',
    description: 'Demo 视频与提交材料记录入口。',
    kind: 'markdown',
    status: 'available',
    badge: 'MD',
    source: submissionDemoSource,
    downloadName: 'demo-video.md',
    meta: 'submission/demo-video.md',
  },
  {
    id: 'demo-screenshots',
    category: 'demo',
    title: 'Demo 截图',
    description: 'Demo 截图资源尚未放入仓库，保留截图集预览入口。',
    kind: 'missing',
    status: 'missing',
    badge: '待补充',
    meta: '图片资源',
  },
  {
    id: 'phase-plan',
    category: 'coding',
    title: '阶段计划.md',
    description: 'AI Coding 过程中的阶段计划与实施前记录。',
    kind: 'markdown',
    status: 'available',
    badge: 'MD',
    source: phasePlanSource,
    downloadName: '阶段计划.md',
    meta: '根目录',
  },
  {
    id: 'phase-implementation',
    category: 'coding',
    title: '阶段实现.md',
    description: 'AI Coding 过程中的阶段实现记录。',
    kind: 'markdown',
    status: 'available',
    badge: 'MD',
    source: phaseImplementationSource,
    downloadName: '阶段实现.md',
    meta: '根目录',
  },
  {
    id: 'interface-docs',
    category: 'coding',
    title: '接口文档.md',
    description: '前后端接口记录，同时提供 Swagger 外部入口。',
    kind: 'markdown',
    status: 'available',
    badge: 'MD + Swagger',
    source: interfaceDocsSource,
    externalUrl: SWAGGER_URL,
    downloadName: '接口文档.md',
    meta: '根目录',
  },
  {
    id: 'swagger',
    category: 'external',
    title: 'Swagger UI',
    description: '后端 OpenAPI 调试和接口浏览入口。',
    kind: 'external',
    status: 'external',
    badge: 'HTTP',
    externalUrl: SWAGGER_URL,
    meta: '127.0.0.1:8080',
  },
];

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

function createReadmeTocGroups(headings: ReadmeHeading[]): ReadmeTocGroup[] {
  const groups: ReadmeTocGroup[] = [];
  let currentGroup: ReadmeTocGroup | null = null;

  headings.forEach((heading) => {
    if (heading.level === 2) {
      currentGroup = { heading, children: [] };
      groups.push(currentGroup);
      return;
    }

    if (heading.level === 3 && currentGroup) {
      currentGroup.children.push(heading);
    }
  });

  return groups;
}

function createReadmeParentHeadingIdMap(groups: ReadmeTocGroup[]) {
  const parentByHeadingId = new Map<string, string>();

  groups.forEach((group) => {
    parentByHeadingId.set(group.heading.id, group.heading.id);
    group.children.forEach((child) => {
      parentByHeadingId.set(child.id, group.heading.id);
    });
  });

  return parentByHeadingId;
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
    if (location.pathname === item.path || !isPlainLeftClick(event)) {
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
      navigate(target, {
        state: {
          fromLandingAuthTransition: true,
          authTransitionKind: kind,
        },
      });
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
  const { message } = App.useApp();
  const docsPreviewRef = useRef<HTMLElement | null>(null);
  const docsWorkbenchRef = useRef<HTMLElement | null>(null);
  const docsFullscreenTimerRef = useRef<number | null>(null);
  const [activeCategory, setActiveCategory] = useState<DocsCategoryKey>('project');
  const [activeResourceId, setActiveResourceId] = useState(docsResources[0]?.id ?? '');
  const [docsPanelMode, setDocsPanelMode] = useState<DocsPanelMode>('categories');
  const [docsPanelTransition, setDocsPanelTransition] = useState<DocsPanelTransition>('forward');
  const [pendingDocsQuickScroll, setPendingDocsQuickScroll] = useState(false);
  const [isDocsSidebarCollapsed, setIsDocsSidebarCollapsed] = useState(false);
  const [isDocsPreviewFullscreen, setIsDocsPreviewFullscreen] = useState(false);
  const [docsFullscreenTransition, setDocsFullscreenTransition] = useState<DocsFullscreenTransition>(null);
  const activeResource = docsResources.find((resource) => resource.id === activeResourceId) ?? docsResources[0];
  const visibleResources = docsResources.filter((resource) => resource.category === activeCategory);
  const activeCategoryMeta = docsCategories.find((category) => category.key === activeCategory) ?? docsCategories[0];

  usePublicPageClass();

  const clearDocsFullscreenTimer = () => {
    if (docsFullscreenTimerRef.current !== null) {
      window.clearTimeout(docsFullscreenTimerRef.current);
      docsFullscreenTimerRef.current = null;
    }
  };

  const startDocsPreviewFullscreenEnter = () => {
    clearDocsFullscreenTimer();
    setIsDocsPreviewFullscreen(true);
    setDocsFullscreenTransition('entering');
    message.success('全屏模式');
    docsFullscreenTimerRef.current = window.setTimeout(() => {
      setDocsFullscreenTransition(null);
      docsFullscreenTimerRef.current = null;
    }, DOCS_FULLSCREEN_ANIMATION_MS);
  };

  const startDocsPreviewFullscreenExit = () => {
    clearDocsFullscreenTimer();
    setDocsFullscreenTransition('leaving');
    message.success('退出全屏');
    docsFullscreenTimerRef.current = window.setTimeout(() => {
      setIsDocsPreviewFullscreen(false);
      setDocsFullscreenTransition(null);
      docsFullscreenTimerRef.current = null;
    }, DOCS_FULLSCREEN_ANIMATION_MS);
  };

  useEffect(() => () => clearDocsFullscreenTimer(), []);

  useEffect(() => {
    if (
      !pendingDocsQuickScroll ||
      activeCategory !== 'technical' ||
      activeResourceId !== 'api-docs-local' ||
      docsPanelMode !== 'resources'
    ) {
      return;
    }

    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        docsWorkbenchRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
        setPendingDocsQuickScroll(false);
      });
    });

    return () => window.cancelAnimationFrame(firstFrame);
  }, [activeCategory, activeResourceId, docsPanelMode, pendingDocsQuickScroll]);

  useEffect(() => {
    const handleDocsFullscreenKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isDocsPreviewFullscreen || docsFullscreenTransition === 'leaving') {
        return;
      }

      event.preventDefault();
      startDocsPreviewFullscreenExit();
    };

    window.addEventListener('keydown', handleDocsFullscreenKeyDown);
    return () => window.removeEventListener('keydown', handleDocsFullscreenKeyDown);
  }, [docsFullscreenTransition, isDocsPreviewFullscreen]);

  const selectCategory = (category: DocsCategoryKey) => {
    setActiveCategory(category);
    const firstResource = docsResources.find((resource) => resource.category === category);
    if (firstResource) {
      setActiveResourceId(firstResource.id);
    }
    setDocsPanelTransition('forward');
    setDocsPanelMode('resources');
  };

  const backToCategories = () => {
    setDocsPanelTransition('back');
    setDocsPanelMode('categories');
  };

  const handleDownload = () => {
    if (!activeResource.fileUrl && !activeResource.source) {
      return;
    }

    message.loading('正在下载', 1.2);
    downloadDocsResource(activeResource);
  };

  const handleQuickStart = () => {
    setPendingDocsQuickScroll(true);
    setActiveCategory('technical');
    setActiveResourceId('api-docs-local');
    setDocsPanelTransition('forward');
    setDocsPanelMode('resources');
  };

  const toggleDocsPreviewFullscreen = () => {
    if (docsFullscreenTransition) {
      return;
    }

    if (isDocsPreviewFullscreen) {
      startDocsPreviewFullscreenExit();
      return;
    }

    startDocsPreviewFullscreenEnter();
  };

  return (
    <main className={`landing-page landing-docs-page${isDocsPreviewFullscreen ? ' is-docs-preview-fullscreen' : ''}`}>
      <PublicHeader activeKey="docs" />

      <section className="landing-docs-hero" aria-labelledby="docs-title">
        <div className="landing-docs-hero-inner">
          <div className="landing-docs-hero-content">
            <div className="landing-docs-hero-badge">
              <span className="landing-docs-hero-badge-dot" aria-hidden />
              <span>数据标注文档中心</span>
            </div>
            <h1 id="docs-title">
              沉淀项目文档，管理数据资产，
              <br />
              连接 <span>标注.</span>
            </h1>
            <div className="landing-docs-hero-actions" aria-label="文档中心快捷入口">
              <button className="landing-docs-hero-action is-primary" type="button" onClick={handleQuickStart}>
                <ReadOutlined />
                <span>快速开始</span>
              </button>
              <a
                className="landing-docs-hero-action"
                href="https://github.com/Qiang0129/ByteDance_competition"
                target="_blank"
                rel="noreferrer"
              >
                <GithubOutlined />
                <span>GitHub</span>
              </a>
              <a
                className="landing-docs-hero-action"
                href="http://127.0.0.1:8080/swagger-ui/index.html"
                target="_blank"
                rel="noreferrer"
              >
                <LinkOutlined />
                <span>Swagger</span>
              </a>
            </div>
          </div>

          <img
            className="landing-docs-hero-screenshot"
            src={docsCenterPreviewUrl}
            alt=""
            aria-hidden="true"
          />
        </div>
      </section>

      <section
        id="docs-workbench"
        ref={docsWorkbenchRef}
        className={`landing-docs-workbench${isDocsSidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}
        aria-label="文档浏览工作台"
      >
        <aside className="landing-docs-sidebar" aria-label="文档分类">
          <div className="landing-docs-sidebar-header">
            <div className="landing-docs-sidebar-title">
              {docsPanelMode === 'resources' ? activeCategoryMeta.label : '资源分类'}
            </div>
            <button
              type="button"
              className="landing-docs-sidebar-toggle"
              onClick={() => setIsDocsSidebarCollapsed((value) => !value)}
              aria-label={isDocsSidebarCollapsed ? '展开文档侧边栏' : '收起文档侧边栏'}
              aria-expanded={!isDocsSidebarCollapsed}
              title={isDocsSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            >
              {isDocsSidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>
          </div>
          {!isDocsSidebarCollapsed ? (
            <div
              key={docsPanelMode}
              className={`landing-docs-panel landing-docs-panel-${docsPanelMode} is-${docsPanelTransition}`}
            >
              {docsPanelMode === 'categories' ? (
                <>
                  <nav className="landing-docs-category-list" aria-label="资源分类">
                    {docsCategories.map((category) => {
                      const categoryResources = docsResources.filter((resource) => resource.category === category.key);
                      return (
                        <button
                          key={category.key}
                          type="button"
                          className={`landing-docs-category${activeCategory === category.key ? ' is-active' : ''}`}
                          onClick={() => selectCategory(category.key)}
                        >
                          <span>{category.label}</span>
                          <small>{category.description}</small>
                          <em>{categoryResources.length}</em>
                        </button>
                      );
                    })}
                  </nav>
                </>
              ) : (
                <>
                  <div className="landing-docs-resource-panel-head">
                    <button type="button" className="landing-docs-back-button" onClick={backToCategories}>
                      <ArrowLeftOutlined />
                      返回
                    </button>
                    <div>
                      <span>{activeCategoryMeta.label}</span>
                      <small>{activeCategoryMeta.description}</small>
                    </div>
                    <strong>{visibleResources.length}</strong>
                  </div>
                  <div className="landing-docs-resource-list landing-docs-resource-list-in-sidebar">
                    {visibleResources.map((resource) => (
                      <button
                        key={resource.id}
                        type="button"
                        className={`landing-docs-resource${activeResource.id === resource.id ? ' is-active' : ''}${
                          resource.status === 'missing' ? ' is-missing' : ''
                        }`}
                        onClick={() => setActiveResourceId(resource.id)}
                      >
                        <span className="landing-docs-resource-icon" aria-hidden="true">
                          {getDocsResourceIcon(resource.kind)}
                        </span>
                        <span className="landing-docs-resource-text">
                          <strong>{resource.title}</strong>
                          <small>{resource.description}</small>
                        </span>
                        <span className="landing-docs-resource-badge">{resource.badge}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </aside>

        <article
          ref={docsPreviewRef}
          className={`landing-docs-preview${isDocsPreviewFullscreen ? ' is-fullscreen' : ''}${
            docsFullscreenTransition ? ` is-fullscreen-${docsFullscreenTransition}` : ''
          }`}
          aria-labelledby="docs-preview-title"
        >
          <header className="landing-docs-preview-head">
            <div>
              <span className="landing-docs-preview-kicker">{activeResource.meta}</span>
              <h2 id="docs-preview-title">{activeResource.title}</h2>
              <p>{activeResource.description}</p>
            </div>
            <div className="landing-docs-preview-actions">
              <button
                type="button"
                className="landing-docs-action-link landing-docs-fullscreen-button"
                onClick={toggleDocsPreviewFullscreen}
                aria-label={isDocsPreviewFullscreen ? '退出全屏观看文档' : '全屏观看文档'}
                title={isDocsPreviewFullscreen ? '退出全屏' : '全屏观看'}
              >
                {isDocsPreviewFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                {isDocsPreviewFullscreen ? '退出全屏' : '全屏'}
              </button>
              {activeResource.externalUrl ? (
                <a
                  className="landing-docs-action-link"
                  href={activeResource.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <LinkOutlined />
                  打开外部链接
                </a>
              ) : null}
              {activeResource.status !== 'missing' && (activeResource.fileUrl || activeResource.source) ? (
                <button
                  type="button"
                  className="landing-docs-action-link"
                  onClick={handleDownload}
                >
                  <DownloadOutlined />
                  下载
                </button>
              ) : null}
            </div>
          </header>

          <div className="landing-docs-preview-body">
            <DocsPreview resource={activeResource} />
          </div>
        </article>
      </section>

      <LandingFooter />
    </main>
  );
}

function DocsPreview({ resource }: { resource: DocsResource }) {
  if (resource.status === 'missing') {
    return <MissingDocsPreview resource={resource} />;
  }

  if (resource.kind === 'markdown') {
    return (
      <div className="landing-docs-markdown landing-about-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
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
          }}
        >
          {resource.source ?? ''}
        </ReactMarkdown>
      </div>
    );
  }

  if (resource.kind === 'docx' && resource.fileUrl) {
    return <DocxPreviewPane resource={resource} />;
  }

  if (resource.kind === 'image' && resource.fileUrl) {
    return (
      <div className="landing-docs-image-preview">
        <img src={resource.fileUrl} alt={resource.title} />
      </div>
    );
  }

  if (resource.kind === 'external' && resource.externalUrl) {
    return (
      <div className="landing-docs-external-preview">
        <ApiOutlined />
        <h3>外部接口文档</h3>
        <p>Swagger UI 由后端服务提供。为了避免 iframe 跨域或安全策略限制，这里使用新标签页打开。</p>
        <a href={resource.externalUrl} target="_blank" rel="noreferrer">
          打开 Swagger UI
        </a>
      </div>
    );
  }

  return <MissingDocsPreview resource={resource} />;
}

function DocxPreviewPane({ resource }: { resource: DocsResource }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !resource.fileUrl) {
      return undefined;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFallback = false;
    let animationFrame = 0;
    let nestedAnimationFrame = 0;
    const getDocxPageFrames = () => {
      const directPages = Array.from(container.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement && child.matches('section.landing-docx-rendered'),
      );

      directPages.forEach((page) => {
        const frame = document.createElement('div');
        frame.className = 'landing-docx-page-frame';
        container.insertBefore(frame, page);
        frame.appendChild(page);
      });

      return Array.from(container.querySelectorAll<HTMLElement>('.landing-docx-page-frame'));
    };

    const updateDocxScale = () => {
      const previewBody = container.closest<HTMLElement>('.landing-docs-preview-body');
      const pageFrames = getDocxPageFrames();
      if (!previewBody || pageFrames.length === 0) {
        return;
      }

      const pageSizes = pageFrames
        .map((frame) => {
          const page = frame.querySelector<HTMLElement>('section.landing-docx-rendered');
          if (!page) {
            return null;
          }
          const width = page.scrollWidth || page.offsetWidth || page.getBoundingClientRect().width;
          const height = page.scrollHeight || page.offsetHeight || page.getBoundingClientRect().height;
          return width && height ? { frame, width, height } : null;
        })
        .filter((size): size is { frame: HTMLElement; width: number; height: number } => Boolean(size));

      if (pageSizes.length === 0) {
        return;
      }

      const sourcePageWidth = Math.max(...pageSizes.map((size) => size.width));
      const availableWidth = Math.max(previewBody.clientWidth - 56, 320);
      const scale = Math.min(1.45, availableWidth / sourcePageWidth);
      container.style.setProperty('--landing-docx-page-width', `${sourcePageWidth}px`);
      container.style.setProperty('--landing-docx-scale', scale.toFixed(4));

      pageSizes.forEach(({ frame, width, height }) => {
        frame.style.width = `${Math.ceil(width * scale)}px`;
        frame.style.height = `${Math.ceil(height * scale)}px`;
        frame.style.setProperty('--landing-docx-page-source-width', `${width}px`);
        frame.style.setProperty('--landing-docx-page-source-height', `${height}px`);
      });
    };

    const observeDocxWidth = () => {
      const previewBody = container.closest<HTMLElement>('.landing-docs-preview-body');
      updateDocxScale();

      if (previewBody && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(updateDocxScale);
        resizeObserver.observe(previewBody);
        return;
      }

      resizeFallback = true;
      window.addEventListener('resize', updateDocxScale);
    };

    setLoading(true);
    setError(null);
    container.style.setProperty('--landing-docx-scale', '1');
    container.style.removeProperty('--landing-docx-page-width');
    container.innerHTML = '';

    fetch(resource.fileUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((buffer) => renderAsync(buffer, container, undefined, {
        className: 'landing-docx-rendered',
        inWrapper: false,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: true,
      }))
      .then(() => {
        if (!cancelled) {
          setLoading(false);
          animationFrame = window.requestAnimationFrame(() => {
            nestedAnimationFrame = window.requestAnimationFrame(() => {
              if (!cancelled) {
                observeDocxWidth();
              }
            });
          });
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) {
          return;
        }
        container.innerHTML = '';
        setError(reason instanceof Error ? reason.message : 'DOCX 预览加载失败');
        setLoading(false);
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (resizeFallback) {
        window.removeEventListener('resize', updateDocxScale);
      }
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (nestedAnimationFrame) {
        window.cancelAnimationFrame(nestedAnimationFrame);
      }
    };
  }, [resource.fileUrl, retryKey]);

  return (
    <div className="landing-docs-docx-preview">
      {loading ? (
        <div className="landing-docs-preview-state">
          <ReadOutlined />
          <span>正在渲染 Word 文档...</span>
        </div>
      ) : null}
      {error ? (
        <div className="landing-docs-preview-state is-error">
          <FileWordOutlined />
          <strong>DOCX 预览失败</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setRetryKey((value) => value + 1)}>
            <ReloadOutlined />
            重试
          </button>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className={`landing-docs-docx-canvas${loading || error ? ' is-hidden' : ''}`}
      />
    </div>
  );
}

function MissingDocsPreview({ resource }: { resource: DocsResource }) {
  return (
    <div className="landing-docs-missing-preview">
      <ReadOutlined />
      <h3>{resource.title} 待补充</h3>
      <p>{resource.description}</p>
      <span>资源放入仓库并补充 manifest 后即可在这里预览和下载。</span>
    </div>
  );
}

function getDocsResourceIcon(kind: DocsResourceKind) {
  if (kind === 'docx') return <FileWordOutlined />;
  if (kind === 'image') return <PictureOutlined />;
  if (kind === 'external') return <ApiOutlined />;
  if (kind === 'missing') return <InfoCircleOutlined />;
  return <FileTextOutlined />;
}

function downloadDocsResource(resource: DocsResource) {
  const link = document.createElement('a');
  const filename = resource.downloadName ?? resource.title;

  if (resource.fileUrl) {
    link.href = resource.fileUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    return;
  }

  if (resource.source) {
    const blob = new Blob([resource.source], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
}

export function AboutPlaceholder() {
  const readmeBodyRef = useRef<HTMLDivElement | null>(null);
  const tocRef = useRef<HTMLElement | null>(null);
  const { message } = App.useApp();
  const [activeReadmeHeadingId, setActiveReadmeHeadingId] = useState(README_HEADINGS[0]?.id ?? '');
  const [isReadmeTocCollapsed, setIsReadmeTocCollapsed] = useState(false);
  const [expandedReadmeHeadingIds, setExpandedReadmeHeadingIds] = useState<Set<string>>(
    () => new Set(),
  );
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
    const parentHeadingId = README_PARENT_HEADING_ID_BY_ID.get(heading.id);
    if (parentHeadingId && parentHeadingId !== heading.id) {
      setExpandedReadmeHeadingIds((previousIds) => {
        if (previousIds.has(parentHeadingId)) {
          return previousIds;
        }
        const nextIds = new Set(previousIds);
        nextIds.add(parentHeadingId);
        return nextIds;
      });
    }

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

    if (heading.level === 2) {
      const group = README_TOC_GROUPS.find((item) => item.heading.id === heading.id);
      if (!group || group.children.length === 0) {
        scrollToReadmeHeading(heading);
        return;
      }

      setExpandedReadmeHeadingIds((previousIds) => {
        const nextIds = new Set(previousIds);
        if (nextIds.has(heading.id)) {
          nextIds.delete(heading.id);
        } else {
          nextIds.add(heading.id);
        }
        return nextIds;
      });
      return;
    }

    scrollToReadmeHeading(heading);

    const parentHeadingId = README_PARENT_HEADING_ID_BY_ID.get(heading.id);
    if (parentHeadingId) {
      setExpandedReadmeHeadingIds((previousIds) => {
        if (previousIds.has(parentHeadingId)) {
          return previousIds;
        }
        const nextIds = new Set(previousIds);
        nextIds.add(parentHeadingId);
        return nextIds;
      });
    }
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

      const parentHeadingId = README_PARENT_HEADING_ID_BY_ID.get(nextActiveId);
      if (parentHeadingId && parentHeadingId !== nextActiveId) {
        setExpandedReadmeHeadingIds((previousIds) => {
          if (previousIds.has(parentHeadingId)) {
            return previousIds;
          }
          const nextIds = new Set(previousIds);
          nextIds.add(parentHeadingId);
          return nextIds;
        });
      }
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
        <div
          className={`landing-about-docs-shell${
            isReadmeTocCollapsed ? ' is-toc-collapsed' : ''
          }`}
        >
          <aside className="landing-about-toc" aria-label="README 目录" ref={tocRef}>
            <div className="landing-about-toc-header">
              <div className="landing-about-toc-title">README</div>
              <button
                type="button"
                className="landing-about-toc-toggle"
                aria-label={isReadmeTocCollapsed ? '展开 README 目录' : '收起 README 目录'}
                aria-expanded={!isReadmeTocCollapsed}
                title={isReadmeTocCollapsed ? '展开目录' : '收起目录'}
                onClick={() => setIsReadmeTocCollapsed((collapsed) => !collapsed)}
              >
                {isReadmeTocCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              </button>
            </div>
            <nav className="landing-about-toc-nav" aria-hidden={isReadmeTocCollapsed}>
              {README_TOC_GROUPS.map((group) => {
                const isExpanded = expandedReadmeHeadingIds.has(group.heading.id);
                const isActiveGroup =
                  activeReadmeHeadingId === group.heading.id ||
                  group.children.some((child) => child.id === activeReadmeHeadingId);

                return (
                  <div
                    key={group.heading.id}
                    className={`landing-about-toc-group${isExpanded ? ' is-expanded' : ''}`}
                  >
                    <a
                      className={`landing-about-toc-link landing-about-toc-level-2${
                        activeReadmeHeadingId === group.heading.id ? ' is-active' : ''
                      }${isActiveGroup ? ' is-active-group' : ''}${
                        group.children.length > 0 ? ' has-children' : ''
                      }`}
                      href={`#${group.heading.id}`}
                      tabIndex={isReadmeTocCollapsed ? -1 : undefined}
                      aria-expanded={group.children.length > 0 ? isExpanded : undefined}
                      onClick={(event) => handleReadmeTocClick(event, group.heading)}
                    >
                      <span>{group.heading.text}</span>
                    </a>
                    {group.children.length > 0 ? (
                      <div className="landing-about-toc-children" aria-hidden={!isExpanded}>
                        <div className="landing-about-toc-children-inner">
                          {group.children.map((heading) => (
                            <a
                              key={`${heading.id}-${heading.text}`}
                              className={`landing-about-toc-link landing-about-toc-level-3${
                                activeReadmeHeadingId === heading.id ? ' is-active' : ''
                              }`}
                              href={`#${heading.id}`}
                              tabIndex={isReadmeTocCollapsed || !isExpanded ? -1 : undefined}
                              onClick={(event) => handleReadmeTocClick(event, heading)}
                            >
                              {heading.text}
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
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
