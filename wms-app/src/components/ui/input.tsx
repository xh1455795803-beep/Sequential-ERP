/**
 * meoo Label / Input —— 源码反推自 meoo production
 * label-BuXBz_9E.js + input-sRnoCtJ7.js
 */
import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '../../lib/utils';

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-[13px] font-medium leading-none text-fg',
      'peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      className
    )}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-8 w-full rounded-lg border border-input bg-card px-3 py-1 text-sm shadow-soft',
        'transition-[border-color,box-shadow]',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        'placeholder:text-text-subtle',
        'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-muted-foreground disabled:opacity-70',
        'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-danger-ring',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export { Label, Input };
