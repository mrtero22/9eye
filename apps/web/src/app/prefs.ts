// Per-user display settings: theme (Light / Dark) and density (Calm / Compact), decisions 0003 / 0009.
// Kept in this browser until user accounts exist.

import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
export type Density = 'calm' | 'compact';

function read<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function apply(theme: Theme, density: Density) {
  const el = document.documentElement;
  el.classList.add('ds');
  el.classList.toggle('dark', theme === 'dark');
  el.classList.toggle('compact', density === 'compact');
}

export function usePrefs() {
  const [theme, setTheme] = useState<Theme>(() => read('9eye.theme', 'light'));
  const [density, setDensity] = useState<Density>(() => read('9eye.density', 'calm'));
  useEffect(() => {
    apply(theme, density);
    write('9eye.theme', theme);
    write('9eye.density', density);
  }, [theme, density]);
  return { theme, setTheme, density, setDensity };
}

/** A small remembered view setting (e.g. "Show on blocks"). */
export function useStoredState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? ({ ...initial, ...JSON.parse(raw) } as T) : initial;
    } catch {
      return initial;
    }
  });
  return [
    value,
    (v: T) => {
      setValue(v);
      write(key, JSON.stringify(v));
    },
  ];
}
