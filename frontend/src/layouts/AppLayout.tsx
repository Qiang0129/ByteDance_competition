import { useEffect, useState } from 'react';
import {
  AppstoreOutlined,
  ApiOutlined,
  AuditOutlined,
  BgColorsOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  ExportOutlined,
  FileTextOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProjectOutlined,
  SearchOutlined,
  ShopOutlined,
  SwapOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Dropdown,
  Input,
  Layout,
  Menu,
  Typography,
} from 'antd';
import type { MenuProps } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { authApi, clearStoredAuthUser, getStoredAuthUser } from '../api/auth';
import { clearAuthToken, getAuthToken } from '../api/client';
import type { AuthUser } from '../types/auth';
import {
  isWorkspaceRole,
  type WorkspaceRole,
  workspaceRoleLabels,
  workspaceRolePath,
} from '../utils/authNavigation';
import { PageErrorBoundary } from './PageErrorBoundary';
import ColorModeSwitcher from './ColorModeSwitcher';
import { AiAssistantIcon } from '../components/icons';

const { Header, Sider, Content } = Layout;

/** 系统版本号:优先取构建时注入的 VITE_APP_VERSION,缺省回落到默认值 */
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.1.0';

/** 角色顶层路径前缀,用于推断当前在哪个角色端 */
type RoleSection = WorkspaceRole;

/** 路径片段 -> 显示文案,顶部面包屑使用 */
const segmentLabel: Record<string, string> = {
  owner: '任务负责人后台',
  labeler: '标注员',
  reviewer: '审核员',
  'ai-reviewer': 'AI 审核后台',
  rules: '规则管理',
  jobs: 'Job 队列',
  market: '任务市场',
  'my-tasks': '我的任务',
  drafts: '草稿箱',
  returned: '打回项',
  tasks: '任务管理',
  templates: '模板搭建',
  designer: 'Designer',
  datasets: '数据集',
  'ai-review': 'AI 预审规则',
  review: '人工审核',
  dashboard: '数据看板',
  export: '导出中心',
  overview: '工作概览',
  ai: '待审队列',
  answer: '答题',
  disputes: '争议样本',
  reports: '审核报表',
  settings: '系统设置',
  appearance: '外观主题',
  model: '模型配置',
};

/**
 * Owner 端导航对齐计划书 4.1 / 4.2 / 4.4 / 4.5 / 4.6:
 * - 数据生产组:数据集 / 模板搭建 / 任务管理
 *   按"先有数据 → 再建模板 → 最后发布任务"的真实工作流顺序排列
 * - 审核与质检组:AI 预审规则 / 人工审核
 * - 数据交付组:数据看板 / 导出中心
 */
const ownerMenuItems: MenuProps['items'] = [
  {
    type: 'group',
    key: 'g-owner-produce',
    label: '数据生产',
    children: [
      { key: '/owner/datasets', icon: <DatabaseOutlined />, label: '数据集' },
      { key: '/owner/templates', icon: <AppstoreOutlined />, label: '模板搭建' },
      { key: '/owner/tasks', icon: <ProjectOutlined />, label: '任务管理' },
    ],
  },
  {
    type: 'group',
    key: 'g-owner-review',
    label: '审核与质检',
    children: [
      { key: '/owner/ai-review', icon: <AiAssistantIcon />, label: 'AI 预审规则' },
      { key: '/owner/settings/model', icon: <ApiOutlined />, label: '模型配置' },
      { key: '/owner/review', icon: <AuditOutlined />, label: '人工审核' },
    ],
  },
  {
    type: 'group',
    key: 'g-owner-deliver',
    label: '数据交付',
    children: [
      { key: '/owner/dashboard', icon: <DashboardOutlined />, label: '数据看板' },
      { key: '/owner/export', icon: <ExportOutlined />, label: '导出中心' },
    ],
  },
];

/**
 * Labeler 端导航对齐计划书 2.1 与 4.3,按"工作概览 / 任务"两组展示。
 * - 概览组:Dashboard
 * - 任务组:任务市场 / 我的任务 / 草稿箱 / 打回项
 */
const labelerMenuItems: MenuProps['items'] = [
  {
    type: 'group',
    key: 'g-workspace',
    label: 'WORKSPACE',
    children: [
      { key: '/labeler', icon: <AppstoreOutlined />, label: '工作概览' },
    ],
  },
  {
    type: 'group',
    key: 'g-tasks',
    label: 'TASKS',
    children: [
      { key: '/labeler/market', icon: <ShopOutlined />, label: '任务市场' },
      { key: '/labeler/my-tasks', icon: <FileTextOutlined />, label: '我的任务' },
      { key: '/labeler/drafts', icon: <EditOutlined />, label: '草稿箱' },
      { key: '/labeler/returned', icon: <ExclamationCircleOutlined />, label: '打回项' },
    ],
  },
];

/** Reviewer 端导航对齐计划书 4.5 / 4.4 / 4.6:
 * - 工作台:概览
 * - 审核动作:待审队列 / AI 审核 / 争议样本
 * - 报表:审核报表
 */
const reviewerMenuItems: MenuProps['items'] = [
  {
    type: 'group',
    key: 'g-reviewer-workspace',
    label: 'WORKSPACE',
    children: [{ key: '/reviewer', icon: <DashboardOutlined />, label: '工作概览' }],
  },
  {
    type: 'group',
    key: 'g-reviewer-review',
    label: 'REVIEW',
    children: [
      { key: '/reviewer/ai', icon: <AuditOutlined />, label: '待审队列' },
      { key: '/reviewer/disputes', icon: <ExclamationCircleOutlined />, label: '争议样本' },
    ],
  },
  {
    type: 'group',
    key: 'g-reviewer-reports',
    label: 'REPORTS',
    children: [{ key: '/reviewer/reports', icon: <FileTextOutlined />, label: '审核报表' }],
  },
];

const aiReviewerMenuItems: MenuProps['items'] = [
  {
    type: 'group',
    key: 'g-ai-reviewer',
    label: 'AI REVIEW',
    children: [
      { key: '/ai-reviewer', icon: <DashboardOutlined />, label: '作业概览' },
      { key: '/ai-reviewer/jobs', icon: <AiAssistantIcon />, label: 'Job 队列' },
      { key: '/ai-reviewer/queue', icon: <ProjectOutlined />, label: '预审队列' },
      { key: '/ai-reviewer/settings/model', icon: <ApiOutlined />, label: '模型配置' },
    ],
  },
];

function resolveSection(pathname: string): RoleSection {
  if (pathname.startsWith('/ai-reviewer')) return 'ai_reviewer';
  if (pathname.startsWith('/labeler')) return 'labeler';
  if (pathname.startsWith('/reviewer')) return 'reviewer';
  return 'owner';
}

function resolveSelectedKey(section: RoleSection, pathname: string): string {
  if (section === 'labeler') {
    const labelerKeys = ['/labeler/market', '/labeler/my-tasks', '/labeler/drafts', '/labeler/returned'];
    return labelerKeys.find((key) => pathname.startsWith(key)) ?? '/labeler';
  }
  if (section === 'owner') {
    const ownerKeys = [
      '/owner/tasks',
      '/owner/templates',
      '/owner/datasets',
      '/owner/ai-review',
      '/owner/settings/model',
      '/owner/review',
      '/owner/dashboard',
      '/owner/export',
    ];
    return ownerKeys.find((key) => pathname.startsWith(key)) ?? '/owner/tasks';
  }
  if (section === 'reviewer') {
    const reviewerKeys = [
      '/reviewer/ai',
      '/reviewer/disputes',
      '/reviewer/reports',
    ];
    return reviewerKeys.find((key) => pathname.startsWith(key)) ?? '/reviewer';
  }
  if (section === 'ai_reviewer') {
    const aiReviewerKeys = [
      '/ai-reviewer/jobs',
      '/ai-reviewer/queue',
      '/ai-reviewer/settings/model',
    ];
    return aiReviewerKeys.find((key) => pathname.startsWith(key)) ?? '/ai-reviewer';
  }
  return `/${section}`;
}

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const section = resolveSection(location.pathname);
  const selectedKey = resolveSelectedKey(section, location.pathname);

  // 侧栏折叠状态:由顶部左侧折叠按钮控制
  const [collapsed, setCollapsed] = useState(false);

  // 滚动距离 > 8px 时给 header 加上液态玻璃样式
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => getStoredAuthUser());

  useEffect(() => {
    let cancelled = false;

    const refreshCurrentUser = async () => {
      if (!getAuthToken()) {
        clearStoredAuthUser();
        navigate('/login', { replace: true });
        return;
      }

      try {
        const response = await authApi.getCurrentUser();
        if (!cancelled) {
          setCurrentUser(response.user);
        }
      } catch {
        clearAuthToken();
        clearStoredAuthUser();
        if (!cancelled) {
          navigate('/login', { replace: true });
        }
      }
    };

    void refreshCurrentUser();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const menuItems =
    section === 'labeler'
      ? labelerMenuItems
      : section === 'reviewer'
        ? reviewerMenuItems
        : section === 'ai_reviewer'
          ? aiReviewerMenuItems
          : ownerMenuItems;

  /**
   * 根据 location.pathname 拆出面包屑节点。
   * 顶层是 Home + 角色后台名称(任务负责人后台 / 标注员 / 审核员),
   * 随后按路径片段累加,例如 /owner/tasks -> 任务负责人后台 / 任务管理。
   * 父级片段可点跳转,末级为当前页只显示文字。
   */
  const breadcrumbItems = (() => {
    const parts = location.pathname.split('/').filter(Boolean);
    const rootLabel =
      section === 'owner'
        ? '任务负责人后台'
        : section === 'labeler'
          ? '标注员后台'
          : section === 'ai_reviewer'
            ? 'AI 审核后台'
            : '审核员后台';
    const items: Array<{ title: React.ReactNode; href?: string }> = [
      {
        title: (
          <span className="app-breadcrumb-root">
            <HomeOutlined />
            <span>{rootLabel}</span>
          </span>
        ),
        href: workspaceRolePath[section],
      },
    ];
    let acc = '';
    parts.forEach((segment, idx) => {
      acc += `/${segment}`;
      // 跳过第一段(角色名)避免和 root 重复
      if (idx === 0) return;
      // 跳过纯数字片段(如 assignmentId / taskId),避免面包屑显示无意义 ID
      if (/^\d+$/.test(segment)) return;
      const label = segmentLabel[segment] ?? segment;
      const isLast = idx === parts.length - 1;
      items.push({
        title: <span>{label}</span>,
        href: isLast ? undefined : acc,
      });
    });
    return items.map((item) => ({
      title: item.href ? (
        <a
          href={item.href}
          onClick={(event) => {
            event.preventDefault();
            navigate(item.href!);
          }}
        >
          {item.title}
        </a>
      ) : (
        item.title
      ),
    }));
  })();

  const switchableRoles = (currentUser?.roles ?? [])
    .filter(isWorkspaceRole);
  const visibleRoles = switchableRoles.length > 0 ? switchableRoles : [section];

  async function handleUserMenuClick({ key }: { key: string }) {
    if (key.startsWith('switch:')) {
      const role = key.replace('switch:', '') as WorkspaceRole;
      navigate(workspaceRolePath[role]);
      return;
    }

    if (key === 'profile') {
      if (section === 'ai_reviewer') {
        navigate('/ai-reviewer/settings/model');
      } else if (section === 'owner') {
        navigate('/owner/settings/model');
      } else {
        message.info('个人资料将在后续用户中心阶段开放。');
      }
      return;
    }

    if (key === 'appearance') {
      navigate(`${section === 'ai_reviewer' ? '/ai-reviewer' : `/${section}`}/settings/appearance`);
      return;
    }

    if (key === 'logout') {
      await authApi.logout();
      message.success('已退出登录');
      navigate('/login', { replace: true });
    }
  }

  // 用户头像下拉菜单:支持展示身份、切换可用角色和真正退出登录
  const userMenu: MenuProps['items'] = [
    {
      key: 'user-summary',
      disabled: true,
      label: (
        <div className="app-user-menu-summary">
          <span className="app-user-menu-name">{currentUser?.displayName ?? 'LabelHub User'}</span>
          <span className="app-user-menu-meta">{currentUser?.username ?? '未同步用户信息'}</span>
        </div>
      ),
    },
    {
      key: 'profile',
      icon: section === 'ai_reviewer' || section === 'owner' ? <AiAssistantIcon /> : <UserOutlined />,
      label: section === 'ai_reviewer' || section === 'owner' ? '模型配置' : '个人资料',
    },
    { key: 'appearance', icon: <BgColorsOutlined />, label: '外观主题' },
    {
      type: 'group',
      key: 'switch-role-group',
      label: '切换角色',
      children: visibleRoles.map((role) => ({
        key: `switch:${role}`,
        icon: <SwapOutlined />,
        label: workspaceRoleLabels[role],
        disabled: role === section,
      })),
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
    },
  ];

  return (
    <Layout className="app-shell app-shell-enter">
      <Sider width={232} collapsedWidth={72} collapsed={collapsed} theme="light" trigger={null}>
        <div className="app-sider-inner">
          <div className="app-logo">
            <span className="app-logo-mark">LH</span>
            <span className="app-logo-text" aria-hidden={collapsed}>
              LabelHub
            </span>
          </div>
          <Menu
            className="app-sider-menu"
            theme="light"
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
          />
          <div className="app-sider-footer">
            <span className="app-sider-footer-full" aria-hidden={collapsed}>
              <span className="app-sider-version">LabelHub v{APP_VERSION}</span>
              <span className="app-sider-build">Phase 1 · MVP</span>
            </span>
            <span className="app-sider-version-mark" aria-hidden={!collapsed}>
              v{APP_VERSION}
            </span>
          </div>
        </div>
      </Sider>

      <Layout>
        <Header className={`app-header ${scrolled ? 'is-scrolled' : ''}`}>
          {/* 左侧:折叠按钮 + 面包屑路径 + 搜索框 */}
          <div className="app-header-left">
            <Button
              type="text"
              className="app-header-toggle"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
            />
            <Breadcrumb
              className="app-header-breadcrumb"
              separator="/"
              items={breadcrumbItems}
            />
            <Input
              className="app-header-search"
              prefix={<SearchOutlined />}
              placeholder="搜索任务、数据集或字段..."
              allowClear
              size="middle"
            />
          </div>

          {/* 中间留白 */}
          <div className="app-header-middle" />

          {/* 右侧:色彩模式切换 + 用户下拉 */}
          <div className="app-header-right">
            <ColorModeSwitcher />
            <Dropdown
              menu={{ items: userMenu, onClick: handleUserMenuClick }}
              placement="bottomRight"
              trigger={['click']}
            >
              <div className="app-header-profile" role="button">
                <div className="app-header-profile-text">
                  <Typography.Text type="secondary" className="app-header-profile-role">
                    {workspaceRoleLabels[section]}
                  </Typography.Text>
                  {currentUser?.displayName && (
                    <Typography.Text className="app-header-profile-name">
                      {currentUser.displayName}
                    </Typography.Text>
                  )}
                </div>
                <Badge dot status="success" offset={[-6, 28]}>
                  <Avatar
                    icon={<UserOutlined />}
                    style={{ background: 'var(--lh-primary)' }}
                  />
                </Badge>
              </div>
            </Dropdown>
          </div>
        </Header>

        <Content className="app-content">
          <PageErrorBoundary>
            <Outlet />
          </PageErrorBoundary>
        </Content>
      </Layout>
    </Layout>
  );
}
