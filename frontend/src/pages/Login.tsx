import { useEffect, useRef, useState } from 'react';
import {
  KeyOutlined,
  MailOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { App, Button, Form, Input } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';

import { authApi, clearStoredAuthUser, getStoredAuthUser } from '../api/auth';
import { clearAuthToken, getAuthToken } from '../api/client';
import TurnstileWidget, { type TurnstileWidgetHandle } from '../components/TurnstileWidget';
import type { LoginRequest, RegisterRequest } from '../types/auth';
import { resolveLandingPath } from '../utils/authNavigation';

type AuthMode = 'login' | 'signup' | 'forgot';
type LandingAuthMode = Exclude<AuthMode, 'forgot'>;
type PasswordResetStep = 'request' | 'confirm';

type LoginFormValues = Pick<LoginRequest, 'username' | 'password'>;
type SignupFormValues = Pick<RegisterRequest, 'username' | 'password'>;
type PasswordResetFormValues = {
  username: string;
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
};
type LandingAuthTransitionState = {
  fromLandingAuthTransition?: boolean;
  authTransitionKind?: LandingAuthMode;
};

const SIGNUP_HASH = '#signup';
const FORGOT_HASH = '#forgot';
const LOGIN_HASH = '#login';
const LOGIN_ENTRY_ANIMATION_MS = 560;
const REVIEWER_INVITE_QUERY_KEY = 'reviewerInvite';
const OWNER_INVITE_QUERY_KEY = 'ownerInvite';
const DEFAULT_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
const TURNSTILE_SITE_KEY =
  import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() || DEFAULT_TURNSTILE_SITE_KEY;

function resolveModeFromHash(hash: string): AuthMode {
  if (hash === SIGNUP_HASH) {
    return 'signup';
  }
  if (hash === FORGOT_HASH) {
    return 'forgot';
  }
  return 'login';
}

function replaceAuthHash(mode: AuthMode) {
  if (typeof window === 'undefined') {
    return;
  }
  const hash = mode === 'signup' ? SIGNUP_HASH : mode === 'forgot' ? FORGOT_HASH : LOGIN_HASH;
  const nextUrl = `${window.location.pathname}${window.location.search}${hash}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

function resolveReviewerInviteToken(search: string) {
  const value = new URLSearchParams(search).get(REVIEWER_INVITE_QUERY_KEY);
  return value && value.trim() ? value.trim() : null;
}

function resolveOwnerInviteToken(search: string) {
  const value = new URLSearchParams(search).get(OWNER_INVITE_QUERY_KEY);
  return value && value.trim() ? value.trim() : null;
}

function replaceReviewerInviteSearch() {
  if (typeof window === 'undefined') {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  params.delete(REVIEWER_INVITE_QUERY_KEY);
  params.delete(OWNER_INVITE_QUERY_KEY);
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${LOGIN_HASH}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

function resolveTurnstileSize(): 'normal' | 'compact' {
  if (typeof window === 'undefined') {
    return 'normal';
  }
  return window.matchMedia('(max-width: 380px)').matches ? 'compact' : 'normal';
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = App.useApp();
  const landingTransitionState = location.state as LandingAuthTransitionState | null;
  const initialEntryKind =
    landingTransitionState?.fromLandingAuthTransition === true
      ? landingTransitionState.authTransitionKind ?? (resolveModeFromHash(window.location.hash) === 'signup'
        ? 'signup'
        : 'login')
      : null;
  // 登录/注册模式:仅控制翻转动画与左侧标题文案
  const [mode, setMode] = useState<AuthMode>(() => resolveModeFromHash(window.location.hash));
  const [entryKind, setEntryKind] = useState<LandingAuthMode | null>(initialEntryKind);
  // 登录成功后的离场动画状态:开启后页面淡出,过渡结束再跳转
  const [leaving, setLeaving] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [sendingResetCode, setSendingResetCode] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [passwordResetStep, setPasswordResetStep] = useState<PasswordResetStep>('request');
  const [passwordResetIdentity, setPasswordResetIdentity] = useState<{
    username: string;
    email: string;
  } | null>(null);
  const [loginTurnstileToken, setLoginTurnstileToken] = useState<string | null>(null);
  const [signupTurnstileToken, setSignupTurnstileToken] = useState<string | null>(null);
  const [passwordResetTurnstileToken, setPasswordResetTurnstileToken] = useState<string | null>(null);
  const [turnstileSize, setTurnstileSize] =
    useState<'normal' | 'compact'>(resolveTurnstileSize);
  const loginTurnstileRef = useRef<TurnstileWidgetHandle | null>(null);
  const signupTurnstileRef = useRef<TurnstileWidgetHandle | null>(null);
  const passwordResetTurnstileRef = useRef<TurnstileWidgetHandle | null>(null);
  const reviewerInviteToken = resolveReviewerInviteToken(location.search);
  const ownerInviteToken = resolveOwnerInviteToken(location.search);

  useEffect(() => {
    if (!reviewerInviteToken) {
      return undefined;
    }
    if (ownerInviteToken) {
      message.warning('同一注册链接不能同时包含审核员和负责人邀请');
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
  }, [message, ownerInviteToken, reviewerInviteToken]);

  useEffect(() => {
    if (!ownerInviteToken) {
      return undefined;
    }
    if (reviewerInviteToken) {
      message.warning('同一注册链接不能同时包含审核员和负责人邀请');
      return undefined;
    }
    let cancelled = false;
    setMode('signup');
    void authApi.validateOwnerInvitation(ownerInviteToken).then((result) => {
      if (cancelled || result.valid) return;
      const reasonText = result.reason === 'expired'
        ? '负责人邀请链接已过期'
        : result.reason === 'used'
          ? '负责人邀请链接已被使用'
          : '负责人邀请链接无效';
      message.warning(reasonText);
    }).catch(() => {
      if (!cancelled) {
        message.warning('负责人邀请链接校验失败，提交注册时会再次校验');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [message, ownerInviteToken, reviewerInviteToken]);

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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const media = window.matchMedia('(max-width: 380px)');
    const handleChange = () => {
      setTurnstileSize(media.matches ? 'compact' : 'normal');
    };
    handleChange();
    media.addEventListener('change', handleChange);
    return () => {
      media.removeEventListener('change', handleChange);
    };
  }, []);

  const resetLoginTurnstile = () => {
    setLoginTurnstileToken(null);
    loginTurnstileRef.current?.reset();
  };

  const resetSignupTurnstile = () => {
    setSignupTurnstileToken(null);
    signupTurnstileRef.current?.reset();
  };

  const resetPasswordResetTurnstile = () => {
    setPasswordResetTurnstileToken(null);
    passwordResetTurnstileRef.current?.reset();
  };

  const switchAuthMode = (nextMode: AuthMode) => {
    replaceAuthHash(nextMode);
    setMode(nextMode);
    if (nextMode !== 'forgot') {
      setPasswordResetStep('request');
      setPasswordResetIdentity(null);
      resetPasswordResetTurnstile();
    }
  };

  const handleLoginFinish = async (values: LoginFormValues) => {
    if (!loginTurnstileToken) {
      message.warning('请先完成人机验证');
      return;
    }

    const turnstileToken = loginTurnstileToken;
    setSigningIn(true);
    try {
      const response = await authApi.login({
        ...values,
        turnstileToken,
      });
      const landingPath = resolveLandingPath(response.user.roles);
      message.success('登录成功');
      setLeaving(true);
      // 等离场动画跑完再跳转,避免直接 navigate 造成"闪一下"
      window.setTimeout(() => {
        navigate(landingPath);
      }, 480);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败');
      setSigningIn(false);
      resetLoginTurnstile();
    }
  };

  const handleSignupFinish = async (values: SignupFormValues) => {
    if (!signupTurnstileToken) {
      message.warning('请先完成人机验证');
      return;
    }

    const turnstileToken = signupTurnstileToken;
    try {
      await authApi.register({
        ...values,
        role: 'labeler',
        inviteToken: reviewerInviteToken ?? undefined,
        ownerInviteToken: ownerInviteToken ?? undefined,
        turnstileToken,
      });
      if (ownerInviteToken) {
        replaceReviewerInviteSearch();
        message.success('负责人账号创建成功，请使用任务负责人身份登录');
      } else if (reviewerInviteToken) {
        replaceReviewerInviteSearch();
        message.success('审核员账号创建成功，请使用人工审核员身份登录');
      } else {
        replaceAuthHash('login');
        message.success('账号创建成功，请登录');
      }
      setMode('login');
      resetSignupTurnstile();
    } catch (error) {
      resetSignupTurnstile();
      message.error(error instanceof Error ? error.message : '注册失败');
    }
  };

  const handlePasswordResetCodeFinish = async (
    values: Pick<PasswordResetFormValues, 'username' | 'email'>,
  ) => {
    if (!passwordResetTurnstileToken) {
      message.warning('请先完成人机验证');
      return;
    }

    const username = values.username.trim();
    const email = values.email.trim();
    const turnstileToken = passwordResetTurnstileToken;
    setSendingResetCode(true);
    try {
      await authApi.sendPasswordResetCode({
        username,
        email,
        turnstileToken,
      });
      setPasswordResetIdentity({ username, email });
      setPasswordResetStep('confirm');
      message.success('如果账号信息可验证，验证码将发送到该邮箱');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '验证码发送失败');
      resetPasswordResetTurnstile();
    } finally {
      setSendingResetCode(false);
    }
  };

  const handlePasswordResetConfirmFinish = async (
    values: Pick<PasswordResetFormValues, 'code' | 'newPassword' | 'confirmPassword'>,
  ) => {
    if (!passwordResetIdentity) {
      setPasswordResetStep('request');
      message.warning('请先发送邮箱验证码');
      return;
    }
    setResettingPassword(true);
    try {
      await authApi.confirmPasswordReset({
        username: passwordResetIdentity.username,
        email: passwordResetIdentity.email,
        code: values.code,
        newPassword: values.newPassword,
        confirmPassword: values.confirmPassword,
      });
      message.success('密码已重置，请使用新密码登录');
      setPasswordResetStep('request');
      setPasswordResetIdentity(null);
      resetPasswordResetTurnstile();
      switchAuthMode('login');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '密码重置失败');
    } finally {
      setResettingPassword(false);
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
            {mode === 'login' ? '账号登录' : mode === 'forgot' ? '找回密码' : '创建账号'}
          </div>
        </div>

        {/* 翻转卡片:正面登录,背面注册/找回密码 */}
        <div className={`login-card-flip${mode !== 'login' ? ' is-flipped' : ''}`}>
          <div className="login-card-inner">
            {/* 正面:登录 */}
            <section className="login-card login-card-face login-card-face--front">
              <div className="login-avatar">
                <UserOutlined />
              </div>

              <h1 className="login-welcome">欢迎回来</h1>

              <Form<LoginFormValues>
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

                <TurnstileWidget
                  ref={loginTurnstileRef}
                  siteKey={TURNSTILE_SITE_KEY}
                  size={turnstileSize}
                  className="login-turnstile"
                  onTokenChange={setLoginTurnstileToken}
                  onExpire={() => {
                    if (mode === 'login') {
                      message.warning('人机验证已过期，请重新验证');
                    }
                  }}
                  onError={() => {
                    if (mode === 'login') {
                      message.warning('人机验证加载失败，请稍后重试');
                    }
                  }}
                />

                <Button
                  type="primary"
                  htmlType="submit"
                  size="large"
                  block
                  className="login-submit"
                  loading={signingIn}
                  disabled={!loginTurnstileToken || signingIn}
                >
                  登录
                </Button>
              </Form>

              <div className="login-footer">
                <a
                  href="#forgot"
                  onClick={(event) => {
                    event.preventDefault();
                    switchAuthMode('forgot');
                  }}
                >
                  忘记密码
                </a>
                <span className="login-footer-separator" aria-hidden>
                  ·
                </span>
                还没有账号？
                <a
                  href="#signup"
                  onClick={(event) => {
                    event.preventDefault();
                    switchAuthMode('signup');
                  }}
                >
                  注册
                </a>
              </div>
            </section>

            {/* 背面:注册 / 找回密码 */}
            <section className="login-card login-card-face login-card-face--back">
              <div className="login-avatar">
                <UserOutlined />
              </div>

              {mode === 'forgot' ? (
                <>
                  <h1 className="login-welcome">
                    {passwordResetStep === 'request' ? '找回密码' : '重置密码'}
                  </h1>

                  {passwordResetStep === 'request' ? (
                    <Form<Pick<PasswordResetFormValues, 'username' | 'email'>>
                      layout="vertical"
                      onFinish={(values) => void handlePasswordResetCodeFinish(values)}
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
                        name="email"
                        rules={[
                          { required: true, message: '请输入邮箱' },
                          { type: 'email', message: '邮箱格式不正确' },
                        ]}
                      >
                        <Input
                          className="login-input"
                          prefix={<MailOutlined />}
                          placeholder="邮箱"
                          size="large"
                          autoComplete="email"
                        />
                      </Form.Item>

                      <TurnstileWidget
                        ref={passwordResetTurnstileRef}
                        siteKey={TURNSTILE_SITE_KEY}
                        size={turnstileSize}
                        className="login-turnstile"
                        onTokenChange={setPasswordResetTurnstileToken}
                        onExpire={() => {
                          if (mode === 'forgot') {
                            message.warning('人机验证已过期，请重新验证');
                          }
                        }}
                        onError={() => {
                          if (mode === 'forgot') {
                            message.warning('人机验证加载失败，请稍后重试');
                          }
                        }}
                      />

                      <Button
                        type="primary"
                        htmlType="submit"
                        size="large"
                        block
                        className="login-submit"
                        loading={sendingResetCode}
                        disabled={!passwordResetTurnstileToken || sendingResetCode}
                      >
                        发送验证码
                      </Button>
                    </Form>
                  ) : (
                    <Form<Pick<PasswordResetFormValues, 'code' | 'newPassword' | 'confirmPassword'>>
                      layout="vertical"
                      onFinish={(values) => void handlePasswordResetConfirmFinish(values)}
                      requiredMark={false}
                    >
                      <div className="login-reset-target">
                        <span>{passwordResetIdentity?.username}</span>
                        <small>{passwordResetIdentity?.email}</small>
                      </div>

                      <Form.Item
                        name="code"
                        rules={[
                          { required: true, message: '请输入邮箱验证码' },
                          { pattern: /^\d{6}$/, message: '请输入 6 位数字验证码' },
                        ]}
                      >
                        <Input
                          className="login-input"
                          prefix={<MailOutlined />}
                          placeholder="邮箱验证码"
                          size="large"
                          autoComplete="one-time-code"
                          inputMode="numeric"
                          maxLength={6}
                        />
                      </Form.Item>

                      <Form.Item
                        name="newPassword"
                        rules={[
                          { required: true, message: '请输入新密码' },
                          { min: 6, max: 72, message: '密码长度需为 6-72 位' },
                        ]}
                      >
                        <Input.Password
                          className="login-input"
                          prefix={<KeyOutlined />}
                          placeholder="新密码"
                          size="large"
                          autoComplete="new-password"
                        />
                      </Form.Item>

                      <Form.Item
                        name="confirmPassword"
                        dependencies={['newPassword']}
                        rules={[
                          { required: true, message: '请再次输入新密码' },
                          ({ getFieldValue }) => ({
                            validator(_, value) {
                              if (!value || getFieldValue('newPassword') === value) {
                                return Promise.resolve();
                              }
                              return Promise.reject(new Error('两次输入的新密码不一致'));
                            },
                          }),
                        ]}
                      >
                        <Input.Password
                          className="login-input"
                          prefix={<KeyOutlined />}
                          placeholder="确认新密码"
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
                        loading={resettingPassword}
                      >
                        重置密码
                      </Button>
                    </Form>
                  )}

                  <div className="login-footer">
                    {passwordResetStep === 'confirm' ? (
                      <>
                        <a
                          href="#forgot"
                          onClick={(event) => {
                            event.preventDefault();
                            setPasswordResetStep('request');
                            setPasswordResetIdentity(null);
                            resetPasswordResetTurnstile();
                          }}
                        >
                          重新发送
                        </a>
                        <span className="login-footer-separator" aria-hidden>
                          ·
                        </span>
                      </>
                    ) : null}
                    <a
                      href="#login"
                      onClick={(event) => {
                        event.preventDefault();
                        switchAuthMode('login');
                      }}
                    >
                      返回登录
                    </a>
                  </div>
                </>
              ) : (
                <>
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

                    <TurnstileWidget
                      ref={signupTurnstileRef}
                      siteKey={TURNSTILE_SITE_KEY}
                      size={turnstileSize}
                      className="login-turnstile"
                      onTokenChange={setSignupTurnstileToken}
                      onExpire={() => {
                        if (mode === 'signup') {
                          message.warning('人机验证已过期，请重新验证');
                        }
                      }}
                      onError={() => {
                        if (mode === 'signup') {
                          message.warning('人机验证加载失败，请稍后重试');
                        }
                      }}
                    />

                    <Button
                      type="primary"
                      htmlType="submit"
                      size="large"
                      block
                      className="login-submit"
                      disabled={!signupTurnstileToken}
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
                        switchAuthMode('login');
                      }}
                    >
                      登录
                    </a>
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
