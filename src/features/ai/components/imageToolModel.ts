import { imageModelToolId } from '../image-generation/models.ts';
import type { ImageModelConfig, ToolEvent } from '../types.ts';

export function imageModelForTool(tool: ToolEvent, models: ImageModelConfig[] | undefined): ImageModelConfig | undefined {
  if (tool.name !== 'generate_image') return undefined;
  let args: unknown;
  try {
    args = JSON.parse(tool.arguments);
  } catch {
    return undefined;
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;

  const enabledModels = models?.filter(model => model.enabled) || [];
  if ('modelConfigId' in args) {
    if (typeof args.modelConfigId !== 'string') return undefined;
    return enabledModels.find(model => model.id === args.modelConfigId || imageModelToolId(model) === args.modelConfigId);
  }
  return enabledModels.length === 1 ? enabledModels[0] : undefined;
}