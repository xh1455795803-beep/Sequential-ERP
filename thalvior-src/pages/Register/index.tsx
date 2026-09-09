// 极简白底风格注册页 - 与登录页风格统一
import { useState, useEffect } from 'react';
import { Form, Input, Button, Typography, message, Checkbox, Divider } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  GiftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import BrandLogo from '../../components/BrandLogo';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { registerApi, authApi } from '../../api';

const { Title, Text } = Typography;

function detectAccountType(account: string): { username?: string; email?: string; phone?: string } {
  const v = String(account || '').trim();
  if (/^1[3-9]\d{9}$/.test(v)) return { phone: v };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { email: v };
  return { username: v };
}

export default function Register() {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const nav = useNavigate();
  const { token, setAuth } = useAuthStore();
  const [pwdVisible, setPwdVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [agreed, setAgreed] = useState(true);

  useEffect(() => { setMounted(true); }, []);

  if (token) return <Navigate to="/workbench/overview" replace />;

  const onSubmit = async (vals: any) => {
    const account = String(vals.account || '').trim();
    if (!account) { message.error('请输入账号'); return; }
    const ident = detectAccountType(account);
    if (ident.username && ident.username.length < 3) {
      message.error('账号至少 3 个字符'); return;
    }
    setLoading(true);
    try {
      await registerApi.register({
        username: ident.username,
        email: ident.email,
        phone: ident.phone,
        password: vals.password,
        inviteCode: vals.inviteCode || undefined,
      });
      const loginRes = await authApi.login(account, vals.password);
      setAuth(loginRes.token, loginRes.user);
      message.success('注册成功, 14 天专业版试用已开启');
      setTimeout(() => nav('/workbench/overview', { replace: true }), 1200);
    } catch (e: any) {
      // 错误已由 axios 拦截器提示
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    height: 44,
    borderRadius: 8,
    background: '#fff',
    border: '1px solid #E5E6EB',
    fontSize: 14,
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fff',
        padding: '40px 24px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 40,
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(8px)',
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
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(12px)',
          transition: 'all 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <Title level={2} style={{ margin: 0, fontWeight: 700, fontSize: 28, color: '#1D2129', textAlign: 'center' }}>
          创建账号
        </Title>
        <Text style={{ display: 'block', marginTop: 8, marginBottom: 32, fontSize: 14, color: '#86909C', textAlign: 'center' }}>
          注册即送 14 天专业版试用
        </Text>

        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            border: '1px solid #E5E6EB',
            padding: '28px 28px 24px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <Form form={form} layout="vertical" onFinish={onSubmit} requiredMark={false} size="large">
            <Form.Item name="account" rules={[{ required: true, message: '请输入账号' }]} style={{ marginBottom: 16 }}>
              <Input
                prefix={<UserOutlined style={{ color: '#86909C' }} />}
                placeholder="账号 / 手机号 / 邮箱"
                autoComplete="username"
                style={inputStyle}
                styles={{ input: { background: 'transparent', fontSize: 14 } }}
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }, { min: 6, message: '密码至少 6 位' }]}
              style={{ marginBottom: 16 }}
            >
              <Input
                prefix={<LockOutlined style={{ color: '#86909C' }} />}
                placeholder="密码 (至少 6 位)"
                autoComplete="new-password"
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

            <Form.Item
              name="confirm"
              dependencies={['password']}
              rules={[
                { required: true, message: '请确认密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) return Promise.resolve();
                    return Promise.reject(new Error('两次密码不一致'));
                  },
                }),
              ]}
              style={{ marginBottom: 16 }}
            >
              <Input
                prefix={<LockOutlined style={{ color: '#86909C' }} />}
                placeholder="再次输入密码"
                autoComplete="new-password"
                type={confirmVisible ? 'text' : 'password'}
                suffix={
                  <span
                    onClick={() => setConfirmVisible(!confirmVisible)}
                    style={{ cursor: 'pointer', color: '#86909C', display: 'flex', alignItems: 'center' }}
                  >
                    {confirmVisible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                  </span>
                }
                style={inputStyle}
                styles={{ input: { background: 'transparent', fontSize: 14 } }}
              />
            </Form.Item>

            <Form.Item name="inviteCode" style={{ marginBottom: 16 }}>
              <Input
                prefix={<GiftOutlined style={{ color: '#86909C' }} />}
                placeholder="邀请码 (可选)"
                style={inputStyle}
                styles={{ input: { background: 'transparent', fontSize: 14 } }}
              />
            </Form.Item>

            <Checkbox
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ marginBottom: 20, color: '#4E5969', fontSize: 13 }}
            >
              我已阅读并同意 <a style={{ color: '#1D2129', textDecoration: 'underline' }} href="#">服务条款</a>{' '}
              和 <a style={{ color: '#1D2129', textDecoration: 'underline' }} href="#">隐私政策</a>
            </Checkbox>

            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              disabled={!agreed}
              block
              style={{ height: 44, borderRadius: 8, background: '#1D2129', border: 'none', fontSize: 15, fontWeight: 600 }}
            >
              注 册
            </Button>

            <Divider plain style={{ margin: '18px 0 12px', color: '#86909C', fontSize: 12 }}>或</Divider>

            <div style={{ textAlign: 'center', fontSize: 14 }}>
              <Text style={{ color: '#86909C' }}>已有账号? </Text>
              <Link to="/login" style={{ color: '#1D2129', fontWeight: 600 }}>
                返回登录 <RightOutlined style={{ fontSize: 11 }} />
              </Link>
            </div>
          </Form>
        </div>
      </div>
    </div>
  );
}
