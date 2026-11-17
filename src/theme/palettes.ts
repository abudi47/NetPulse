/**
 * Colour tokens for NetPulse.
 *
 * Every text and tone colour is verified against the backgrounds it is drawn
 * on for WCAG AA contrast (4.5:1) in `__tests__/palettes.test.ts`. Change a
 * value here and that test tells you whether it is still readable.
 */

/** Semantic meaning of a status colour. Components ask for a tone, not a hex. */
export type Tone = 'neutral' | 'info' | 'positive' | 'caution' | 'critical';

export interface ColorPalette {
  /** Behind all content. */
  readonly background: string;
  /** Cards. */
  readonly surface: string;
  /** Inset areas inside cards: badges, empty states, disabled controls. */
  readonly surfaceMuted: string;
  readonly border: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  /** The single brand/action colour. */
  readonly accent: string;
  /** Text drawn on top of `accent`. */
  readonly onAccent: string;
  readonly tone: Readonly<Record<Tone, string>>;
}

export const darkPalette: ColorPalette = {
  background: '#0A0E13',
  surface: '#111720',
  surfaceMuted: '#18202B',
  border: '#263140',
  textPrimary: '#EEF2F6',
  textSecondary: '#A9B4C2',
  textMuted: '#8D99A9',
  accent: '#5EC8B8',
  onAccent: '#04211D',
  tone: {
    neutral: '#8D99A9',
    info: '#7DB7F5',
    positive: '#5BC98F',
    caution: '#E6B85C',
    critical: '#F28B82',
  },
};

export const lightPalette: ColorPalette = {
  background: '#F3F5F8',
  surface: '#FFFFFF',
  surfaceMuted: '#EDF0F4',
  border: '#D5DCE5',
  textPrimary: '#0E1620',
  textSecondary: '#3F4C5C',
  textMuted: '#566373',
  accent: '#0B7366',
  onAccent: '#FFFFFF',
  tone: {
    neutral: '#566373',
    info: '#1B5FB3',
    positive: '#1F7A4D',
    caution: '#8A5A00',
    critical: '#B3261E',
  },
};
