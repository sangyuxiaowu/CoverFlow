import React, { useState } from 'react';
import * as csstree from 'css-tree';
import { Language, translations } from '../translations.ts';
import { detectDecorationFormat, type ContentFormat } from '../utils/customContent.ts';
import ColorPicker from './ColorPicker.tsx';

interface Props {
  lang: Language;
  content: string;
  format: ContentFormat;
  onChange: (source: string) => void;
  onChangeFormat: (format: ContentFormat) => void;
}

const fieldClass = 'w-full min-w-0 bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-blue-500';

const DecorationCodeEditor: React.FC<Props> = ({ lang, content, format, onChange, onChangeFormat }) => {
  const t = translations[lang];
  const formatId = React.useId();
  const [nodeIndex, setNodeIndex] = useState(0);
  const resolved = format === 'auto' ? detectDecorationFormat(content) : format;
  const document = resolved === 'html' ? new DOMParser().parseFromString(content, 'text/html') : null;
  const nodes = document ? Array.from(document.body.querySelectorAll('*')).filter((node) => node.tagName !== 'STYLE') : [];
  const selectedNode = nodes[Math.min(nodeIndex, nodes.length - 1)];
  const serialize = () => document ? `${document.head.innerHTML}${document.body.innerHTML}` : content;
  const variables = new Map<string, string>();
  const visitCss = (source: string, context: 'stylesheet' | 'declarationList', update?: { name: string; value: string }) => {
    try {
      const tree = csstree.parse(source, { context, parseCustomProperty: true });
      csstree.walk(tree, (node) => {
        if (node.type !== 'Declaration' || !node.property.startsWith('--')) return;
        variables.set(node.property, csstree.generate(node.value));
        if (update?.name === node.property) node.value = csstree.parse(update.value, { context: 'value' }) as csstree.Value;
      });
      return csstree.generate(tree);
    } catch {
      return source;
    }
  };
  const collectOrUpdate = (update?: { name: string; value: string }) => {
    if (!document) return visitCss(content, 'declarationList', update);
    document.querySelectorAll('style').forEach((style) => {
      const next = visitCss(style.textContent || '', 'stylesheet', update);
      if (update) style.textContent = next;
    });
    document.querySelectorAll('[style]').forEach((element) => {
      const next = visitCss(element.getAttribute('style') || '', 'declarationList', update);
      if (update) element.setAttribute('style', next);
    });
    return serialize();
  };
  collectOrUpdate();

  return (
    <div className="space-y-3 min-w-0">
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-slate-400" htmlFor={formatId}>{t.customCodeFormat}</label>
        <select id={formatId} aria-label={t.customCodeFormat} value={format} onChange={(event) => onChangeFormat(event.target.value as ContentFormat)} className={`${fieldClass} flex-1`}>
          <option value="auto">{t.customCodeAuto}</option>
          <option value="css">CSS</option>
          <option value="html">HTML</option>
        </select>
        <span className="text-[10px] text-sky-400 shrink-0">{resolved.toUpperCase()}</span>
      </div>
      <textarea
        aria-label={t.decorationCode}
        value={content}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className={`${fieldClass} min-h-[180px] font-mono leading-5 resize-y`}
      />
      {resolved === 'html' && nodes.length > 0 && (
        <div className="space-y-2">
          <label className="text-[10px] text-slate-400">{t.customCodeNode}</label>
          <select aria-label={t.customCodeNode} value={Math.min(nodeIndex, nodes.length - 1)} onChange={(event) => setNodeIndex(Number(event.target.value))} className={fieldClass}>
            {nodes.map((node, index) => <option key={index} value={index}>{`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${node.className ? `.${String(node.className).trim().split(/\s+/).join('.')}` : ''}`}</option>)}
          </select>
          {selectedNode && selectedNode.children.length === 0 && (
            <input aria-label={t.customCodeText} value={selectedNode.textContent || ''} placeholder={t.customCodeText} onChange={(event) => {
              selectedNode.textContent = event.target.value;
              onChange(serialize());
            }} className={fieldClass} />
          )}
          {selectedNode && (
            <textarea aria-label={t.customCodeNodeStyle} value={selectedNode.getAttribute('style') || ''} placeholder={t.customCodeNodeStyle} onChange={(event) => {
              selectedNode.setAttribute('style', event.target.value);
              onChange(serialize());
            }} className={`${fieldClass} font-mono min-h-[64px]`} />
          )}
        </div>
      )}
      {variables.size > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] text-slate-400">{t.customCodeVariables}</div>
          {Array.from(variables).map(([name, value]) => (
            <div key={name} className="flex items-center gap-2 text-[10px] text-slate-400 min-w-0">
              <span className="w-24 truncate shrink-0" title={name}>{name}</span>
              <ColorPicker lang={lang} name={name} value={value} onChange={(next) => onChange(collectOrUpdate({ name, value: next }))} />
              <input aria-label={`${name} ${t.customCodeValue}`} value={value} onChange={(event) => onChange(collectOrUpdate({ name, value: event.target.value }))} className={`${fieldClass} flex-1 font-mono`} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DecorationCodeEditor;