// Axios 客户端 + 拦截器
import axios, { type AxiosResponse, type AxiosError } from 'axios';
import { message } from 'antd';
import { useAuthStore } from '../store/auth';
import { useI18nStore } from '../store/auth';
import { zhCN, enUS, jaJP } from '../i18n/locales';

export interface ApiEnvelope<T> {
  code: number;
  success: boolean;
  message: string;
  data: T;
  timestamp: string;
}

const http = axios.create({
  // 走 Vite 代理, 同源请求避免 CORS
  baseURL: import.meta.env.VITE_API_BASE || '/api',
  timeout: 15000,
});

// 模块级翻译函数 (非 hook, 供拦截器等非 React 场景使用)
const _dicts: Record<string, any> = { 'zh-CN': zhCN, 'en-US': enUS, 'ja-JP': jaJP };
function getT() {
  const locale = (useI18nStore.getState?.().locale) || 'zh-CN';
  const dict = _dicts[locale] || zhCN;
  return (key: string, params?: Record<string, string | number>) => {
    const parts = key.split('.');
    let v: any = dict;
    for (const p of parts) { v = v?.[p]; if (v === undefined) break; }
    let result = typeof v === 'string' ? v : key;
    if (params) Object.entries(params).forEach(([k, val]) => result = result.replace(new RegExp(`{${k}}`, 'g'), String(val)));
    return result;
  };
}

// 请求拦截: 自动附带 token
// 优先从 zustand store 取, 若未就绪 (persist 异步 hydration) 则直接从 localStorage 兜底
function readToken(): string | null {
  try {
    const fromStore = useAuthStore.getState().token;
    if (fromStore) return fromStore;
    // fallback: 从 localStorage 读 raw state
    const raw = localStorage.getItem('miaoerp-auth');
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed?.state?.token || null;
    }
  } catch {
    /* noop */
  }
  return null;
}

http.interceptors.request.use((config) => {
  const token = readToken();
  if (token) {
    config.headers = config.headers || {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截: 统一解包 + 错误处理
http.interceptors.response.use(
  (res: AxiosResponse<ApiEnvelope<any>>) => {
    const body = res.data;
    if (body && typeof body === 'object' && 'success' in body) {
      if (!body.success) {
        const t = getT();
        message.error(body.message || t('common.serverError'));
        return Promise.reject(new Error(body.message || 'Error'));
      }
      return { ...res, data: body.data } as any;
    }
    return res;
  },
  (err: AxiosError<ApiEnvelope<any>>) => {
    const t = getT();
    const status = err.response?.status;
    const backendMsg = err.response?.data?.message;
    // 后端返回的 message 可能已是目标语言, 若是中文兜底统一翻译
    const fallbackMsg = t('common.networkError');
    const msg = backendMsg || err.message || fallbackMsg;
    if (status === 401) {
      message.error(t('common.unauthorized'));
      useAuthStore.getState().logout();
      setTimeout(() => {
        window.location.href = '/login';
      }, 300);
    } else if (status === 403) {
      message.error(t('common.forbidden') + ': ' + msg);
    } else {
      message.error(msg);
    }
    return Promise.reject(err);
  },
);

export default http;

// 辅助函数: 直接拿 data
export async function get<T>(url: string, params?: any): Promise<T> {
  const res = await http.get<T>(url, { params });
  return res.data as T;
}
export async function post<T>(url: string, body?: any): Promise<T> {
  const res = await http.post<T>(url, body);
  return res.data as T;
}
export async function put<T>(url: string, body?: any): Promise<T> {
  const res = await http.put<T>(url, body);
  return res.data as T;
}
export async function del<T = void>(url: string, body?: any): Promise<T> {
  const res = await http.delete<T>(url, { data: body });
  return res.data as T;
}
