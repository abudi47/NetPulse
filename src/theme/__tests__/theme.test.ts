import { withAlpha } from '../color';
import { DEFAULT_THEME_PREFERENCE, resolveColorScheme } from '../theme';

describe('resolveColorScheme', () => {
  it('is dark by default', () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe('dark');
    expect(resolveColorScheme(DEFAULT_THEME_PREFERENCE, 'light')).toBe('dark');
  });

  it('honours an explicit choice regardless of the system setting', () => {
    expect(resolveColorScheme('light', 'dark')).toBe('light');
    expect(resolveColorScheme('dark', 'light')).toBe('dark');
  });

  it('follows the system when asked to', () => {
    expect(resolveColorScheme('system', 'light')).toBe('light');
    expect(resolveColorScheme('system', 'dark')).toBe('dark');
  });

  it('falls back to dark when the system scheme is unknown', () => {
    expect(resolveColorScheme('system', null)).toBe('dark');
    expect(resolveColorScheme('system', undefined)).toBe('dark');
    expect(resolveColorScheme('system', 'unspecified')).toBe('dark');
  });
});

describe('withAlpha', () => {
  it('appends the alpha channel as two hex digits', () => {
    expect(withAlpha('#5EC8B8', 0)).toBe('#5EC8B800');
    expect(withAlpha('#5EC8B8', 1)).toBe('#5EC8B8FF');
    expect(withAlpha('#5EC8B8', 0.5)).toBe('#5EC8B880');
  });

  it('rejects colours that are not #RRGGBB', () => {
    expect(() => withAlpha('#FFF', 0.5)).toThrow('#RRGGBB');
    expect(() => withAlpha('teal', 0.5)).toThrow('#RRGGBB');
    expect(() => withAlpha('#5EC8B880', 0.5)).toThrow('#RRGGBB');
  });

  it('rejects alpha outside 0..1', () => {
    expect(() => withAlpha('#5EC8B8', -0.1)).toThrow('between 0 and 1');
    expect(() => withAlpha('#5EC8B8', 1.1)).toThrow('between 0 and 1');
    expect(() => withAlpha('#5EC8B8', Number.NaN)).toThrow('between 0 and 1');
  });
});
