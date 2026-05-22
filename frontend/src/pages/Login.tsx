import { useState } from 'react';
import {
  KeyOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { App, Button, Form, Input, Select } from 'antd';
import { useNavigate } from 'react-router-dom';

import { authApi } from '../api/auth';
import type { LoginRequest, RegisterRequest, UserRole } from '../types/auth';

type AuthMode = 'login' | 'signup';

type SignupFormValues = Pick<RegisterRequest, 'username' | 'password'>;

const roleOptions: Array<{ label: string; value: UserRole }> = [
  { label: 'Owner', value: 'owner' },
  { label: 'Labeler', value: 'labeler' },
  { label: 'Reviewer', value: 'reviewer' },
];

export default function Login() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  // 登录/注册模式:仅控制翻转动画与左侧标题文案
  const [mode, setMode] = useState<AuthMode>('login');
  // 登录成功后的离场动画状态:开启后页面淡出,过渡结束再跳转
  const [leaving, setLeaving] = useState(false);

  const handleLoginFinish = async (values: LoginRequest) => {
    try {
      const response = await authApi.login(values);
      const role = resolveLandingRole(response.user.roles, values.role);
      message.success('Signed in successfully.');
      setLeaving(true);
      // 等离场动画跑完再跳转,避免直接 navigate 造成"闪一下"
      window.setTimeout(() => {
        navigate(`/${role}`);
      }, 480);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Sign in failed.');
    }
  };

  const resolveLandingRole = (roles: UserRole[], selectedRole?: UserRole) => {
    if (selectedRole && roles.includes(selectedRole)) {
      return selectedRole;
    }

    return roles.find((role) => role === 'owner' || role === 'labeler' || role === 'reviewer') ?? 'owner';
  };

  const handleSignupFinish = async (values: SignupFormValues) => {
    try {
      await authApi.register({ ...values, role: 'labeler' });
      message.success('Account created. Please sign in.');
      setMode('login');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Sign up failed.');
    }
  };

  return (
    <main className={`login-page${leaving ? ' is-leaving' : ''}`}>
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
            <svg viewBox="0 0 64 64" aria-hidden focusable="false">
              <circle cx="32" cy="20" r="11" />
              <path d="M12 56 C12 41 20 35 32 35 C44 35 52 41 52 56 Z" />
            </svg>
          </div>
          <div className="login-side-title">
            {mode === 'login' ? 'ACCOUNT LOGIN' : 'CREATE ACCOUNT'}
          </div>
        </div>

        {/* 翻转卡片:正面登录,背面注册 */}
        <div className={`login-card-flip${mode === 'signup' ? ' is-flipped' : ''}`}>
          <div className="login-card-inner">
            {/* 正面:登录 */}
            <section className="login-card login-card-face login-card-face--front">
              <div className="login-avatar">
                <UserOutlined />
              </div>

              <h1 className="login-welcome">Welcome back</h1>

              <Form<LoginRequest>
                layout="vertical"
                initialValues={{ role: 'owner' }}
                onFinish={handleLoginFinish}
                requiredMark={false}
              >
                <Form.Item
                  name="username"
                  rules={[{ required: true, message: 'Please enter username' }]}
                >
                  <Input
                    className="login-input"
                    prefix={<UserOutlined />}
                    placeholder="Username"
                    size="large"
                    autoComplete="username"
                  />
                </Form.Item>

                <Form.Item
                  name="password"
                  rules={[{ required: true, message: 'Please enter password' }]}
                >
                  <Input.Password
                    className="login-input"
                    prefix={<KeyOutlined />}
                    placeholder="Password"
                    size="large"
                    autoComplete="current-password"
                  />
                </Form.Item>

                <Form.Item
                  name="role"
                  rules={[{ required: true, message: 'Please select a role' }]}
                >
                  <Select
                    className="login-input login-input-select"
                    options={roleOptions}
                    size="large"
                    suffixIcon={<TeamOutlined />}
                    placeholder="Select role"
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
                    setMode('signup');
                  }}
                >
                  signup
                </a>
              </div>
            </section>

            {/* 背面:注册 */}
            <section className="login-card login-card-face login-card-face--back">
              <div className="login-avatar">
                <UserOutlined />
              </div>

              <h1 className="login-welcome">Let&apos;s get started</h1>

              <Form<SignupFormValues>
                layout="vertical"
                onFinish={handleSignupFinish}
                requiredMark={false}
              >
                <Form.Item
                  name="username"
                  rules={[{ required: true, message: 'Please enter username' }]}
                >
                  <Input
                    className="login-input"
                    prefix={<UserOutlined />}
                    placeholder="Username"
                    size="large"
                    autoComplete="username"
                  />
                </Form.Item>

                <Form.Item
                  name="password"
                  rules={[{ required: true, message: 'Please enter password' }]}
                >
                  <Input.Password
                    className="login-input"
                    prefix={<KeyOutlined />}
                    placeholder="Password"
                    size="large"
                    autoComplete="new-password"
                  />
                </Form.Item>

                <Button
                  type="primary"
                  htmlType="submit"
                  size="large"
                  block
                  className="login-submit"
                >
                  SIGNUP
                </Button>
              </Form>

              <div className="login-footer">
                Already have an account ?
                <a
                  href="#login"
                  onClick={(event) => {
                    event.preventDefault();
                    setMode('login');
                  }}
                >
                  login
                </a>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
