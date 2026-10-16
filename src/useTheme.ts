import { useEffect, useState } from 'react';
import { readPreference, writePreference } from './useWorkspace';

type Theme = 'dark' | 'light';
type Appearance = Theme | 'system';

export function useTheme(notify: (message: string) => void) {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    const stored = readPreference('theme', 'dark');
    return stored === 'light' || stored === 'system' ? stored : 'dark';
  });
  const [systemTheme, setSystemTheme] = useState<Theme>(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const theme = appearance === 'system' ? systemTheme : appearance;
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemTheme(media.matches ? 'dark' : 'light');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101115' : '#f5f5f8');
  }, [theme]);
  function setTheme(value: string) {
    if (value !== 'light' && value !== 'dark' && value !== 'system') return;
    setAppearance(value);
    if (!writePreference('theme', value)) notify('Appearance changed for this visit. Browser storage is unavailable.');
  }
  return { appearance, theme, setTheme };
}
