export function isImageURL(iconURL?: string | null): iconURL is string {
  if (!iconURL) {
    return false;
  }

  return /^https?:\/\//i.test(iconURL) || (iconURL.startsWith('/') && !iconURL.startsWith('//'));
}

export function parseThemeIconURL(iconURL: string): { light: string; dark: string } | null {
  if (!iconURL.startsWith('{')) {
    return null;
  }
  try {
    const parsed = JSON.parse(iconURL);
    if (typeof parsed.light === 'string' && typeof parsed.dark === 'string') {
      return parsed as { light: string; dark: string };
    }
  } catch {
    // not valid JSON
  }
  return null;
}
