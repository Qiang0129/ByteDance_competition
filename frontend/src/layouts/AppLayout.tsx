import {
  AuditOutlined,
  CheckCircleOutlined,
  LogoutOutlined,
  ProjectOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Layout, Menu, Space, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const { Header, Sider, Content } = Layout;

const routeKeys = ['/owner', '/labeler', '/reviewer'];

const routeTitles: Record<string, string> = {
  '/owner': '项目方工作台',
  '/labeler': '标注员工作台',
  '/reviewer': '审核员工作台',
};

const navigationItems: MenuProps['items'] = [
  {
    key: '/owner',
    icon: <ProjectOutlined />,
    label: '项目方',
  },
  {
    key: '/labeler',
    icon: <TeamOutlined />,
    label: '标注员',
  },
  {
    key: '/reviewer',
    icon: <AuditOutlined />,
    label: '审核员',
  },
];

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedKey =
    routeKeys.find((routeKey) => location.pathname.startsWith(routeKey)) ?? '/owner';

  return (
    <Layout className="app-shell app-shell-enter">
      <Sider width={232} theme="dark">
        <div className="app-logo">
          <span className="app-logo-mark">LH</span>
          <span>LabelHub</span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={navigationItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>

      <Layout>
        <Header className="app-header">
          <div className="app-header-title">
            <Typography.Text className="app-header-name" strong>
              {routeTitles[selectedKey]}
            </Typography.Text>
            <Typography.Text type="secondary" className="app-header-sub">
              第一阶段 UI 框架已就绪,后续接入 Spring Boot 认证与 RBAC。
            </Typography.Text>
          </div>

          <Space size="middle" className="app-header-actions">
            <Tag icon={<CheckCircleOutlined />} color="processing" className="app-header-phase">
              Phase 1
            </Tag>
            <Space size={8} className="app-header-user">
              <Avatar icon={<UserOutlined />} style={{ background: '#2f7bff' }} />
              <span>演示用户</span>
            </Space>
            <Button icon={<LogoutOutlined />} onClick={() => navigate('/login')}>
              退出
            </Button>
          </Space>
        </Header>

        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
