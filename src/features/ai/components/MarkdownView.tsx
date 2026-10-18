import React, { useMemo } from 'react';
import { parseMarkdown } from '../services/markdown.ts';

interface MarkdownViewProps {
  content: string;
  className?: string;
}

export default function MarkdownView({ content, className = '' }: MarkdownViewProps) {
  const html = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div
      className={`cf-ai-markdown ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
