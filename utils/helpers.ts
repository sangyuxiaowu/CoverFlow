// 模块：通用工具（导出、SVG 处理）
// 生成短随机 ID。
export const generateId = () => Math.random().toString(36).substr(2, 9);

// 触发浏览器下载。
export const downloadFile = (content: string, fileName: string, contentType: string) => {
  const a = document.createElement("a");
  const file = new Blob([content], { type: contentType });
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
};

const getSVGContent = (svgString: string): string => {
  // 查找第一个 <svg>（忽略大小写）
  const idx = svgString.toLowerCase().indexOf('<svg');
  if (idx >= 0) {
    return svgString.substring(idx);
  }
  return `<svg>${svgString}</svg>`;
};

// 标准化 SVG 以便在画布中一致渲染。
export const normalizeSVG = (svgContent: string): string => {
  const content = getSVGContent(svgContent);

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    const parserError = doc.querySelector('parsererror');

    if (svg && !parserError) {
      const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // 使用基于内容的稳定前缀（函数签名不能变，所以基于内容生成）
      const idPrefix = `cf-${Math.abs(Array.from(content).reduce((h, c) => (h << 5) - h + c.charCodeAt(0), 0)).toString(36)}`;
      const idMap = new Map<string, string>();

      // 修复1：从整个document找ID，包括defs！
      Array.from(doc.querySelectorAll('[id]')).forEach(el => {
        const oldId = el.getAttribute('id');
        if (!oldId) return;
        const nextId = `${idPrefix}-${oldId}`;
        idMap.set(oldId, nextId);
        el.setAttribute('id', nextId);
      });

      if (idMap.size > 0) {
        // 处理所有元素的属性中的url引用
        const allNodes = [svg, ...Array.from(doc.querySelectorAll('*'))];
        allNodes.forEach(node => {
          Array.from(node.attributes).forEach(attr => {
            let value = attr.value;
            if (!value || !value.includes('#')) return;
            idMap.forEach((nextId, oldId) => {
              const re = new RegExp(`#${escapeRegExp(oldId)}(?![\\w-])`, 'g');
              value = value.replace(re, `#${nextId}`);
            });
            if (value !== attr.value) {
              node.setAttribute(attr.name, value);
            }
          });
        });

        // 修复2：处理style标签内的CSS url引用！
        const styleTags = doc.querySelectorAll('style');
        styleTags.forEach(style => {
          let cssText = style.textContent || '';
          idMap.forEach((nextId, oldId) => {
            const re = new RegExp(`url\\(#${escapeRegExp(oldId)}\\)`, 'g');
            cssText = cssText.replace(re, `url(#${nextId})`);
          });
          style.textContent = cssText;
        });
      }

      // 计算合理的 viewBox
      let viewBox = svg.getAttribute('viewBox');
      if (!viewBox) {
        const w = parseFloat(svg.getAttribute('width') || '0') || parseFloat(svg.style.width) || 0;
        const h = parseFloat(svg.getAttribute('height') || '0') || parseFloat(svg.style.height) || 0;
        if (w > 0 && h > 0) {
          viewBox = `0 0 ${w} ${h}`;
        } else {
          viewBox = '0 0 100 100';
        }
      }

      // 构建新的属性列表
      const newAttrs: string[] = [];
      newAttrs.push(`viewBox="${viewBox}"`);
      newAttrs.push('width="100%"');
      newAttrs.push('height="100%"');
      
      // 修复3：保留原始preserveAspectRatio，绝不强制none！
      const par = svg.getAttribute('preserveAspectRatio');
      newAttrs.push(`preserveAspectRatio="${par || 'xMidYMid meet'}"`);

      // 显式排除的属性（只移除布局相关）
      const blacklist = ['width', 'height', 'x', 'y', 'id', 'enable-background', 'viewbox', 'preserveaspectratio'];
      
      // 保留所有其他原始属性
      Array.from(svg.attributes).forEach(attr => {
        const name = attr.name.toLowerCase();
        if (!blacklist.includes(name) && !name.startsWith('on')) {
          newAttrs.push(`${attr.name}="${attr.value}"`);
        }
      });

      // 处理 style：移除现有宽高并强制100%与block，但保留颜色相关样式！
      let style = svg.getAttribute('style') || '';
      
      // 提取并保留颜色相关样式
      const colorStyles: string[] = [];
      style.split(';').forEach(s => {
        const trimmed = s.trim();
        if (trimmed && 
            (trimmed.includes('fill') || 
             trimmed.includes('stroke') || 
             trimmed.includes('color') || 
             trimmed.includes('opacity') ||
             trimmed.includes('filter'))) {
          colorStyles.push(trimmed);
        }
      });
      
      // 移除 style 中的 width/height
      style = style.replace(/(?:^|;)\s*(?:width|height)\s*:[^;]+/gi, '');
      
      // 通过内联 style 强制全尺寸与 block，并保留颜色样式
      const layoutStyle = 'width: 100%; height: 100%; display: block;';
      const finalStyle = [layoutStyle, ...colorStyles].join(' ');
      newAttrs.push(`style="${finalStyle}"`);
      
      // 确保存在 XML 命名空间
      if (!newAttrs.some(a => a.toLowerCase().startsWith('xmlns='))) {
        newAttrs.push('xmlns="http://www.w3.org/2000/svg"');
      }

      // 用净化后的属性重建 SVG 标签
      const result = `<svg ${newAttrs.join(' ')}>${svg.innerHTML}</svg>`;
      
      return result;
    }
  } catch (e) {
    // 静默失败，走兜底逻辑
  }

  // 兜底：DOMParser 失败时使用正则替换
  let fixed = content;
  
  if (!fixed.match(/viewBox/i)) {
    fixed = `<svg width="100%" height="100%" style="width: 100%; height: 100%; display: block;" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${content.replace(/<\/?svg[^>]*>/g, '')}</svg>`;
  } else {
    // 使用正则替换开标签属性
    fixed = fixed.replace(/<svg([^>]*)>/i, (match, attrs) => {
        let newAttrs = attrs;
        // 移除 width、height、x、y、id、enable-background
        const regex = /\s+(width|height|x|y|id|enable-background)\s*=\s*(["'])(?:(?!(?:\\|\2)).|\\.)*\2/gi;
        newAttrs = newAttrs.replace(regex, '');
        const regexUnquoted = /\s+(width|height|x|y|id|enable-background)\s*=\s*[\w%\.]+/gi;
        newAttrs = newAttrs.replace(regexUnquoted, '');

        // 确保 style 存在并强制尺寸，但尽量保留原有样式
        if (!newAttrs.includes('style=')) {
            newAttrs += ' style="width: 100%; height: 100%; display: block;"';
        } else {
            // 若已存在 style，则追加布局样式，保留原有颜色
            newAttrs = newAttrs.replace(/style=(["'])/i, 'style=$1width: 100%; height: 100%; display: block; ');
        }

        // 修复preserveAspectRatio
        if (!newAttrs.includes('preserveAspectRatio=')) {
          newAttrs += ' preserveAspectRatio="xMidYMid meet"';
        }

        return `<svg${newAttrs} width="100%" height="100%">`;
    });
  }

  return fixed;
};

// 根据锁定比例控制 SVG 的 preserveAspectRatio。
export const applySvgAspectRatio = (svgContent: string, ratioLocked: boolean): string => {
  if (ratioLocked) return svgContent;
  if (!svgContent.toLowerCase().includes('<svg')) return svgContent;

  return svgContent.replace(/<svg\b([^>]*)>/i, (_match, attrs) => {
    let nextAttrs = attrs;
    const quotedAttr = /\s+(preserveAspectRatio|width|height)\s*=\s*(["'])(?:(?!(?:\\|\2)).|\\.)*\2/gi;
    const unquotedAttr = /\s+(preserveAspectRatio|width|height)\s*=\s*[^\s>]+/gi;
    nextAttrs = nextAttrs.replace(quotedAttr, '');
    nextAttrs = nextAttrs.replace(unquotedAttr, '');
    return `<svg${nextAttrs} width="100%" height="100%" preserveAspectRatio="none">`;
  });
};