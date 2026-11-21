/**
 * meoo Sheet —— 基于 Radix Dialog 的抽屉组件
 * 源码反推自 meoo production sheet-DlVX4k1-.js
 */
import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import * as Dialog from './dialog';

type SheetSide = 'top' | 'bottom' | 'left' | 'right';

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: SheetSide;
  children: React.ReactNode;
}

export function Sheet({ open, onOpenChange, side = 'right', children }: SheetProps) {
  const base = 'fixed z-50 gap-4 bg-card p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out';
  const variant: Record<SheetSide, string> = {
    top:    'inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
    bottom: 'inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
    left:   'inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm',
    right:  'inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm',
  };

  return (
    <Dialog.Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.DialogPortal>
        <Dialog.DialogOverlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.DialogContent
          className={cn('border-0 p-0 overflow-hidden', base, variant[side])}
          style={{ borderRadius: 0 }}
        >
          {children}
        </Dialog.DialogContent>
      </Dialog.DialogPortal>
    </Dialog.Dialog>
  );
}
