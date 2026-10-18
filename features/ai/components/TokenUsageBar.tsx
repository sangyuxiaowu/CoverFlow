import { useState, useRef, useEffect, useLayoutEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { AiConfig, ChatSession } from '../types.ts';
import { toRequestConfig, resolveSelection } from '../services/config.ts';
import { sessionUsage } from '../services/usage.ts';
import { Activity, Layers, MessageSquare, Terminal, Zap, Clock, ShieldCheck, AlertTriangle, AlertOctagon } from 'lucide-react';

interface Props {
  session?: ChatSession;
  config: AiConfig;
  prompt: string;
  busy: boolean;
  english: boolean;
}

export default function TokenUsageBar({ session, config, prompt, busy, english }: Props) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'turn' | 'total'>('turn');
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<CSSProperties>({ left: 0, top: 0, visibility: 'hidden' });
  const closeTimerRef = useRef<number | null>(null);
  const requestConfig = toRequestConfig(config);
  const { model } = resolveSelection(config);
  const usage = sessionUsage(session, requestConfig, session?.responseItems || [], prompt);

  const format = (value?: number) => (value === undefined ? '--' : value.toLocaleString(english ? 'en-US' : 'zh-CN'));
  const label = (zh: string, en: string) => (english ? en : zh);

  const handleMouseEnter = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  };

  const handleMouseLeave = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 280);
  };

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!containerRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      const popover = popoverRef.current;
      if (!anchor || !popover) return;

      const margin = 12;
      const gap = 6;
      const width = Math.min(330, window.innerWidth - margin * 2);
      const maxAvailableHeight = Math.max(80, window.innerHeight - margin * 2);
      const measuredHeight = Math.min(popover.scrollHeight, maxAvailableHeight);
      const spaceAbove = Math.max(0, anchor.top - margin - gap);
      const spaceBelow = Math.max(0, window.innerHeight - anchor.bottom - margin - gap);
      const placeAbove = spaceAbove >= measuredHeight || spaceAbove >= spaceBelow;
      const availableHeight = Math.max(80, Math.min(maxAvailableHeight, placeAbove ? spaceAbove : spaceBelow));
      const height = Math.min(popover.scrollHeight, availableHeight);
      const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin));
      const top = placeAbove
        ? Math.max(margin, anchor.top - height - gap)
        : Math.min(window.innerHeight - margin - height, anchor.bottom + gap);

      setPopoverPosition({ left, top, width, maxHeight: availableHeight, visibility: 'visible' });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, activeTab]);

  const percent = Math.min(100, Math.max(0, usage.percent));
  const percentDisplay = `${percent.toFixed(0)}%`;

  // 计算多色分段比例 (以总窗口为基准)
  const windowSize = usage.breakdown.contextWindow || 128000;
  const sysPct = Math.min(100, (usage.breakdown.systemAndTools / windowSize) * 100);
  const canvasPct = Math.min(100, (usage.breakdown.canvasAndToolData / windowSize) * 100);
  const historyPct = Math.min(100, (usage.breakdown.historyMessages / windowSize) * 100);
  const turnPct = Math.min(100, (usage.breakdown.currentTurnEstimate / windowSize) * 100);

  const safetyColors = {
    safe: {
      ring: 'rgb(16, 185, 129)',
      badgeBg: 'bg-emerald-500/15',
      badgeText: 'text-emerald-300',
      badgeBorder: 'border-emerald-500/30',
      label: label('安全 · 空间充裕', 'Healthy'),
      icon: ShieldCheck
    },
    warning: {
      ring: 'rgb(245, 158, 11)',
      badgeBg: 'bg-amber-500/15',
      badgeText: 'text-amber-300',
      badgeBorder: 'border-amber-500/30',
      label: label('注意 · 占用偏高', 'Attention'),
      icon: AlertTriangle
    },
    danger: {
      ring: 'rgb(244, 63, 94)',
      badgeBg: 'bg-rose-500/15',
      badgeText: 'text-rose-300',
      badgeBorder: 'border-rose-500/30',
      label: label('预警 · 接近上限', 'Capacity Low'),
      icon: AlertOctagon
    }
  };

  const currentSafety = safetyColors[usage.breakdown.safetyLevel];
  const SafetyIcon = currentSafety.icon;

  return (
    <div
      className="group/token relative shrink-0 flex items-center"
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 圆形 Token 使用率渐变环 (h-6 w-6 紧凑尺寸) */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (closeTimerRef.current) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
          }
          setOpen(prev => !prev);
        }}
        className="relative w-6 h-6 rounded-full cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400"
        aria-label={label(`会话 Token 使用率 ${percent.toFixed(1)}%`, `Token usage ${percent.toFixed(1)}%`)}
        title={label(`Token 消耗与上下文全景面板 (${percent.toFixed(1)}%)`, `Token & Context Breakdown (${percent.toFixed(1)}%)`)}
        style={{
          background: `conic-gradient(${currentSafety.ring} ${percent}%, rgb(51, 65, 85) ${percent}% 100%)`
        }}
      >
        <div className="absolute inset-[2px] rounded-full flex items-center justify-center bg-slate-950">
          <span className="text-[7.5px] font-bold leading-none text-slate-200">{percentDisplay}</span>
        </div>
      </button>

      {/* 悬浮用量与上下文全景看板 (紧贴触发环，无空隙阻断，带防抖延时缓冲) */}
      {open && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[100] w-[330px] max-w-[calc(100vw-24px)] overflow-y-auto pointer-events-auto"
          style={popoverPosition}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div
            className="w-full rounded-2xl border p-3.5 shadow-2xl text-[11px] bg-slate-900/98 backdrop-blur-2xl border-slate-700/80 text-slate-300 animate-in fade-in zoom-in-95 duration-150 select-none space-y-3"
            role="tooltip"
          >
          {/* 1. 顶部：活跃模型名称与健康度状态徽标 */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
            <div className="flex items-center gap-1.5 truncate pr-2">
              <span className="font-semibold text-slate-100 text-xs truncate" title={model.modelId}>
                {model.label || model.modelId}
              </span>
              <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-400 shrink-0">
                {(windowSize / 1000).toFixed(0)}k
              </span>
            </div>
            <div className={`flex items-center gap-1 text-[9.5px] font-medium px-2 py-0.5 rounded-full border ${currentSafety.badgeBg} ${currentSafety.badgeText} ${currentSafety.badgeBorder} shrink-0`}>
              <SafetyIcon size={11} />
              <span>{currentSafety.label}</span>
            </div>
          </div>

          {/* 2. Cursor/Windsurf 风格：上下文全景多色分段条 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10.5px]">
              <span className="text-slate-200 font-medium flex items-center gap-1">
                <Layers size={12} className="text-blue-400" />
                {label('上下文窗口全景', 'Context Breakdown')}
              </span>
              <span className="font-mono text-slate-200 font-semibold text-[10.5px]">
                {format(usage.contextTokens)} / {format(windowSize)} · {percent.toFixed(1)}%
              </span>
            </div>

            {/* 分段进度条 */}
            <div className="w-full h-2.5 bg-slate-800/90 rounded-full overflow-hidden flex p-[1px] gap-[1px]">
              {/* 系统指令与工具 */}
              {sysPct > 0 && (
                <div
                  className="h-full bg-cyan-400 rounded-l-full transition-all duration-300"
                  style={{ width: `${Math.max(1, sysPct)}%` }}
                  title={`${label('系统与工具定义', 'System & Tools')}: ${format(usage.breakdown.systemAndTools)} tokens (${sysPct.toFixed(1)}%)`}
                />
              )}
              {/* 画布图层与工具数据 */}
              {canvasPct > 0 && (
                <div
                  className="h-full bg-emerald-400 transition-all duration-300"
                  style={{ width: `${Math.max(1, canvasPct)}%` }}
                  title={`${label('画布图层与状态', 'Canvas State')}: ${format(usage.breakdown.canvasAndToolData)} tokens (${canvasPct.toFixed(1)}%)`}
                />
              )}
              {/* 历史对话记录 */}
              {historyPct > 0 && (
                <div
                  className="h-full bg-amber-400 transition-all duration-300"
                  style={{ width: `${Math.max(1, historyPct)}%` }}
                  title={`${label('历史对话记录', 'Chat History')}: ${format(usage.breakdown.historyMessages)} tokens (${historyPct.toFixed(1)}%)`}
                />
              )}
              {/* 本轮输入预估 */}
              {turnPct > 0 && (
                <div
                  className="h-full bg-purple-400 rounded-r-full transition-all duration-300"
                  style={{ width: `${Math.max(1, turnPct)}%` }}
                  title={`${label('本轮输入预估', 'Current Prompt')}: ${format(usage.breakdown.currentTurnEstimate)} tokens (${turnPct.toFixed(1)}%)`}
                />
              )}
            </div>

            {/* 图例 (4 类核心上下文构成) */}
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[9.5px] pt-1 text-slate-400">
              <div className="flex items-center gap-1.5 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                <span className="truncate">{label('系统/工具', 'System/Tools')}:</span>
                <span className="font-mono text-slate-200 ml-auto">{format(usage.breakdown.systemAndTools)}</span>
              </div>
              <div className="flex items-center gap-1.5 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="truncate">{label('封面画布', 'Canvas')}:</span>
                <span className="font-mono text-slate-200 ml-auto">{format(usage.breakdown.canvasAndToolData)}</span>
              </div>
              <div className="flex items-center gap-1.5 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                <span className="truncate">{label('对话历史', 'History')}:</span>
                <span className="font-mono text-slate-200 ml-auto">{format(usage.breakdown.historyMessages)}</span>
              </div>
              <div className="flex items-center gap-1.5 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                <span className="truncate">{label('本轮预估', 'Turn Est.')}:</span>
                <span className="font-mono text-slate-200 ml-auto">{format(usage.breakdown.currentTurnEstimate)}</span>
              </div>
            </div>
          </div>

          {/* 3. 指标派性能与明细看板 (支持单轮实测 / 会话累计 Tab 切换) */}
          <div className="pt-2 border-t border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center p-0.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-[10px]">
                <button
                  type="button"
                  onClick={() => setActiveTab('turn')}
                  className={`px-2 py-0.5 rounded-md font-medium transition-all ${
                    activeTab === 'turn'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label('单轮实测', 'Latest Turn')}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('total')}
                  className={`px-2 py-0.5 rounded-md font-medium transition-all ${
                    activeTab === 'total'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label('会话累计', 'Session Total')}
                </button>
              </div>

              {/* 耗时与速率亮点展示 */}
              <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400">
                {activeTab === 'turn' ? (
                  <>
                    <span className="inline-flex items-center gap-1 text-slate-300" title={label('最新单轮模型耗时', 'Turn Duration')}>
                      <Clock size={11} className="text-blue-400" />
                      {usage.performance.turnDurationMs ? `${(usage.performance.turnDurationMs / 1000).toFixed(1)}s` : '--'}
                    </span>
                    <span className="inline-flex items-center gap-1 text-slate-300" title={label('生成速率 (tokens/秒)', 'Generation Speed')}>
                      <Zap size={11} className="text-amber-400" />
                      {usage.performance.turnTokensPerSec ? `${usage.performance.turnTokensPerSec} t/s` : '--'}
                    </span>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 text-slate-300" title={label('全会话平均生成速率', 'Average Speed')}>
                    <Activity size={11} className="text-emerald-400" />
                    {usage.performance.avgTokensPerSec ? `${usage.performance.avgTokensPerSec} t/s` : '--'}
                  </span>
                )}
              </div>
            </div>

            {/* 卡片化指标栅格 */}
            {activeTab === 'turn' ? (
              <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                <div className="p-2 rounded-xl bg-slate-800/40 border border-slate-800 flex flex-col justify-between">
                  <span className="text-slate-400 font-sans text-[9.5px]">{label('单轮输入 (Input)', 'Turn Input')}</span>
                  <span className="text-slate-100 font-semibold text-xs mt-0.5">{format(usage.current?.inputTokens)}</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-800/40 border border-slate-800 flex flex-col justify-between">
                  <span className="text-slate-400 font-sans text-[9.5px]">{label('单轮输出 (Output)', 'Turn Output')}</span>
                  <span className="text-emerald-400 font-semibold text-xs mt-0.5">{format(usage.current?.outputTokens)}</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-800/40 border border-slate-800 flex flex-col justify-between">
                  <span className="text-slate-400 font-sans text-[9.5px]">{label('单轮总计 (Turn Total)', 'Turn Total')}</span>
                  <span className="text-slate-200 font-semibold mt-0.5">{format(usage.current?.totalTokens)}</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-800/40 border border-slate-800 flex flex-col justify-between">
                  <span className="text-slate-400 font-sans text-[9.5px]">{label('缓存命中 / 思考', 'Cache / Reason')}</span>
                  <span className="text-blue-300 font-semibold mt-0.5">
                    {format(usage.current?.cachedTokens)} / {format(usage.current?.reasoningTokens)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                <div className="p-2 rounded-xl bg-slate-800/40 border border-slate-800 flex flex-col justify-between">
                  <span className="text-slate-400 font-sans text-[9.5px]">{label('累计总消耗 (Total)', 'Total Tokens')}</span>
                  <span className="text-slate-100 font-semibold text-xs mt-0.5">{format(usage.total?.totalTokens)}</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-800/40 border border-slate-800 flex flex-col justify-between">
                  <span className="text-slate-400 font-sans text-[9.5px]">{label('交互轮次 (Requests)', 'Request Count')}</span>
                  <span className="text-blue-400 font-semibold text-xs mt-0.5">{usage.requestCount}</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-800/40 border border-slate-800 flex flex-col justify-between">
                  <span className="text-slate-400 font-sans text-[9.5px]">{label('输入 / 输出 (In / Out)', 'In / Out Ratio')}</span>
                  <span className="text-slate-200 mt-0.5">{format(usage.total?.inputTokens)} / {format(usage.total?.outputTokens)}</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-800/40 border border-slate-800 flex flex-col justify-between">
                  <span className="text-slate-400 font-sans text-[9.5px]">{label('累计缓存节省', 'Cached Tokens')}</span>
                  <span className="text-emerald-400 font-semibold mt-0.5">{format(usage.total?.cachedTokens)}</span>
                </div>
              </div>
            )}
          </div>

          {/* 4. 底部状态提示与人性化建议 */}
          <div className="pt-2 border-t border-slate-800/80 text-[9.5px] text-slate-400 flex items-center justify-between">
            {busy ? (
              <span className="text-blue-400 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
                {label('正在进行模型处理与实时测速...', 'Processing and benchmarking...')}
              </span>
            ) : usage.breakdown.safetyLevel === 'danger' ? (
              <span className="text-rose-400">
                {label('⚠️ 上下文占用偏高，建议适时新建会话', '⚠️ Context window high, consider new session')}
              </span>
            ) : usage.breakdown.safetyLevel === 'warning' ? (
              <span className="text-amber-300">
                {label('💡 上下文占用超过 60%，仍可正常对话', '💡 Context over 60%, ready for more turns')}
              </span>
            ) : (
              <span className="text-slate-400">
                {label('✨ 上下文空间充裕，可放心连续设计', '✨ Context healthy for multi-turn editing')}
              </span>
            )}

            <span className="font-mono text-slate-500 text-[9px]">
              {label(`预留: ${format(usage.reservedOutput)}`, `Rsv: ${format(usage.reservedOutput)}`)}
            </span>
          </div>
        </div>
      </div>
      , document.body)}
  </div>
);
}