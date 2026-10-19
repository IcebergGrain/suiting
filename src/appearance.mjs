export function normalizeAppearance(value) {
  return ['system', 'light', 'dark'].includes(value) ? value : 'system';
}

export function resolvedAppearance(preference, system = 'light') {
  const value = normalizeAppearance(preference);
  return value === 'system' ? system === 'dark' ? 'dark' : 'light' : value;
}
