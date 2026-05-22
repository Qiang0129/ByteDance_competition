import { useState } from 'react';
import {
  AppstoreOutlined,
  AuditOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProjectOutlined,
  SearchOutlined,
  ShopOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Input,
  Layout,
  Menu,
  Typography,
} from 'antd';
import type { MenuProps } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const { Header, Sider, Content } = Layout;

/** 系统版本号:优先取构建时注入的 VITE_APP_VERSION,缺省回落到默认值 */
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.1.0';

/** 角色顶层路径前缀,用于推断当前在哪个角色端 */
type RoleSection = 'owner' | 'labeler' | 'reviewer';

const sectionRoleLabel: Record<RoleSection, string> = {
  owner: 'Project Owner',
  labeler: 'Labeler',
  reviewer: 'Reviewer',
};

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

/** Owner / Reviewer 暂保留单项入口,后续阶段再展开 */
const ownerMenuItems: MenuProps['items'] = [
  { key: '/owner', icon: <ProjectOutlined />, label: '项目方工作台' },
];

const reviewerMenuItems: MenuProps['items'] = [
  { key: '/reviewer', icon: <AuditOutlined />, label: '审核员工作台' },
];

function resolveSection(pathname: string): RoleSection {
  if (pathname.startsWith('/labeler')) return 'labeler';
  if (pathname.startsWith('/reviewer')) return 'reviewer';
  return 'owner';
}

function resolveSelectedKey(section: RoleSection, pathname: string): string {
  if (section !== 'labeler') return `/${section}`;
  // Labeler 选中态:精确匹配优先,根路径回落到 /labeler
  const labelerKeys = ['/labeler/market', '/labeler/my-tasks', '/labeler/drafts', '/labeler/returned'];
  return labelerKeys.find((key) => pathname.startsWith(key)) ?? '/labeler';
}

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const section = resolveSection(location.pathname);
  const selectedKey = resolveSelectedKey(section, location.pathname);

  // 侧栏折叠状态:由顶部左侧折叠按钮控制
  const [collapsed, setCollapsed] = useState(false);

  const menuItems =
    section === 'labeler'
      ? labelerMenuItems
      : section === 'reviewer'
        ? reviewerMenuItems
        : ownerMenuItems;

  // 用户头像下拉菜单:把"退出"收纳进去,符合现代后台习惯
  const userMenu: MenuProps['items'] = [
    { key: 'profile', icon: <UserOutlined />, label: '个人资料' },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: () => navigate('/login'),
    },
  ];

  return (
    <Layout className="app-shell app-shell-enter">
      <Sider width={232} collapsedWidth={72} collapsed={collapsed} theme="light" trigger={null}>
        <div className="app-sider-inner">
          <div className="app-logo">
            <span className="app-logo-mark">LH</span>
            {!collapsed && <span>LabelHub</span>}
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
            {collapsed ? (
              <span className="app-sider-version-mark">v{APP_VERSION}</span>
            ) : (
              <>
                <span className="app-sider-version">LabelHub v{APP_VERSION}</span>
                <span className="app-sider-build">Phase 1 · MVP</span>
              </>
            )}
          </div>
        </div>
      </Sider>

      <Layout>
        <Header className="app-header">
          {/* 左侧:折叠按钮 + 搜索框 */}
          <div className="app-header-left">
            <Button
              type="text"
              className="app-header-toggle"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
            />
            <Input
              className="app-header-search"
              prefix={<SearchOutlined />}
              placeholder="搜索任务、数据集或字段..."
              allowClear
              size="middle"
            />
          </div>

          {/* 中间留白(后续可放面包屑或页面标题) */}
          <div className="app-header-middle" />

          {/* 右侧:用户下拉 */}
          <div className="app-header-right">
            <Dropdown menu={{ items: userMenu }} placement="bottomRight" trigger={['click']}>
              <div className="app-header-profile" role="button">
                <div className="app-header-profile-text">
                  <Typography.Text type="secondary" className="app-header-profile-role">
                    {sectionRoleLabel[section]}
                  </Typography.Text>
                </div>
                <Badge dot status="success" offset={[-6, 28]}>
                  <Avatar icon={<UserOutlined />} style={{ background: '#2f7bff' }} />
                </Badge>
              </div>
            </Dropdown>
          </div>
        </Header>

        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
