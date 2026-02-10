
export const generateId = () => Math.random().toString(36).substr(2, 9);

export const downloadFile = (content: string, fileName: string, contentType: string) => {
  const a = document.createElement("a");
  const file = new Blob([content], { type: contentType });
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
};

const getSVGContent = (svgString: string): string => {
  // Find the first occurrence of <svg (case insensitive)
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
    
    // Check style
    if (width === 0 && svg.style.width) width = parseFloat(svg.style.width) || 0;
    if (height === 0 && svg.style.height) height = parseFloat(svg.style.height) || 0;

    // Check viewBox
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
      // 1. Determine correct viewBox
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

      // 2. Build new attributes list
      const newAttrs: string[] = [];
      newAttrs.push(`viewBox="${viewBox}"`);
      newAttrs.push('width="100%"');
      newAttrs.push('height="100%"');
      
      const par = svg.getAttribute('preserveAspectRatio');
      newAttrs.push(`preserveAspectRatio="${par || 'none'}"`);

      // Attributes to explicitly exclude
      const blacklist = ['width', 'height', 'x', 'y', 'id', 'enable-background', 'viewbox', 'preserveaspectratio', 'style'];
      
      Array.from(svg.attributes).forEach(attr => {
        const name = attr.name.toLowerCase();
        if (!blacklist.includes(name) && !name.startsWith('on')) {
           newAttrs.push(`${attr.name}="${attr.value}"`);
        }
      });

      // Handle Style: strip existing width/height and force 100% + block display
      let style = svg.getAttribute('style') || '';
      // Remove existing width/height definitions from style string
      style = style.replace(/(?:^|;)\s*(?:width|height)\s*:[^;]+/gi, '');
      // Enforce full size and block display via inline style (highest priority)
      newAttrs.push(`style="width: 100%; height: 100%; display: block; ${style}"`);
      
      // Ensure XML namespace exists
      if (!newAttrs.some(a => a.toLowerCase().startsWith('xmlns='))) {
        newAttrs.push('xmlns="http://www.w3.org/2000/svg"');
      }

      // 3. Reconstruct SVG tag with clean attributes and original inner content
      const result = `<svg ${newAttrs.join(' ')}>${svg.innerHTML}</svg>`;
      
      return result;
    }
  } catch (e) {
    // silent fail
  }

  // Robust Fallback: Regex replacement if DOMParser failed
  let fixed = content;
  
  if (!fixed.match(/viewBox/i)) {
     fixed = `<svg width="100%" height="100%" style="width: 100%; height: 100%; display: block;" viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${content.replace(/<\/?svg[^>]*>/g, '')}</svg>`;
  } else {
    // Replace attributes in the opening tag using Regex
    fixed = fixed.replace(/<svg([^>]*)>/i, (match, attrs) => {
        let newAttrs = attrs;
        // Remove width, height, x, y, id, enable-background
        const regex = /\s+(width|height|x|y|id|enable-background)\s*=\s*(["'])(?:(?!(?:\\|\2)).|\\.)*\2/gi;
        newAttrs = newAttrs.replace(regex, '');
        const regexUnquoted = /\s+(width|height|x|y|id|enable-background)\s*=\s*[\w%\.]+/gi;
        newAttrs = newAttrs.replace(regexUnquoted, '');

        // Ensure style attribute exists and enforces size
        if (!newAttrs.includes('style=')) {
            newAttrs += ' style="width: 100%; height: 100%; display: block;"';
        } else {
            // If style exists, rudimentary check to append (less robust than DOMParser but works for simple cases)
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
