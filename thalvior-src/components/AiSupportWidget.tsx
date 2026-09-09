// AI 智能客服 - 浮动聊天组件
import { useEffect, useRef, useState } from 'react';
import { Button, Input, Badge, Spin, Tag, message as antdMessage } from 'antd';
import {
  CustomerServiceOutlined,
  SendOutlined,
  CloseOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { aiSupportApi } from '../api';
import { useNavigate } from 'react-router-dom';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  ts?: number;
  suggestions?: string[];
  links?: { label: string; path: string }[];
}

export default function AiSupportWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const sessionIdRef = useRef<string>(`web-${Date.now()}`);
  const bodyRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    if (open && messages.length === 0) {
      // 首次打开, 拉一次欢迎
      send('你好');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function send(text: string) {
    const q = (text || '').trim();
    if (!q || loading) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: q, ts: Date.now() }]);
    setLoading(true);
    try {
      const r: any = await aiSupportApi.chat({ sessionId: sessionIdRef.current, message: q });
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: r.reply,
          ts: Date.now(),
          suggestions: r.suggestions,
          links: r.links,
        },
      ]);
    } catch (e: any) {
      antdMessage.error(e?.message || '客服暂时不可用, 请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    sessionIdRef.current = `web-${Date.now()}`;
    setMessages([]);
    setTimeout(() => send('你好'), 100);
  }

  return (
    <>
      {/* 浮动按钮 */}
      {!open && (
        <Button
          type="primary"
          shape="circle"
          size="large"
          icon={<CustomerServiceOutlined />}
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            zIndex: 1000,
            width: 56,
            height: 56,
            boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
          }}
          title="AI 智能客服"
        />
      )}

      {/* 聊天面板 */}
      {open && (
        <div
          style={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            zIndex: 1000,
            width: 380,
            maxWidth: '90vw',
            height: 540,
            maxHeight: '80vh',
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 16px',
              background: 'linear-gradient(135deg, #1677ff, #69b1ff)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                <CustomerServiceOutlined style={{ marginRight: 6 }} />
                AI 智能客服
              </div>
              <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
                <Badge status="success" text="在线" /> 7×24 智能回复
              </div>
            </div>
            <div>
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                onClick={reset}
                style={{ color: '#fff' }}
                title="重新开始"
              />
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                onClick={() => setOpen(false)}
                style={{ color: '#fff' }}
              />
            </div>
          </div>

          {/* Body */}
          <div
            ref={bodyRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 12,
              background: '#f7f8fa',
            }}
          >
            {messages.map((m, i) => (
              <MessageItem
                key={i}
                msg={m}
                onClickSuggestion={(s) => send(s)}
                onClickLink={(path) => {
                  setOpen(false);
                  nav(path);
                }}
              />
            ))}
            {loading && (
              <div style={{ textAlign: 'left', margin: '8px 0' }}>
                <Tag color="processing" icon={<Spin size="small" />}>
                  客服正在思考...
                </Tag>
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{ borderTop: '1px solid #f0f0f0', padding: 8, display: 'flex', gap: 6 }}>
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="输入您的问题, Enter 发送"
              autoSize={{ minRows: 1, maxRows: 3 }}
              maxLength={500}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => send(input)}
              disabled={!input.trim() || loading}
            />
          </div>
        </div>
      )}
    </>
  );
}

function MessageItem({
  msg,
  onClickSuggestion,
  onClickLink,
}: {
  msg: Message;
  onClickSuggestion: (s: string) => void;
  onClickLink: (path: string) => void;
}) {
  const isUser = msg.role === 'user';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 12,
      }}
    >
      <div style={{ maxWidth: '85%' }}>
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            background: isUser ? '#1677ff' : '#fff',
            color: isUser ? '#fff' : 'rgba(0,0,0,0.85)',
            boxShadow: isUser ? 'none' : '0 1px 2px rgba(0,0,0,0.06)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          {msg.content}
        </div>
        {/* 跳转链接 */}
        {msg.links && msg.links.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {msg.links.map((l, i) => (
              <Tag
                key={i}
                color="blue"
                style={{ cursor: 'pointer' }}
                onClick={() => onClickLink(l.path)}
              >
                {l.label} →
              </Tag>
            ))}
          </div>
        )}
        {/* 追问建议 */}
        {!isUser && msg.suggestions && msg.suggestions.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {msg.suggestions.map((s, i) => (
              <Tag
                key={i}
                style={{ cursor: 'pointer', fontSize: 12 }}
                onClick={() => onClickSuggestion(s)}
              >
                {s}
              </Tag>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
