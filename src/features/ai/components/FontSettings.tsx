import FontSettingsView from 'sang-ai-kit/font-settings';
import type { LocalFontSelection } from '../services/fonts.ts';

interface Props {
  fonts: LocalFontSelection[];
  onChange: (fonts: LocalFontSelection[]) => void;
  english: boolean;
  showLocalFonts?: boolean;
  showOnlineFonts?: boolean;
}

export default function FontSettings(props: Props) {
  return <FontSettingsView {...props} catalogId="coverflow-google-fonts-catalog" />;
}