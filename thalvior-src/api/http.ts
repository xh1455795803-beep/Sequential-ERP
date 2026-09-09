// Axios 客户端 + 拦截器
import axios, { type AxiosResponse, type AxiosError } from 'axios';
import { message } from 'antd';
import { useAuthStore } from '../store/auth';

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
        message.error(body.message || '请求失败');
        return Promise.reject(new Error(body.message || 'Error'));
      }
      return { ...res, data: body.data } as any;
    }
    return res;
  },
  (err: AxiosError<ApiEnvelope<any>>) => {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.message || '网络错误';
    if (status === 401) {
      message.error('登录已失效, 请重新登录');
      useAuthStore.getState().logout();
      setTimeout(() => {
        window.location.href = '/login';
      }, 300);
    } else if (status === 403) {
      message.error('无权限: ' + msg);
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
