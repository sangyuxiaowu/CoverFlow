// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AiAssistant from './AiAssistant.tsx';
import { useAiAssistant } from '../hooks/useAiAssistant.ts';
import { defaultConfig, resolveSelection } from '../services/config.ts';
import { createImageUpload } from '../services/imageAttachments.ts';
import type { WorkspaceOptions } from '../services/workspace.ts';
import type { StorageAdapter } from '../../../storage/StorageAdapter.ts';

vi.mock('../hooks/useAiAssistant.ts', () => ({ useAiAssistant: vi.fn() }));
vi.mock('../hooks/useChatStore.ts', () => ({ useChatStore: () => ({ id: 'test' }) }));
vi.mock('../hooks/useFloatingPanel.ts', () => ({ useFloatingPanel: () => ({ minimized: false, setMinimized: vi.fn() }) }));
vi.mock('../hooks/useChatScroll.ts', () => ({ useChatScroll: () => ({ resetScroll: vi.fn() }) }));
vi.mock('./TokenUsageBar.tsx', () => ({ default: () => null }));
vi.mock('./ModelControls.tsx', () => ({ default: () => null }));
vi.mock('./ChatScrollbar.tsx', () => ({ default: () => null }));
vi.mock('../services/imageAttachments.ts', () => ({ createImageUpload: vi.fn() }));

let root: Root;
let host: HTMLDivElement;
let assistant: ReturnType<typeof useAiAssistant>;
const workspace: WorkspaceOptions = {
  project: null, selectedLayerIds: [], storage: {} as StorageAdapter, localProjects: [], activeLocalPath: null,
  onCommit: () => {}, onOpen: async () => {}, onUpsert: () => {}, onDelete: () => {}, onSearch: () => {}, saveLocal: async () => {}
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:test');
    static revokeObjectURL = vi.fn();
  });
  const config = defaultConfig();
  resolveSelection(config).endpoint.apiKey = 'test-key';
  assistant = { config, sessions: [], entries: [], send: vi.fn(async () => {}) } as unknown as ReturnType<typeof useAiAssistant>;
  vi.mocked(useAiAssistant).mockReturnValue(assistant);
  vi.mocked(createImageUpload).mockResolvedValue({
    image: { id: 'upload', name: 'test.webp', type: 'image/webp', size: 10 }, blob: new Blob(['image'], { type: 'image/webp' })
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function render(vision: boolean) {
  resolveSelection(assistant.config).model.supportsVision = vision;
  await act(async () => { root.render(<AiAssistant workspace={workspace} lang="en" onBusyChange={() => {}} open />); });
}

async function pasteImage() {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { items: [
    { type: 'image/png', getAsFile: () => new File(['image'], 'test.png', { type: 'image/png' }) }
  ] } });
  await act(async () => { host.querySelector('textarea')!.dispatchEvent(event); });
  return event;
}

it.each([false, true])('hides uploads and ignores pasted images for text-only models even with image generation enabled=%s', async enabled => {
  assistant.config.imageModels = [{ enabled } as NonNullable<typeof assistant.config.imageModels>[number]];
  await render(false);
  expect(host.querySelector('[aria-label="Attach image"]')).toBeNull();
  expect(host.querySelector('input[type="file"]')).toBeNull();
  expect((await pasteImage()).defaultPrevented).toBe(false);
  expect(createImageUpload).not.toHaveBeenCalled();
});

async function enterPrompt(value: string) {
  await act(async () => {
    const textarea = host.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('holds pending images while sending text and restores them when switching back to vision', async () => {
  await render(true);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Attach image"]')?.disabled).toBe(false);
  expect((await pasteImage()).defaultPrevented).toBe(true);
  expect(createImageUpload).toHaveBeenCalledOnce();
  await render(false);
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(assistant.send).not.toHaveBeenCalled();
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Images held.');
  await enterPrompt('Continue with text');
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(assistant.send).toHaveBeenCalledWith('Continue with text', []);
  expect(host.querySelector('[aria-label="Remove image: test.webp"]')).not.toBeNull();
  await render(true);
  expect(host.querySelector('[role="status"]')).toBeNull();
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(assistant.send).toHaveBeenCalledWith('Please analyze this image.', [expect.objectContaining({ image: expect.objectContaining({ id: 'upload' }) })]);
});

it('keeps held images and restores the text draft when a text-only request fails', async () => {
  await render(true);
  await pasteImage();
  await render(false);
  vi.mocked(assistant.send).mockRejectedValueOnce(new Error('Request failed'));
  await enterPrompt('Keep my draft');
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(host.querySelector('textarea')?.value).toBe('Keep my draft');
  expect(host.querySelector('[aria-label="Remove image: test.webp"]')).not.toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Request failed');
});