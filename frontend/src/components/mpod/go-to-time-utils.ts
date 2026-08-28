export function formatDigitsToTime(digits: string, hasHours = false): string {
  if (!digits) return hasHours ? "0:00:00" : "0:00";

  if (hasHours || digits.length > 4) {
    const padded = digits.padStart(6, "0");
    const hours = parseInt(padded.slice(0, -4), 10);
    return `${hours}:${padded.slice(-4, -2)}:${padded.slice(-2)}`;
  }

  const padded = digits.padStart(4, "0");
  const minutes = parseInt(padded.slice(0, -2), 10);
  return `${minutes}:${padded.slice(-2)}`;
}

export function parseDigitsToSeconds(digits: string, hasHours = false): number {
  if (!digits) return 0;

  if (hasHours || digits.length > 4) {
    const padded = digits.padStart(6, "0");
    const hours = parseInt(padded.slice(0, -4), 10) || 0;
    const minutes = parseInt(padded.slice(-4, -2), 10) || 0;
    const seconds = parseInt(padded.slice(-2), 10) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }

  const padded = digits.padStart(4, "0");
  const minutes = parseInt(padded.slice(0, -2), 10) || 0;
  const seconds = parseInt(padded.slice(-2), 10) || 0;
  return minutes * 60 + seconds;
}
