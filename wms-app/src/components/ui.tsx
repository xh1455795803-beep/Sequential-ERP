// 共享 WMS UI 组件：Modal / Grid / Field / Footer / Inp
// 原本散落在 LocationsPage 里被跨页面 import，现在集中管理
import { ReactNode } from 'react';

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

export function Field({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? 'col-span-2' : ''}`}>
      <span className="text-xs text-gray-600 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export function Footer({ onClose, onSave, saveLabel }: { onClose: () => void; onSave: () => void | Promise<void>; saveLabel?: string }) {
  return (
    <div className="mt-5 flex gap-2 justify-end">
      <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">取消</button>
      <button onClick={onSave} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600">{saveLabel || '保存'}</button>
    </div>
  );
}
