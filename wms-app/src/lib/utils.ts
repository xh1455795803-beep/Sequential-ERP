import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** meoo 同款 cn() — clsx + tailwind-merge */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
