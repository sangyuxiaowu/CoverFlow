import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronsUpDown, Pipette, X } from 'lucide-react';
import { RgbaColorPicker } from 'react-colorful';
import { PRESET_COLORS } from '../constants.ts';
import { Language, translations } from '../translations.ts';
import { detectColorFormat, formatColor, getColorChannels, parseColor, updateColorChannel, type ColorFormat } from '../utils/colors.ts';
import './ColorPicker.css';

interface Props {
  lang: Language;
  name: string;
  value: string;
  onChange: (value: string) => void;
}

type EyeDropperConstructor = new () => { open: (options: { signal: AbortSignal }) => Promise<{ sRGBHex: string }> };

const ColorPicker: React.FC<Props> = ({ lang, name, value, onChange }) => {
  const t = translations[lang];
  const panelId = React.useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pickAbortRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState(false);
  const [hexDraft, setHexDraft] = useState(() => formatColor(value, 'hex'));
  const [position, setPosition] = useState({ left: 12, top: 12, width: 240 });
  const color = parseColor(value);
  const format = detectColorFormat(value);
  const channels = getColorChannels(value, format);
  const EyeDropper = typeof window === 'undefined' ? undefined : (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;

  useEffect(() => setHexDraft(formatColor(value, 'hex')), [value]);

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(240, window.innerWidth - 24);
      const height = Math.min(panelRef.current?.getBoundingClientRect().height || 320, window.innerHeight - 24);
      const top = anchor.bottom + 8 + height <= window.innerHeight - 12 ? anchor.bottom + 8 : anchor.top - height - 8;
      setPosition({ width, left: Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)), top: Math.max(12, Math.min(top, window.innerHeight - height - 12)) });
    };
    reposition();
    panelRef.current?.focus({ preventScroll: true });
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    const observer = new ResizeObserver(reposition);
    if (panelRef.current) observer.observe(panelRef.current);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      pickAbortRef.current?.abort();
      setOpen(false);
      buttonRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      pickAbortRef.current?.abort();
    };
  }, [open]);

  const pickScreenColor = async () => {
    if (!EyeDropper || !color) return;
    const abort = new AbortController();
    pickAbortRef.current = abort;
    setPicking(true);
    setPickError(false);
    try {
      const result = await new EyeDropper().open({ signal: abort.signal });
      const picked = parseColor(result.sRGBHex);
      if (picked && !abort.signal.aborted) onChange(formatColor({ ...picked, a: color.a }, format));
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError' && !abort.signal.aborted) setPickError(true);
    } finally {
      if (!abort.signal.aborted) setPicking(false);
    }
  };

  const commitHex = () => {
    if (parseColor(hexDraft)) onChange(formatColor(hexDraft, 'hex'));
    else setHexDraft(formatColor(value, 'hex'));
  };

  if (!color) return null;

  return (
    <>
      <button ref={buttonRef} type="button" className="cf-color-swatch" aria-label={`${t.colorPicker} ${name}`} title={`${t.colorPicker} ${name}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => { setPickError(false); setPicking(false); setOpen((previous) => !previous); }}>
        <span style={{ backgroundColor: value }} />
      </button>
      {open && createPortal(
        <div id={panelId} ref={panelRef} role="dialog" aria-label={`${t.colorPicker} ${name}`} tabIndex={-1} className="cf-color-popover" style={position} onKeyDown={(event) => event.stopPropagation()}>
          <div className="cf-color-heading">
            <span title={name}>{name}</span>
            <span className="cf-color-space">sRGB</span>
            <button type="button" title={t.colorPickerClose} aria-label={t.colorPickerClose} onClick={() => { setOpen(false); buttonRef.current?.focus({ preventScroll: true }); }}><X size={15} /></button>
          </div>
          <div className="cf-color-controls">
            <RgbaColorPicker color={color} onChange={(next) => onChange(formatColor(next, format))} />
            <div className="cf-color-toolbar">
              <button type="button" title={EyeDropper ? t.colorPickerEyedropper : t.colorPickerEyedropperUnavailable} aria-label={t.colorPickerEyedropper} disabled={!EyeDropper || picking} onClick={pickScreenColor}><Pipette size={15} /></button>
              <div className="cf-color-preview"><span style={{ backgroundColor: value }} /></div>
            </div>
          </div>
          <div className="cf-color-values">
            <div className="cf-color-channels">
              {format === 'hex' && <label className="cf-color-hex"><input aria-label="HEX" value={hexDraft} aria-invalid={!parseColor(hexDraft)} onChange={(event) => setHexDraft(event.target.value)} onBlur={commitHex} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} spellCheck={false} /><span>HEX</span></label>}
              {channels.map((channel, index) => <label key={`${format}-${channel.label}`}><input type="number" aria-label={`${format.toUpperCase()} ${channel.label}`} min={0} max={channel.max} step={channel.step} value={Number(channel.value.toFixed(channel.step >= 1 ? 0 : channel.step >= 0.1 ? 1 : 3))} onChange={(event) => { if (event.target.value !== '') onChange(updateColorChannel(value, format, index, Number(event.target.value))); }} /><span>{channel.label}</span></label>)}
            </div>
            <div className="cf-color-format" title={`${t.colorPickerFormat}: ${format.toUpperCase()}`}>
              <ChevronsUpDown size={14} aria-hidden="true" />
              <select aria-label={t.colorPickerFormat} title={`${t.colorPickerFormat}: ${format.toUpperCase()}`} value={format} onChange={(event) => onChange(formatColor(value, event.target.value as ColorFormat))}>
                <option value="hex">HEX</option><option value="rgb">RGB</option><option value="hsl">HSL</option><option value="oklch">OKLCH</option>
              </select>
            </div>
          </div>
          <div className="cf-color-palette">
            {[...PRESET_COLORS, 'transparent'].map((preset) => <button key={preset} type="button" className="cf-color-swatch" title={preset} aria-label={`${t.colorPickerPreset} ${preset}`} onClick={() => onChange(formatColor(preset, format))}><span style={{ backgroundColor: preset }} /></button>)}
          </div>
          {pickError && <div role="status" className="cf-color-error">{t.colorPickerEyedropperFailed}</div>}
        </div>, document.body
      )}
    </>
  );
};

export default ColorPicker;