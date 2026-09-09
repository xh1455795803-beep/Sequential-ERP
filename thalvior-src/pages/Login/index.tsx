// 极简白底风格登录页
import { useState, useEffect, useRef } from 'react';
import { Form, Input, Button, Typography, message, Checkbox, Segmented, Divider } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  MobileOutlined,
  MailOutlined,
  WechatOutlined,
  RightOutlined,
} from '@ant-design/icons';
import BrandLogo from '../../components/BrandLogo';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { authApi } from '../../api';

const { Title, Text } = Typography;

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const nav = useNavigate();
  const { token, setAuth } = useAuthStore();
  const [pwdVisible, setPwdVisible] = useState(false);
  const [remember, setRemember] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<'password' | 'phone' | 'email' | 'wechat'>('password');
  const [codeForm] = Form.useForm();
  const [wechatForm] = Form.useForm();
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<any>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('thalvior_login_username');
    if (saved) form.setFieldsValue({ username: saved });
  }, [form]);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  if (token) return <Navigate to="/workbench/overview" replace />;

  const onLoginSuccess = (res: { token: string; user: any }) => {
    setAuth(res.token, res.user);
    message.success('登录成功');
    nav('/workbench/overview', { replace: true });
  };

  const onSubmit = async (vals: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await authApi.login(vals.username, vals.password);
      if (remember) localStorage.setItem('thalvior_login_username', vals.username);
      else localStorage.removeItem('thalvior_login_username');
      onLoginSuccess(res);
    } catch (e: any) {
      // 错误已由 axios 拦截器提示
    } finally {
      setLoading(false);
    }
  };

  const onSendCode = async (type: 'phone' | 'email') => {
    try {
      const vals = await codeForm.validateFields([type === 'phone' ? 'phone' : 'email']);
      setSending(true);
      const res = await authApi.sendCode(type, vals[type === 'phone' ? 'phone' : 'email']);
      if (res.devCode) {
        codeForm.setFieldsValue({ code: res.devCode });
        message.success(`开发模式: 验证码 ${res.devCode} 已自动填入`);
      } else {
        message.success('验证码已发送, 请注意查收');
      }
      setCountdown(60);
      timerRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) { if (timerRef.current) clearInterval(timerRef.current); return 0; }
          return c - 1;
        });
      }, 1000);
    } catch (e: any) {
      // 错误已提示
    } finally {
      setSending(false);
    }
  };

  const onSubmitCode = async (type: 'phone' | 'email') => {
    try {
      const vals = await codeForm.validateFields();
      const account = vals[type === 'phone' ? 'phone' : 'email'];
      setLoading(true);
      const res = await authApi.loginByCode(type, account, vals.code);
      onLoginSuccess(res);
    } catch (e: any) {
      // 错误已提示
    } finally {
      setLoading(false);
    }
  };

  const onSubmitWechat = async () => {
    try {
      const vals = await wechatForm.validateFields();
      setLoading(true);
      const res = await authApi.wechatLogin(vals.code);
      onLoginSuccess(res);
    } catch (e: any) {
      // 错误已由 axios 拦截器提示
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    height: 44, borderRadius: 8, background: '#fff', border: '1px solid #E5E6EB', fontSize: 14,
  };

  const submitBtnStyle = {
    height: 44, borderRadius: 8, background: '#1D2129', border: 'none', fontSize: 15, fontWeight: 600,
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: '#fff', padding: '40px 24px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40,
          opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0)' : 'translateY(8px)',
          transition: 'all 0.4s ease',
        }}
      >
        <div
          style={{
            width: 32, height: 32, borderRadius: 8, background: '#1D2129',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <BrandLogo size={18} />
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#1D2129', letterSpacing: 0.5 }}>thalvior</span>
      </div>

      <div
        style={{
          width: 420, maxWidth: '100%',
          opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0)' : 'translateY(12px)',
          transition: 'all 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <Title level={2} style={{ margin: 0, fontWeight: 700, fontSize: 28, color: '#1D2129', textAlign: 'center' }}>
          欢迎回来
        </Title>
        <Text style={{ display: 'block', marginTop: 8, marginBottom: 32, fontSize: 14, color: '#86909C', textAlign: 'center' }}>
          登录 thalvior 管理您的跨境业务
        </Text>

        <Segmented
          block
          value={mode}
          onChange={(v) => setMode(v as any)}
          options={[
            { label: '账号密码', value: 'password' },
            { label: '手机号', value: 'phone' },
            { label: '邮箱', value: 'email' },
            { label: '微信', value: 'wechat' },
          ]}
          style={{ marginBottom: 24, padding: 4, background: '#F2F3F5' }}
        />

        <div
          style={{
            background: '#fff', borderRadius: 12, border: '1px solid #E5E6EB',
            padding: '28px 28px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          {mode === 'password' && (
            <Form form={form} layout="vertical" onFinish={onSubmit} requiredMark={false} size="large">
              <Form.Item name="username" rules={[{ required: true, message: '请输入账号' }]} style={{ marginBottom: 16 }}>
                <Input
                  prefix={<UserOutlined style={{ color: '#86909C' }} />}
                  placeholder="账号 / 手机号 / 邮箱"
                  autoComplete="username"
                  style={inputStyle}
                  styles={{ input: { background: 'transparent', fontSize: 14 } }}
                />
              </Form.Item>

              <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]} style={{ marginBottom: 8 }}>
                <Input
                  prefix={<LockOutlined style={{ color: '#86909C' }} />}
                  placeholder="密码"
                  autoComplete="current-password"
                  type={pwdVisible ? 'text' : 'password'}
                  suffix={
                    <span
                      onClick={() => setPwdVisible(!pwdVisible)}
                      style={{ cursor: 'pointer', color: '#86909C', display: 'flex', alignItems: 'center' }}
                    >
                      {pwdVisible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                    </span>
                  }
                  style={inputStyle}
                  styles={{ input: { background: 'transparent', fontSize: 14 } }}
                />
              </Form.Item>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 0 20px' }}>
                <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ color: '#4E5969', fontSize: 13 }}>
                  记住账号
                </Checkbox>
                <a style={{ color: '#86909C', fontSize: 13 }} href="#">忘记密码?</a>
              </div>

              <Button type="primary" htmlType="submit" loading={loading} block style={submitBtnStyle}>
                登 录
              </Button>
            </Form>
          )}

          {mode === 'phone' && (
            <Form form={codeForm} layout="vertical" onFinish={() => onSubmitCode('phone')} requiredMark={false} size="large">
              <Form.Item
                name="phone"
                rules={[{ required: true, message: '请输入手机号' }, { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' }]}
                style={{ marginBottom: 16 }}
              >
                <Input
                  prefix={<MobileOutlined style={{ color: '#86909C' }} />}
                  placeholder="手机号"
                  maxLength={11}
                  autoComplete="tel"
                  style={inputStyle}
                  styles={{ input: { background: 'transparent', fontSize: 14 } }}
                />
              </Form.Item>

              <Form.Item name="code" rules={[{ required: true, message: '请输入验证码' }]} style={{ marginBottom: 20 }}>
                <Input
                  prefix={<LockOutlined style={{ color: '#86909C' }} />}
                  placeholder="验证码"
                  maxLength={6}
                  suffix={
                    <Button
                      type="link"
                      size="small"
                      disabled={countdown > 0 || sending}
                      loading={sending}
                      onClick={() => onSendCode('phone')}
                      style={{ color: '#1D2129', fontWeight: 500 }}
                    >
                      {countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
                    </Button>
                  }
                  style={inputStyle}
                  styles={{ input: { background: 'transparent', fontSize: 14 } }}
                />
              </Form.Item>

              <Button type="primary" htmlType="submit" loading={loading} block style={submitBtnStyle}>
                手机号登录
              </Button>
            </Form>
          )}

          {mode === 'email' && (
            <Form form={codeForm} layout="vertical" onFinish={() => onSubmitCode('email')} requiredMark={false} size="large">
              <Form.Item
                name="email"
                rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '邮箱格式不正确' }]}
                style={{ marginBottom: 16 }}
              >
                <Input
                  prefix={<MailOutlined style={{ color: '#86909C' }} />}
                  placeholder="邮箱地址"
                  autoComplete="email"
                  style={inputStyle}
                  styles={{ input: { background: 'transparent', fontSize: 14 } }}
                />
              </Form.Item>

              <Form.Item name="code" rules={[{ required: true, message: '请输入验证码' }]} style={{ marginBottom: 20 }}>
                <Input
                  prefix={<LockOutlined style={{ color: '#86909C' }} />}
                  placeholder="验证码"
                  maxLength={6}
                  suffix={
                    <Button
                      type="link"
                      size="small"
                      disabled={countdown > 0 || sending}
                      loading={sending}
                      onClick={() => onSendCode('email')}
                      style={{ color: '#1D2129', fontWeight: 500 }}
                    >
                      {countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
                    </Button>
                  }
                  style={inputStyle}
                  styles={{ input: { background: 'transparent', fontSize: 14 } }}
                />
              </Form.Item>

              <Button type="primary" htmlType="submit" loading={loading} block style={submitBtnStyle}>
                邮箱登录
              </Button>
            </Form>
          )}

          {mode === 'wechat' && (
            <Form form={wechatForm} layout="vertical" onFinish={onSubmitWechat} requiredMark={false} size="large">
              <Form.Item name="code" rules={[{ required: true, message: '请输入微信授权 code' }]} style={{ marginBottom: 8 }}>
                <Input
                  prefix={<WechatOutlined style={{ color: '#07C160' }} />}
                  placeholder="微信 OAuth 授权 code"
                  style={inputStyle}
                  styles={{ input: { background: 'transparent', fontSize: 14 } }}
                />
              </Form.Item>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 18 }}>
                需在系统 .env 配置 WECHAT_APPID / WECHAT_SECRET 后使用; 未绑定 ERP 账号的微信无法登录
              </Text>
              <Button type="primary" htmlType="submit" loading={loading} block style={{ ...submitBtnStyle, background: '#07C160' }}>
                微信登录
              </Button>
            </Form>
          )}

          <Divider plain style={{ margin: '20px 0 14px', color: '#86909C', fontSize: 12 }}>其他方式</Divider>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 24 }}>
            <Button shape="circle" size="large" icon={<MobileOutlined />} onClick={() => setMode('phone')}
              style={{ color: mode === 'phone' ? '#1D2129' : '#86909C', borderColor: '#E5E6EB' }} title="手机号登录" />
            <Button shape="circle" size="large" icon={<MailOutlined />} onClick={() => setMode('email')}
              style={{ color: mode === 'email' ? '#1D2129' : '#86909C', borderColor: '#E5E6EB' }} title="邮箱登录" />
            <Button shape="circle" size="large" icon={<WechatOutlined />} onClick={() => setMode('wechat')}
              style={{ color: mode === 'wechat' ? '#07C160' : '#86909C', borderColor: '#E5E6EB' }} title="微信登录" />
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 22, fontSize: 14 }}>
          <Text style={{ color: '#86909C' }}>还没有账号? </Text>
          <Link to="/register" style={{ color: '#1D2129', fontWeight: 600 }}>
            立即注册 <RightOutlined style={{ fontSize: 11 }} />
          </Link>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, color: '#86909C', fontSize: 12 }}>
          登录即表示同意 <a style={{ color: '#1D2129', textDecoration: 'underline' }} href="#">服务条款</a>{' '}
          和 <a style={{ color: '#1D2129', textDecoration: 'underline' }} href="#">隐私政策</a>
        </div>
      </div>
    </div>
  );
}
