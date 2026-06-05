import { useEffect, useState } from 'react';
import {
  KeyOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { App, Button, Form, Input } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';

import { authApi, clearStoredAuthUser, getStoredAuthUser } from '../api/auth';
import { clearAuthToken, getAuthToken } from '../api/client';
import type { LoginRequest, RegisterRequest } from '../types/auth';
import { resolveLandingPath } from '../utils/authNavigation';

type AuthMode = 'login' | 'signup';
type DemoLoginSource = 'owner' | 'labeler' | 'reviewer' | 'ai_reviewer' | 'allRoles';
type LoginSource = 'manual' | DemoLoginSource;

type SignupFormValues = Pick<RegisterRequest, 'username' | 'password'>;
type LandingAuthTransitionState = {
  fromLandingAuthTransition?: boolean;
  authTransitionKind?: AuthMode;
};

const demoAccounts: Array<{
  source: DemoLoginSource;
  label: string;
  username: string;
  password: string;
}> = [
  { source: 'allRoles', label: '全部角色', username: 'demo', password: 'demo123' },
  { source: 'owner', label: '任务方', username: 'owner', password: 'owner123' },
  { source: 'labeler', label: '标注员', username: 'labeler', password: 'labeler123' },
  { source: 'reviewer', label: '人工审核员', username: 'reviewer', password: 'reviewer123' },
  { source: 'ai_reviewer', label: 'AI 审核员', username: 'ai_reviewer', password: 'ai_reviewer123' },
];

const SIGNUP_HASH = '#signup';
const LOGIN_HASH = '#login';
const LOGIN_ENTRY_ANIMATION_MS = 560;
const REVIEWER_INVITE_QUERY_KEY = 'reviewerInvite';

function resolveModeFromHash(hash: string): AuthMode {
  return hash === SIGNUP_HASH ? 'signup' : 'login';
}

function replaceAuthHash(mode: AuthMode) {
  if (typeof window === 'undefined') {
    return;
  }
  const hash = mode === 'signup' ? SIGNUP_HASH : LOGIN_HASH;
  const nextUrl = `${window.location.pathname}${window.location.search}${hash}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

function resolveReviewerInviteToken(search: string) {
  const value = new URLSearchParams(search).get(REVIEWER_INVITE_QUERY_KEY);
  return value && value.trim() ? value.trim() : null;
}

function replaceReviewerInviteSearch() {
  if (typeof window === 'undefined') {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  params.delete(REVIEWER_INVITE_QUERY_KEY);
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${LOGIN_HASH}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = App.useApp();
  const landingTransitionState = location.state as LandingAuthTransitionState | null;
  const initialEntryKind =
    landingTransitionState?.fromLandingAuthTransition === true
      ? landingTransitionState.authTransitionKind ?? resolveModeFromHash(window.location.hash)
      : null;
  // 登录/注册模式:仅控制翻转动画与左侧标题文案
  const [mode, setMode] = useState<AuthMode>(() => resolveModeFromHash(window.location.hash));
  const [entryKind, setEntryKind] = useState<AuthMode | null>(initialEntryKind);
  // 登录成功后的离场动画状态:开启后页面淡出,过渡结束再跳转
  const [leaving, setLeaving] = useState(false);
  const [signingIn, setSigningIn] = useState<LoginSource | null>(null);
  const reviewerInviteToken = resolveReviewerInviteToken(location.search);

  useEffect(() => {
    if (!reviewerInviteToken) {
      return undefined;
    }
    let cancelled = false;
    setMode('signup');
    void authApi.validateReviewerInvitation(reviewerInviteToken).then((result) => {
      if (cancelled || result.valid) return;
      const reasonText = result.reason === 'expired'
        ? '审核员邀请链接已过期'
        : result.reason === 'used'
          ? '审核员邀请链接已被使用'
          : '审核员邀请链接无效';
      message.warning(reasonText);
    }).catch(() => {
      if (!cancelled) {
        message.warning('审核员邀请链接校验失败，提交注册时会再次校验');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [message, reviewerInviteToken]);

  useEffect(() => {
    setMode(resolveModeFromHash(location.hash));
  }, [location.hash]);

  useEffect(() => {
    if (!entryKind) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setEntryKind(null);
      navigate(`${location.pathname}${location.search}${location.hash}`, {
        replace: true,
        state: null,
      });
    }, LOGIN_ENTRY_ANIMATION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [entryKind, location.hash, location.pathname, location.search, navigate]);

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
      const landingPath = resolveLandingPath(response.user.roles);
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
      await authApi.register({
        ...values,
        role: 'labeler',
        inviteToken: reviewerInviteToken ?? undefined,
      });
      if (reviewerInviteToken) {
        replaceReviewerInviteSearch();
        message.success('审核员账号创建成功，请使用人工审核员身份登录');
      } else {
        replaceAuthHash('login');
        message.success('账号创建成功，请登录');
      }
      setMode('login');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '注册失败');
    }
  };

  return (
    <main
      className={`login-page${leaving ? ' is-leaving' : ''}${
        entryKind ? ` is-entering-from-landing is-entering-${entryKind}` : ''
      }`}
    >
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
                    replaceAuthHash('signup');
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
                    replaceAuthHash('login');
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
