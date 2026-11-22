/* =====================================================
   Thalvior ERP · 交互增强脚本 v2
   功能：全局交互优化、业务流程改进、用户体验增强
   ===================================================== */

(function () {
  'use strict';

  // 修复 fetch Illegal invocation 问题
  const nativeFetch = window.fetch;
  const safeFetch = function (...args) {
    return nativeFetch.apply(window, args);
  };

  const makeSafeFetch = () => {
    const fn = function (...args) {
      return safeFetch(...args);
    };
    fn.call = function (thisArg, ...args) {
      return safeFetch(...args);
    };
    fn.apply = function (thisArg, args) {
      return safeFetch(...(args || []));
    };
    fn.bind = function (thisArg, ...args) {
      return function (...moreArgs) {
        return safeFetch(...args, ...moreArgs);
      };
    };
    fn.toString = () => nativeFetch.toString();
    return fn;
  };

  try {
    const safeFn = makeSafeFetch();
    Object.defineProperty(window, 'fetch', {
      get() { return safeFn; },
      configurable: true
    });
    Object.defineProperty(globalThis, 'fetch', {
      get() { return safeFn; },
      configurable: true
    });
  } catch (e) {}

  const ThalviorEnhance = {
    init() {
      this.initNumberFormatting();
      this.initTableEnhancements();
      this.initKeyboardShortcuts();
      this.initLoadingStates();
      this.initFormEnhancements();
      this.initAutoRefresh();
      this.initClickToCopy();
      this.initSmoothScroll();
      console.log('[Thalvior Enhance] 交互增强 v2 已加载');
    },

    /* —— 数字格式化（金额千分位、数量）—— */
    initNumberFormatting() {
      const formatNumber = (el) => {
        if (el.getAttribute('data-formatted')) return;
        const text = el.textContent.trim();
        // 匹配纯数字（含小数），排除年份、日期等
        if (/^-?\d{1,3}(\.\d+)?$/.test(text) || /^-?\d{4,}(\.\d+)?$/.test(text)) {
          const num = parseFloat(text);
          if (!isNaN(num) && num !== 0 && Math.abs(num) >= 100) {
            el.textContent = num.toLocaleString('zh-CN', {
              minimumFractionDigits: num % 1 === 0 ? 0 : 2,
              maximumFractionDigits: 2
            });
            el.setAttribute('data-formatted', 'true');
            el.setAttribute('data-original-value', text);
            el.style.fontVariantNumeric = 'tabular-nums';
          }
        }
      };

      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              node.querySelectorAll('td, span, div').forEach(formatNumber);
            }
          });
        });
      });

      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    },

    /* —— 表格增强：行选中、斑马纹、表头吸顶 —— */
    initTableEnhancements() {
      document.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        if (row && row.parentElement.tagName === 'TBODY') {
          document.querySelectorAll('tr.selected-row').forEach(r => r.classList.remove('selected-row'));
          row.classList.add('selected-row');
        }
      });

      // 表头吸顶
      const style = document.createElement('style');
      style.textContent = `
        tr.selected-row { background-color: rgba(37, 99, 235, 0.06) !important; }
        tr.selected-row td { color: #1E40AF !important; font-weight: 500; }
        thead th { position: sticky; top: 0; z-index: 10; }
      `;
      document.head.appendChild(style);
    },

    /* —— 键盘快捷键 —— */
    initKeyboardShortcuts() {
      document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + K 聚焦搜索
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          e.preventDefault();
          const searchInput = document.querySelector('input[type="search"], input[placeholder*="搜索"], input[placeholder*="search"]');
          if (searchInput) searchInput.focus();
        }

        // Escape 关闭弹窗
        if (e.key === 'Escape') {
          const closeButtons = document.querySelectorAll('[role="dialog"] button[aria-label="Close"], [class*="modal"] button[class*="close"], [class*="modal"] button[aria-label*="close"]');
          if (closeButtons.length) closeButtons[closeButtons.length - 1].click();
        }

        // Ctrl/Cmd + S 保存
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          const saveBtn = [...document.querySelectorAll('button')].find(b =>
            /保存|Save|提交|Submit/.test(b.textContent)
          );
          if (saveBtn && !saveBtn.disabled) saveBtn.click();
        }

        // Ctrl/Cmd + B 切换侧边栏
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
          e.preventDefault();
          const toggleBtn = document.querySelector('button[aria-label*="菜单"], button[aria-label*="menu"], button[class*="menu"]');
          if (toggleBtn) toggleBtn.click();
        }
      });
    },

    /* —— 顶部加载指示器 —— */
    initLoadingStates() {
      const indicator = document.createElement('div');
      indicator.id = 'thalvior-loading-indicator';
      indicator.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; height: 3px;
        background: linear-gradient(90deg, #2563EB, #3B82F6, #60A5FA);
        z-index: 99999; transform: translateX(-100%);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 0 8px rgba(37, 99, 235, 0.3);
      `;
      document.body.appendChild(indicator);

      const self = this;
      document.addEventListener('fetch-start', () => self.updateLoadingIndicator(true));
      document.addEventListener('fetch-end', () => self.updateLoadingIndicator(false));
    },

    updateLoadingIndicator(show) {
      const indicator = document.getElementById('thalvior-loading-indicator');
      if (indicator) {
        indicator.style.transform = show ? 'translateX(0)' : 'translateX(100%)';
      }
    },

    /* —— 表单增强 —— */
    initFormEnhancements() {
      // 输入框聚焦状态
      document.addEventListener('focusin', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
          e.target.parentElement.classList.add('input-focused');
        }
      });

      document.addEventListener('focusout', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
          e.target.parentElement.classList.remove('input-focused');
        }
      });

      // 手机号自动格式化
      document.addEventListener('input', (e) => {
        if (e.target.tagName === 'INPUT' && /phone|mobile|手机|电话/i.test(e.target.name + e.target.placeholder + e.target.id)) {
          let value = e.target.value.replace(/\D/g, '');
          if (value.length > 11) value = value.slice(0, 11);
          e.target.value = value;
        }
      });

      // 数字输入框限制
      document.addEventListener('keypress', (e) => {
        if (e.target.tagName === 'INPUT' && /number|price|amount|quantity|qty/i.test(e.target.name + e.target.id + e.target.type)) {
          if (!/[0-9.]/.test(e.key) && e.key !== 'Backspace') {
            e.preventDefault();
          }
        }
      });
    },

    /* —— 点击复制（订单号、SKU 等）—— */
    initClickToCopy() {
      document.addEventListener('dblclick', (e) => {
        const el = e.target.closest('td, span, div');
        if (!el) return;
        const text = el.textContent.trim();
        // 只复制看起来像 ID/编号 的内容
        if (text && (text.length >= 4 && text.length <= 40) && /^[A-Za-z0-9\-_]+$/.test(text)) {
          navigator.clipboard?.writeText(text).then(() => {
            this.showToast(`已复制: ${text}`);
          }).catch(() => {});
        }
      });
    },

    /* —— 轻量 Toast 提示 —— */
    showToast(message, type = 'success') {
      const toast = document.createElement('div');
      const colors = {
        success: '#10B981',
        error: '#EF4444',
        info: '#0EA5E9',
        warning: '#F59E0B'
      };
      toast.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%) translateY(-100px);
        background: #FFFFFF; color: #0F172A; padding: 10px 20px; border-radius: 8px;
        box-shadow: 0 10px 25px rgba(15, 23, 42, 0.15); z-index: 100000;
        border-left: 3px solid ${colors[type]}; font-size: 14px; font-weight: 500;
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      `;
      toast.textContent = message;
      document.body.appendChild(toast);
      requestAnimationFrame(() => {
        toast.style.transform = 'translateX(-50%) translateY(0)';
      });
      setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(-100px)';
        setTimeout(() => toast.remove(), 300);
      }, 2000);
    },

    /* —— 平滑滚动 —— */
    initSmoothScroll() {
      document.documentElement.style.scrollBehavior = 'smooth';
    },

    /* —— 数据自动刷新 —— */
    initAutoRefresh() {
      const dataPages = ['/dashboard', '/orders', '/inventory', '/products', '/finance'];
      const currentPath = window.location.pathname;

      if (dataPages.some(p => currentPath.startsWith(p))) {
        setInterval(() => {
          if (!document.hidden && !document.querySelector('input:focus, textarea:focus')) {
            const refreshBtn = document.querySelector('button[aria-label*="refresh"], button[class*="refresh"], button[aria-label*="刷新"]');
            if (refreshBtn) refreshBtn.click();
          }
        }, 30000);
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ThalviorEnhance.init());
  } else {
    ThalviorEnhance.init();
  }
})();
