import React, { useId } from 'react';
import type { Layer } from '../types.ts';
import { detectDecorationFormat, resolveDecorationLayerImages, sanitizeDecorationHtml } from '../utils/customContent.ts';
import { buildDecorationLayerStyle } from '../utils/decorationStyles.ts';

interface DecorationContentProps {
  content: string;
  layers?: readonly Layer[];
}

const DecorationContent: React.FC<DecorationContentProps> = ({ content, layers = [] }) => {
  const instanceId = useId().replace(/[^a-z0-9-]/gi, '');
  const resolved = detectDecorationFormat(content);
  if (resolved === 'css') return <div className="w-full h-full" style={buildDecorationLayerStyle(content)} />;
  const result = sanitizeDecorationHtml(content, instanceId);
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', isolation: 'isolate', contain: 'layout paint style', pointerEvents: 'none', boxSizing: 'border-box' }}>
      <div
        data-cf-fragment={instanceId}
        style={{ width: '100%', height: '100%', position: 'relative', boxSizing: 'border-box' }}
        dangerouslySetInnerHTML={{ __html: resolveDecorationLayerImages(result.source, layers) }}
      />
    </div>
  );
};

export default React.memo(DecorationContent);