import { formatBytes, formatClockTime, formatDuration } from '../format';

describe('formatClockTime', () => {
  it('shows local time as zero-padded HH:MM:SS', () => {
    const morning = new Date(2026, 0, 5, 9, 4, 7).getTime();
    const evening = new Date(2026, 0, 5, 23, 59, 59).getTime();

    expect(formatClockTime(morning)).toBe('09:04:07');
    expect(formatClockTime(evening)).toBe('23:59:59');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0 s'],
    [400, '0 s'],
    [42_000, '42 s'],
    [59_600, '1 min'],
    [60_000, '1 min'],
    [185_000, '3 min 5 s'],
    [3_600_000, '1 h'],
    [7_800_000, '2 h 10 min'],
    [-5_000, '0 s'],
  ])('formats %d ms as "%s"', (durationMs, text) => {
    expect(formatDuration(durationMs)).toBe(text);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [980, '980 B'],
    [1_024, '1.0 KB'],
    [12_700, '12.4 KB'],
    [1_048_576, '1.0 MB'],
    [5_242_880, '5.0 MB'],
  ])('formats %d bytes as "%s"', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});
