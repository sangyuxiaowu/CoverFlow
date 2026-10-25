import { beforeAll, test } from 'vitest';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { ConversationAbortError, conversationAbortDetails, readResponse, runConversation, normalizeUsage, sanitizeResponseItems } from './conversation.ts';
import type { Response as AiResponse, ResponseStreamEvent } from 'openai/resources/responses/responses';
import { DEFAULT_IMAGE_TOOL_PROMPT, SYSTEM_PROMPT, defaultConfig, saveConfig, normalizeConfig, normalizeEndpoint, selectModel, toRequestConfig, reasoningPayload, loadConfig, createEndpoint, validateRequestConfig } from './config.ts';
import type { ProjectState } from '../../../types.ts';
import type { AiRequestConfig, ChatEntry, ChatSession, RequestUsage, ResponseItem, ToolEvent, WorkspaceBridge } from '../types.ts';
import { AI_DATABASE_NAME, listStoredSessions, saveStoredImage, loadStoredImage, saveStoredSession, deleteStoredSession, replaceEncryptionKey } from './configStore.ts';
import { generateEncryptionKey } from './encryptionKeys.ts';
import { createFileChatStore, type ChatFileAccess } from './chatStore.ts';
import { estimateInput, sessionUsage, sumUsage } from './usage.ts';
import { parseMarkdown } from './markdown.ts';
import { skillToolDefinitions, TOOL_DEFINITIONS, VISION_TOOL_DEFINITIONS } from '../tools/definitions.ts';
import { exampleSkill } from './skills.ts';


const config: AiRequestConfig = { endpoint: 'https://example.com/v1', model: 'test', apiKey: 'secret', maxTokens: 4096, systemPrompt: SYSTEM_PROMPT };
beforeAll(async () => {
  const generated = await generateEncryptionKey();
  await replaceEncryptionKey(generated.key, true);
  generated.bytes.fill(0);
});
const configuredConfig = () => {
  const profiles = defaultConfig();
  Object.assign(profiles.endpoints[0], { endpoint: config.endpoint, apiKey: config.apiKey });
  Object.assign(profiles.endpoints[0].models[0], { modelId: config.model, label: config.model });
  return profiles;
};
const bridge: WorkspaceBridge = { getProject: () => null, getSelection: () => [], commit: async () => {}, manageProjects: async () => ({ items: [] }) };

test('skills default empty, persist as plain text and inject only an index without changing saved prompts', async () => {
  const profiles = configuredConfig();
  assert.deepEqual(profiles.skills, []);
  delete profiles.skills;
  assert.deepEqual(normalizeConfig(profiles).skills, []);
  assert.equal(toRequestConfig(profiles).systemPrompt, profiles.systemPrompt);
  assert.deepEqual(skillToolDefinitions(), []);
  profiles.skills = [exampleSkill()];
  profiles.systemPrompt = 'Keep my custom system instructions.';
  await saveConfig(profiles);
  const restored = await loadConfig();
  assert.deepEqual(restored.skills, profiles.skills);
  assert.equal(restored.systemPrompt, profiles.systemPrompt);
  const request = toRequestConfig(restored);
  assert.match(request.systemPrompt, /available_skills/);
  assert.match(request.systemPrompt, /brand-cover/);
  assert.ok(!request.systemPrompt.includes(profiles.skills[0].content));
  assert.equal(request.systemPrompt.split('<available_skills>').length, 2);
  assert.equal(toRequestConfig({ ...restored, systemPrompt: request.systemPrompt }).systemPrompt, request.systemPrompt);
  request.skills![0].content = 'changed snapshot';
  assert.equal(restored.skills![0].content, profiles.skills[0].content);
  await assert.rejects(saveConfig({ ...profiles, skills: [exampleSkill(), exampleSkill()] }), /Duplicate skill/);
});

test('skill loads full content on demand through Responses without requiring an open project', async () => {
  const originalFetch = globalThis.fetch;
  const profiles = configuredConfig();
  const skill = { name: 'brand-cover', description: 'Use for brand covers', content: 'FULL PRIVATE RULES: place the approved logo only.' };
  profiles.skills = [skill];
  const requestConfig = toRequestConfig(profiles);
  const requests: Record<string, any>[] = [];
  const events: ToolEvent[] = [];
  const usages: RequestUsage[] = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options!.body as string));
    if (requests.length === 1) requestConfig.skills![0].content = 'Configuration changed during request';
    return streamResponse(responsePayload(requests.length === 1
      ? [{ type: 'function_call', call_id: 'skill-read', name: 'skill', arguments: '{"name":"brand-cover"}' }]
      : [textOutput]));
  };
  try {
    await runConversation({ config: requestConfig, input: [], bridge, signal: new AbortController().signal,
      onText: () => {}, onTool: event => events.push(event), onUsage: usage => usages.push(usage) });
    assert.equal(requests.length, 2);
    const definition = skillToolDefinitions([skill])[0];
    assert.deepEqual(requests[0].tools.find((tool: { name: string }) => tool.name === 'skill'), { type: 'function', ...definition.function, strict: false });
    assert.ok(requests[0].instructions.includes(skill.description));
    assert.ok(!JSON.stringify(requests[0]).includes(skill.content));
    assert.ok(!JSON.stringify(requests[0].tools).includes(skill.description));
    assert.deepEqual(requests[1].tools, requests[0].tools);
    const output = requests[1].input.find((item: { type: string }) => item.type === 'function_call_output');
    assert.deepEqual(JSON.parse(output.output), skill);
    assert.equal(events.at(-1)!.status, 'success');
    assert.equal(usages[0].inputEstimate, estimateInput([], requestConfig.systemPrompt, requestConfig.supportsVision, false, undefined, [skill]));
    const largeSkill = { ...skill, content: 'A'.repeat(40000) };
    assert.equal(estimateInput([], requestConfig.systemPrompt, false, false, undefined, [largeSkill]), estimateInput([], requestConfig.systemPrompt, false, false, undefined, [skill]));
    const breakdown = sessionUsage(undefined, { ...requestConfig, skills: [skill] }, [], '');
    assert.equal(breakdown.breakdown.systemAndTools, usages[0].inputEstimate);
  } finally { globalThis.fetch = originalFetch; }
});

test('empty skills omit the tool and unknown skill names produce a factual tool error', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const skills of [[], [exampleSkill()]]) {
      const requests: Record<string, any>[] = [];
      const events: ToolEvent[] = [];
      globalThis.fetch = async (_url, options) => {
        requests.push(JSON.parse(options!.body as string));
        return streamResponse(responsePayload(requests.length === 1
          ? [{ type: 'function_call', call_id: 'missing-skill', name: 'skill', arguments: '{"name":"missing"}' }]
          : [textOutput]));
      };
      await runConversation({ config: { ...config, skills }, input: [], bridge, signal: new AbortController().signal,
        onText: () => {}, onTool: event => events.push(event) });
      assert.equal(requests[0].tools.some((tool: { name: string }) => tool.name === 'skill'), skills.length > 0);
      assert.equal(events.at(-1)!.status, 'error');
      const output = requests[1].input.find((item: { type: string }) => item.type === 'function_call_output');
      assert.match(JSON.parse(output.output).error, skills.length ? /Skill not found/ : /Unknown tool/);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('AI endpoint and model configuration IDs are short', () => {
  const profiles = defaultConfig();
  assert.match(profiles.endpoints[0].id, /^[0-9a-z]{9}$/);
  assert.match(profiles.endpoints[0].models[0].id, /^[0-9a-z]{9}$/);
  const endpoint = createEndpoint('deepseek');
  assert.match(endpoint.id, /^[0-9a-z]{9}$/);
  assert.ok(endpoint.models.every(model => /^[0-9a-z]{9}$/.test(model.id)));
});

const responsePayload = (output: unknown[], overrides = {}) => ({ id: 'resp-test', object: 'response', status: 'completed', output, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 50 }, output_tokens_details: { reasoning_tokens: 10 } }, ...overrides });
const textOutput = { type: 'message', id: 'msg-test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done', annotations: [] }] };
async function* eventsFrom(events: unknown[]) { for (const event of events) yield event as ResponseStreamEvent; }
const streamResponse = (payload: ReturnType<typeof responsePayload>) => new Response(`event: response.${payload.status}\ndata: ${JSON.stringify({ type: `response.${payload.status}`, response: payload })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });

test('turn limits default, normalize, validate, persist and reach request configuration', async () => {
  const profiles = configuredConfig();
  assert.equal(profiles.maxToolRounds, 24);
  assert.equal(profiles.maxImageFailures, 3);
  delete profiles.maxToolRounds;
  delete profiles.maxImageFailures;
  assert.equal(normalizeConfig(profiles).maxToolRounds, 24);
  assert.equal(normalizeConfig(profiles).maxImageFailures, 3);
  profiles.maxToolRounds = 40;
  profiles.maxImageFailures = 5;
  await saveConfig(profiles);
  const restored = await loadConfig();
  assert.equal(restored.maxToolRounds, 40);
  assert.equal(restored.maxImageFailures, 5);
  assert.equal(toRequestConfig(restored).maxToolRounds, 40);
  assert.equal(toRequestConfig(restored).maxImageFailures, 5);
  for (const field of ['maxToolRounds', 'maxImageFailures'] as const) {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => validateRequestConfig({ ...config, [field]: value }), /positive safe integer/);
      await assert.rejects(saveConfig({ ...profiles, [field]: value }), /positive safe integer/);
    }
  }
});

for (const maxToolRounds of [1, 3, 25]) test(`stops after the configured ${maxToolRounds} tool rounds and preserves paired history`, async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let limits = 0;
  let history: ResponseItem[] = [];
  globalThis.fetch = async () => streamResponse(responsePayload([
    { type: 'function_call', call_id: `call-${++requests}`, name: 'get_context', arguments: '{}' }
  ]));
  try {
    const result = await runConversation({ config: { ...config, maxToolRounds }, input: [], bridge,
      signal: new AbortController().signal, onText: () => {}, onTool: () => {},
      onLimit: () => { limits++; }, onHistory: items => { history = items; } });
    assert.equal(requests, maxToolRounds);
    assert.equal(limits, 1);
    assert.match(result, /工具调用上限/);
    assert.equal(history.filter(item => 'type' in item && item.type === 'function_call_output').length, maxToolRounds);
  } finally { globalThis.fetch = originalFetch; }
});

test('background removal remains statically registered and sends model-not-ready errors back to Responses', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, any>[] = [];
  const events: ToolEvent[] = [];
  const project: ProjectState = {
    id: 'removal-project', title: 'Test', updatedAt: 0, selectedLayerId: 'image',
    layers: [{ id: 'image', name: 'Photo', type: 'image', content: 'data:image/png;base64,AA==',
      x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, zIndex: 1, visible: true, locked: false }],
    canvasConfig: { width: 800, height: 600, ratio: '4:3' },
    background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 1 }
  };
  let commits = 0;
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options!.body as string));
    return streamResponse(responsePayload(requests.length === 1
      ? [{ type: 'function_call', call_id: 'removal-call', name: 'remove_background',
        arguments: JSON.stringify({ projectId: project.id, layerId: 'image', modelId: 'birefnet' }) }]
      : [textOutput]));
  };
  try {
    await runConversation({ config: { ...config, supportsVision: false, imageToolsEnabled: false }, input: [],
      bridge: { ...bridge, getProject: () => project, commit: async () => { commits++; } },
      signal: new AbortController().signal, onText: () => {}, onTool: event => events.push(event) });
    assert.equal(requests.length, 2);
    const definition = TOOL_DEFINITIONS.find(item => item.function.name === 'remove_background')!;
    const sent = requests[0].tools.find((item: { name: string }) => item.name === 'remove_background');
    assert.deepEqual(sent, { type: 'function', ...definition.function, strict: false });
    assert.deepEqual(requests[1].tools, requests[0].tools);
    const output = requests[1].input.find((item: { type: string; call_id?: string }) => item.type === 'function_call_output' && item.call_id === 'removal-call');
    assert.equal(output.type, 'function_call_output');
    assert.deepEqual(JSON.parse(output.output), {
      success: false, code: 'MODEL_NOT_READY', stage: 'model',
      error: 'BiRefNet is not ready. Import or download the model in AI Settings > Background Removal; the large model was not downloaded automatically.',
      projectId: project.id, layerId: 'image', modelId: 'birefnet', runtimeDownloaded: false
    });
    assert.equal(events.at(-1)!.status, 'error');
    assert.equal(commits, 0);
  } finally { globalThis.fetch = originalFetch; }
});

for (const outcome of ['success', 'error', 'aborted'] as const) {
  test(`tool timing is finalized on ${outcome} without entering model output`, async () => {
    const originalFetch = globalThis.fetch;
    const controller = new AbortController();
    const events: ToolEvent[] = [];
    let history: ResponseItem[] = [];
    let round = 0;
    globalThis.fetch = async () => streamResponse(responsePayload(++round === 1
      ? [{ type: 'function_call', call_id: 'timed-preview', name: 'get_canvas_preview', arguments: '{}' }]
      : [textOutput]));
    try {
      const run = runConversation({
        config: { ...config, supportsVision: true }, input: [], signal: controller.signal,
        bridge: { ...bridge, getCanvasPreview: async () => {
          assert.equal(events.length, 1);
          assert.equal(events[0].status, 'running');
          assert.equal(typeof events[0].startedAt, 'number');
          assert.equal(events[0].durationMs, undefined);
          if (outcome === 'aborted') controller.abort(new ConversationAbortError('user_stop'));
          if (outcome !== 'success') throw new Error('Preview interrupted');
          return new Blob(['image'], { type: 'image/webp' });
        } },
        saveImage: async () => ({ id: 'timed-image', name: 'preview.webp', type: 'image/webp', size: 5 }),
        onText: () => {}, onTool: event => events.push(event), onHistory: items => { history = items; }
      });
      if (outcome === 'aborted') await assert.rejects(run);
      else await run;
      assert.equal(events.length, 2);
      assert.equal(events[1].startedAt, events[0].startedAt);
      assert.equal(events[1].status, outcome === 'success' ? 'success' : 'error');
      assert.ok(Number.isFinite(events[1].durationMs));
      assert.ok(events[1].durationMs! >= 0);
      assert.ok(!JSON.stringify(history).includes('durationMs'));
      assert.ok(!JSON.stringify(history).includes('startedAt'));
    } finally { globalThis.fetch = originalFetch; }
  });
}

test('Responses function definitions provide empty parameters for tools without arguments', async () => {
  const originalFetch = globalThis.fetch;
  let sentTools: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, options) => {
    sentTools = JSON.parse(options!.body as string).tools;
    return streamResponse(responsePayload([textOutput]));
  };
  try {
    await runConversation({ config: { ...config, supportsVision: true }, input: [], bridge, signal: new AbortController().signal, onText: () => {}, onTool: () => {} });
    const noArgumentTools = sentTools.filter(tool => ['get_context', 'get_cover_size_recommendations', 'get_selected_layers', 'get_canvas_preview'].includes(String(tool.name)));
    assert.equal(noArgumentTools.length, 4);
    assert.ok(noArgumentTools.every(tool => JSON.stringify(tool.parameters) === JSON.stringify({ type: 'object', properties: {} })));
  } finally { globalThis.fetch = originalFetch; }
});

test('custom prompts are not silently extended with visual capability instructions', async () => {
  const profiles = configuredConfig();
  profiles.imageModels = profiles.imageModels?.map(model => ({ ...model, enabled: true, endpointId: profiles.endpoints[0].id }));
  const original = '请保持我的品牌配色，并使用简洁中文回复。';
  profiles.systemPrompt = original;
  const requestConfig = toRequestConfig(profiles);
  assert.equal(profiles.systemPrompt, original);
  assert.equal(requestConfig.systemPrompt, `${original}\n\n${DEFAULT_IMAGE_TOOL_PROMPT}`);
  assert.equal(toRequestConfig({ ...profiles, systemPrompt: requestConfig.systemPrompt }).systemPrompt, requestConfig.systemPrompt);
  assert.equal(toRequestConfig({ ...configuredConfig(), imageModels: [] }).systemPrompt, SYSTEM_PROMPT);
  assert.equal(toRequestConfig({ ...profiles, systemPrompt: SYSTEM_PROMPT, imageToolPrompt: '自定义生图规则' }).systemPrompt, `${SYSTEM_PROMPT}\n\n自定义生图规则`);
  assert.equal(toRequestConfig({ ...configuredConfig(), imageModels: [], imageToolPrompt: '自定义生图规则' }).systemPrompt, SYSTEM_PROMPT);
  const originalFetch = globalThis.fetch;
  let sentInstructions = '';
  let sentTools: unknown[] = [];
  let inputEstimate = 0;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options!.body as string);
    sentInstructions = request.instructions;
    sentTools = request.tools;
    return streamResponse(responsePayload([textOutput]));
  };
  try {
    await runConversation({ config: requestConfig, input: [], bridge, signal: new AbortController().signal, onText: () => {}, onTool: () => {}, onUsage: usage => { inputEstimate = usage.inputEstimate ?? 0; } });
    assert.equal(sentInstructions, requestConfig.systemPrompt);
    assert.deepEqual(sentTools, [...TOOL_DEFINITIONS, ...VISION_TOOL_DEFINITIONS].map(definition => ({ type: 'function', ...definition.function, strict: false })));
    assert.doesNotMatch(JSON.stringify(sentTools), /"\$(?:defs|ref)"/);
    assert.deepEqual(sentTools.filter(tool => (tool as { name: string }).name.startsWith('add_')).map(tool => (tool as { name: string }).name), ['add_layer']);
    assert.ok(sentTools.filter((tool: { name: string; parameters: unknown }) => ['get_context', 'get_cover_size_recommendations', 'get_selected_layers', 'get_canvas_preview'].includes(tool.name)).every(tool => JSON.stringify(tool.parameters) === JSON.stringify({ type: 'object', properties: {} })));
    assert.equal(inputEstimate, estimateInput([], requestConfig.systemPrompt, requestConfig.supportsVision));
    assert.ok(inputEstimate > estimateInput([], original));
  } finally { globalThis.fetch = originalFetch; }
});

test('Responses text deltas and final output are returned', async () => {
  const events = eventsFrom([{ type: 'response.output_text.delta', delta: '你好' }, { type: 'response.completed', response: responsePayload([textOutput]) }]);
  let content = '';
  const response = await readResponse(events, chunk => { content += chunk; }, new AbortController().signal);
  assert.equal(content, '你好');
  assert.equal(response.output[0].type, 'message');
});

test('vision models receive a WebP image from the canvas preview tool', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, any>[] = [];
  let round = 0;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options!.body as string);
    requests.push(request);
    round++;
    return streamResponse(responsePayload(round === 1
      ? [{ type: 'function_call', call_id: 'preview-call', name: 'get_canvas_preview', arguments: '{}' }]
      : [textOutput]));
  };
  try {
    const image = new Blob(['webp-bytes'], { type: 'image/webp' });
    const result = await runConversation({
      config: { ...config, supportsVision: true }, input: [],
      bridge: { ...bridge, getCanvasPreview: async () => image },
      signal: new AbortController().signal, onText: () => {}, onTool: () => {},
      saveImage: async () => ({ id: 'preview-image', name: 'canvas-preview.webp', type: 'image/webp', size: image.size }),
      loadImage: async () => image
    });
    assert.equal(result, 'Done');
    assert.ok(requests[0].tools.some((tool: { name: string }) => tool.name === 'get_canvas_preview'));
    const output = requests[1].input.at(-1).output;
    assert.equal(output[0].type, 'input_image');
    assert.match(output[0].image_url, /^data:image\/webp;base64,/);
  } finally { globalThis.fetch = originalFetch; }
});

test('selected image layers are sent as WebP input only to vision models', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, any>[] = [];
  let round = 0;
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options!.body as string));
    round++;
    return streamResponse(responsePayload(round === 1
      ? [{ type: 'function_call', call_id: 'selected-call', name: 'get_selected_layers', arguments: '{}' }]
      : [textOutput]));
  };
  try {
    const imageLayer = { id: 'image-1', name: 'Photo', type: 'image' as const, content: 'data:image/png;base64,abc', x: 10, y: 20, width: 300, height: 200, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 };
    const project: ProjectState = { id: 'p1', title: 'Test', updatedAt: 0, selectedLayerId: imageLayer.id, layers: [imageLayer], canvasConfig: { width: 800, height: 600, ratio: '4:3' }, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } };
    const image = new Blob(['webp-bytes'], { type: 'image/webp' });
    let previewRequests = 0;
    const saved: string[] = [];
    await runConversation({
      config: { ...config, supportsVision: true }, input: [],
      bridge: { ...bridge, getProject: () => project, getSelection: () => [imageLayer.id], getLayerPreview: async () => { previewRequests++; return image; } },
      signal: new AbortController().signal, onText: () => {}, onTool: () => {},
      saveImage: async (_blob, name) => { saved.push(name); return { id: 'selected-image', name, type: 'image/webp', size: image.size }; },
      loadImage: async () => image
    });
    assert.equal(previewRequests, 1);
    assert.deepEqual(saved, ['layer-image-1.webp']);
    const output = requests[1].input.at(-1).output;
    assert.equal(output[0].type, 'input_text');
    assert.equal(JSON.parse(output[0].text).layers[0].content, undefined);
    assert.equal(JSON.parse(output[0].text).layers[0].image.content, undefined);
    assert.equal(output[1].type, 'input_image');
    assert.match(output[1].image_url, /^data:image\/webp;base64,/);

    requests.length = 0;
    round = 0;
    previewRequests = 0;
    await runConversation({
      config, input: [],
      bridge: { ...bridge, getProject: () => project, getSelection: () => [imageLayer.id], getLayerPreview: async () => { previewRequests++; return image; } },
      signal: new AbortController().signal, onText: () => {}, onTool: () => {}
    });
    assert.equal(previewRequests, 0);
    assert.equal(typeof requests[1].input.at(-1).output, 'string');
    const metadata = JSON.parse(requests[1].input.at(-1).output);
    assert.equal(metadata.layers[0].image.content, undefined);
    assert.equal(metadata.layers[0].image.imageInfo.previewStatus, 'not_requested');
  } finally { globalThis.fetch = originalFetch; }
});

test('tool round limit signals that the conversation can continue', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let limitReached = 0;
  const outputText: string[] = [];
  globalThis.fetch = async () => {
    requests++;
    return streamResponse(responsePayload([
      { ...textOutput, content: [{ type: 'output_text', text: `Step ${requests}` }] },
      { type: 'function_call', call_id: `call-${requests}`, name: 'get_context', arguments: '{}' }
    ]));
  };
  try {
    await runConversation({
      config,
      input: [{ role: 'user', content: '调整封面' }],
      bridge,
      signal: new AbortController().signal,
      onText: text => { outputText.push(text); },
      onTool: () => {},
      onLimit: () => { limitReached++; }
    });
    assert.equal(requests, 24);
    assert.equal(limitReached, 1);
    assert.deepEqual(outputText, Array.from({ length: 24 }, (_, index) => `Step ${index + 1}`));
  } finally { globalThis.fetch = originalFetch; }
});

test('canvas preview names and images stay associated with their tool events', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  const names: string[] = [];
  const completedTools: ToolEvent[] = [];
  globalThis.fetch = async () => {
    requests++;
    return streamResponse(responsePayload(requests < 3
      ? [{ type: 'function_call', call_id: `preview-${requests}`, name: 'get_canvas_preview', arguments: '{}' }]
      : [textOutput]));
  };
  try {
    const image = new Blob(['preview'], { type: 'image/webp' });
    await runConversation({
      config: { ...config, supportsVision: true },
      input: [{ role: 'user', content: 'Review the cover' }],
      bridge: { ...bridge, getCanvasPreview: async () => image },
      signal: new AbortController().signal,
      onText: () => {},
      onTool: event => { if (event.status === 'success') completedTools.push(event); },
      saveImage: async (_blob, name) => {
        names.push(name);
        return { id: `image-${names.length}`, name, type: 'image/webp', size: image.size };
      }
    });
    assert.deepEqual(names, ['canvas-preview-1.webp', 'canvas-preview-2.webp']);
    assert.deepEqual(completedTools.map(tool => tool.image?.name), names);
  } finally { globalThis.fetch = originalFetch; }
});

test('uploaded image references are hydrated only for vision requests', async () => {
  const originalFetch = globalThis.fetch;
  let request: Record<string, any> | null = null;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options!.body as string);
    return streamResponse(responsePayload([textOutput]));
  };
  try {
    await runConversation({
      config: { ...config, supportsVision: true },
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'What is this?' }, { type: 'input_image', image_url: 'attachment://image-one', detail: 'auto' }] }],
      bridge, signal: new AbortController().signal, onText: () => {}, onTool: () => {},
      loadImage: async () => new Blob(['webp-bytes'], { type: 'image/webp' })
    });
    assert.equal(request!.input[0].content[1].type, 'input_image');
    assert.match(request!.input[0].content[1].image_url, /^data:image\/webp;base64,/);
    assert.equal(request!.tools.some((tool: { name: string }) => tool.name === 'get_canvas_preview'), true);
  } finally { globalThis.fetch = originalFetch; }
});

test('switching vision off projects images only in requests and switching back restores original history', async () => {
  const originalFetch = globalThis.fetch;
  const requests: { input: ResponseItem[]; tools: { name: string }[] }[] = [];
  const input: ResponseItem[] = [
    { role: 'user', content: [
      { type: 'input_text', text: 'Keep this text and the literal attachment://mention.' },
      { type: 'input_image', image_url: 'attachment://upload', detail: 'auto' },
      { type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'auto' },
      { type: 'input_image', image_url: 'https://example.com/image.png', detail: 'auto' }
    ] },
    { type: 'function_call', call_id: 'preview', name: 'get_canvas_preview', arguments: '{}' },
    { type: 'function_call_output', call_id: 'preview', output: [
      { type: 'input_text', text: 'Preview metadata' },
      { type: 'input_image', image_url: 'attachment://preview' }
    ] },
    { type: 'function_call', call_id: 'selected', name: 'get_selected_layers', arguments: '{}' },
    { type: 'function_call_output', call_id: 'selected', output: [
      { type: 'input_image', image_url: 'attachment://selected' }
    ] },
    { role: 'user', content: [{ type: 'input_image', image_url: 'https://example.com/only-image.png', detail: 'auto' }] }
  ];
  const original = structuredClone(input);
  let history: ResponseItem[] = [];
  let loaded = 0;
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options!.body as string));
    return streamResponse(responsePayload(requests.length === 2
      ? [{ type: 'function_call', call_id: 'context', name: 'get_context', arguments: '{}' }]
      : [textOutput]));
  };
  const run = (supportsVision: boolean, source: ResponseItem[]) => runConversation({
    config: { ...config, supportsVision }, input: source, bridge, signal: new AbortController().signal,
    onText: () => {}, onTool: () => {}, onHistory: items => { history = items; },
    loadImage: async () => {
      assert.equal(supportsVision, true, 'text-only requests must not read image binaries');
      loaded++;
      return new Blob(['webp-bytes'], { type: 'image/webp' });
    }
  });
  try {
    await run(true, input);
    assert.equal(loaded, 3);
    const visionHistory = structuredClone(history);
    await run(false, history);
    assert.equal(loaded, 3);
    const marker = { type: 'input_text', text: '[Image not provided: the current model does not support image input.]' };
    const expected = [
      { role: 'user', content: [{ type: 'input_text', text: 'Keep this text and the literal attachment://mention.' }, marker, marker, marker] },
      original[1],
      { type: 'function_call_output', call_id: 'preview', output: [{ type: 'input_text', text: 'Preview metadata' }, marker] },
      original[3],
      { type: 'function_call_output', call_id: 'selected', output: [marker] },
      { role: 'user', content: [marker] }
    ];
    assert.equal(requests.length, 3);
    for (const request of requests.slice(1)) {
      assert.deepEqual(request.input.slice(0, original.length), expected);
      assert.equal(request.tools.some(tool => tool.name === 'get_canvas_preview'), false);
    }
    assert.deepEqual(history.slice(0, visionHistory.length), visionHistory);
    assert.deepEqual(input, original);
    await run(true, history);
    assert.equal(loaded, 6);
    assert.deepEqual(requests[3].input.slice(0, original.length), requests[0].input.slice(0, original.length));
    assert.deepEqual(history.slice(0, original.length), original);
  } finally { globalThis.fetch = originalFetch; }
});

test('truncated streams and token exhaustion cannot execute tools', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(readResponse(eventsFrom([{ type: 'response.output_text.delta', delta: 'partial' }]), () => {}, signal), /disconnected/);
  const originalFetch = globalThis.fetch;
  let toolCount = 0;
  const usages: unknown[] = [];
  globalThis.fetch = async () => streamResponse(responsePayload([{ type: 'function_call', call_id: 'call', name: 'get_context', arguments: '{}' }], { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }));
  try {
    await assert.rejects(runConversation({ config, input: [], bridge, signal, onText: () => {}, onTool: () => { toolCount++; }, onUsage: usage => usages.push(usage) }), /incomplete/);
    assert.equal(toolCount, 0);
    assert.equal(usages.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('tool results and assistant calls are preserved for the next round', async () => {
  const originalFetch = globalThis.fetch;
  const requests: { input: { type?: string; content?: string; call_id?: string }[]; reasoning?: unknown }[] = [];
  const urls: string[] = [];
  const usages: unknown[] = [];
  globalThis.fetch = async (_url, options) => {
    urls.push(String(_url));
    requests.push(JSON.parse(options!.body as string));
    return streamResponse(responsePayload(requests.length === 1 ? [{ type: 'reasoning', id: 'rs-test', summary: [], content: [{ type: 'reasoning_text', text: 'Plan' }] }, { type: 'function_call', id: 'fc-test', call_id: 'call', name: 'get_context', arguments: '{}' }] : [textOutput], { id: `resp-${requests.length}` }));
  };
  try {
    const result = await runConversation({ config, input: [{ role: 'user', content: 'List projects' }], bridge, signal: new AbortController().signal, onText: () => {}, onTool: () => {}, onUsage: usage => usages.push(usage) });
    assert.equal(requests.length, 2);
    assert.equal(urls[0], 'https://example.com/v1/responses');
    assert.equal(requests[1].input.at(-1)!.type, 'function_call_output');
    assert.equal(requests[1].input.at(-1)!.call_id, 'call');
    assert.equal(requests[1].input[1].type, 'reasoning');
    assert.equal(usages.length, 2);
    assert.equal(result, 'Done');
  } finally { globalThis.fetch = originalFetch; }
});

test.each([
  { arguments: '{"action":"list"}', status: 'success' },
  { arguments: '{"action":', status: 'error' }
])('tool events preserve request arguments while running and after $status', async ({ arguments: args, status }) => {
  const originalFetch = globalThis.fetch;
  const tools: ToolEvent[] = [];
  let count = 0;
  globalThis.fetch = async () => {
    count++;
    return streamResponse(responsePayload(count === 1 ? [{ type: 'function_call', call_id: 'call', name: 'search_projects', arguments: args }] : [textOutput]));
  };
  try {
    await runConversation({ config, input: [], bridge, signal: new AbortController().signal, onText: () => {}, onTool: event => { tools.push(event); } });
    assert.equal(tools.length, 2);
    assert.deepEqual(tools[0], { id: 'call', name: 'search_projects', arguments: args, status: 'running', startedAt: tools[0].startedAt });
    assert.deepEqual(tools[1], { id: 'call', name: 'search_projects', arguments: args, status, result: tools[1].result, startedAt: tools[0].startedAt, durationMs: tools[1].durationMs });
    assert.ok(tools[1].result);
  } finally { globalThis.fetch = originalFetch; }
});

test('Responses never sends temperature in any reasoning mode', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options!.body as string));
    return streamResponse(responsePayload([textOutput]));
  };
  try {
    for (const settings of [config, { ...config, thinkingAvailable: true, thinkingEnabled: true, reasoningEffort: 'high' as const }, { ...config, thinkingAvailable: true, thinkingEnabled: false }]) {
      await runConversation({ config: settings, input: [], bridge, signal: new AbortController().signal, onText: () => {}, onTool: () => {} });
    }
    assert.equal(requests.length, 3);
    assert.equal(requests.every(request => !Object.hasOwn(request, 'temperature')), true);
    assert.equal(Object.hasOwn(defaultConfig().endpoints[0].models[0], 'temperature'), false);
    assert.equal(Object.hasOwn(toRequestConfig(configuredConfig()), 'temperature'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('IndexedDB stores encrypted API keys and restores multi-endpoint settings', async () => {
  const profiles = configuredConfig();
  Object.assign(profiles.imageModels![0], { version: 'custom-version', releasedAt: '2026-10-01', timeoutSeconds: 420 });
  const second = createEndpoint('deepseek');
  second.apiKey = 'second-secret';
  profiles.endpoints.push(second);
  await saveConfig(profiles);
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(AI_DATABASE_NAME); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const read = <Value>(store: string, key?: string) => new Promise<Value>((resolve, reject) => {
    const request = key ? db.transaction(store).objectStore(store).get(key) : db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as Value); request.onerror = () => reject(request.error);
  });
  const saved = await read<Record<string, unknown>>('settings', 'config');
  assert.equal(JSON.stringify(saved).includes('second-secret'), false);
  assert.equal(JSON.stringify(saved).includes('"apiKey":"secret"'), false);
  const secrets = await read<{ iv: ArrayBuffer; ciphertext: ArrayBuffer }[]>('endpoint-secrets');
  assert.equal(secrets.length, 2);
  assert.equal(secrets[0].iv.byteLength, 12);
  assert.notDeepEqual(new Uint8Array(secrets[0].iv), new Uint8Array(secrets[1].iv));
  const key = await read<CryptoKey>('encryption-key', 'master');
  assert.equal(key.extractable, false);
  assert.equal(key.algorithm.name, 'AES-GCM');
  const restored = await loadConfig();
  assert.equal(restored.endpoints[0].apiKey, 'secret');
  assert.equal(restored.endpoints[1].apiKey, 'second-secret');
  assert.deepEqual(restored.imageModels, profiles.imageModels);
  db.close();
});

test('configuration requires the current structure and API base URLs', () => {
  assert.throws(() => normalizeConfig(config), /endpoint/);
  assert.throws(() => validateRequestConfig({ ...config, endpoint: 'https://example.com/v1/chat/completions' }), /base URL/);
  assert.throws(() => validateRequestConfig({ ...config, endpoint: 'https://example.com/v1/responses' }), /base URL/);
  assert.equal(normalizeEndpoint('https://example.com/v1/'), 'https://example.com/v1');
  assert.equal(toRequestConfig(normalizeConfig(configuredConfig())).model, 'test');
});

test('multiple endpoints preserve independent keys and repair deleted selections', () => {
  const profiles = configuredConfig();
  const endpoint = createEndpoint('deepseek');
  endpoint.apiKey = 'second-key';
  profiles.endpoints.push(endpoint);
  const selected = selectModel(profiles, endpoint.id, endpoint.models[1].id);
  assert.equal(toRequestConfig(selected).apiKey, 'second-key');
  assert.equal(toRequestConfig(profiles).apiKey, 'secret');
  const repaired = normalizeConfig({ ...selected, endpoints: [profiles.endpoints[0]] });
  assert.equal(repaired.activeSelection.endpointId, profiles.endpoints[0].id);
  assert.throws(() => selectModel(profiles, 'missing', 'missing'), /not found/);
});

test('Responses uses one reasoning format with model-specific levels', () => {
  assert.deepEqual(reasoningPayload(config), {});
  assert.deepEqual(reasoningPayload({ ...config, thinkingAvailable: true, thinkingEnabled: true, reasoningEffort: 'max' }), { reasoning: { effort: 'max' } });
  assert.deepEqual(reasoningPayload({ ...config, thinkingAvailable: true, thinkingEnabled: false }), { reasoning: { effort: 'none' } });
  const endpoint = createEndpoint('deepseek');
  assert.equal(endpoint.models.every(model => model.thinkingAvailable), true);
  assert.deepEqual(endpoint.models[0].supportedReasoningEfforts, ['none', 'low', 'high', 'max']);
  assert.throws(() => validateRequestConfig({ ...config, contextWindow: 1000 }), /Context window/);
  assert.throws(() => validateRequestConfig({ ...config, thinkingAvailable: true, thinkingEnabled: true, supportedReasoningEfforts: ['low'], reasoningEffort: 'max' }), /does not support/);
});

test('saving without a removed endpoint deletes its encrypted key', async () => {
  const stored = await loadConfig();
  const reduced = normalizeConfig({ ...stored, endpoints: [stored.endpoints[0]] });
  await saveConfig(reduced);
  const restored = await loadConfig();
  assert.equal(restored.endpoints.length, 1);
  assert.equal(restored.endpoints[0].apiKey, 'secret');
});

test('tampered ciphertext fails closed without overwriting settings', async () => {
  const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open(AI_DATABASE_NAME); request.onsuccess = () => resolve(request.result); });
  const original = await new Promise<{ endpointId: string; iv: ArrayBuffer; ciphertext: ArrayBuffer }>(resolve => { const request = db.transaction('endpoint-secrets').objectStore('endpoint-secrets').getAll(); request.onsuccess = () => resolve(request.result[0]); });
  const put = (value: typeof original) => new Promise<void>((resolve, reject) => { const tx = db.transaction('endpoint-secrets', 'readwrite'); tx.objectStore('endpoint-secrets').put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  const bytes = new Uint8Array(original.ciphertext.slice(0));
  bytes[0] ^= 1;
  await put({ ...original, ciphertext: bytes.buffer });
  try { await assert.rejects(loadConfig(), /decrypt/); }
  finally { await put(original); db.close(); }
});

test('reasoning chunks are exposed separately from assistant text', async () => {
  let thinking = '';
  let answer = '';
  const data = eventsFrom([{ type: 'response.reasoning_text.delta', delta: 'Plan' }, { type: 'response.output_text.delta', delta: 'Done' }, { type: 'response.completed', response: responsePayload([textOutput]) }]);
  await readResponse(data, chunk => { answer += chunk; }, new AbortController().signal, chunk => { thinking += chunk; });
  assert.equal(thinking, 'Plan');
  assert.equal(answer, 'Done');
});

test('usage keeps cache and reasoning as subsets, not additional tokens', () => {
  assert.deepEqual(normalizeUsage(responsePayload([]).usage as AiResponse['usage']), { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedTokens: 50, reasoningTokens: 10 });
  assert.equal(normalizeUsage(null), undefined);
});

test('session statistics sum all tool rounds but do not confuse spend with context', () => {
  const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedTokens: 50, reasoningTokens: 10 };
  const requests = [{ id: 'one', entryId: 'assistant', endpoint: 'https://example.com/v1', model: 'test', createdAt: 1, status: 'completed' as const, usage }, { id: 'two', entryId: 'assistant', endpoint: 'https://example.com/v1', model: 'test', createdAt: 2, status: 'completed' as const, usage }];
  assert.deepEqual(sumUsage(requests), { inputTokens: 200, outputTokens: 40, totalTokens: 240, cachedTokens: 100, reasoningTokens: 20 });
  const session: ChatSession = { id: 'stats', title: 'Stats', createdAt: 1, updatedAt: 1, entries: [{ id: 'assistant', role: 'assistant', content: 'Done' }], responseItems: [], requests };
  const summary = sessionUsage(session, { ...config, contextWindow: 4096 }, [], '');
  assert.equal(summary.total?.totalTokens, 240);
  assert.equal(summary.current?.totalTokens, 240);
  assert.equal(summary.lastInputTokens, 100);
  assert.equal(summary.incomplete, false);
  assert.ok(summary.breakdown.systemAndTools > 0);
  assert.equal(summary.breakdown.contextWindow, 4096);
  assert.equal(summary.breakdown.safetyLevel, 'danger');
  assert.equal(sessionUsage({ ...session, requests: [...requests, { ...requests[0], id: 'failed', usage: undefined, status: 'aborted' }] }, config, [], '').incomplete, true);
  assert.equal(sessionUsage({ ...session, requests: [] }, config, [], '').total, undefined);
});

test('aborted requests record unknown usage without SDK retries', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let count = 0;
  const usages: RequestUsage[] = [];
  globalThis.fetch = async () => { count++; controller.abort(); throw new Error('aborted'); };
  try {
    await assert.rejects(runConversation({ config, input: [], bridge, signal: controller.signal, onText: () => {}, onTool: () => {}, onUsage: usage => usages.push(usage) }));
    assert.equal(count, 1);
    assert.equal(usages.length, 1);
    assert.equal(usages[0].status, 'aborted');
    assert.equal(usages[0].usage, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test('tool interruptions preserve the abort source and reason instead of claiming missing approval', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const source of ['user_stop', 'panel_closed', 'storage_changed', 'assistant_disposed'] as const) {
      const controller = new AbortController();
      const reason = new ConversationAbortError(source);
      const tools: ToolEvent[] = [];
      let history: ResponseItem[] = [];
      let requests = 0;
      globalThis.fetch = async () => {
        requests++;
        return streamResponse(responsePayload([{ type: 'function_call', call_id: 'interrupted-call', name: 'search_projects', arguments: '{}' }]));
      };
      const interruptedBridge: WorkspaceBridge = { ...bridge, manageProjects: async () => { controller.abort(reason); throw reason; } };
      await assert.rejects(runConversation({ config, input: [], bridge: interruptedBridge, signal: controller.signal, onText: () => {}, onTool: event => tools.push(event), onHistory: input => { history = input; } }), error => error === reason);
      const failed = tools.find(event => event.status === 'error')!;
      assert.deepEqual(JSON.parse(failed.result!), {
        error: 'Operation interrupted.', abortSource: source, reason: reason.message,
        retryPolicy: 'Do not automatically retry in this turn. A new explicit user request may retry.'
      });
      const result = history.find(item => 'type' in item && item.type === 'function_call_output');
      assert.ok(result && 'output' in result);
      assert.equal(result.output, failed.result);
      assert.equal(requests, 1);
    }
    const unknown = new AbortController();
    unknown.abort(new Error('External interruption'));
    assert.deepEqual(conversationAbortDetails(unknown.signal), { abortSource: 'unknown', reason: 'External interruption' });
  } finally { globalThis.fetch = originalFetch; }
});

test('user rejection pairs all pending tool calls without executing or retrying them', async () => {
  const originalFetch = globalThis.fetch;
  let count = 0;
  let history: ResponseItem[] = [];
  const rejectingBridge = { ...bridge, manageProjects: async () => { throw new Error('User cancelled'); } };
  globalThis.fetch = async () => { count++; return streamResponse(responsePayload(['first', 'second'].map(call_id => ({ type: 'function_call', call_id, name: 'search_projects', arguments: '{}' })))); };
  try {
    const content = await runConversation({ config, input: [], bridge: rejectingBridge, signal: new AbortController().signal, onText: () => {}, onTool: () => {}, onHistory: input => { history = input; } });
    assert.equal(count, 1);
    assert.equal(content, '操作已取消。');
    assert.equal(history.filter(item => 'type' in item && item.type === 'function_call_output').length, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('IndexedDB keeps separate session messages, titles and update ordering', async () => {
  const first: ChatSession = { id: 'session-one', title: 'First', createdAt: 1, updatedAt: 1, entries: [{ id: 'u1', role: 'user', content: 'One' }], responseItems: [{ role: 'user', content: 'One' }], requests: [{ id: 'request-one', endpoint: 'https://example.com/v1', model: 'test', createdAt: 1, status: 'completed', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }] };
  const second: ChatSession = { ...first, id: 'session-two', title: 'Second', updatedAt: 2, entries: [{ id: 'u2', role: 'user', content: 'Two' }], responseItems: [{ role: 'user', content: 'Two' }] };
  await saveStoredSession(first);
  await saveStoredSession(second);
  const imageBlob = new Blob(['image-data'], { type: 'image/webp' });
  await saveStoredImage(first.id, 'image-one', imageBlob);
  assert.equal((await loadStoredImage(first.id, 'image-one'))?.type, 'image/webp');
  assert.equal(await loadStoredImage(second.id, 'image-one'), null);
  assert.deepEqual((await listStoredSessions()).map(session => session.id), ['session-two', 'session-one']);
  await saveStoredSession({ ...first, title: 'Renamed', updatedAt: 3 });
  const restored = await listStoredSessions();
  assert.equal(restored[0].title, 'Renamed');
  assert.deepEqual(restored[0].requests, first.requests);
  assert.deepEqual(restored[0].responseItems, first.responseItems);
  assert.deepEqual(restored[1].responseItems, second.responseItems);
  await deleteStoredSession(first.id);
  assert.equal(await loadStoredImage(first.id, 'image-one'), null);
  assert.deepEqual((await listStoredSessions()).map(session => session.id), ['session-two']);
  await deleteStoredSession(second.id);
});

test('file mode stores encrypted configuration and each session under chat', async () => {
  const data = new Map<string, string>();
  const binary = new Map<string, Blob>();
  const files: ChatFileAccess = {
    read: async path => data.get(path) || null,
    write: async (path, value) => { data.set(path, value); },
    readBinary: async path => binary.get(path) || null,
    writeBinary: async (path, value) => { binary.set(path, value); },
    remove: async path => { data.delete(path); binary.delete(path); },
    removeDirectory: async path => { for (const key of binary.keys()) if (key.startsWith(path + '/')) binary.delete(key); },
    list: async path => [...data.keys(), ...binary.keys()].filter(key => key.startsWith(path + '/')).map(key => key.slice(path.length + 1))
  };
  const store = createFileChatStore(files, 'test-directory');
  const settings = configuredConfig();
  settings.maxToolRounds = 50;
  settings.maxImageFailures = 4;
  settings.skills = [exampleSkill()];
  Object.assign(settings.imageModels![0], { version: 'file-version', releasedAt: '2026-10-02', timeoutSeconds: 360 });
  await store.saveConfig(settings);
  assert.equal(data.get('chat/config.json')!.includes('"apiKey": "secret"'), false);
  assert.equal(toRequestConfig(await store.loadConfig()).apiKey, 'secret');
  assert.deepEqual((await createFileChatStore(files, 'reopened-directory').loadConfig()).imageModels, settings.imageModels);
  const restoredSettings = toRequestConfig(await createFileChatStore(files, 'reopened-limits').loadConfig());
  assert.equal(restoredSettings.maxToolRounds, 50);
  assert.equal(restoredSettings.maxImageFailures, 4);
  assert.deepEqual(restoredSettings.skills, settings.skills);
  const session: ChatSession = { id: 'file-session', title: 'File chat', createdAt: 1, updatedAt: 1, entries: [{ id: 'u', role: 'user', content: 'File message' }], responseItems: [{ role: 'user', content: 'File message' }], requests: [{ id: 'file-request', endpoint: 'https://example.com/v1', model: 'test', createdAt: 1, status: 'completed', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }] };
  await store.saveSession(session);
  const imageBlob = new Blob(['webp'], { type: 'image/webp' });
  await store.saveImage(session.id, 'image-one', imageBlob);
  assert.equal((await store.loadImage(session.id, 'image-one'))?.type, 'image/webp');
  assert.equal(binary.has('chat/images/file-session/image-one.webp'), true);
  assert.equal(data.has('chat/sessions/file-session.json'), true);
  assert.deepEqual((await store.listSessions())[0].requests, session.requests);
  assert.deepEqual((await store.listSessions())[0].responseItems, session.responseItems);
  assert.equal((await listStoredSessions()).some(item => item.id === session.id), false);
  await store.deleteSession(session.id);
  assert.equal(binary.has('chat/images/file-session/image-one.webp'), false);
  assert.equal((await store.listSessions()).length, 0);
  assert.throws(() => store.saveSession({ ...session, id: '../escape' }), /Invalid/);
});

test('endpoint without configured API key is identified', () => {
  const cfg = defaultConfig();
  const selected = cfg.endpoints[0];
  assert.equal(!selected.apiKey || !selected.apiKey.trim(), true);
  selected.apiKey = 'sk-test-key-123';
  assert.equal(Boolean(selected.apiKey && selected.apiKey.trim().length > 0), true);
});

test('parseMarkdown correctly renders markdown constructs with secure links', () => {
  const md = '# 标题\n\n**加粗** 与 *斜体*\n\n- 列表项 1\n- 列表项 2\n\n```ts\nconst a = 1;\n```\n\n[链接](https://example.com)';
  const html = parseMarkdown(md);
  assert.equal(html.includes('<h1>标题</h1>'), true);
  assert.equal(html.includes('<strong>加粗</strong>'), true);
  assert.equal(html.includes('<em>斜体</em>'), true);
  assert.equal(html.includes('<li>列表项 1</li>'), true);
  assert.equal(html.includes('<pre><code class="language-ts">const a = 1;\n</code></pre>'), true);
  assert.equal(html.includes('<a href="https://example.com" target="_blank" rel="noopener noreferrer">链接</a>'), true);
  assert.equal(parseMarkdown(''), '');
});

test('sanitizeResponseItems removes unpaired function_calls but keeps paired calls and outputs', () => {
  const user: ResponseItem = { role: 'user', content: '优化设计' };
  const call1: ResponseItem = { type: 'function_call', id: 'fc-1', call_id: 'c1', name: 'read_layers', arguments: '{}' };
  const out1: ResponseItem = { type: 'function_call_output', call_id: 'c1', output: '{"layers":[]}' };
  const danglingCall: ResponseItem = { type: 'function_call', id: 'fc-2', call_id: 'c2', name: 'update_canvas', arguments: '{}' };

  const sanitized = sanitizeResponseItems([user, call1, out1, danglingCall]);
  assert.equal(sanitized.length, 3);
  assert.equal(sanitized.some(item => 'call_id' in item && item.call_id === 'c2'), false);
  assert.equal(sanitized.some(item => 'call_id' in item && item.call_id === 'c1'), true);
});

test('runConversation can resume directly from existing tool outputs', async () => {
  const originalFetch = globalThis.fetch;
  let receivedInput: unknown[] = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    receivedInput = body.input;
    return streamResponse(responsePayload([textOutput]));
  };
  try {
    const resumedInput: ResponseItem[] = [
      { role: 'user', content: '优化设计' },
      { type: 'reasoning', id: 'rs-1', summary: [], content: [{ type: 'reasoning_text', text: 'Plan' }] },
      { type: 'function_call', id: 'fc-1', call_id: 'c1', name: 'read_layers', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c1', output: '{"layers":[]}' }
    ];
    const result = await runConversation({
      config,
      input: resumedInput,
      bridge,
      signal: new AbortController().signal,
      onText: () => {},
      onTool: () => {}
    });
    assert.equal(result, 'Done');
    assert.equal(receivedInput.length, 4);
    assert.equal((receivedInput[3] as { type: string }).type, 'function_call_output');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sumUsage computes single-turn token output accurately', () => {
  const requests: RequestUsage[] = [
    {
      id: 'req-1',
      entryId: 'assistant-1',
      endpoint: 'https://example.com/v1',
      model: 'test-model',
      createdAt: 100,
      status: 'completed',
      usage: { inputTokens: 500, outputTokens: 120, totalTokens: 620 }
    },
    {
      id: 'req-2',
      entryId: 'assistant-1',
      endpoint: 'https://example.com/v1',
      model: 'test-model',
      createdAt: 200,
      status: 'completed',
      usage: { inputTokens: 620, outputTokens: 80, totalTokens: 700 }
    },
    {
      id: 'req-3',
      entryId: 'assistant-2',
      endpoint: 'https://example.com/v1',
      model: 'test-model',
      createdAt: 300,
      status: 'completed',
      usage: { inputTokens: 700, outputTokens: 50, totalTokens: 750 }
    }
  ];

  const turn1Usage = sumUsage(requests.filter(r => r.entryId === 'assistant-1'));
  assert.ok(turn1Usage);
  assert.equal(turn1Usage.inputTokens, 1120);
  assert.equal(turn1Usage.outputTokens, 200);
  assert.equal(turn1Usage.totalTokens, 1320);

  const turn2Usage = sumUsage(requests.filter(r => r.entryId === 'assistant-2'));
  assert.ok(turn2Usage);
  assert.equal(turn2Usage.outputTokens, 50);
});

test('regenerate reverts project snapshot and resets turn without branching', async () => {
  let committedProject: any = null;
  const mockBridge = {
    ...bridge,
    commit: async (p: any) => { committedProject = p; }
  };

  const initialProject: ProjectState = {
    id: 'proj-1',
    title: 'Initial Title',
    layers: [],
    background: { type: 'color' as const, value: '#000000', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0.1, overlayScale: 20 },
    canvasConfig: { width: 1200, height: 630, ratio: '1200x630' },
    selectedLayerId: null,
    updatedAt: 1
  };

  const modifiedProject: ProjectState = {
    ...initialProject,
    title: 'AI Modified Title',
    layers: [{ id: 'layer-1', name: 'AI Layer', type: 'text', content: 'Hello', x: 0, y: 0, width: 100, height: 50, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }]
  };

  const previousResponseItems: ResponseItem[] = [
    { role: 'user', content: '第一轮对话' },
    { role: 'assistant', content: '第一轮回复' }
  ];

  const assistantEntry: ChatEntry = {
    id: 'asst-2',
    role: 'assistant',
    content: '修改了标题和图层',
    projectSnapshot: initialProject,
    previousResponseItems
  };

  const userEntry: ChatEntry = {
    id: 'user-2',
    role: 'user',
    content: '添加一个图层并修改标题'
  };

  const entries: ChatEntry[] = [
    { id: 'user-1', role: 'user', content: '第一轮对话' },
    { id: 'asst-1', role: 'assistant', content: '第一轮回复' },
    userEntry,
    assistantEntry
  ];

  // 模拟 regenerate 操作逻辑
  // 1. 恢复 snapshot
  await mockBridge.commit(assistantEntry.projectSnapshot);
  assert.equal(committedProject.title, 'Initial Title');
  assert.equal(committedProject.layers.length, 0);

  // 2. 移除上一轮的用户和助手 entry，撤销历史不分叉
  const filteredEntries = entries.filter(e => e.id !== assistantEntry.id && e.id !== userEntry.id);
  assert.equal(filteredEntries.length, 2);
  assert.equal(filteredEntries[filteredEntries.length - 1].id, 'asst-1');

  // 3. 恢复 responseItems 到该轮之前的状态
  const restoredResponseItems = assistantEntry.previousResponseItems!;
  assert.equal(restoredResponseItems.length, 2);
  assert.equal((restoredResponseItems[1] as any).content, '第一轮回复');
});



