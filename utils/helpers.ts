// 模块：通用工具（导出、SVG 处理）
export const generateId = () => Math.random().toString(36).substr(2, 9);

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

export const getSVGDimensions = (svgString: string): { width: number; height: number } => {
  try {
    const parser = new DOMParser();
    const content = getSVGContent(svgString);
      
    const doc = parser.parseFromString(content, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return { width: 100, height: 100 };

    let width = parseFloat(svg.getAttribute('width') || '0');
    let height = parseFloat(svg.getAttribute('height') || '0');
    
    // 检查 style 中的尺寸
    if (width === 0 && svg.style.width) width = parseFloat(svg.style.width) || 0;
    if (height === 0 && svg.style.height) height = parseFloat(svg.style.height) || 0;

    // 检查 viewBox
    const viewBox = svg.getAttribute('viewBox');
    if (viewBox && (width === 0 || height === 0)) {
      const parts = viewBox.split(/[\s,]+/).filter(v => v !== '').map(parseFloat);
      if (parts.length === 4) {
        if (width === 0) width = parts[2];
        if (height === 0) height = parts[3];
      }
    }
    
    return { width: width || 100, height: height || 100 };
  } catch (e) {
    return { width: 100, height: 100 };
  }
};

export const normalizeSVG = (svgContent: string): string => {
  const content = getSVGContent(svgContent);

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    const parserError = doc.querySelector('parsererror');

    if (svg && !parserError) {
      // 1. 计算合理的 viewBox
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

      // 2. 构建新的属性列表
      const newAttrs: string[] = [];
      newAttrs.push(`viewBox="${viewBox}"`);
      newAttrs.push('width="100%"');
      newAttrs.push('height="100%"');
      
      const par = svg.getAttribute('preserveAspectRatio');
      newAttrs.push(`preserveAspectRatio="${par || 'none'}"`);

      // 显式排除的属性
      const blacklist = ['width', 'height', 'x', 'y', 'id', 'enable-background', 'viewbox', 'preserveaspectratio', 'style'];
      
      Array.from(svg.attributes).forEach(attr => {
        const name = attr.name.toLowerCase();
        if (!blacklist.includes(name) && !name.startsWith('on')) {
           newAttrs.push(`${attr.name}="${attr.value}"`);
        }
      });

      // 处理 style：移除现有宽高并强制 100% 与 block
      let style = svg.getAttribute('style') || '';
      // 移除 style 中的 width/height
      style = style.replace(/(?:^|;)\s*(?:width|height)\s*:[^;]+/gi, '');
      // 通过内联 style 强制全尺寸与 block（最高优先级）
      newAttrs.push(`style="width: 100%; height: 100%; display: block; ${style}"`);
      
      // 确保存在 XML 命名空间
      if (!newAttrs.some(a => a.toLowerCase().startsWith('xmlns='))) {
        newAttrs.push('xmlns="http://www.w3.org/2000/svg"');
      }

      // 3. 用净化后的属性重建 SVG 标签
      const result = `<svg ${newAttrs.join(' ')}>${svg.innerHTML}</svg>`;
      
      return result;
    }
  } catch (e) {
    // 静默失败
  }

  // 兜底：DOMParser 失败时使用正则替换
  let fixed = content;
  
  if (!fixed.match(/viewBox/i)) {
     fixed = `<svg width="100%" height="100%" style="width: 100%; height: 100%; display: block;" viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${content.replace(/<\/?svg[^>]*>/g, '')}</svg>`;
  } else {
    // 使用正则替换开标签属性
    fixed = fixed.replace(/<svg([^>]*)>/i, (match, attrs) => {
        let newAttrs = attrs;
        // 移除 width、height、x、y、id、enable-background
        const regex = /\s+(width|height|x|y|id|enable-background)\s*=\s*(["'])(?:(?!(?:\\|\2)).|\\.)*\2/gi;
        newAttrs = newAttrs.replace(regex, '');
        const regexUnquoted = /\s+(width|height|x|y|id|enable-background)\s*=\s*[\w%\.]+/gi;
        newAttrs = newAttrs.replace(regexUnquoted, '');

        // 确保 style 存在并强制尺寸
        if (!newAttrs.includes('style=')) {
            newAttrs += ' style="width: 100%; height: 100%; display: block;"';
        } else {
            // 若已存在 style，则追加（不如 DOMParser 严谨，但适用于简单情况）
            newAttrs = newAttrs.replace(/style=(["'])/i, 'style=$1width: 100%; height: 100%; display: block; ');
        }

        return `<svg${newAttrs} width="100%" height="100%">`;
    });
  }

  return fixed;
};

export const parseSVG = (svgString: string): { width: number; height: number; paths: string[] } => {
  const dims = getSVGDimensions(svgString);
  const parser = new DOMParser();
  const content = getSVGContent(svgString);
  const doc = parser.parseFromString(content, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  const paths = svg ? Array.from(svg.children).map(child => child.outerHTML) : [svgString];
  return { ...dims, paths };
};
