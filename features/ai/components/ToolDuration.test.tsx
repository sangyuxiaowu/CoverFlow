// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import ToolDuration, { formatToolDuration } from './ToolDuration.tsx';
import type { ToolEvent } from '../types.ts';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('formats seconds, minutes and negative values in both languages', () => {
  expect(formatToolDuration(32000, false)).toBe('32秒');
  expect(formatToolDuration(68000, false)).toBe('1分08秒');
  expect(formatToolDuration(68000, true)).toBe('1m 08s');
  expect(formatToolDuration(-1000, true)).toBe('0s');
});

it('ticks locally, freezes on completion and hides unknown interrupted durations', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const container = document.createElement('div');
  const root = createRoot(container);
  const tool: ToolEvent = { id: 'timed', name: 'generate_image', arguments: '{}', status: 'running', startedAt: Date.now() };
  try {
    await act(async () => { root.render(<ToolDuration tool={tool} english={false} />); });
    expect(container.textContent).toBe('0秒');
    await act(async () => { vi.advanceTimersByTime(68000); });
    expect(container.textContent).toBe('1分08秒');
    await act(async () => { root.render(<ToolDuration tool={{ ...tool, status: 'success', durationMs: 68500 }} english={false} />); });
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { vi.advanceTimersByTime(120000); });
    expect(container.textContent).toBe('1分08秒');
    await act(async () => { root.render(<ToolDuration tool={{ ...tool, status: 'error' }} english={false} />); });
    expect(container.textContent).toBe('');
  } finally { await act(async () => root.unmount()); }
});

it('shows other running tools only after three seconds and cleans up its timer', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const container = document.createElement('div');
  const root = createRoot(container);
  const tool: ToolEvent = { id: 'read', name: 'read_layers', arguments: '{}', status: 'running', startedAt: Date.now() };
  try {
    await act(async () => { root.render(<ToolDuration tool={tool} english />); });
    expect(container.textContent).toBe('');
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(container.textContent).toBe('3s');
    await act(async () => { root.render(<ToolDuration tool={{ ...tool, status: 'error', durationMs: 3000 }} english />); });
    expect(container.textContent).toBe('');
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { root.render(<ToolDuration tool={{ ...tool, startedAt: undefined }} english />); });
    expect(container.textContent).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  } finally { await act(async () => root.unmount()); }
});