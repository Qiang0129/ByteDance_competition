import {
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
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
} from '@ant-design/icons';
import { App, Button } from 'antd';
import { parseAsync, renderDocument } from 'docx-preview';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import architectureSource from '../../../docs/architecture.md?raw';
import apiDocsSource from '../../../docs/api-docs.md?raw';
import demoScriptSource from '../../../docs/demo-script.md?raw';
import stateMachineSource from '../../../docs/state-machine.md?raw';
import submissionDemoSource from '../../../submission/demo-video.md?raw';
import readmeSource from '../../../README.md?raw';
import courseRequirementDocxUrl from '../../../LabelHub 数据标注平台 · AI全栈课题实现要求.docx?url';
import englishImplementationPlanDocxUrl from '../../../LabelHub_Project_Implementation_Plan_EN.docx?url';
import implementationPlanDocxUrl from '../../../项目实施计划书.docx?url';
import architectureDiagramUrl from '../../../submission/screenshots/系统架构图.png?url';
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
const ABOUT_README_PREVIEWED_STORAGE_KEY = 'labelhub.about.readme.previewed';

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
type DocsPanelMode = 'categories' | 'resources' | 'document-toc';
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
  loadSource?: () => Promise<string>;
  fileUrl?: string;
  externalUrl?: string;
  downloadName?: string;
  meta?: string;
};

type DocsPreviewStatus = 'idle' | 'loading' | 'success' | 'error';
type DocsPreviewStage = 'prepare' | 'fetch' | 'parse' | 'render' | 'layout' | 'done';

type DocsPreviewState = {
  status: DocsPreviewStatus;
  stage: DocsPreviewStage;
  progress?: number;
  runId?: number;
  error?: string;
};

type DocsPreviewCache =
  | { kind: 'markdown'; source: string; headings?: MarkdownHeading[]; tocGroups?: MarkdownTocGroup[] }
  | { kind: 'image' }
  | {
      kind: 'docx';
      html: string;
      scale: string;
      pageWidth: string;
    };

type DocsPreviewStageMeta = {
  key: DocsPreviewStage;
  label: string;
};

type MarkdownRawModule = {
  default: string;
};

type MarkdownVirtualBlock = {
  id: string;
  content: string;
};

type MarkdownVirtualBlockOffset = {
  id: string;
  top: number;
  height: number;
};

type DocsPreviewProgressTimer = {
  runId: number;
  intervalId?: number;
  completionTimeoutId?: number;
  startedAt: number;
};

type MarkdownHeading = {
  id: string;
  text: string;
  level: number;
  lineIndex: number;
};

type MarkdownTocGroup = {
  heading: MarkdownHeading;
  children: MarkdownHeading[];
};

type MarkdownOutline = {
  source: string;
  headings: MarkdownHeading[];
  tocGroups: MarkdownTocGroup[];
  parentHeadingIdById: Map<string, string>;
};

const DOCX_PREVIEW_OPTIONS = {
  className: 'landing-docx-rendered',
  inWrapper: false,
  ignoreWidth: false,
  ignoreHeight: false,
  breakPages: true,
};

const docsPreviewIdleState: DocsPreviewState = {
  status: 'idle',
  stage: 'prepare',
};

const docsPreviewStages: DocsPreviewStageMeta[] = [
  { key: 'prepare', label: '准备预览' },
  { key: 'fetch', label: '下载文件' },
  { key: 'parse', label: '解析文档' },
  { key: 'render', label: '生成页面' },
  { key: 'layout', label: '完成布局' },
  { key: 'done', label: '预览完成' },
];

const MARKDOWN_VIRTUAL_THRESHOLD = 80 * 1024;
const MARKDOWN_BLOCK_TARGET_CHARS = 6000;
const MARKDOWN_VIRTUAL_OVERSCAN = 4;
const MARKDOWN_HEIGHT_MEASURE_TOLERANCE = 4;
const MIN_LARGE_MARKDOWN_PROGRESS_MS = 1500;
const MARKDOWN_MAX_LOADING_PROGRESS = 96;
const MARKDOWN_PROGRESS_INTERVAL_MS = 120;
const MARKDOWN_PROGRESS_STAGE_STOPS: Array<{ stage: DocsPreviewStage; progress: number }> = [
  { stage: 'prepare', progress: 8 },
  { stage: 'fetch', progress: 28 },
  { stage: 'parse', progress: 52 },
  { stage: 'render', progress: 76 },
  { stage: 'layout', progress: 92 },
];
const DOCS_IMAGE_ZOOM_DEFAULT = 1;
const DOCS_IMAGE_ZOOM_MIN = 0.5;
const DOCS_IMAGE_ZOOM_MAX = 4;
const DOCS_IMAGE_ZOOM_STEP = 1.16;
const DOCS_IMAGE_WHEEL_DELTA_UNIT = 100;
const DOCS_IMAGE_PREVIEW_PADDING = 32;
const DOCS_IMAGE_BASE_MAX_HEIGHT = 620;

type DocsImageSize = {
  width: number;
  height: number;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getNextDocsImageZoom(currentZoom: number, deltaY: number) {
  if (deltaY === 0) {
    return currentZoom;
  }

  const stepCount = clampNumber(-deltaY / DOCS_IMAGE_WHEEL_DELTA_UNIT, -4, 4);
  const nextZoom = currentZoom * Math.pow(DOCS_IMAGE_ZOOM_STEP, stepCount);

  return Number(clampNumber(nextZoom, DOCS_IMAGE_ZOOM_MIN, DOCS_IMAGE_ZOOM_MAX).toFixed(3));
}

const docsMarkdownRemarkPlugins = [remarkGfm];
const docsMarkdownComponents: Components = {
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
};

const loadPhasePlanSource = () => import('../../../阶段计划.md?raw').then((module: MarkdownRawModule) => module.default);
const loadPhaseImplementationSource = () =>
  import('../../../阶段实现.md?raw').then((module: MarkdownRawModule) => module.default);
const loadInterfaceDocsSource = () =>
  import('../../../接口文档.md?raw').then((module: MarkdownRawModule) => module.default);

const navItems: Array<{ key: PublicNavKey; label: string; path: string }> = [
  { key: 'home', label: '首页', path: '/' },
  { key: 'docs', label: '文档', path: '/docs' },
  { key: 'about', label: '关于', path: '/about' },
];

type ReadmeHeading = MarkdownHeading;
type ReadmeTocGroup = MarkdownTocGroup;

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
    description: 'LabelHub 系统架构图图片预览。',
    kind: 'image',
    status: 'available',
    badge: 'PNG',
    fileUrl: architectureDiagramUrl,
    downloadName: '系统架构图.png',
    meta: 'submission/screenshots',
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
    loadSource: loadPhasePlanSource,
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
    loadSource: loadPhaseImplementationSource,
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
    loadSource: loadInterfaceDocsSource,
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

function createMarkdownHeadings(source: string): MarkdownHeading[] {
  const counts = new Map<string, number>();
  return source
    .split(/\r?\n/)
    .map((line, lineIndex) => {
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
        lineIndex,
      };
    })
    .filter((item): item is MarkdownHeading => Boolean(item));
}

function createMarkdownTocGroups(headings: MarkdownHeading[]): MarkdownTocGroup[] {
  const groups: MarkdownTocGroup[] = [];
  let currentGroup: MarkdownTocGroup | null = null;

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

function createMarkdownParentHeadingIdMap(groups: MarkdownTocGroup[]) {
  const parentByHeadingId = new Map<string, string>();

  groups.forEach((group) => {
    parentByHeadingId.set(group.heading.id, group.heading.id);
    group.children.forEach((child) => {
      parentByHeadingId.set(child.id, group.heading.id);
    });
  });

  return parentByHeadingId;
}

function createReadmeHeadings(source: string): ReadmeHeading[] {
  return createMarkdownHeadings(source);
}

function createReadmeTocGroups(headings: ReadmeHeading[]): ReadmeTocGroup[] {
  return createMarkdownTocGroups(headings);
}

function createReadmeParentHeadingIdMap(groups: ReadmeTocGroup[]) {
  return createMarkdownParentHeadingIdMap(groups);
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
            更好的体验，更高的效率，只需要访问以下网址
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
  const docsPreviewCacheRef = useRef<Record<string, DocsPreviewCache>>({});
  const docsQuickPreviewTimersRef = useRef<Record<string, number>>({});
  const docsPreviewProgressTimersRef = useRef<Record<string, DocsPreviewProgressTimer>>({});
  const docsMarkdownTocOpenedResourceIdsRef = useRef<Set<string>>(new Set());
  const docsPreviewRunSequenceRef = useRef(0);
  const [activeCategory, setActiveCategory] = useState<DocsCategoryKey>('project');
  const [activeResourceId, setActiveResourceId] = useState(docsResources[0]?.id ?? '');
  const [docsPanelMode, setDocsPanelMode] = useState<DocsPanelMode>('categories');
  const [docsPanelTransition, setDocsPanelTransition] = useState<DocsPanelTransition>('forward');
  const [activeMarkdownHeadingIdByResourceId, setActiveMarkdownHeadingIdByResourceId] = useState<Record<string, string>>({});
  const [expandedMarkdownHeadingIdsByResourceId, setExpandedMarkdownHeadingIdsByResourceId] = useState<Record<string, string[]>>({});
  const [pendingDocsQuickScroll, setPendingDocsQuickScroll] = useState(false);
  const [isDocsSidebarCollapsed, setIsDocsSidebarCollapsed] = useState(false);
  const [isDocsPreviewFullscreen, setIsDocsPreviewFullscreen] = useState(false);
  const [isDocsFullscreenTocCollapsed, setIsDocsFullscreenTocCollapsed] = useState(false);
  const [docsFullscreenTransition, setDocsFullscreenTransition] = useState<DocsFullscreenTransition>(null);
  const [docsPreviewStates, setDocsPreviewStates] = useState<Record<string, DocsPreviewState>>({});
  const activeResource = docsResources.find((resource) => resource.id === activeResourceId) ?? docsResources[0];
  const visibleResources = docsResources.filter((resource) => resource.category === activeCategory);
  const activeCategoryMeta = docsCategories.find((category) => category.key === activeCategory) ?? docsCategories[0];
  const activePreviewState = docsPreviewStates[activeResource.id] ?? docsPreviewIdleState;
  const activePreviewCache = docsPreviewCacheRef.current[activeResource.id];
  const activeMarkdownOutline = useMemo(
    () => getDocsMarkdownOutline(activeResource, activePreviewState, activePreviewCache),
    [activePreviewCache, activePreviewState, activeResource],
  );
  const activeMarkdownHeadingId = activeMarkdownOutline
    ? activeMarkdownHeadingIdByResourceId[activeResource.id] ?? activeMarkdownOutline.headings[0]?.id
    : undefined;
  const activeMarkdownHeading = activeMarkdownOutline?.headings.find((heading) => heading.id === activeMarkdownHeadingId)
    ?? activeMarkdownOutline?.headings[0];
  const activeMarkdownSectionSource = activeMarkdownOutline && activeMarkdownHeading
    ? extractMarkdownSection(activeMarkdownOutline.source, activeMarkdownHeading, activeMarkdownOutline.headings)
    : undefined;
  const expandedMarkdownHeadingIds = useMemo(
    () => new Set(expandedMarkdownHeadingIdsByResourceId[activeResource.id] ?? []),
    [activeResource.id, expandedMarkdownHeadingIdsByResourceId],
  );

  usePublicPageClass();

  const clearDocsQuickPreviewTimer = (resourceId: string) => {
    const timer = docsQuickPreviewTimersRef.current[resourceId];
    if (timer === undefined) {
      return;
    }

    window.clearTimeout(timer);
    delete docsQuickPreviewTimersRef.current[resourceId];
  };

  const clearDocsPreviewProgressTimer = (resourceId: string, runId?: number) => {
    const timer = docsPreviewProgressTimersRef.current[resourceId];
    if (!timer) {
      return;
    }
    if (runId !== undefined && timer.runId !== runId) {
      return;
    }

    if (timer.intervalId !== undefined) {
      window.clearInterval(timer.intervalId);
    }
    if (timer.completionTimeoutId !== undefined) {
      window.clearTimeout(timer.completionTimeoutId);
    }
    delete docsPreviewProgressTimersRef.current[resourceId];
  };

  const cancelDocsPreview = (resourceId: string) => {
    clearDocsQuickPreviewTimer(resourceId);
    clearDocsPreviewProgressTimer(resourceId);
    setDocsPreviewStates((previousStates) => ({
      ...previousStates,
      [resourceId]: docsPreviewIdleState,
    }));
  };

  const setDocsPreviewProgress = (
    resourceId: string,
    runId: number,
    nextState: Pick<DocsPreviewState, 'stage' | 'progress'>,
  ) => {
    setDocsPreviewStates((previousStates) => {
      const currentState = previousStates[resourceId];
      if (currentState?.status !== 'loading' || currentState.runId !== runId) {
        return previousStates;
      }

      const progress = Math.min(
        MARKDOWN_MAX_LOADING_PROGRESS,
        Math.max(currentState.progress ?? 0, nextState.progress ?? 0),
      );

      return {
        ...previousStates,
        [resourceId]: {
          ...currentState,
          stage: nextState.stage,
          progress,
        },
      };
    });
  };

  const startMarkdownPreviewProgress = (resourceId: string, runId: number) => {
    clearDocsPreviewProgressTimer(resourceId);

    const startedAt = window.performance.now();
    setDocsPreviewProgress(resourceId, runId, getMarkdownPreviewProgressState(0));

    const intervalId = window.setInterval(() => {
      const timer = docsPreviewProgressTimersRef.current[resourceId];
      const elapsed = timer ? window.performance.now() - timer.startedAt : 0;
      setDocsPreviewProgress(resourceId, runId, getMarkdownPreviewProgressState(elapsed));
    }, MARKDOWN_PROGRESS_INTERVAL_MS);

    docsPreviewProgressTimersRef.current[resourceId] = {
      runId,
      intervalId,
      startedAt,
    };
  };

  const completeMarkdownPreviewWhenReady = (resource: DocsResource, runId: number, source: string) => {
    const isLargeMarkdown = source.length >= MARKDOWN_VIRTUAL_THRESHOLD;
    const timer = docsPreviewProgressTimersRef.current[resource.id];
    if (!timer || timer.runId !== runId) {
      return;
    }

    const elapsed = window.performance.now() - timer.startedAt;
    const waitMs = isLargeMarkdown ? Math.max(0, MIN_LARGE_MARKDOWN_PROGRESS_MS - elapsed) : 0;

    if (waitMs <= 0) {
      setDocsPreviewProgress(resource.id, runId, {
        stage: 'layout',
        progress: MARKDOWN_MAX_LOADING_PROGRESS,
      });
      completeDocsPreview(resource.id, runId, createMarkdownPreviewCache(source));
      return;
    }

    setDocsPreviewProgress(resource.id, runId, getMarkdownPreviewProgressState(elapsed));
    timer.completionTimeoutId = window.setTimeout(() => {
      completeDocsPreview(resource.id, runId, createMarkdownPreviewCache(source));
    }, waitMs);
  };

  const startDocsPreview = (resource: DocsResource) => {
    if (resource.status !== 'available' || (resource.kind !== 'markdown' && resource.kind !== 'docx' && resource.kind !== 'image')) {
      return;
    }

    clearDocsQuickPreviewTimer(resource.id);
    clearDocsPreviewProgressTimer(resource.id);

    const cachedPreview = docsPreviewCacheRef.current[resource.id];
    if (cachedPreview) {
      setDocsPreviewStates((previousStates) => ({
        ...previousStates,
        [resource.id]: {
          status: 'success',
          stage: 'done',
          progress: 100,
        },
      }));
      return;
    }

    const runId = docsPreviewRunSequenceRef.current + 1;
    docsPreviewRunSequenceRef.current = runId;
    setDocsPreviewStates((previousStates) => ({
      ...previousStates,
      [resource.id]: {
        status: 'loading',
        stage: 'prepare',
        runId,
      },
    }));

    if (resource.kind === 'docx') {
      return;
    }

    if (resource.kind === 'markdown') {
      startMarkdownPreviewProgress(resource.id, runId);
      loadMarkdownPreviewSource(resource)
        .then((source) => {
          completeMarkdownPreviewWhenReady(resource, runId, source);
        })
        .catch((reason: unknown) => {
          failDocsPreview(resource.id, runId, reason instanceof Error ? reason.message : 'Markdown 预览加载失败');
        });
      return;
    }

    docsQuickPreviewTimersRef.current[resource.id] = window.setTimeout(() => {
      completeDocsPreview(resource.id, runId, { kind: 'image' });
      delete docsQuickPreviewTimersRef.current[resource.id];
    }, 180);
  };

  const setDocsPreviewStage = (resourceId: string, runId: number, stage: DocsPreviewStage) => {
    setDocsPreviewStates((previousStates) => {
      const currentState = previousStates[resourceId];
      if (currentState?.status !== 'loading' || currentState.runId !== runId) {
        return previousStates;
      }

      return {
        ...previousStates,
        [resourceId]: {
          ...currentState,
          stage,
        },
      };
    });
  };

  const completeDocsPreview = (resourceId: string, runId: number, cache: DocsPreviewCache) => {
    clearDocsPreviewProgressTimer(resourceId, runId);
    setDocsPreviewStates((previousStates) => {
      const currentState = previousStates[resourceId];
      if (currentState?.status !== 'loading' || currentState.runId !== runId) {
        return previousStates;
      }

      docsPreviewCacheRef.current[resourceId] = cache;

      return {
        ...previousStates,
        [resourceId]: {
          status: 'success',
          stage: 'done',
          progress: 100,
          runId,
        },
      };
    });
  };

  const failDocsPreview = (resourceId: string, runId: number, error: string) => {
    clearDocsPreviewProgressTimer(resourceId, runId);
    setDocsPreviewStates((previousStates) => {
      const currentState = previousStates[resourceId];
      if (currentState?.status !== 'loading' || currentState.runId !== runId) {
        return previousStates;
      }

      return {
        ...previousStates,
        [resourceId]: {
          status: 'error',
          stage: currentState.stage,
          runId,
          error,
        },
      };
    });
  };

  const selectDocsResource = (resourceId: string) => {
    if (docsPreviewStates[activeResourceId]?.status === 'loading') {
      cancelDocsPreview(activeResourceId);
    }

    setActiveResourceId(resourceId);
  };

  const clearDocsFullscreenTimer = () => {
    if (docsFullscreenTimerRef.current !== null) {
      window.clearTimeout(docsFullscreenTimerRef.current);
      docsFullscreenTimerRef.current = null;
    }
  };

  const startDocsPreviewFullscreenEnter = () => {
    clearDocsFullscreenTimer();
    if (activeMarkdownOutline && activeMarkdownHeading) {
      setIsDocsFullscreenTocCollapsed(window.innerWidth <= 900);
    }
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

  useEffect(() => () => {
    Object.keys(docsQuickPreviewTimersRef.current).forEach(clearDocsQuickPreviewTimer);
    Object.keys(docsPreviewProgressTimersRef.current).forEach((resourceId) => clearDocsPreviewProgressTimer(resourceId));
  }, []);

  useEffect(() => {
    if (!activeMarkdownOutline || !activeMarkdownHeading) {
      return;
    }

    if (activeMarkdownHeadingIdByResourceId[activeResource.id] !== activeMarkdownHeading.id) {
      setActiveMarkdownHeadingIdByResourceId((previousIds) => ({
        ...previousIds,
        [activeResource.id]: activeMarkdownHeading.id,
      }));
    }

    if (docsMarkdownTocOpenedResourceIdsRef.current.has(activeResource.id)) {
      return;
    }

    docsMarkdownTocOpenedResourceIdsRef.current.add(activeResource.id);
    setDocsPanelTransition('forward');
    setDocsPanelMode('document-toc');
  }, [
    activeMarkdownHeading,
    activeMarkdownHeadingIdByResourceId,
    activeMarkdownOutline,
    activeResource.id,
  ]);

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
    if (docsPreviewStates[activeResourceId]?.status === 'loading') {
      cancelDocsPreview(activeResourceId);
    }

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

  const backToDocsResources = () => {
    setDocsPanelTransition('back');
    setDocsPanelMode('resources');
  };

  const scrollDocsPreviewBodyToTop = () => {
    const previewBody = docsPreviewRef.current?.querySelector<HTMLElement>('.landing-docs-preview-body');
    previewBody?.scrollTo({ top: 0, behavior: 'auto' });
  };

  const toggleExpandedMarkdownHeading = (resourceId: string, headingId: string) => {
    setExpandedMarkdownHeadingIdsByResourceId((previousByResourceId) => {
      const previousIds = new Set(previousByResourceId[resourceId] ?? []);
      if (previousIds.has(headingId)) {
        previousIds.delete(headingId);
      } else {
        previousIds.add(headingId);
      }

      return {
        ...previousByResourceId,
        [resourceId]: Array.from(previousIds),
      };
    });
  };

  const ensureExpandedMarkdownHeading = (resourceId: string, headingId: string) => {
    setExpandedMarkdownHeadingIdsByResourceId((previousByResourceId) => {
      const previousIds = new Set(previousByResourceId[resourceId] ?? []);
      if (previousIds.has(headingId)) {
        return previousByResourceId;
      }

      previousIds.add(headingId);
      return {
        ...previousByResourceId,
        [resourceId]: Array.from(previousIds),
      };
    });
  };

  const selectMarkdownHeading = (heading: MarkdownHeading, hasChildren = false) => {
    setActiveMarkdownHeadingIdByResourceId((previousIds) => ({
      ...previousIds,
      [activeResource.id]: heading.id,
    }));

    if (heading.level === 2 && hasChildren) {
      toggleExpandedMarkdownHeading(activeResource.id, heading.id);
    }

    if (heading.level === 3 && activeMarkdownOutline) {
      const parentHeadingId = activeMarkdownOutline.parentHeadingIdById.get(heading.id);
      if (parentHeadingId) {
        ensureExpandedMarkdownHeading(activeResource.id, parentHeadingId);
      }
    }

    scrollDocsPreviewBodyToTop();
  };

  const selectFullscreenMarkdownHeading = (heading: MarkdownHeading, hasChildren = false) => {
    selectMarkdownHeading(heading, hasChildren);
    // 带子项的父级点击只负责展开/收起分组，避免手机全屏目录被顺手关闭。
    if (window.innerWidth <= 900 && !hasChildren) {
      setIsDocsFullscreenTocCollapsed(true);
    }
  };

  const handleDownload = () => {
    if (!activeResource.fileUrl && !activeResource.source && !activeResource.loadSource) {
      return;
    }

    message.loading('正在下载', 1.2);
    downloadDocsResource(activeResource, activePreviewCache)
      .then((markdownSource) => {
        if (markdownSource && activeResource.kind === 'markdown') {
          docsPreviewCacheRef.current[activeResource.id] = createMarkdownPreviewCache(markdownSource);
        }
      })
      .catch((reason: unknown) => {
        message.error(reason instanceof Error ? reason.message : '下载失败');
      });
  };

  const handleQuickStart = () => {
    if (docsPreviewStates[activeResourceId]?.status === 'loading') {
      cancelDocsPreview(activeResourceId);
    }

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

  const docsSidebarTitle = docsPanelMode === 'document-toc' && activeMarkdownOutline
    ? '文档目录'
    : docsPanelMode === 'resources' || docsPanelMode === 'document-toc'
      ? activeCategoryMeta.label
      : '资源分类';
  const shouldShowDocumentTocPanel = docsPanelMode === 'document-toc' && activeMarkdownOutline;
  const shouldShowFullscreenToc = Boolean(isDocsPreviewFullscreen && activeMarkdownOutline && activeMarkdownHeading);

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
              连接 · <span>标注。</span>
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
              {docsSidebarTitle}
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
              ) : shouldShowDocumentTocPanel ? (
                <DocsMarkdownTocPanel
                  resource={activeResource}
                  outline={activeMarkdownOutline}
                  activeHeadingId={activeMarkdownHeading?.id}
                  expandedHeadingIds={expandedMarkdownHeadingIds}
                  onBack={backToDocsResources}
                  onSelectHeading={selectMarkdownHeading}
                />
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
                        onClick={() => selectDocsResource(resource.id)}
                      >
                        <span className="landing-docs-resource-icon" aria-hidden="true">
                          {getDocsResourceIcon(resource.kind)}
                        </span>
                        <span className="landing-docs-resource-text">
                          <strong>{resource.title}</strong>
                          <span className="landing-docs-resource-badge">{resource.badge}</span>
                        </span>
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
            shouldShowFullscreenToc ? ' has-fullscreen-toc' : ''
          }${isDocsFullscreenTocCollapsed ? ' is-fullscreen-toc-collapsed' : ''}${
            docsFullscreenTransition ? ` is-fullscreen-${docsFullscreenTransition}` : ''
          }`}
          aria-labelledby="docs-preview-title"
        >
          <div className="landing-docs-preview-fullscreen-shell">
            {shouldShowFullscreenToc && activeMarkdownOutline && activeMarkdownHeading ? (
              <aside className="landing-docs-fullscreen-toc" aria-label={`${activeResource.title} 全屏标题目录`}>
                <button
                  type="button"
                  className="landing-docs-fullscreen-toc-toggle"
                  onClick={() => setIsDocsFullscreenTocCollapsed((value) => !value)}
                  aria-label={isDocsFullscreenTocCollapsed ? '展开全屏目录' : '收起全屏目录'}
                  aria-expanded={!isDocsFullscreenTocCollapsed}
                  title={isDocsFullscreenTocCollapsed ? '展开目录' : '收起目录'}
                >
                  {isDocsFullscreenTocCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                </button>
                <div className="landing-docs-fullscreen-toc-panel" aria-hidden={isDocsFullscreenTocCollapsed}>
                  <DocsMarkdownTocPanel
                    resource={activeResource}
                    outline={activeMarkdownOutline}
                    activeHeadingId={activeMarkdownHeading.id}
                    expandedHeadingIds={expandedMarkdownHeadingIds}
                    onSelectHeading={selectFullscreenMarkdownHeading}
                    showBackButton={false}
                    onCollapse={() => setIsDocsFullscreenTocCollapsed(true)}
                    variant="fullscreen"
                  />
                </div>
              </aside>
            ) : null}

            <div className="landing-docs-preview-content">
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
                  {activeResource.status !== 'missing' && (activeResource.fileUrl || activeResource.source || activeResource.loadSource) ? (
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
                <DocsPreview
                  resource={activeResource}
                  previewState={activePreviewState}
                  previewCache={activePreviewCache}
                  markdownSectionSource={activeMarkdownSectionSource}
                  markdownSectionHeading={activeMarkdownHeading}
                  onStartPreview={startDocsPreview}
                  onCancelPreview={() => cancelDocsPreview(activeResource.id)}
                  onDownload={handleDownload}
                  onStageChange={setDocsPreviewStage}
                  onPreviewSuccess={completeDocsPreview}
                  onPreviewError={failDocsPreview}
                />
              </div>
            </div>
          </div>
        </article>
      </section>

      <LandingFooter />
    </main>
  );
}

function DocsMarkdownTocPanel({
  resource,
  outline,
  activeHeadingId,
  expandedHeadingIds,
  onBack,
  onSelectHeading,
  variant = 'sidebar',
  showBackButton = true,
  onCollapse,
}: {
  resource: DocsResource;
  outline: MarkdownOutline;
  activeHeadingId?: string;
  expandedHeadingIds: Set<string>;
  onBack?: () => void;
  onSelectHeading: (heading: MarkdownHeading, hasChildren?: boolean) => void;
  variant?: 'sidebar' | 'fullscreen';
  showBackButton?: boolean;
  onCollapse?: () => void;
}) {
  return (
    <>
      <div className={`landing-docs-resource-panel-head landing-docs-document-toc-head is-${variant}`}>
        {showBackButton && onBack ? (
          <button type="button" className="landing-docs-back-button" onClick={onBack}>
            <ArrowLeftOutlined />
            文件列表
          </button>
        ) : (
          <span className="landing-docs-document-toc-root-label">根目录</span>
        )}
        <div>
          <span>{resource.title}</span>
          <small>按标题分节预览</small>
        </div>
        {onCollapse ? (
          <button
            type="button"
            className="landing-docs-document-toc-collapse"
            onClick={onCollapse}
            aria-label="收起全屏目录"
            title="收起目录"
          >
            <MenuFoldOutlined />
          </button>
        ) : (
          <strong>{outline.headings.length}</strong>
        )}
      </div>
      <nav className="landing-docs-document-toc" aria-label={`${resource.title} 标题目录`}>
        {outline.tocGroups.map((group) => {
          const isExpanded = expandedHeadingIds.has(group.heading.id);
          const isActiveGroup =
            activeHeadingId === group.heading.id ||
            group.children.some((child) => child.id === activeHeadingId);

          return (
            <div
              key={group.heading.id}
              className={`landing-docs-document-toc-group${isExpanded ? ' is-expanded' : ''}`}
            >
              <button
                type="button"
                className={`landing-docs-document-toc-link landing-docs-document-toc-level-2${
                  activeHeadingId === group.heading.id ? ' is-active' : ''
                }${isActiveGroup ? ' is-active-group' : ''}${
                  group.children.length > 0 ? ' has-children' : ''
                }`}
                aria-expanded={group.children.length > 0 ? isExpanded : undefined}
                onClick={() => onSelectHeading(group.heading, group.children.length > 0)}
              >
                <span>{group.heading.text}</span>
              </button>
              {group.children.length > 0 ? (
                <div className="landing-docs-document-toc-children" aria-hidden={!isExpanded}>
                  <div className="landing-docs-document-toc-children-inner">
                    {group.children.map((heading) => (
                      <button
                        key={`${heading.id}-${heading.text}`}
                        type="button"
                        className={`landing-docs-document-toc-link landing-docs-document-toc-level-3${
                          activeHeadingId === heading.id ? ' is-active' : ''
                        }`}
                        tabIndex={!isExpanded ? -1 : undefined}
                        onClick={() => onSelectHeading(heading)}
                      >
                        {heading.text}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </>
  );
}

function DocsPreview({
  resource,
  previewState,
  previewCache,
  markdownSectionSource,
  markdownSectionHeading,
  onStartPreview,
  onCancelPreview,
  onDownload,
  onStageChange,
  onPreviewSuccess,
  onPreviewError,
}: {
  resource: DocsResource;
  previewState: DocsPreviewState;
  previewCache?: DocsPreviewCache;
  markdownSectionSource?: string;
  markdownSectionHeading?: MarkdownHeading;
  onStartPreview: (resource: DocsResource) => void;
  onCancelPreview: () => void;
  onDownload: () => void;
  onStageChange: (resourceId: string, runId: number, stage: DocsPreviewStage) => void;
  onPreviewSuccess: (resourceId: string, runId: number, cache: DocsPreviewCache) => void;
  onPreviewError: (resourceId: string, runId: number, error: string) => void;
}) {
  if (resource.status === 'missing') {
    return <MissingDocsPreview resource={resource} />;
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

  if (resource.kind === 'docx' && resource.fileUrl) {
    return (
      <DocxPreviewPane
        resource={resource}
        previewState={previewState}
        previewCache={previewCache}
        onStartPreview={onStartPreview}
        onCancelPreview={onCancelPreview}
        onDownload={onDownload}
        onStageChange={onStageChange}
        onPreviewSuccess={onPreviewSuccess}
        onPreviewError={onPreviewError}
      />
    );
  }

  if (previewState.status !== 'success') {
    return (
      <ManualDocsPreviewState
        resource={resource}
        previewState={previewState}
        onStartPreview={() => onStartPreview(resource)}
        onCancelPreview={onCancelPreview}
        onDownload={onDownload}
      />
    );
  }

  if (resource.kind === 'markdown') {
    const markdownSource = previewCache?.kind === 'markdown' ? previewCache.source : resource.source ?? '';
    return (
      <MarkdownDocsPreview
        source={markdownSectionSource ?? markdownSource}
        sectionHeading={markdownSectionHeading}
      />
    );
  }

  if (resource.kind === 'image' && resource.fileUrl) {
    return (
      <ZoomableDocsImagePreview
        resourceId={resource.id}
        title={resource.title}
        fileUrl={resource.fileUrl}
      />
    );
  }

  return <MissingDocsPreview resource={resource} />;
}

function ZoomableDocsImagePreview({
  resourceId,
  title,
  fileUrl,
}: {
  resourceId: string;
  title: string;
  fileUrl: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(DOCS_IMAGE_ZOOM_DEFAULT);
  const [naturalSize, setNaturalSize] = useState<DocsImageSize | null>(null);
  const [viewportSize, setViewportSize] = useState<DocsImageSize>({ width: 0, height: 0 });

  const createLayout = useCallback((targetZoom: number) => {
    if (!naturalSize || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return null;
    }

    const availableWidth = Math.max(1, viewportSize.width - DOCS_IMAGE_PREVIEW_PADDING * 2);
    const availableHeight = Math.max(
      1,
      Math.min(DOCS_IMAGE_BASE_MAX_HEIGHT, viewportSize.height - DOCS_IMAGE_PREVIEW_PADDING * 2),
    );
    const fitScale = Math.min(1, availableWidth / naturalSize.width, availableHeight / naturalSize.height);
    const baseWidth = Math.max(1, naturalSize.width * fitScale);
    const baseHeight = Math.max(1, naturalSize.height * fitScale);
    const renderedWidth = baseWidth * targetZoom;
    const renderedHeight = baseHeight * targetZoom;
    const stageWidth = Math.max(viewportSize.width, renderedWidth + DOCS_IMAGE_PREVIEW_PADDING * 2);
    const stageHeight = Math.max(viewportSize.height, renderedHeight + DOCS_IMAGE_PREVIEW_PADDING * 2);

    return {
      renderedWidth,
      renderedHeight,
      stageWidth,
      stageHeight,
      imageLeft: (stageWidth - renderedWidth) / 2,
      imageTop: (stageHeight - renderedHeight) / 2,
    };
  }, [naturalSize, viewportSize.height, viewportSize.width]);

  const imageLayout = useMemo(() => createLayout(zoom), [createLayout, zoom]);

  useEffect(() => {
    setZoom(DOCS_IMAGE_ZOOM_DEFAULT);
    setNaturalSize(null);
    pendingScrollRef.current = null;
  }, [fileUrl, resourceId]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const measureContainer = () => {
      setViewportSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    measureContainer();

    const observer = new ResizeObserver(measureContainer);
    observer.observe(container);

    return () => observer.disconnect();
  }, [fileUrl, resourceId]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const pendingScroll = pendingScrollRef.current;
    if (!container || !pendingScroll) {
      return;
    }

    container.scrollLeft = pendingScroll.left;
    container.scrollTop = pendingScroll.top;
    pendingScrollRef.current = null;
  }, [imageLayout]);

  const handleImageWheel = useCallback((event: globalThis.WheelEvent) => {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();
    const container = containerRef.current;
    const previousLayout = imageLayout;
    const nextZoom = getNextDocsImageZoom(zoom, event.deltaY);
    const nextLayout = createLayout(nextZoom);

    if (!container || !previousLayout || !nextLayout || nextZoom === zoom) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const pointerX = event.clientX - containerRect.left;
    const pointerY = event.clientY - containerRect.top;
    const contentX = container.scrollLeft + pointerX;
    const contentY = container.scrollTop + pointerY;
    const imageRatioX = clampNumber(
      (contentX - previousLayout.imageLeft) / previousLayout.renderedWidth,
      0,
      1,
    );
    const imageRatioY = clampNumber(
      (contentY - previousLayout.imageTop) / previousLayout.renderedHeight,
      0,
      1,
    );
    const nextContentX = nextLayout.imageLeft + imageRatioX * nextLayout.renderedWidth;
    const nextContentY = nextLayout.imageTop + imageRatioY * nextLayout.renderedHeight;

    pendingScrollRef.current = {
      left: clampNumber(nextContentX - pointerX, 0, Math.max(0, nextLayout.stageWidth - container.clientWidth)),
      top: clampNumber(nextContentY - pointerY, 0, Math.max(0, nextLayout.stageHeight - container.clientHeight)),
    };
    setZoom(nextZoom);
  }, [createLayout, imageLayout, zoom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    container.addEventListener('wheel', handleImageWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleImageWheel);
    };
  }, [handleImageWheel]);

  const stageStyle = imageLayout
    ? ({
        width: imageLayout.stageWidth,
        height: imageLayout.stageHeight,
      } satisfies CSSProperties)
    : undefined;
  const imageStyle = imageLayout
    ? ({
        left: imageLayout.imageLeft,
        top: imageLayout.imageTop,
        width: imageLayout.renderedWidth,
        height: imageLayout.renderedHeight,
        maxWidth: 'none',
        maxHeight: 'none',
      } satisfies CSSProperties)
    : undefined;

  return (
    <div
      ref={containerRef}
      className={`landing-docs-image-preview${zoom > DOCS_IMAGE_ZOOM_DEFAULT ? ' is-zoomed' : ''}`}
    >
      <div className="landing-docs-image-stage" style={stageStyle}>
        <img
          src={fileUrl}
          alt={title}
          style={imageStyle}
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget;
            setNaturalSize({
              width: image.naturalWidth,
              height: image.naturalHeight,
            });
          }}
        />
      </div>
    </div>
  );
}

const MarkdownDocsPreview = memo(function MarkdownDocsPreview({
  source,
  sectionHeading,
}: {
  source: string;
  sectionHeading?: MarkdownHeading;
}) {
  if (!sectionHeading && source.length >= MARKDOWN_VIRTUAL_THRESHOLD) {
    return <VirtualMarkdownPreview source={source} />;
  }

  return (
    <div className={`landing-docs-markdown landing-about-markdown${sectionHeading ? ' is-section-preview' : ''}`}>
      {sectionHeading ? (
        <div className="landing-docs-section-context">
          当前章节：{sectionHeading.text}
        </div>
      ) : null}
      <ReactMarkdown
        remarkPlugins={docsMarkdownRemarkPlugins}
        components={docsMarkdownComponents}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});

function VirtualMarkdownPreview({ source }: { source: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const blockHeightsRef = useRef<Record<string, number>>({});
  const blockOffsetsRef = useRef<MarkdownVirtualBlockOffset[]>([]);
  const pendingScrollAnchorRef = useRef<{ id: string; offset: number } | null>(null);
  const blocks = useMemo(() => splitMarkdownVirtualBlocks(source), [source]);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 680 });
  const [heightVersion, setHeightVersion] = useState(0);

  const blockOffsets = useMemo(() => {
    let top = 0;
    return blocks.map((block) => {
      const height = blockHeightsRef.current[block.id] ?? estimateMarkdownBlockHeight(block);
      const offset = { id: block.id, top, height };
      top += height;
      return offset;
    });
  }, [blocks, heightVersion]);
  blockOffsetsRef.current = blockOffsets;

  const totalHeight = blockOffsets.length
    ? blockOffsets[blockOffsets.length - 1].top + blockOffsets[blockOffsets.length - 1].height
    : 0;

  const rawFirstVisibleIndex = blockOffsets.findIndex((block) => block.top + block.height >= viewport.scrollTop);
  const firstVisibleIndex = Math.max(0, (rawFirstVisibleIndex === -1 ? 0 : rawFirstVisibleIndex) - MARKDOWN_VIRTUAL_OVERSCAN);
  const nextBlockIndex = blockOffsets.findIndex((block) => block.top >= viewport.scrollTop + viewport.height);
  const visibleEndIndex = nextBlockIndex === -1 ? blocks.length - 1 : nextBlockIndex + MARKDOWN_VIRTUAL_OVERSCAN;
  const lastVisibleIndex = Math.min(
    blocks.length - 1,
    Math.max(firstVisibleIndex, visibleEndIndex),
  );
  const normalizedLastVisibleIndex = lastVisibleIndex < firstVisibleIndex ? blocks.length - 1 : lastVisibleIndex;
  const visibleBlocks = blocks.slice(firstVisibleIndex, normalizedLastVisibleIndex + 1);

  useEffect(() => {
    const container = getMarkdownScrollContainer(rootRef.current);
    if (!container) {
      return undefined;
    }
    scrollContainerRef.current = container;

    const updateViewport = () => {
      setViewport({
        scrollTop: container.scrollTop,
        height: container.clientHeight || 680,
      });
    };

    updateViewport();
    container.addEventListener('scroll', updateViewport, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateViewport);
      resizeObserver.observe(container);
    }

    return () => {
      container.removeEventListener('scroll', updateViewport);
      resizeObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current ?? getMarkdownScrollContainer(rootRef.current);
    blockHeightsRef.current = {};
    pendingScrollAnchorRef.current = null;
    container?.scrollTo({ top: 0 });
    setViewport({ scrollTop: 0, height: container?.clientHeight || 680 });
    setHeightVersion((value) => value + 1);
  }, [source]);

  useLayoutEffect(() => {
    const anchor = pendingScrollAnchorRef.current;
    const container = scrollContainerRef.current;
    if (!anchor || !container) {
      pendingScrollAnchorRef.current = null;
      return;
    }

    const nextAnchorOffset = blockOffsets.find((block) => block.id === anchor.id);
    if (!nextAnchorOffset) {
      pendingScrollAnchorRef.current = null;
      return;
    }

    const nextScrollTop = Math.max(0, nextAnchorOffset.top + anchor.offset);
    if (Math.abs(container.scrollTop - nextScrollTop) > 1) {
      container.scrollTop = nextScrollTop;
      setViewport({
        scrollTop: container.scrollTop,
        height: container.clientHeight || 680,
      });
    }
    pendingScrollAnchorRef.current = null;
  }, [blockOffsets]);

  const handleBlockMeasured = useCallback((blockId: string, height: number) => {
    const previousHeight = blockHeightsRef.current[blockId] ?? 0;
    if (previousHeight && Math.abs(previousHeight - height) < MARKDOWN_HEIGHT_MEASURE_TOLERANCE) {
      return;
    }

    const container = scrollContainerRef.current;
    if (container) {
      const anchorOffset =
        blockOffsetsRef.current.find((block) => block.top + block.height >= container.scrollTop) ??
        blockOffsetsRef.current[0];
      pendingScrollAnchorRef.current = anchorOffset
        ? {
            id: anchorOffset.id,
            offset: container.scrollTop - anchorOffset.top,
          }
        : null;
    }

    blockHeightsRef.current[blockId] = height;
    setHeightVersion((value) => value + 1);
  }, []);

  return (
    <div ref={rootRef} className="landing-docs-virtual-markdown">
      <div className="landing-docs-virtual-markdown-spacer" style={{ height: `${totalHeight}px` }}>
        {visibleBlocks.map((block, index) => {
          const blockIndex = firstVisibleIndex + index;
          const offset = blockOffsets[blockIndex];
          return (
            <VirtualMarkdownBlock
              key={block.id}
              block={block}
              top={offset?.top ?? 0}
              onMeasured={handleBlockMeasured}
            />
          );
        })}
      </div>
    </div>
  );
}

function VirtualMarkdownBlock({
  block,
  top,
  onMeasured,
}: {
  block: MarkdownVirtualBlock;
  top: number;
  onMeasured: (blockId: string, height: number) => void;
}) {
  const blockRef = useRef<HTMLDivElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const element = blockRef.current;
    if (!element) {
      return undefined;
    }

    const measure = () => {
      if (resizeFrameRef.current !== null) {
        return;
      }

      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        onMeasured(block.id, element.getBoundingClientRect().height);
      });
    };
    measure();

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        if (resizeFrameRef.current !== null) {
          window.cancelAnimationFrame(resizeFrameRef.current);
        }
      };
    }

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(element);
    return () => {
      resizeObserver.disconnect();
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, [block.id, onMeasured]);

  return (
    <div
      ref={blockRef}
      className="landing-docs-markdown landing-about-markdown landing-docs-virtual-markdown-block"
      style={{ transform: `translateY(${top}px)` }}
    >
      <ReactMarkdown remarkPlugins={docsMarkdownRemarkPlugins} components={docsMarkdownComponents}>
        {block.content}
      </ReactMarkdown>
    </div>
  );
}

function ManualDocsPreviewState({
  resource,
  previewState,
  onStartPreview,
  onCancelPreview,
  onDownload,
}: {
  resource: DocsResource;
  previewState: DocsPreviewState;
  onStartPreview: () => void;
  onCancelPreview: () => void;
  onDownload: () => void;
}) {
  const canDownload = Boolean(resource.fileUrl || resource.source || resource.loadSource);
  const isLoading = previewState.status === 'loading';
  const isError = previewState.status === 'error';

  return (
    <div className={`landing-docs-preview-state landing-docs-manual-preview is-${previewState.status}`}>
      <span className="landing-docs-preview-state-icon" aria-hidden="true">
        {getDocsResourceIcon(resource.kind)}
      </span>
      <strong>{isError ? '预览失败' : resource.title}</strong>
      <p>{isError ? previewState.error : resource.description}</p>
      {isLoading ? <DocsPreviewProgress stage={previewState.stage} progress={previewState.progress} /> : null}
      <div className="landing-docs-preview-state-actions">
        {isLoading ? (
          <button type="button" className="landing-docs-preview-secondary-action" onClick={onCancelPreview}>
            取消
          </button>
        ) : (
          <button type="button" className="landing-docs-preview-primary-action" onClick={onStartPreview}>
            <ReadOutlined />
            {isError ? '重新预览' : '预览'}
          </button>
        )}
        {canDownload && !isLoading ? (
          <button type="button" className="landing-docs-preview-secondary-action" onClick={onDownload}>
            <DownloadOutlined />
            下载
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DocsPreviewProgress({ stage, progress }: { stage: DocsPreviewStage; progress?: number }) {
  const activeStageIndex = Math.max(0, docsPreviewStages.findIndex((item) => item.key === stage));
  const displayedProgress = Math.max(
    4,
    Math.min(100, Math.round(progress ?? ((activeStageIndex + 1) / docsPreviewStages.length) * 100)),
  );

  return (
    <div className="landing-docs-preview-progress" aria-label="文档预览进度">
      <div
        className="landing-docs-preview-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={displayedProgress}
      >
        <span className="landing-docs-preview-progress-bar" style={{ width: `${displayedProgress}%` }} />
      </div>
      <div className="landing-docs-preview-progress-steps">
        {docsPreviewStages.map((item, index) => (
          <span
            key={item.key}
            className={index <= activeStageIndex ? 'is-active' : ''}
          >
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function DocxPreviewPane({
  resource,
  previewState,
  previewCache,
  onStartPreview,
  onCancelPreview,
  onDownload,
  onStageChange,
  onPreviewSuccess,
  onPreviewError,
}: {
  resource: DocsResource;
  previewState: DocsPreviewState;
  previewCache?: DocsPreviewCache;
  onStartPreview: (resource: DocsResource) => void;
  onCancelPreview: () => void;
  onDownload: () => void;
  onStageChange: (resourceId: string, runId: number, stage: DocsPreviewStage) => void;
  onPreviewSuccess: (resourceId: string, runId: number, cache: DocsPreviewCache) => void;
  onPreviewError: (resourceId: string, runId: number, error: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const docxCache = previewCache?.kind === 'docx' ? previewCache : undefined;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !resource.fileUrl || previewState.status !== 'loading' || !previewState.runId) {
      return undefined;
    }

    const runId = previewState.runId;
    const fileUrl = resource.fileUrl;
    const abortController = new AbortController();
    let cancelled = false;

    resetDocxCanvas(container);

    const renderDocx = async () => {
      try {
        onStageChange(resource.id, runId, 'fetch');
        const response = await fetch(fileUrl, { signal: abortController.signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        if (cancelled) return;

        onStageChange(resource.id, runId, 'parse');
        const documentModel = await parseAsync(buffer, DOCX_PREVIEW_OPTIONS);
        if (cancelled) return;

        onStageChange(resource.id, runId, 'render');
        await renderDocument(documentModel, container, undefined, DOCX_PREVIEW_OPTIONS);
        if (cancelled) return;

        onStageChange(resource.id, runId, 'layout');
        await waitForDocxLayoutFrame();
        if (cancelled) return;

        updateDocxCanvasScale(container);
        onPreviewSuccess(resource.id, runId, {
          kind: 'docx',
          html: container.innerHTML,
          scale: container.style.getPropertyValue('--landing-docx-scale') || '1',
          pageWidth: container.style.getPropertyValue('--landing-docx-page-width') || 'auto',
        });
      } catch (reason: unknown) {
        if (cancelled) {
          return;
        }

        if (reason instanceof DOMException && reason.name === 'AbortError') {
          return;
        }

        resetDocxCanvas(container);
        onPreviewError(resource.id, runId, reason instanceof Error ? reason.message : 'DOCX 预览加载失败');
      }
    };

    renderDocx();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [
    resource.fileUrl,
    previewState.runId,
    previewState.status,
    resource.id,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || previewState.status !== 'success' || !docxCache) {
      return undefined;
    }

    if (!container.children.length) {
      container.innerHTML = docxCache.html;
    }
    container.style.setProperty('--landing-docx-scale', docxCache.scale);
    container.style.setProperty('--landing-docx-page-width', docxCache.pageWidth);

    return observeDocxCanvasWidth(container);
  }, [docxCache, previewState.status]);

  return (
    <div className="landing-docs-docx-preview">
      {previewState.status !== 'success' ? (
        <ManualDocsPreviewState
          resource={resource}
          previewState={previewState}
          onStartPreview={() => onStartPreview(resource)}
          onCancelPreview={onCancelPreview}
          onDownload={onDownload}
        />
      ) : null}
      <div
        ref={containerRef}
        className={`landing-docs-docx-canvas${previewState.status !== 'success' ? ' is-hidden' : ''}`}
      />
    </div>
  );
}

function waitForDocxLayoutFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function getMarkdownPreviewProgressState(elapsedMs: number): Pick<DocsPreviewState, 'stage' | 'progress'> {
  const ratio = Math.min(1, Math.max(0, elapsedMs / MIN_LARGE_MARKDOWN_PROGRESS_MS));
  const progress = Math.min(
    MARKDOWN_MAX_LOADING_PROGRESS,
    Math.round(8 + (MARKDOWN_MAX_LOADING_PROGRESS - 8) * ratio),
  );
  const stageStop =
    MARKDOWN_PROGRESS_STAGE_STOPS.find((item) => progress <= item.progress) ??
    MARKDOWN_PROGRESS_STAGE_STOPS[MARKDOWN_PROGRESS_STAGE_STOPS.length - 1];

  return {
    stage: stageStop.stage,
    progress,
  };
}

function createMarkdownPreviewCache(source: string): Extract<DocsPreviewCache, { kind: 'markdown' }> {
  if (source.length < MARKDOWN_VIRTUAL_THRESHOLD) {
    return { kind: 'markdown', source };
  }

  const headings = createMarkdownHeadings(source);
  const tocGroups = createMarkdownTocGroups(headings);
  return headings.length > 0 && tocGroups.length > 0
    ? { kind: 'markdown', source, headings, tocGroups }
    : { kind: 'markdown', source };
}

function getDocsMarkdownOutline(
  resource: DocsResource,
  previewState: DocsPreviewState,
  previewCache?: DocsPreviewCache,
): MarkdownOutline | undefined {
  if (resource.kind !== 'markdown' || previewState.status !== 'success') {
    return undefined;
  }

  const source = previewCache?.kind === 'markdown' ? previewCache.source : resource.source ?? '';
  if (source.length < MARKDOWN_VIRTUAL_THRESHOLD) {
    return undefined;
  }

  const headings = previewCache?.kind === 'markdown' && previewCache.headings
    ? previewCache.headings
    : createMarkdownHeadings(source);
  const tocGroups = previewCache?.kind === 'markdown' && previewCache.tocGroups
    ? previewCache.tocGroups
    : createMarkdownTocGroups(headings);
  if (headings.length === 0 || tocGroups.length === 0) {
    return undefined;
  }

  return {
    source,
    headings,
    tocGroups,
    parentHeadingIdById: createMarkdownParentHeadingIdMap(tocGroups),
  };
}

function extractMarkdownSection(source: string, heading: MarkdownHeading, headings: MarkdownHeading[]) {
  const lines = source.split(/\r?\n/);
  const headingIndex = headings.findIndex((item) => item.id === heading.id);
  if (headingIndex === -1) {
    return source;
  }

  const nextHeading = headings.slice(headingIndex + 1).find((item) => (
    heading.level === 2 ? item.level <= 3 : item.level <= heading.level
  ));
  const endLineIndex = nextHeading?.lineIndex ?? lines.length;
  const sectionLines = lines.slice(heading.lineIndex, endLineIndex);
  return sectionLines.join('\n').trim() || lines[heading.lineIndex] || '';
}

function estimateMarkdownBlockHeight(block: MarkdownVirtualBlock) {
  const lineCount = block.content.split('\n').length;
  const headingBonus = /^#{1,3}\s/m.test(block.content) ? 44 : 0;
  const tableBonus = block.content.includes('|') ? 36 : 0;
  const codeBonus = block.content.includes('```') ? 42 : 0;
  return Math.max(120, Math.ceil(lineCount * 24 + block.content.length / 72 + headingBonus + tableBonus + codeBonus));
}

function getMarkdownScrollContainer(element: HTMLElement | null) {
  return element?.closest<HTMLElement>('.landing-docs-preview-body') ?? null;
}

function resetDocxCanvas(container: HTMLElement) {
  container.style.setProperty('--landing-docx-scale', '1');
  container.style.removeProperty('--landing-docx-page-width');
  container.innerHTML = '';
}

function getDocxPageFrames(container: HTMLElement) {
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
}

function updateDocxCanvasScale(container: HTMLElement) {
  const previewBody = container.closest<HTMLElement>('.landing-docs-preview-body');
  const pageFrames = getDocxPageFrames(container);
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
}

function observeDocxCanvasWidth(container: HTMLElement) {
  const previewBody = container.closest<HTMLElement>('.landing-docs-preview-body');
  updateDocxCanvasScale(container);

  if (previewBody && typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(() => updateDocxCanvasScale(container));
    resizeObserver.observe(previewBody);
    return () => resizeObserver.disconnect();
  }

  const handleResize = () => updateDocxCanvasScale(container);
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
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

function loadMarkdownPreviewSource(resource: DocsResource) {
  if (resource.source !== undefined) {
    return Promise.resolve(resource.source);
  }

  if (resource.loadSource) {
    return resource.loadSource();
  }

  return Promise.reject(new Error('Markdown 资源未配置加载入口'));
}

async function downloadDocsResource(resource: DocsResource, previewCache?: DocsPreviewCache) {
  const link = document.createElement('a');
  const filename = resource.downloadName ?? resource.title;

  if (resource.fileUrl) {
    link.href = resource.fileUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    return undefined;
  }

  if (resource.kind === 'markdown') {
    const source = previewCache?.kind === 'markdown' ? previewCache.source : await loadMarkdownPreviewSource(resource);
    const blob = new Blob([source], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return source;
  }

  return undefined;
}

function splitMarkdownVirtualBlocks(source: string): MarkdownVirtualBlock[] {
  const blocks: MarkdownVirtualBlock[] = [];
  const lines = source.split(/\r?\n/);
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    if (buffer.length === 0) {
      return;
    }

    const content = buffer.join('\n').trimEnd();
    if (content.trim()) {
      blocks.push({
        id: `md-block-${blocks.length}`,
        content,
      });
    }
    buffer = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    const isFence = /^```/.test(trimmed);
    const isHeading = /^#{2,3}\s+/.test(trimmed);
    const shouldStartNewBlock = !inFence && isHeading && buffer.length > 0;
    const shouldSplitLargeBlock = !inFence && buffer.join('\n').length >= MARKDOWN_BLOCK_TARGET_CHARS && trimmed === '';

    if (shouldStartNewBlock || shouldSplitLargeBlock) {
      flush();
    }

    buffer.push(line);

    if (isFence) {
      inFence = !inFence;
    }
  });

  flush();
  return blocks.length > 0 ? blocks : [{ id: 'md-block-empty', content: source }];
}

export function AboutPlaceholder() {
  const readmeBodyRef = useRef<HTMLDivElement | null>(null);
  const tocRef = useRef<HTMLElement | null>(null);
  const aboutReadmeFullscreenTimerRef = useRef<number | null>(null);
  const { message } = App.useApp();
  const [activeReadmeHeadingId, setActiveReadmeHeadingId] = useState(README_HEADINGS[0]?.id ?? '');
  const [isReadmeTocCollapsed, setIsReadmeTocCollapsed] = useState(false);
  const [isAboutReadmePreviewed, setIsAboutReadmePreviewed] = useState(() => {
    try {
      return window.localStorage.getItem(ABOUT_README_PREVIEWED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [isAboutReadmeFullscreen, setIsAboutReadmeFullscreen] = useState(false);
  const [isAboutReadmeFullscreenTocCollapsed, setIsAboutReadmeFullscreenTocCollapsed] = useState(false);
  const [aboutReadmeFullscreenTransition, setAboutReadmeFullscreenTransition] =
    useState<DocsFullscreenTransition>(null);
  const [expandedReadmeHeadingIds, setExpandedReadmeHeadingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const isReadmeTocVisuallyCollapsed = isAboutReadmeFullscreen
    ? isAboutReadmeFullscreenTocCollapsed
    : isReadmeTocCollapsed;
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

  const clearAboutReadmeFullscreenTimer = () => {
    if (aboutReadmeFullscreenTimerRef.current !== null) {
      window.clearTimeout(aboutReadmeFullscreenTimerRef.current);
      aboutReadmeFullscreenTimerRef.current = null;
    }
  };

  const startAboutReadmeFullscreenEnter = () => {
    clearAboutReadmeFullscreenTimer();
    setIsAboutReadmeFullscreenTocCollapsed(window.innerWidth <= 900);
    setIsAboutReadmeFullscreen(true);
    setAboutReadmeFullscreenTransition('entering');
    message.success('全屏模式');
    aboutReadmeFullscreenTimerRef.current = window.setTimeout(() => {
      setAboutReadmeFullscreenTransition(null);
      aboutReadmeFullscreenTimerRef.current = null;
    }, DOCS_FULLSCREEN_ANIMATION_MS);
  };

  const startAboutReadmeFullscreenExit = () => {
    clearAboutReadmeFullscreenTimer();
    setAboutReadmeFullscreenTransition('leaving');
    message.success('退出全屏');
    aboutReadmeFullscreenTimerRef.current = window.setTimeout(() => {
      setIsAboutReadmeFullscreen(false);
      setAboutReadmeFullscreenTransition(null);
      aboutReadmeFullscreenTimerRef.current = null;
    }, DOCS_FULLSCREEN_ANIMATION_MS);
  };

  const toggleAboutReadmeFullscreen = () => {
    if (isAboutReadmeFullscreen) {
      startAboutReadmeFullscreenExit();
      return;
    }

    startAboutReadmeFullscreenEnter();
  };

  const toggleReadmeTocCollapsed = () => {
    if (isAboutReadmeFullscreen) {
      setIsAboutReadmeFullscreenTocCollapsed((collapsed) => !collapsed);
      return;
    }

    setIsReadmeTocCollapsed((collapsed) => !collapsed);
  };

  const handleStartAboutReadmePreview = () => {
    setIsAboutReadmePreviewed(true);
    try {
      window.localStorage.setItem(ABOUT_README_PREVIEWED_STORAGE_KEY, 'true');
    } catch {
      // localStorage 不可用时仍允许当前页面会话内预览。
    }
  };

  const handleDownloadReadme = () => {
    const blob = new Blob([readmeSource], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'README.md';
    document.body.appendChild(link);
    message.loading('正在下载', 1.2);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  useEffect(() => {
    if (!isAboutReadmePreviewed) {
      return undefined;
    }

    const hashText = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    if (!hashText) {
      return undefined;
    }

    const targetHeading = README_HEADINGS.find(
      (heading) => heading.id === hashText || heading.text === hashText,
    );
    if (!targetHeading) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollToReadmeHeading(targetHeading, 'auto', false);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isAboutReadmePreviewed]);

  useEffect(() => {
    if (!isAboutReadmePreviewed) {
      return undefined;
    }

    const container = readmeBodyRef.current;
    if (!container) {
      return undefined;
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
  }, [isAboutReadmePreviewed]);

  useEffect(() => () => clearAboutReadmeFullscreenTimer(), []);

  useEffect(() => {
    if (!isAboutReadmeFullscreen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        startAboutReadmeFullscreenExit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAboutReadmeFullscreen]);

  usePublicPageClass();

  return (
    <main className={`landing-page landing-about-page${isAboutReadmeFullscreen ? ' is-about-readme-fullscreen' : ''}`}>
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
            isReadmeTocVisuallyCollapsed ? ' is-toc-collapsed' : ''
          }${isAboutReadmeFullscreen ? ' is-fullscreen' : ''}${
            aboutReadmeFullscreenTransition ? ` is-fullscreen-${aboutReadmeFullscreenTransition}` : ''
          }`}
        >
          <aside className="landing-about-toc" aria-label="README 目录" ref={tocRef}>
            <div className="landing-about-toc-header">
              <div className="landing-about-toc-title">README</div>
              <button
                type="button"
                className="landing-about-toc-toggle"
                aria-label={isReadmeTocVisuallyCollapsed ? '展开 README 目录' : '收起 README 目录'}
                aria-expanded={!isReadmeTocVisuallyCollapsed}
                title={isReadmeTocVisuallyCollapsed ? '展开目录' : '收起目录'}
                onClick={toggleReadmeTocCollapsed}
              >
                {isReadmeTocVisuallyCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              </button>
            </div>
            <nav className="landing-about-toc-nav" aria-hidden={isReadmeTocVisuallyCollapsed}>
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
                      tabIndex={isReadmeTocVisuallyCollapsed ? -1 : undefined}
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
                              tabIndex={isReadmeTocVisuallyCollapsed || !isExpanded ? -1 : undefined}
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
              <div className="landing-about-readme-heading">
                <span>Repository README</span>
                <h2 id="about-readme-title">项目说明文档</h2>
                <p>以下内容直接来自仓库根目录 README.md，便于公开页与项目文档保持同步。</p>
              </div>
              <div className="landing-about-readme-actions">
                <button
                  type="button"
                  className="landing-docs-action-link landing-about-readme-fullscreen-button"
                  onClick={toggleAboutReadmeFullscreen}
                  aria-label={isAboutReadmeFullscreen ? '退出全屏观看 README' : '全屏观看 README'}
                  title={isAboutReadmeFullscreen ? '退出全屏' : '全屏观看'}
                >
                  {isAboutReadmeFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                  {isAboutReadmeFullscreen ? '退出全屏' : '全屏'}
                </button>
                <button
                  type="button"
                  className="landing-docs-action-link"
                  onClick={handleDownloadReadme}
                >
                  <DownloadOutlined />
                  下载
                </button>
              </div>
            </div>
            <div
              className={`landing-about-readme-body${!isAboutReadmePreviewed ? ' is-preview-gate' : ''}`}
              ref={readmeBodyRef}
              tabIndex={0}
            >
              {isAboutReadmePreviewed ? (
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
              ) : (
                <AboutReadmePreviewCard onPreview={handleStartAboutReadmePreview} />
              )}
            </div>
          </article>
        </div>
      </section>

      <LandingFooter />
    </main>
  );
}

function AboutReadmePreviewCard({ onPreview }: { onPreview: () => void }) {
  return (
    <div className="landing-docs-preview-state landing-docs-manual-preview landing-about-readme-preview-gate is-idle">
      <span className="landing-docs-preview-state-icon" aria-hidden="true">
        <FileTextOutlined />
      </span>
      <strong>README.md</strong>
      <p>仓库根目录项目说明文档。</p>
      <div className="landing-docs-preview-state-actions">
        <button type="button" className="landing-docs-preview-primary-action" onClick={onPreview}>
          <ReadOutlined />
          预览
        </button>
      </div>
    </div>
  );
}
