import { describe, expect, it } from 'vitest';
import type { ImageModelConfig, ToolEvent } from '../types.ts';
import { imageModelForTool } from './imageToolModel.ts';

const model = (id: string, enabled = true): ImageModelConfig => ({
  id,
  adapter: 'gpt-image',
  label: `Label ${id}`,
  description: '',
  modelId: `api-${id}`,
  endpointId: 'endpoint',
  requestUrl: '',
  enabled,
  size: '1024x1024',
  ratio: '1:1',
  steps: 20,
  guidance: 7.5
});

const tool = (name: string, args: string): ToolEvent => ({
  id: 'tool',
  name,
  arguments: args,
  status: 'success'
});

describe('imageModelForTool', () => {
  it('resolves the displayed model from the tool model configuration ID', () => {
    const configured = model('config-id-123');
    expect(imageModelForTool(tool('generate_image', '{"modelConfigId":"configid1"}'), [configured])).toBe(configured);
  });

  it('uses the only enabled model when the single-model tool omits its ID', () => {
    const configured = model('single');
    expect(imageModelForTool(tool('generate_image', '{}'), [model('disabled', false), configured])).toBe(configured);
  });

  it('does not guess when the model ID is unknown or multiple models are enabled', () => {
    const models = [model('first'), model('second')];
    expect(imageModelForTool(tool('generate_image', '{"modelConfigId":"missing"}'), models)).toBeUndefined();
    expect(imageModelForTool(tool('generate_image', '{}'), models)).toBeUndefined();
  });

  it('ignores non-image tools and malformed arguments', () => {
    const configured = [model('single')];
    expect(imageModelForTool(tool('read_layers', '{}'), configured)).toBeUndefined();
    expect(imageModelForTool(tool('generate_image', '{'), configured)).toBeUndefined();
  });
});