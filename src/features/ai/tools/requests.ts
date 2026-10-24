import type { Layer } from '../../../types.ts';
import type { LayerAction } from '../domain/layerOperations.ts';
import { choice, ids, layerPatch, number, record, text } from './validation.ts';

export const ALIGN_MODES = ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const;
export const DISTRIBUTE_MODES = ['horizontal', 'vertical'] as const;
export const REORDER_POSITIONS = ['front', 'back', 'forward', 'backward'] as const;
export const ADD_LAYER_TYPES = ['text', 'image', 'svg', 'decoration'] as const;
export const LAYER_TOOL_ACTIONS = {
  update_layers: 'update',
  delete_layers: 'delete',
  duplicate_layers: 'duplicate',
  group_layers: 'group',
  ungroup_layers: 'ungroup',
  reorder_layers: 'front',
  align_layers: 'align',
  distribute_layers: 'distribute'
} as const;

export type LayerUpdateProperties = Partial<Pick<Layer,
  'name' | 'content' | 'color' | 'fontFamily' | 'fontWeight' | 'x' | 'y' | 'width' | 'height' |
  'rotation' | 'zIndex' | 'opacity' | 'fontSize' | 'visible' | 'locked' | 'ratioLocked' |
  'textAlign' | 'writingMode' | 'textGradient' | 'textShadow'
>>;

interface ActionRule {
  required: readonly string[];
  optional: readonly string[];
}

type RequestUnion<Fields, Rules extends Record<string, ActionRule>> = {
  [Action in keyof Rules]: { action: Action } &
    Pick<Fields, Extract<Rules[Action]['required'][number], keyof Fields>> &
    Partial<Pick<Fields, Extract<Rules[Action]['optional'][number], keyof Fields>>>
}[keyof Rules];

interface EditLayerFields {
  projectId: string;
  layerIds: string[];
  properties: LayerUpdateProperties;
  name: string;
  mode: typeof ALIGN_MODES[number] | typeof DISTRIBUTE_MODES[number];
}

export const EDIT_LAYER_RULES = {
  update: { required: ['projectId', 'layerIds', 'properties'], optional: [] },
  delete: { required: ['projectId', 'layerIds'], optional: [] },
  duplicate: { required: ['projectId', 'layerIds'], optional: [] },
  group: { required: ['projectId', 'layerIds'], optional: ['name'] },
  ungroup: { required: ['projectId', 'layerIds'], optional: [] },
  front: { required: ['projectId', 'layerIds'], optional: [] },
  back: { required: ['projectId', 'layerIds'], optional: [] },
  forward: { required: ['projectId', 'layerIds'], optional: [] },
  backward: { required: ['projectId', 'layerIds'], optional: [] },
  align: { required: ['projectId', 'layerIds', 'mode'], optional: [] },
  distribute: { required: ['projectId', 'layerIds', 'mode'], optional: [] }
} as const satisfies Record<LayerAction, { required: readonly (keyof EditLayerFields)[]; optional: readonly (keyof EditLayerFields)[] }>;

type EditLayerVariants = RequestUnion<EditLayerFields, typeof EDIT_LAYER_RULES>;
export type EditLayersRequest = Exclude<EditLayerVariants, { action: 'align' | 'distribute' }> |
  (Extract<EditLayerVariants, { action: 'align' }> & { mode: typeof ALIGN_MODES[number] }) |
  (Extract<EditLayerVariants, { action: 'distribute' }> & { mode: typeof DISTRIBUTE_MODES[number] });

interface ProjectFields {
  projectId: string;
  title: string;
  query: string;
  page: number;
  pageSize: number;
  width: number;
  height: number;
}

export const PROJECT_RULES = {
  list: { required: [], optional: ['page', 'pageSize', 'query'] },
  create: { required: [], optional: ['title', 'width', 'height'] },
  open: { required: ['projectId'], optional: [] },
  rename: { required: ['projectId', 'title'], optional: [] },
  duplicate: { required: ['projectId'], optional: ['title'] },
  delete: { required: ['projectId'], optional: [] },
  save: { required: ['projectId'], optional: [] }
} as const satisfies Record<string, { required: readonly (keyof ProjectFields)[]; optional: readonly (keyof ProjectFields)[] }>;

export const PROJECT_MANAGE_RULES = {
  open: PROJECT_RULES.open,
  rename: PROJECT_RULES.rename,
  duplicate: PROJECT_RULES.duplicate,
  delete: PROJECT_RULES.delete,
  save: PROJECT_RULES.save
} as const;

export type ManageProjectsRequest = RequestUnion<ProjectFields, typeof PROJECT_RULES>;

export function fieldUsage(rules: Record<string, ActionRule>, field: string): string {
  const required = Object.entries(rules).filter(([, rule]) => rule.required.includes(field)).map(([action]) => action);
  const optional = Object.entries(rules).filter(([, rule]) => rule.optional.includes(field)).map(([action]) => action);
  return [required.length ? `${required.join('/')} 时必填。` : '', optional.length ? `${optional.join('/')} 时可选。` : '', '其他操作禁止提供。'].join('');
}

function parseActionRequest(input: unknown, rules: Record<string, ActionRule>, parsers: Record<string, (value: unknown) => unknown>) {
  const args = record(input);
  const action = choice(args.action, 'action', Object.keys(rules));
  const rule = rules[action];
  const allowed = ['action', ...rule.required, ...rule.optional];
  for (const field of Object.keys(args)) {
    if (!allowed.includes(field)) throw new Error(`${action}: unsupported field ${field}. ${fieldUsage(rules, field)}`);
  }
  for (const field of rule.required) {
    if (!Object.hasOwn(args, field) || args[field] === undefined) throw new Error(`${action}: missing required field ${field}.`);
  }
  return Object.fromEntries(Object.entries(args).map(([field, value]) => [field, field === 'action' ? action : parsers[field](value)]));
}

export function parseEditLayersRequest(input: unknown): EditLayersRequest {
  const args = parseActionRequest(input, EDIT_LAYER_RULES, {
    projectId: value => text(value, 'projectId'),
    layerIds: ids,
    properties: value => {
      const patch = layerPatch(value);
      if (!Object.keys(patch).length) throw new Error('update: properties must contain at least one field.');
      return patch;
    },
    name: value => text(value, 'name'),
    mode: value => choice(value, 'mode', record(input).action === 'align' ? ALIGN_MODES : DISTRIBUTE_MODES)
  });
  return args as EditLayersRequest;
}

export function parseLayerToolRequest(name: keyof typeof LAYER_TOOL_ACTIONS, input: unknown): EditLayersRequest {
  const args = record(input);
  if (Object.hasOwn(args, 'action')) throw new Error(`${name}: unsupported field action.`);
  if (name === 'update_layers' && Object.hasOwn(record(args.properties), 'zIndex')) {
    throw new Error('update_layers: unsupported field zIndex. Use reorder_layers.');
  }
  if (name === 'reorder_layers') {
    const { position, ...rest } = args;
    return parseEditLayersRequest({ ...rest, action: choice(position, 'position', REORDER_POSITIONS) });
  }
  return parseEditLayersRequest({ ...args, action: LAYER_TOOL_ACTIONS[name] });
}

export function parseManageProjectsRequest(input: unknown): ManageProjectsRequest {
  const integer = (value: unknown, field: string, maximum: number) => {
    const parsed = number(value, field, 1, maximum);
    if (!Number.isInteger(parsed)) throw new Error('Invalid ' + field + ': expected an integer.');
    return parsed;
  };
  return parseActionRequest(input, PROJECT_RULES, {
    projectId: value => text(value, 'projectId'),
    title: value => text(value, 'title'),
    query: value => text(value, 'query'),
    page: value => integer(value, 'page', 100000),
    pageSize: value => integer(value, 'pageSize', 50),
    width: value => number(value, 'width', 10, 10000),
    height: value => number(value, 'height', 10, 10000)
  }) as ManageProjectsRequest;
}