import React from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

// 顶部提示组件（成功/失败状态）。
const Toast = ({ message, type }: { message: string; type: 'success' | 'error' | 'warning' }) => (
  <div
    role="status"
    className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex w-max max-w-[calc(100%-2rem)] items-center gap-2 px-4 py-3 rounded-xl shadow-2xl animate-in slide-in-from-top-4 fade-in duration-300 ${
      type === 'success' ? 'bg-green-600 text-white' : type === 'warning' ? 'bg-amber-400 text-black' : 'bg-red-600 text-white'
    }`}
  >
    {type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
    <span className="min-w-0 break-words font-bold text-sm">{message}</span>
  </div>
);

export default Toast;
