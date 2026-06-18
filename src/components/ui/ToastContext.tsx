import { createContext } from 'react'

export type Tone = 'success' | 'error'
export interface ToastItem { id: number; message: string; tone: Tone }
export interface ToastContextValue { showToast: (message: string, tone?: Tone) => void }

export const ToastContext = createContext<ToastContextValue | null>(null)
