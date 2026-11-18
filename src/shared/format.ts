/*
 * Small formatters for values shown on screen. They take plain numbers and
 * return plain strings, so they behave the same on a phone and under test.
 */

const pad = (value: number) => String(value).padStart(2, '0');

/** Local wall-clock time as HH:MM:SS (24-hour). */
export function formatClockTime(epochMs: number): string {
  const date = new Date(epochMs);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

/** A length of time in the two largest units that matter: "42 s", "3 min 5 s", "2 h 10 min". */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
  }
  return `${seconds} s`;
}

/** A byte count in B, KB or MB (1 KB = 1024 B), with one decimal above 1 KB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
