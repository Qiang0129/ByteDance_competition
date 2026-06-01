import { useEffect, useState } from 'react';
import {
  KeyOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { App, Button, Form, Input, Select } from 'antd';
import { useNavigate } from 'react-router-dom';

import { authApi, clearStoredAuthUser, getStoredAuthUser } from '../api/auth';
import { clearAuthToken, getAuthToken } from '../api/client';
import type { LoginRequest, RegisterRequest, UserRole } from '../types/auth';
import { resolveLandingPath } from '../utils/authNavigation';

type AuthMode = 'login' | 'signup';
type LoginRole = Exclude<UserRole, 'admin' | 'system_agent'>;
type DemoLoginSource = LoginRole | 'allRoles';
type LoginSource = 'manual' | DemoLoginSource;

type SignupFormValues = Pick<RegisterRequest, 'username' | 'password'>;

const roleOptions: Array<{ label: string; value: LoginRole }> = [
  { label: '任务方', value: 'owner' },
  { label: '标注员', value: 'labeler' },
  { label: '人工审核员', value: 'reviewer' },
  { label: 'AI 审核员', value: 'ai_reviewer' },
];

const demoAccounts: Array<{
  source: DemoLoginSource;
  role: LoginRole;
  label: string;
  username: string;
  password: string;
}> = [
  { source: 'allRoles', role: 'owner', label: '全部角色', username: 'demo', password: 'demo123' },
  { source: 'owner', role: 'owner', label: '任务方', username: 'owner', password: 'owner123' },
  { source: 'labeler', role: 'labeler', label: '标注员', username: 'labeler', password: 'labeler123' },
  { source: 'reviewer', role: 'reviewer', label: '人工审核员', username: 'reviewer', password: 'reviewer123' },
  { source: 'ai_reviewer', role: 'ai_reviewer', label: 'AI 审核员', username: 'ai_reviewer', password: 'ai_reviewer123' },
];

export default function Login() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  // 登录/注册模式:仅控制翻转动画与左侧标题文案
  const [mode, setMode] = useState<AuthMode>('login');
  // 登录成功后的离场动画状态:开启后页面淡出,过渡结束再跳转
  const [leaving, setLeaving] = useState(false);
  const [signingIn, setSigningIn] = useState<LoginSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    const redirectSignedInUser = async () => {
      if (!getAuthToken()) {
        return;
      }

      try {
        const response = await authApi.getCurrentUser();
        if (!cancelled) {
          navigate(resolveLandingPath(response.user.roles), { replace: true });
        }
      } catch {
        clearStoredAuthUser();
        clearAuthToken();
      }
    };

    const storedUser = getStoredAuthUser();
    if (storedUser && getAuthToken()) {
      navigate(resolveLandingPath(storedUser.roles), { replace: true });
      return undefined;
    }

    void redirectSignedInUser();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleLoginFinish = async (values: LoginRequest, source: LoginSource = 'manual') => {
    setSigningIn(source);
    try {
      const response = await authApi.login(values);
      const landingPath = resolveLandingPath(response.user.roles, values.role);
      message.success('登录成功');
      setLeaving(true);
      // 等离场动画跑完再跳转,避免直接 navigate 造成"闪一下"
      window.setTimeout(() => {
        navigate(landingPath);
      }, 480);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败');
      setSigningIn(null);
    }
  };

  const handleSignupFinish = async (values: SignupFormValues) => {
    try {
      await authApi.register({ ...values, role: 'labeler' });
      message.success('账号创建成功，请登录');
      setMode('login');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '注册失败');
    }
  };

  return (
    <main className={`login-page${leaving ? ' is-leaving' : ''}`}>
      {/* 右上角装饰圆球 */}
      <span className="login-blob login-blob-large" aria-hidden />
      <span className="login-blob login-blob-small" aria-hidden />

      {/* 底部波浪:fill 用 currentColor + style 注入主题主色,实现切换跟随 */}
      <svg
        className="login-wave"
        viewBox="0 0 1440 220"
        preserveAspectRatio="none"
        aria-hidden
        style={{ color: 'var(--lh-primary)' }}
      >
        <path
          d="M0,140 C220,40 480,220 720,140 C960,60 1200,210 1440,120 L1440,220 L0,220 Z"
          fill="currentColor"
          opacity="0.18"
        />
        <path
          d="M0,170 C240,90 500,240 740,170 C980,100 1220,230 1440,150 L1440,220 L0,220 Z"
          fill="currentColor"
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
            {mode === 'login' ? '账号登录' : '创建账号'}
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

              <h1 className="login-welcome">欢迎回来</h1>

              <Form<LoginRequest>
                layout="vertical"
                initialValues={{ role: 'owner' }}
                onFinish={(values) => void handleLoginFinish(values)}
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
                  loading={signingIn === 'manual'}
                  disabled={!!signingIn && signingIn !== 'manual'}
                >
                  登录
                </Button>
              </Form>

              <div className="login-demo-panel">
                <div className="login-demo-title">演示账号</div>
                <div className="login-demo-actions">
                  {demoAccounts.map((account) => (
                    <Button
                      key={account.source}
                      icon={<TeamOutlined />}
                      className="login-demo-button"
                      loading={signingIn === account.source}
                      disabled={!!signingIn && signingIn !== account.source}
                      onClick={() => {
                        void handleLoginFinish(
                          {
                            username: account.username,
                            password: account.password,
                            role: account.role,
                          },
                          account.source,
                        );
                      }}
                    >
                      {account.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="login-footer">
                还没有账号？
                <a
                  href="#signup"
                  onClick={(event) => {
                    event.preventDefault();
                    setMode('signup');
                  }}
                >
                  注册
                </a>
              </div>
            </section>

            {/* 背面:注册 */}
            <section className="login-card login-card-face login-card-face--back">
              <div className="login-avatar">
                <UserOutlined />
              </div>

              <h1 className="login-welcome">创建账号</h1>

              <Form<SignupFormValues>
                layout="vertical"
                onFinish={handleSignupFinish}
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
                  注册
                </Button>
              </Form>

              <div className="login-footer">
                已有账号？
                <a
                  href="#login"
                  onClick={(event) => {
                    event.preventDefault();
                    setMode('login');
                  }}
                >
                  登录
                </a>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
