import { Marked } from 'marked';

export const markdownParser = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    link({ href, title, text }) {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
    }
  }
});

export function parseMarkdown(content: string): string {
  if (!content) return '';
  try {
    return markdownParser.parse(content, { async: false }) as string;
  } catch {
    return content;
  }
}
