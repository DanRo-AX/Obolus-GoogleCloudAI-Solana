import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Inline style helper for the mask-image logo technique the original uses. */
export function maskStyle(
  url: string,
  position = 'center center',
): React.CSSProperties {
  return {
    maskImage: `url("${url}")`,
    WebkitMaskImage: `url("${url}")`,
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: position,
    WebkitMaskPosition: position,
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
  }
}
