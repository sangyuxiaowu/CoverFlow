// @vitest-environment jsdom
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { ProjectState } from '../../../types.ts';
import type { WorkspaceBridge } from '../types.ts';
import { executeTool } from './execute.ts';
import { layerPatch, safeImage } from './validation.ts';
import { IMAGE_TOOL_DEFINITIONS, TOOL_DEFINITIONS, VISION_TOOL_DEFINITIONS } from './definitions.ts';
import { PRESET_RATIOS } from '../../../constants.ts';
import { ADD_LAYER_TYPES, ALIGN_MODES, DISTRIBUTE_MODES, EDIT_LAYER_RULES, LAYER_TOOL_ACTIONS, PROJECT_MANAGE_RULES, PROJECT_RULES, REORDER_POSITIONS, parseEditLayersRequest, parseLayerToolRequest, parseManageProjectsRequest } from './requests.ts';

test('add_layer uses an inline schema and creates the requested layer type', async () => {
  const definitions = TOOL_DEFINITIONS.filter(item => item.function.name.startsWith('add_'));
  assert.deepEqual(definitions.map(item => item.function.name), ['add_layer']);
  assert.doesNotMatch(JSON.stringify(TOOL_DEFINITIONS), /"\$(?:defs|ref)"/);
  const { bridge, signal } = setup();
  await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { text: { content: 'Title' } } }, bridge, signal);
  assert.equal(bridge.getProject()!.layers[0].type, 'text');
});

test('dedicated layer requests isolate updates, organization and ordering', () => {
  const target = { projectId: 'p1', layerIds: ['title'] };
  assert.deepEqual(parseLayerToolRequest('update_layers', { ...target, properties: { layerInfo: { x: 40 } } }), { ...target, action: 'update', properties: { x: 40 } });
  assert.deepEqual(parseLayerToolRequest('group_layers', { ...target, name: 'Heading' }), { ...target, action: 'group', name: 'Heading' });
  assert.deepEqual(parseLayerToolRequest('reorder_layers', { ...target, position: 'back' }), { ...target, action: 'back' });
  assert.throws(() => parseLayerToolRequest('update_layers', { ...target, action: 'delete', properties: { layerInfo: { x: 40 } } }), /unsupported field action/);
  assert.throws(() => parseLayerToolRequest('update_layers', { ...target, properties: { zIndex: 3 } }), /reorder_layers/);
  assert.throws(() => parseLayerToolRequest('delete_layers', { ...target, properties: { layerInfo: { x: 40 } } }), /unsupported field/);
  assert.throws(() => parseLayerToolRequest('reorder_layers', { ...target, position: 'delete' }), /position/);
  assert.throws(() => parseLayerToolRequest('align_layers', { ...target, mode: 'horizontal' }), /mode/);
});

test('every dedicated layer request rejects unrelated fields and requires its schema fields', () => {
  const samples = { projectId: 'p1', layerIds: ['a', 'b', 'c'], properties: { layerInfo: { x: 10 } }, name: 'Heading', mode: 'left', position: 'front', action: 'delete', type: 'text' };
  for (const name of Object.keys(LAYER_TOOL_ACTIONS) as (keyof typeof LAYER_TOOL_ACTIONS)[]) {
    const schema = TOOL_DEFINITIONS.find(item => item.function.name === name)!.function.parameters;
    const fields = Object.keys(schema.properties as object);
    const request = Object.fromEntries(fields.map(field => [field, field === 'mode' && name === 'distribute_layers' ? 'horizontal' : samples[field as keyof typeof samples]]));
    assert.doesNotThrow(() => parseLayerToolRequest(name, request), name);
    for (const field of Object.keys(samples).filter(field => !fields.includes(field))) {
      assert.throws(() => parseLayerToolRequest(name, { ...request, [field]: samples[field as keyof typeof samples] }), /unsupported field/, `${name}.${field}`);
    }
    for (const field of schema.required as string[]) {
      const missing = { ...request };
      delete missing[field];
      assert.throws(() => parseLayerToolRequest(name, missing), `${name}.${field}`);
    }
  }
});

test('dedicated organization and layout tools preserve existing layer behavior', async () => {
  const { bridge, signal } = setup();
  for (const x of [0, 200, 600]) {
    await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { layerInfo: { x, width: 100 }, text: { content: 'Title' } } }, bridge, signal);
  }
  const layerIds = bridge.getProject()!.layers.map(layer => layer.id);
  await executeTool('distribute_layers', { projectId: 'p1', layerIds, mode: 'horizontal' }, bridge, signal);
  assert.deepEqual(bridge.getProject()!.layers.map(layer => layer.x), [0, 300, 600]);
  await executeTool('duplicate_layers', { projectId: 'p1', layerIds: [layerIds[2]] }, bridge, signal);
  const copyId = bridge.getProject()!.selectedLayerId!;
  assert.notEqual(copyId, layerIds[2]);
  assert.equal(bridge.getProject()!.layers.find(layer => layer.id === copyId)!.content, 'Title');
  const children = layerIds.slice(0, 2);
  await executeTool('group_layers', { projectId: 'p1', layerIds: children }, bridge, signal);
  const groupId = bridge.getProject()!.selectedLayerId!;
  assert.deepEqual(bridge.getProject()!.layers.find(layer => layer.id === groupId)!.children, children);
  await executeTool('ungroup_layers', { projectId: 'p1', layerIds: [groupId] }, bridge, signal);
  assert.ok(!bridge.getProject()!.layers.some(layer => layer.id === groupId || layer.parentId === groupId));
  await executeTool('reorder_layers', { projectId: 'p1', layerIds: [copyId], position: 'back' }, bridge, signal);
  assert.equal(bridge.getProject()!.layers[0].id, copyId);
  await executeTool('reorder_layers', { projectId: 'p1', layerIds: [copyId], position: 'front' }, bridge, signal);
  assert.equal(bridge.getProject()!.layers.at(-1)!.id, copyId);
  await executeTool('delete_layers', { projectId: 'p1', layerIds: [copyId] }, bridge, signal);
  assert.deepEqual(new Set(bridge.getProject()!.layers.map(layer => layer.id)), new Set(layerIds));
});

test('removed entry points and cross-responsibility writes never commit', async () => {
  const { bridge, signal } = setup();
  const before = structuredClone(bridge.getProject());
  let commits = 0;
  const guarded = { ...bridge, commit: async () => { commits++; } };
  const names = TOOL_DEFINITIONS.map(item => item.function.name);
  for (const name of ['add_text_layer', 'add_image_layer', 'add_svg_layer', 'add_decoration_layer', 'edit_layers']) {
    assert.equal(names.includes(name), false);
    await assert.rejects(executeTool(name, { projectId: 'p1' }, guarded, signal), /Unknown tool/);
  }
  for (const type of ADD_LAYER_TYPES) {
    const properties = { [type]: { content: 'Title' } };
    await assert.rejects(executeTool('add_layer', { projectId: 'p1', properties }, guarded, signal), /Invalid type/);
    await assert.rejects(executeTool('add_layer', { projectId: 'p1', type, properties: { ...properties, zIndex: 1 } }, guarded, signal), /reorder_layers/);
    await assert.rejects(executeTool('add_layer', { projectId: 'p1', type, action: 'create', properties }, guarded, signal), /unsupported field action/);
  }
  for (const type of ['group', 'unknown', null]) {
    await assert.rejects(executeTool('add_layer', { projectId: 'p1', type, properties: {} }, guarded, signal), /Invalid type/);
  }
  for (const properties of [{ zIndex: 3 }, { parentId: 'group' }, { group: { children: ['a'] } }, { type: 'group' }]) {
    await assert.rejects(executeTool('update_layers', { projectId: 'p1', layerIds: ['a'], properties }, guarded, signal));
  }
  assert.equal(commits, 0);
  assert.deepEqual(bridge.getProject(), before);
});

function setup(layers: ProjectState['layers'] = [], selectedLayerIds: string[] = []) {
  let current: ProjectState = { id: 'p1', title: 'Test', updatedAt: 0, selectedLayerId: null, layers, canvasConfig: { width: 800, height: 600, ratio: '4:3' }, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } };
  const bridge: WorkspaceBridge = { getProject: () => current, getSelection: () => selectedLayerIds, commit: async project => { current = project; }, manageProjects: async args => args };
  const signal = new AbortController().signal;
  return { bridge, signal };
}

test('background removal is a static tool with model selection guidance and no readiness filtering', () => {
  const definitions = TOOL_DEFINITIONS.filter(item => item.function.name === 'remove_background');
  assert.equal(definitions.length, 1);
  const parameters = definitions[0].function.parameters;
  const properties = parameters.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(parameters.required, ['projectId', 'layerId']);
  assert.deepEqual(properties.modelId.enum, ['u2netp', 'birefnet', 'modnet']);
  assert.match(String(properties.modelId.description), /轻量|快速/);
  assert.match(String(properties.modelId.description), /毛发|复杂边缘/);
  assert.match(String(properties.modelId.description), /modnet.*人像/);
  assert.equal('backgroundRemoved' in (properties || {}), false);
});

test('dedicated tool provides cover size recommendations with and without an open project', async () => {
  const { bridge, signal } = setup();
  for (const getProject of [bridge.getProject, () => null]) {
    const recommendations = await executeTool('get_cover_size_recommendations', {}, { ...bridge, getProject }, signal) as {
      note: string; presets: typeof PRESET_RATIOS;
    };
    assert.deepEqual(recommendations.presets, PRESET_RATIOS);
    assert.match(recommendations.note, /不是平台强制规格/);
    assert.ok(recommendations.presets.every(preset => preset.description.length > 0));
    const context = await executeTool('get_context', {}, { ...bridge, getProject }, signal) as Record<string, unknown>;
    assert.equal('coverSizeRecommendations' in context, false);
    assert.equal('presets' in context, false);
    if (context.projectId === null) assert.match(String(context.message), /get_cover_size_recommendations/);
  }
  const definition = TOOL_DEFINITIONS.find(item => item.function.name === 'get_cover_size_recommendations');
  assert.ok(definition);
  assert.deepEqual(definition.function.parameters, { type: 'object', properties: {} });
});

test('project creation and search use dedicated tools and preserve bridge actions', async () => {
  const { bridge, signal } = setup();
  const requests: unknown[] = [];
  const projectBridge = { ...bridge, manageProjects: async (args: unknown) => { requests.push(args); return args; } };
  assert.deepEqual(await executeTool('create_project', { title: 'Cover', width: 900 }, projectBridge, signal), { title: 'Cover', width: 900, action: 'create' });
  assert.deepEqual(await executeTool('search_projects', { query: 'Cover', page: 2 }, projectBridge, signal), { query: 'Cover', page: 2, action: 'list' });
  assert.deepEqual(requests, [{ title: 'Cover', width: 900, action: 'create' }, { query: 'Cover', page: 2, action: 'list' }]);
  await assert.rejects(executeTool('create_project', { action: 'delete', projectId: 'p1' }, projectBridge, signal), /unsupported field/);
  await assert.rejects(executeTool('manage_projects', { action: 'create' }, projectBridge, signal), /Use create_project/);
  await assert.rejects(executeTool('manage_projects', { action: 'list' }, projectBridge, signal), /search_projects/);
});

test('context exposes only common layer properties and preserves group relationships', async () => {
  const common = { x: 10, y: 20, width: 300, height: 200, rotation: 15, zIndex: 2, visible: true, locked: false, opacity: 0.8, ratioLocked: true };
  const info = () => common;
  const layers: ProjectState['layers'] = [
    { ...common, id: 'group', name: 'Group', type: 'group', content: '', children: ['text', 'decoration'] },
    { ...common, id: 'text', name: 'Title', type: 'text', content: 'Hello', parentId: 'group', fontSize: 64, fontFamily: 'sans-serif', fontWeight: 700, textAlign: 'center', color: '#fff' },
    { ...common, id: 'decoration', name: 'Decoration', type: 'decoration', content: '--accent:#fff;background:var(--accent);', parentId: 'group' },
    { ...common, id: 'image', name: 'Photo', type: 'image', content: 'data:image/png;base64,abc', imageSource: 'upload', imageDescription: 'A photo', imageCrop: { x: 10, y: 10, width: 80, height: 80 }, backgroundRemoved: true },
    { ...common, id: 'svg', name: 'Icon', type: 'svg', content: '<svg></svg>', color: '#000' }
  ];
  const { bridge, signal } = setup(layers, ['group']);
  const context = await executeTool('get_context', {}, bridge, signal) as { layers: Record<string, unknown>[]; selectedLayerIds: string[] };
  assert.deepEqual(context.selectedLayerIds, ['group']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.layers)), [
    { id: 'group', name: 'Group', type: 'group', layerInfo: info(), group: { children: ['text', 'decoration'] } },
    { id: 'text', name: 'Title', type: 'text', parentId: 'group', layerInfo: info() },
    { id: 'decoration', name: 'Decoration', type: 'decoration', parentId: 'group', layerInfo: info() },
    { id: 'image', name: 'Photo', type: 'image', layerInfo: info() },
    { id: 'svg', name: 'Icon', type: 'svg', layerInfo: info() }
  ]);
  const details = await executeTool('read_layers', { projectId: 'p1' }, bridge, signal);
  const expected = [
    { id: 'group', name: 'Group', type: 'group', layerInfo: info(), group: { children: ['text', 'decoration'] } },
    { id: 'text', name: 'Title', type: 'text', parentId: 'group', layerInfo: info(), text: { content: 'Hello', fontSize: 64, fontFamily: 'sans-serif', fontWeight: 700, textAlign: 'center', color: '#fff' } },
    { id: 'decoration', name: 'Decoration', type: 'decoration', parentId: 'group', layerInfo: info(), decoration: { content: layers[2].content } },
    { id: 'image', name: 'Photo', type: 'image', layerInfo: info(), image: { content: '[embedded image]', imageSource: 'upload', imageDescription: 'A photo', imageCrop: { x: 10, y: 10, width: 80, height: 80 }, backgroundRemoved: true } },
    { id: 'svg', name: 'Icon', type: 'svg', layerInfo: info(), svg: { content: '<svg></svg>', color: '#000' } }
  ];
  assert.deepEqual(details, expected);
  const filtered = await executeTool('read_layers', { projectId: 'p1', layerIds: ['text', 'decoration'], query: 'Hello' }, bridge, signal);
  assert.deepEqual(filtered, [expected[1]]);
  const selected = await executeTool('get_selected_layers', {}, { ...bridge, getSelection: () => ['group', 'text', 'decoration', 'svg'] }, signal) as { layers: unknown[] };
  assert.deepEqual(selected.layers, expected.filter(layer => layer.type !== 'image'));
});

test('selected image layers expose metadata and only request a preview for vision models', async () => {
  const imageLayer: ProjectState['layers'][number] = { id: 'image-1', name: 'Photo', type: 'image', content: 'data:image/png;base64,abc', x: 10, y: 20, width: 300, height: 200, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 };
  const { bridge, signal } = setup([imageLayer], ['image-1']);
  let previewRequests = 0;
  const preview = new Blob(['webp'], { type: 'image/webp' });
  bridge.getLayerPreview = async () => { previewRequests++; return preview; };

  const textOnly = await executeTool('get_selected_layers', {}, bridge, signal) as { layers: Record<string, any>[]; images: unknown[] };
  assert.equal(previewRequests, 0);
  assert.equal(textOnly.layers[0].content, undefined);
  assert.equal('imageInfo' in textOnly.layers[0], false);
  assert.deepEqual(textOnly.layers[0].image.imageInfo, { sourceType: 'embedded', sourceLength: imageLayer.content.length, previewStatus: 'not_requested' });
  assert.deepEqual(textOnly.images, []);

  const visual = await executeTool('get_selected_layers', {}, bridge, signal, true) as { layers: Record<string, any>[]; images: { blob: Blob }[] };
  assert.equal(previewRequests, 1);
  assert.equal(visual.layers[0].image.imageInfo.previewStatus, 'available');
  assert.equal(visual.images[0].blob, preview);
});

test('tool schemas describe every parameter and nested field with valid required keys', () => {
  const inspect = (schema: Record<string, unknown>, path: string) => {
    assert.equal(typeof schema.description, 'string', `${path} needs a description`);
    assert.ok((schema.description as string).trim(), `${path} has an empty description`);
    if (schema.type === 'object') {
      assert.equal(Object.hasOwn(schema, 'additionalProperties'), false, path);
      const properties = schema.properties as Record<string, Record<string, unknown>>;
      if (schema.required) {
        assert.ok((schema.required as string[]).length > 0, `${path} has an empty required list`);
        for (const key of schema.required as string[]) assert.ok(Object.hasOwn(properties, key), `${path}.${key} is required but missing`);
      }
      for (const [key, child] of Object.entries(properties)) inspect(child, `${path}.${key}`);
    }
    assert.notEqual(schema.maxLength, 200000, `${path} has a meaningless maxLength`);
    assert.notEqual(schema.minimum, -100000, `${path} has a meaningless minimum`);
    assert.notEqual(schema.maximum, 100000, `${path} has a meaningless maximum`);
    if (schema.items) inspect(schema.items as Record<string, unknown>, `${path}[]`);
    if (Array.isArray(schema.anyOf)) schema.anyOf.forEach((child, index) => inspect(child, `${path}.anyOf[${index}]`));
  };
  const noParameterNames = ['get_context', 'get_cover_size_recommendations', 'get_selected_layers', 'get_canvas_preview', 'list_image_models', 'list_fonts'];
  const definitions = [...TOOL_DEFINITIONS, ...VISION_TOOL_DEFINITIONS, ...IMAGE_TOOL_DEFINITIONS];
  for (const definition of definitions) {
    if (noParameterNames.includes(definition.function.name)) {
      assert.deepEqual(definition.function.parameters, { type: 'object', properties: {} }, definition.function.name);
    } else {
      const schema = definition.function.parameters;
      for (const [field, child] of Object.entries(schema.properties as Record<string, Record<string, unknown>>)) {
        inspect(child, `${definition.function.name}.${field}`);
      }
    }
  }
  const add = TOOL_DEFINITIONS.find(definition => definition.function.name === 'add_layer')!.function;
  const edit = TOOL_DEFINITIONS.find(definition => definition.function.name === 'update_layers')!.function;
  const canvas = TOOL_DEFINITIONS.find(definition => definition.function.name === 'update_canvas')!.function;
  const addProperties = (add.parameters.properties as Record<string, Record<string, unknown>>).properties;
  const editProperties = (edit.parameters.properties as Record<string, Record<string, unknown>>).properties;
  const updatePropertiesSchema = editProperties;
  const updatePropertyFields = updatePropertiesSchema.properties as Record<string, unknown>;
  const addLayerProperties = addProperties.properties as Record<string, Record<string, unknown>>;
  const layerInfoDefinition = addLayerProperties.layerInfo;
  const layerInfoProperties = layerInfoDefinition.properties as Record<string, Record<string, unknown>>;
  const textProperties = addLayerProperties.text.properties as Record<string, Record<string, unknown>>;
  const imageFields = addLayerProperties.image.properties as Record<string, Record<string, unknown>>;
  const decorationFields = addLayerProperties.decoration.properties as Record<string, Record<string, unknown>>;
  const canvasProperties = canvas.parameters.properties as Record<string, Record<string, unknown>>;
  const backgroundProperties = (canvasProperties.background.properties as Record<string, Record<string, unknown>>);
  const overlayProperties = backgroundProperties.overlay.properties as Record<string, unknown>;
  assert.equal(Object.hasOwn(addProperties, 'required'), false);
  assert.equal(updatePropertiesSchema.minProperties, 1);
  assert.deepEqual(Object.keys(updatePropertyFields), []);
  assert.match(String(updatePropertiesSchema.description), /add_layer/);
  assert.equal(Object.hasOwn(addLayerProperties, 'content'), false);
  const layerInfoFields = ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'locked', 'ratioLocked'];
  assert.deepEqual(Object.keys(layerInfoProperties), layerInfoFields);
  assert.equal(layerInfoDefinition.minProperties, 1);
  assert.equal(Object.hasOwn(addLayerProperties, 'name'), true);
  assert.deepEqual(add.parameters.required, ['projectId', 'type', 'properties']);
  assert.deepEqual((add.parameters.properties as Record<string, Record<string, unknown>>).type.enum, [...ADD_LAYER_TYPES]);
  assert.deepEqual(Object.keys(addLayerProperties), ['name', 'layerInfo', ...ADD_LAYER_TYPES]);
  for (const type of ADD_LAYER_TYPES) {
    assert.deepEqual(addLayerProperties[type].required, ['content']);
    assert.equal((addLayerProperties[type].properties as Record<string, Record<string, unknown>>).content.type, 'string');
    assert.match(String(addLayerProperties[type].description), new RegExp(`type 为 ${type} 时必填`));
  }
  assert.equal(Object.hasOwn(editProperties, 'required'), false);
  assert.equal('zIndex' in updatePropertyFields, false);
  assert.deepEqual(Object.keys(overlayProperties), ['type', 'color', 'opacity', 'scale']);
  assert.equal(imageFields.imageFilters.minProperties, 1);
  assert.equal(imageFields.imageCrop.minProperties, 1);
  assert.ok(Object.hasOwn(textProperties, 'fontSize'));
  assert.ok(Object.hasOwn(textProperties, 'letterSpacing'));
  assert.equal(textProperties.lineHeight.minimum, 0.5);
  assert.equal(textProperties.lineHeight.maximum, 5);
  assert.ok(Object.hasOwn(textProperties, 'color'));
  assert.deepEqual(Object.keys(addLayerProperties.svg.properties as object), ['content', 'color']);
  assert.deepEqual(Object.keys(decorationFields), ['content']);
  assert.equal(add.description.includes('6000'), false);
  assert.equal(add.description.includes('url()'), false);
  assert.ok((((addLayerProperties.decoration.properties as Record<string, Record<string, unknown>>).content).description as string).includes('6000'));
});

test('layer tools use matching type groups for input and output', async () => {
  const { bridge, signal } = setup();
  const cases: [ProjectState['layers'][number]['type'], Record<string, unknown>][] = [
    ['text', { text: { content: 'Title\nSecond line', fontSize: 34, letterSpacing: 2.5, lineHeight: 1.8, color: '#fff7ec' } }],
    ['svg', { svg: { content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', color: '#d8ab63' } }],
    ['decoration', { decoration: { content: 'background:red;' } }],
    ['image', { image: { content: 'https://example.com/photo.png', imageSource: 'upload', flipX: true } }]
  ];
  for (const [type, properties] of cases) {
    await executeTool('add_layer', { projectId: 'p1', type, properties }, bridge, signal);
    const layerId = bridge.getProject()!.selectedLayerId!;
    const [details] = await executeTool('read_layers', { projectId: 'p1', layerIds: [layerId] }, bridge, signal) as Record<string, unknown>[];
    assert.deepEqual(details[type], { ...(type === 'text' ? { fontFamily: 'Inter, sans-serif', fontWeight: 700, textAlign: 'left' } : type === 'image' ? { imageDescription: '' } : {}), ...properties[type] as object });
    for (const field of ['color', 'fontSize', 'letterSpacing', 'lineHeight', 'fontFamily', 'imageSource', 'flipX']) assert.equal(field in details, false);
    await executeTool('update_layers', { projectId: 'p1', layerIds: [layerId], properties }, bridge, signal);
  }
  assert.throws(() => layerPatch({ color: '#fff' }), /color.*text.*svg/);
  assert.throws(() => layerPatch({ text: { color: '#fff' }, svg: { color: '#000' } }), /Duplicate|one.*group/);
  const before = structuredClone(bridge.getProject());
  await assert.rejects(executeTool('update_layers', { projectId: 'p1', layerIds: before!.layers.map(layer => layer.id), properties: { text: { color: '#000' } } }, bridge, signal), /only.*text/);
  assert.deepEqual(bridge.getProject(), before);
  for (const layer of before!.layers) {
    for (const [group, properties] of cases.filter(([type]) => type !== layer.type)) {
      await assert.rejects(executeTool('update_layers', { projectId: 'p1', layerIds: [layer.id], properties: { [group]: properties[group] } }, bridge, signal), /only supported/);
    }
  }
  assert.deepEqual(bridge.getProject(), before);
});

test('text line height only accepts finite multipliers in the supported range', () => {
  for (const lineHeight of [0.5, 1.1, 1.8, 5]) assert.deepEqual(layerPatch({ text: { lineHeight } }), { lineHeight });
  for (const lineHeight of [-1, 0, 0.49, 5.01, NaN, Infinity, '1.5', null]) assert.throws(() => layerPatch({ text: { lineHeight } }), /lineHeight/);
  assert.throws(() => layerPatch({ lineHeight: 1.5 }), /properties.text.lineHeight/);
});

test('text color, gradient and shadow update together under text without replacing unrelated fields', async () => {
  const { bridge, signal } = setup();
  await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { text: { content: 'Keep title', fontFamily: 'serif' } } }, bridge, signal);
  const layerId = bridge.getProject()!.selectedLayerId!;
  const styles = {
    fontSize: 78, letterSpacing: -1.5, lineHeight: 1.6, color: '#fff6ea', fontWeight: 500,
    textGradient: { enabled: true, from: '#fffaf0', to: '#f0c084', angle: 104 },
    textShadow: { enabled: true, color: 'rgba(0,0,0,0.55)', blur: 22, offsetX: 0, offsetY: 6 }
  };
  await executeTool('update_layers', { projectId: 'p1', layerIds: [layerId], properties: { layerInfo: { x: 52, y: 84, width: 720, height: 100 }, text: styles } }, bridge, signal);
  const [details] = await executeTool('read_layers', { projectId: 'p1', layerIds: [layerId] }, bridge, signal) as Record<string, unknown>[];
  assert.deepEqual(details.text, { content: 'Keep title', ...styles, fontFamily: 'serif', textAlign: 'left' });
  assert.equal('content' in details, false);
  assert.equal((details.layerInfo as Record<string, unknown>).x, 52);
  assert.equal((details.layerInfo as Record<string, unknown>).y, 84);
  assert.throws(() => layerPatch({ text: { unexpected: true } }), /properties.text.unexpected.*allowed fields/);
  assert.throws(() => layerPatch({ image: { backgroundRemoved: true } }), /properties.image.backgroundRemoved/);
  assert.throws(() => layerPatch({ group: { children: [] } }), /Unsupported/);
});

test('content belongs to each layer type for both writes and reads', async () => {
  const { bridge, signal } = setup();
  const cases = [
    ['text', 'Title', 'Updated title'],
    ['svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>'],
    ['image', 'data:image/png;base64,AA==', 'https://example.com/photo.png'],
    ['decoration', 'background:red;', 'background:blue;']
  ];
  for (const [type, content, updated] of cases) {
    await executeTool('add_layer', { projectId: 'p1', type, properties: { [type]: { content } } }, bridge, signal);
    const id = bridge.getProject()!.selectedLayerId!;
    const [details] = await executeTool('read_layers', { projectId: 'p1', layerIds: [id] }, bridge, signal) as Record<string, unknown>[];
    assert.equal('content' in details, false);
    assert.equal((details[type] as { content: string }).content, type === 'image' ? '[embedded image]' : content);
    const selected = await executeTool('get_selected_layers', {}, { ...bridge, getSelection: () => [id] }, signal) as { layers: Record<string, unknown>[] };
    assert.equal('content' in selected.layers[0], false);
    assert.equal((selected.layers[0][type] as { content?: string }).content, type === 'image' ? undefined : content);
    await executeTool('update_layers', { projectId: 'p1', layerIds: [id], properties: { [type]: { content: updated } } }, bridge, signal);
    assert.equal(bridge.getProject()!.layers.find(layer => layer.id === id)!.content, updated);
    await assert.rejects(executeTool('add_layer', { projectId: 'p1', type, properties: { [type]: { color: '#fff' } } }, bridge, signal));
    await assert.rejects(executeTool('add_layer', { projectId: 'p1', type, properties: { layerInfo: { width: 100 } } }, bridge, signal), new RegExp(`properties.${type}.content`));
  }
  assert.throws(() => layerPatch({ content: 'Flat content' }), /content.*properties.text.content/);
});

test('tools read live state between consecutive edits', async () => {
  const { bridge, signal } = setup();
  await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { text: { content: 'Hello', fontSize: 64 } } }, bridge, signal);
  const id = bridge.getProject()!.selectedLayerId!;
  assert.match(id, /^[0-9a-z]{9}$/);
  await executeTool('update_layers', { projectId: 'p1', layerIds: [id], properties: { text: { content: 'Updated' }, layerInfo: { opacity: 0.5 } } }, bridge, signal);
  assert.equal(bridge.getProject()!.layers[0].content, 'Updated');
  assert.equal(bridge.getProject()!.layers[0].opacity, 0.5);
});

test('stale project IDs, aborts and invalid fields never commit', async () => {
  const { bridge, signal } = setup();
  await assert.rejects(executeTool('add_layer', { projectId: 'old', type: 'text', properties: { text: { content: 'Bad' } } }, bridge, signal), /changed/);
  assert.throws(() => layerPatch({ id: 'overwrite' }), /Unsupported/);
  assert.throws(() => layerPatch({ layerInfo: { opacity: 2 } }), /Invalid/);
  assert.throws(() => layerPatch({ layerInfo: { width: Number.NaN } }), /Invalid/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(executeTool('update_canvas', { projectId: 'p1', width: 1000 }, bridge, abort.signal));
  assert.equal(bridge.getProject()!.layers.length, 0);
});

test('unsafe image sources are rejected', () => {
  assert.throws(() => safeImage('javascript:alert(1)'), /Images require an HTTP\(S\) URL or bitmap data URL\./);
  assert.throws(() => safeImage('not a URL'), /Images require an HTTP\(S\) URL or bitmap data URL\./);
  assert.throws(() => safeImage('data:image/svg+xml,<svg/>'));
  assert.equal(safeImage('https://example.com/cover.png'), 'https://example.com/cover.png');
});

test('canvas and background edits are validated and committed', async () => {
  const { bridge, signal } = setup();
  await executeTool('update_canvas', { projectId: 'p1', width: 1200, background: { type: 'gradient', value: 'linear-gradient(90deg,#000,#fff)', overlay: { type: 'dots', color: '#fff', opacity: 0.3, scale: 24 } } }, bridge, signal);
  assert.equal(bridge.getProject()!.canvasConfig.width, 1200);
  assert.equal(bridge.getProject()!.background.type, 'gradient');
  assert.equal(bridge.getProject()!.background.overlayType, 'dots');
  assert.equal(bridge.getProject()!.background.overlayScale, 24);
  await assert.rejects(executeTool('update_canvas', { projectId: 'p1', background: { overlay: { scale: 19 } } }, bridge, signal), /Invalid/);
  assert.equal(bridge.getProject()!.background.overlayScale, 24);
  await executeTool('update_canvas', { projectId: 'p1', background: { overlay: { scale: 20 } } }, bridge, signal);
  assert.equal(bridge.getProject()!.background.overlayScale, 20);
  await assert.rejects(executeTool('update_canvas', { projectId: 'p1', width: -1 }, bridge, signal), /Invalid/);
});

test('custom CSS backgrounds and HTML decorations use the shared validation', async () => {
  const { bridge, signal } = setup();
  await executeTool('update_canvas', { projectId: 'p1', background: { type: 'css', value: 'background: linear-gradient(45deg, red, blue);' } }, bridge, signal);
  assert.equal(bridge.getProject()!.background.type, 'css');
  await assert.rejects(executeTool('update_canvas', { projectId: 'p1', background: { overlay: { type: 'dots' } } }, bridge, signal), /Overlay textures are not supported/);
  await assert.rejects(executeTool('update_canvas', { projectId: 'p1', background: { type: 'css', value: 'background: red;', overlay: { scale: 24 } } }, bridge, signal), /Overlay textures are not supported/);
  await assert.rejects(executeTool('update_canvas', { projectId: 'p1', background: { overlayType: 'dots' } }, bridge, signal), /Unsupported background field/);
  assert.equal(bridge.getProject()!.background.overlayType, 'none');
  await assert.rejects(executeTool('update_canvas', { projectId: 'p1', background: { value: 'position:fixed;' } }, bridge, signal));
  const source = '<style>:root{--accent:#38bdf8}.badge{color:var(--accent)}</style><div class="badge">Hello</div>';
  await executeTool('add_layer', { projectId: 'p1', type: 'decoration', properties: { decoration: { content: source } } }, bridge, signal);
  const layer = bridge.getProject()!.layers[0];
  assert.equal(layer.content, source);
  assert.equal(layer.content, source);
  await assert.rejects(executeTool('update_layers', { projectId: 'p1', layerIds: [layer.id], properties: { decoration: { content: '<div onclick="alert(1)">Bad</div>' } } }, bridge, signal));
  assert.equal(bridge.getProject()!.layers[0].content, source);
  await assert.rejects(executeTool('update_layers', { projectId: 'p1', layerIds: [layer.id], properties: { decoration: { format: 'css' } } }, bridge, signal));
});

test('decoration color fields fail without committing while variable edits preserve alpha', async () => {
  const { bridge, signal } = setup();
  const content = '--accent: rgba(255,255,255,0.24); background: var(--accent);';
  await assert.rejects(executeTool('add_layer', { projectId: 'p1', type: 'decoration', properties: { decoration: { content }, color: '#ff0000' } }, bridge, signal), /color.*text.*svg/);
  await assert.rejects(executeTool('add_layer', { projectId: 'p1', type: 'decoration', properties: { decoration: { content }, text: { color: '#ff0000' } } }, bridge, signal), /only supported/);
  assert.equal(bridge.getProject()!.layers.length, 0);
  await executeTool('add_layer', { projectId: 'p1', type: 'decoration', properties: { decoration: { content } } }, bridge, signal);
  const decorationId = bridge.getProject()!.selectedLayerId!;
  await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { text: { content: 'Title', color: '#ffffff' } } }, bridge, signal);
  const textId = bridge.getProject()!.selectedLayerId!;
  await assert.rejects(executeTool('update_layers', { projectId: 'p1', layerIds: [decorationId, textId], properties: { text: { color: '#ff0000' } } }, bridge, signal), /only supported/);
  assert.equal(bridge.getProject()!.layers.find(layer => layer.id === textId)!.color, '#ffffff');
  const nextContent = content.replace('rgba(255,255,255,0.24)', 'oklch(0.6 0.1 220 / 0.24)');
  await executeTool('update_layers', { projectId: 'p1', layerIds: [decorationId], properties: { decoration: { content: nextContent } } }, bridge, signal);
  assert.equal(bridge.getProject()!.layers.find(layer => layer.id === decorationId)!.content, nextContent);
  assert.equal(bridge.getProject()!.layers.find(layer => layer.id === decorationId)!.content, nextContent);
  await executeTool('update_layers', { projectId: 'p1', layerIds: [textId], properties: { text: { color: '#22c55e' } } }, bridge, signal);
  assert.equal(bridge.getProject()!.layers.find(layer => layer.id === textId)!.color, '#22c55e');
});

test('edit actions reject missing, empty and unrelated arguments without committing', async () => {
  const { bridge, signal } = setup();
  await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { text: { content: 'Keep' } } }, bridge, signal);
  const before = structuredClone(bridge.getProject());
  const layerIds = [before!.layers[0].id];
  const invalid = [
    { action: 'update' }, { action: 'update', properties: {} },
    { action: 'update', properties: { opacity: 0.5 }, mode: 'left' },
    { action: 'delete', properties: { opacity: 0.5 } },
    { action: 'duplicate', name: 'Ignored' }, { action: 'front', mode: 'left' },
    { action: 'back', extra: true }, { action: 'ungroup', properties: {} },
    { action: 'group', properties: { name: 'Old contract' } },
    { action: 'align' }, { action: 'align', mode: 'horizontal' },
    { action: 'distribute' }, { action: 'distribute', mode: 'left' }
  ];
  let commits = 0;
  const guarded = { ...bridge, commit: async () => { commits++; } };
  for (const { action, ...args } of invalid) {
    const entry = Object.entries(LAYER_TOOL_ACTIONS).find(([, operation]) => operation === action);
    const name = REORDER_POSITIONS.includes(action as typeof REORDER_POSITIONS[number]) ? 'reorder_layers' : entry![0];
    const request = { projectId: 'p1', layerIds, ...args, ...(name === 'reorder_layers' ? { position: action } : {}) };
    await assert.rejects(executeTool(name, request, guarded, signal), Error, JSON.stringify(request));
    assert.deepEqual(bridge.getProject(), before);
  }
  assert.equal(commits, 0);
});

test('group uses a top-level name and alignment accepts its own modes', async () => {
  const { bridge, signal } = setup();
  for (const content of ['First', 'Second']) await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { text: { content } } }, bridge, signal);
  const layerIds = bridge.getProject()!.layers.map(layer => layer.id);
  await executeTool('group_layers', { projectId: 'p1', layerIds, name: 'Named group' }, bridge, signal);
  const group = bridge.getProject()!.layers.find(layer => layer.type === 'group')!;
  assert.equal(group.name, 'Named group');
  await executeTool('align_layers', { projectId: 'p1', layerIds: [group.id], mode: 'left' }, bridge, signal);
  assert.equal(bridge.getProject()!.layers.find(layer => layer.id === group.id)!.x, 0);
});

test('flat tool schemas and runtime action contracts stay aligned', () => {
  for (const [name, rules] of [['manage_projects', PROJECT_MANAGE_RULES]] as const) {
    const schema = TOOL_DEFINITIONS.find(definition => definition.function.name === name)!.function.parameters;
    assert.equal(schema.type, 'object');
    assert.equal(schema.oneOf, undefined);
    assert.equal(schema.anyOf, undefined);
    const fields = schema.properties as Record<string, Record<string, unknown>>;
    assert.deepEqual(fields.action.enum, Object.keys(rules));
    const contractFields = new Set(['action', ...Object.values(rules).flatMap(rule => [...rule.required, ...rule.optional])]);
    assert.deepEqual(Object.keys(fields).sort(), [...contractFields].sort());
    for (const [action, rule] of Object.entries(rules)) {
      assert.deepEqual([...(schema.required as string[])].sort(), ['action', ...Object.keys(fields).filter(field => field !== 'action' && Object.values(rules).every(branch => (branch.required as readonly string[]).includes(field)))].sort());
      for (const field of [...rule.required, ...rule.optional]) {
        assert.equal(typeof fields[field].description, 'string', `${name}.${action}.${field}`);
      }
    }
  }
  for (const [name, action] of Object.entries(LAYER_TOOL_ACTIONS)) {
    const schema = TOOL_DEFINITIONS.find(definition => definition.function.name === name)!.function.parameters;
    const rule = EDIT_LAYER_RULES[action];
    const fields = schema.properties as Record<string, Record<string, unknown>>;
    const required = [...rule.required, ...(name === 'reorder_layers' ? ['position'] : [])];
    assert.deepEqual(Object.keys(fields).sort(), [...required, ...rule.optional].sort());
    assert.deepEqual([...(schema.required as string[])].sort(), required.sort());
    assert.equal(schema.oneOf, undefined);
    assert.equal(schema.anyOf, undefined);
    assert.equal('action' in fields, false);
    if (name === 'align_layers') assert.deepEqual(fields.mode.enum, ALIGN_MODES);
    if (name === 'distribute_layers') assert.deepEqual(fields.mode.enum, DISTRIBUTE_MODES);
    if (name === 'reorder_layers') assert.deepEqual(fields.position.enum, REORDER_POSITIONS);
    if (name === 'update_layers') assert.equal(fields.properties.minProperties, 1);
  }
  const create = TOOL_DEFINITIONS.find(definition => definition.function.name === 'create_project')!.function.parameters;
  const search = TOOL_DEFINITIONS.find(definition => definition.function.name === 'search_projects')!.function.parameters;
  assert.deepEqual(Object.keys(create.properties as object).sort(), ['height', 'title', 'width']);
  assert.deepEqual(Object.keys(search.properties as object).sort(), ['page', 'pageSize', 'query']);
});

test('action parsers accept every valid action and reject every cross-action field', () => {
  const layerSamples: Record<string, unknown> = { projectId: 'p1', layerIds: ['a', 'b', 'c'], properties: { layerInfo: { opacity: 0.5 } }, name: 'Group', mode: 'left' };
  const projectSamples: Record<string, unknown> = { projectId: 'p1', title: 'Title', page: 1, pageSize: 20, query: 'Find', width: 800, height: 600 };
  for (const [rules, samples, parse] of [[EDIT_LAYER_RULES, layerSamples, parseEditLayersRequest], [PROJECT_RULES, projectSamples, parseManageProjectsRequest]] as const) {
    for (const [action, rule] of Object.entries(rules)) {
      const allowed: readonly string[] = [...rule.required, ...rule.optional];
      const args = { action, ...Object.fromEntries(allowed.map(field => [field, field === 'mode' && action === 'distribute' ? 'horizontal' : samples[field]])) };
      const expected = action === 'update' ? { ...args, properties: (samples.properties as { layerInfo: unknown }).layerInfo } : args;
      assert.deepEqual(parse(args), expected);
      for (const field of Object.keys(samples).filter(field => !allowed.includes(field))) {
        assert.throws(() => parse({ ...args, [field]: samples[field] }), /unsupported field/);
      }
      for (const field of rule.required) {
        const missing: Record<string, unknown> = { ...args };
        delete missing[field];
        assert.throws(() => parse(missing), /missing required field/);
        assert.throws(() => parse({ ...args, [field]: null }));
      }
    }
    for (const invalid of [null, [], {}, { action: '__proto__' }, { action: 'unknown' }]) assert.throws(() => parse(invalid));
  }
  for (const mode of ALIGN_MODES) assert.equal(parseEditLayersRequest({ projectId: 'p1', action: 'align', layerIds: ['a'], mode }).action, 'align');
  for (const mode of DISTRIBUTE_MODES) assert.equal(parseEditLayersRequest({ projectId: 'p1', action: 'distribute', layerIds: ['a', 'b', 'c'], mode }).action, 'distribute');
});

test('forward and backward execute through the tool without extra parameters', async () => {
  const { bridge, signal } = setup();
  for (const content of ['First', 'Second', 'Third']) await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { text: { content } } }, bridge, signal);
  const [first, second, third] = bridge.getProject()!.layers.map(layer => layer.id);
  const args = { projectId: 'p1', layerIds: [first] };
  await executeTool('reorder_layers', { ...args, position: 'forward' }, bridge, signal);
  assert.deepEqual(bridge.getProject()!.layers.map(layer => layer.id), [second, first, third]);
  await executeTool('reorder_layers', { ...args, position: 'backward' }, bridge, signal);
  assert.deepEqual(bridge.getProject()!.layers.map(layer => layer.id), [first, second, third]);
  const before = structuredClone(bridge.getProject());
  await assert.rejects(executeTool('reorder_layers', { ...args, position: 'forward', mode: 'left' }, bridge, signal), /unsupported field/);
  await assert.rejects(executeTool('reorder_layers', { ...args, position: 'backward', properties: { zIndex: 1 } }, bridge, signal), /unsupported field/);
  assert.deepEqual(bridge.getProject(), before);
});

test('image source and description are editable, readable and restricted to image layers', async () => {
  const { bridge, signal } = setup();
  await executeTool('add_layer', { projectId: 'p1', type: 'image', properties: { image: { content: 'https://example.com/photo.png', imageSource: 'upload', imageDescription: 'A user description' } } }, bridge, signal);
  const id = bridge.getProject()!.selectedLayerId!;
  await executeTool('update_layers', { projectId: 'p1', layerIds: [id], properties: { image: { imageDescription: 'Revised description' } } }, bridge, signal);
  const selected = await executeTool('get_selected_layers', {}, { ...bridge, getSelection: () => [id] }, signal) as { layers: { image: { imageSource: string; imageDescription: string } }[]; images: unknown[] };
  assert.equal(selected.layers[0].image.imageSource, 'upload');
  assert.equal(selected.layers[0].image.imageDescription, 'Revised description');
  assert.deepEqual(selected.images, []);
  const saved = JSON.parse(JSON.stringify(bridge.getProject())) as ProjectState;
  assert.equal(saved.layers[0].imageDescription, 'Revised description');
  assert.throws(() => layerPatch({ image: { imageSource: 'x'.repeat(201) } }), /Invalid/);
  assert.throws(() => layerPatch({ image: { imageDescription: 'x'.repeat(10001) } }), /Invalid/);
  await assert.rejects(executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { text: { content: 'Text' }, image: { imageSource: 'upload' } } }, bridge, signal), /only supported/);
});

test('image layer flip, filters, and non-destructive crop are controllable via AI tools and restricted to image layers', async () => {
  const { bridge, signal } = setup();
  await executeTool('add_layer', { type: 'image',
    projectId: 'p1',
    properties: {
      layerInfo: { width: 400, height: 300 },
      image: {
        content: 'https://example.com/photo.png',
        flipX: true,
        imageFilters: { brightness: 120, contrast: 110 },
        imageCrop: { x: 10, y: 20, width: 50, height: 50 }
      }
    }
  }, bridge, signal);

  const id = bridge.getProject()!.selectedLayerId!;
  let layer = bridge.getProject()!.layers[0];
  assert.equal(layer.flipX, true);
  assert.deepEqual(layer.imageFilters, { brightness: 120, contrast: 110, grayscale: 0, blur: 0 });
  assert.deepEqual(layer.imageCrop, { x: 10, y: 20, width: 50, height: 50 });

  // Partial filter update preserves existing brightness/contrast and updates grayscale/blur
  await executeTool('update_layers', {
    projectId: 'p1',
    layerIds: [id],
    properties: { image: { imageFilters: { grayscale: 40, blur: 2.5 } } }
  }, bridge, signal);
  layer = bridge.getProject()!.layers[0];
  assert.deepEqual(layer.imageFilters, { brightness: 120, contrast: 110, grayscale: 40, blur: 2.5 });

  // Flipping horizontally mirrors active crop X coordinate
  await executeTool('update_layers', {
    projectId: 'p1',
    layerIds: [id],
    properties: { image: { flipX: false, flipY: true } }
  }, bridge, signal);
  layer = bridge.getProject()!.layers[0];
  assert.equal(layer.flipX, false);
  assert.equal(layer.flipY, true);
  assert.deepEqual(layer.imageCrop, { x: 40, y: 30, width: 50, height: 50 });

  // Resetting filters and crop via default values clears imageFilters and imageCrop and restores dimensions
  await executeTool('update_layers', {
    projectId: 'p1',
    layerIds: [id],
    properties: {
      image: {
        imageFilters: { brightness: 100, contrast: 100, grayscale: 0, blur: 0 },
        imageCrop: { x: 0, y: 0, width: 100, height: 100 }
      }
    }
  }, bridge, signal);
  layer = bridge.getProject()!.layers[0];
  assert.equal(layer.imageFilters, undefined);
  assert.equal(layer.imageCrop, undefined);
  assert.equal(layer.width, 800);
  assert.equal(layer.height, 600);

  // Reject image-only properties on non-image layers and out-of-bounds crop/filter values
  await executeTool('add_layer', { projectId: 'p1', type: 'text', properties: { text: { content: 'Title' } } }, bridge, signal);
  const textId = bridge.getProject()!.selectedLayerId!;
  await assert.rejects(executeTool('update_layers', { projectId: 'p1', layerIds: [textId], properties: { image: { flipX: true } } }, bridge, signal), /only supported/);
  await assert.rejects(executeTool('update_layers', { projectId: 'p1', layerIds: [textId], properties: { image: { imageFilters: { brightness: 110 } } } }, bridge, signal), /only supported/);
  assert.throws(() => layerPatch({ image: { imageFilters: { brightness: 250 } } }), /Invalid/);
  assert.throws(() => layerPatch({ image: { imageFilters: {} } }), /Invalid imageFilters/);
  assert.throws(() => layerPatch({ image: { imageCrop: {} } }), /Invalid imageCrop/);
  assert.throws(() => layerPatch({ image: { imageCrop: { x: 60, width: 50 } } }), /exceed 100%/);
  await assert.rejects(executeTool('add_layer', { projectId: 'p1', type: 'image', properties: { image: { content: 'https://example.com/other.png' }, text: { fontSize: 32 } } }, bridge, signal), /only supported on text layers/);
  await assert.rejects(executeTool('update_layers', { projectId: 'p1', layerIds: [id], properties: { text: { fontSize: 32 } } }, bridge, signal), /only supported on text layers/);
});

test('layerInfo groups common properties for create, update and reads', async () => {
  const { bridge, signal } = setup();
  await executeTool('add_layer', { type: 'text',
    projectId: 'p1',
    properties: {
      name: 'Heading',
      layerInfo: { x: 24, y: 36, width: 420, opacity: 0.75 },
      text: { content: 'Title' }
    }
  }, bridge, signal);
  const layerId = bridge.getProject()!.selectedLayerId!;
  const read = async () => (await executeTool('read_layers', { projectId: 'p1', layerIds: [layerId] }, bridge, signal) as Record<string, unknown>[])[0];
  assert.equal((await read()).name, 'Heading');
  assert.deepEqual((await read()).layerInfo, {
    x: 24, y: 36, width: 420, height: 100, rotation: 0,
    zIndex: 1, visible: true, locked: false, opacity: 0.75
  });
  await executeTool('update_layers', {
    projectId: 'p1', layerIds: [layerId],
    properties: { name: 'New heading', layerInfo: { x: 80, visible: false }, text: { color: '#fff' } }
  }, bridge, signal);
  const updated = await read();
  assert.equal(updated.name, 'New heading');
  assert.equal((updated.layerInfo as Record<string, unknown>).x, 80);
  assert.equal((updated.layerInfo as Record<string, unknown>).visible, false);
  assert.equal((updated.text as Record<string, unknown>).color, '#fff');
  assert.deepEqual((await executeTool('get_selected_layers', {}, { ...bridge, getSelection: () => [layerId] }, signal) as { layers: Record<string, unknown>[] }).layers[0].layerInfo, updated.layerInfo);
  assert.throws(() => layerPatch({ x: 50 }), /properties\.layerInfo\.x/);
  assert.throws(() => layerPatch({ layerInfo: { zIndex: 2 } }), /Unsupported properties\.layerInfo\.zIndex/);
  await assert.rejects(executeTool('update_layers', { projectId: 'p1', layerIds: [layerId], properties: { x: 100 } }, bridge, signal), /properties\.layerInfo\.x/);
});