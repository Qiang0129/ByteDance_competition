import { KeyOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { App, Button, Form, Input, Select, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';

import type { LoginRequest, UserRole } from '../types/auth';

const roleOptions: Array<{ label: string; value: UserRole }> = [
  { label: '项目方 Owner', value: 'owner' },
  { label: '标注员 Labeler', value: 'labeler' },
  { label: '审核员 Reviewer', value: 'reviewer' },
];

export default function Login() {
  const navigate = useNavigate();
  const { message } = App.useApp();

  const handleFinish = (values: LoginRequest) => {
    const role = values.role ?? 'owner';
    message.success('已进入演示工作台,后续将接入真实认证接口。');
    navigate(`/${role}`);
  };

  return (
    <main className="login-page">
      {/* 右上角装饰圆球 */}
      <span className="login-blob login-blob-large" aria-hidden />
      <span className="login-blob login-blob-small" aria-hidden />

      {/* 底部波浪 */}
      <svg
        className="login-wave"
        viewBox="0 0 1440 220"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          d="M0,140 C220,40 480,220 720,140 C960,60 1200,210 1440,120 L1440,220 L0,220 Z"
          fill="#2f7bff"
          opacity="0.18"
        />
        <path
          d="M0,170 C240,90 500,240 740,170 C980,100 1220,230 1440,150 L1440,220 L0,220 Z"
          fill="#2f7bff"
        />
      </svg>

      <div className="login-content">
        <div className="login-side">
          <div className="login-side-icon">
            <UserOutlined />
          </div>
          <div className="login-side-title">ACCOUNT LOGIN</div>
        </div>

        <section className="login-card">
          <div className="login-avatar">
            <UserOutlined />
          </div>

          <Typography.Title level={3} className="login-welcome">
            Welcome back
          </Typography.Title>

          <Form<LoginRequest>
            layout="vertical"
            initialValues={{ role: 'owner' }}
            onFinish={handleFinish}
            requiredMark={false}
          >
            <Form.Item
              name="username"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input
                className="login-input"
                prefix={<UserOutlined />}
                placeholder="用户名"
                size="large"
                autoComplete="username"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                className="login-input"
                prefix={<KeyOutlined />}
                placeholder="密码"
                size="large"
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item
              name="role"
              rules={[{ required: true, message: '请选择角色' }]}
            >
              <Select
                className="login-input login-input-select"
                options={roleOptions}
                size="large"
                suffixIcon={<TeamOutlined />}
                placeholder="选择角色"
              />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              className="login-submit"
            >
              LOGIN
            </Button>
          </Form>

          <div className="login-footer">
            Don&apos;t have an account ?
            <a
              href="#signup"
              onClick={(event) => {
                event.preventDefault();
                message.info('注册功能将在后续阶段开放。');
              }}
            >
              signup
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
