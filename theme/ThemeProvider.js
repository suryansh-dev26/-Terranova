import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { light, dark } from './tokens';

// Persisted user choice: 'system' (default, follows OS), 'light', or 'dark'.
const THEME_PREF_KEY = 'themePreference';
const PREFERENCES = ['system', 'light', 'dark'];

export const themes = { light, dark };

const ThemeContext = createContext({
  theme: light,
  preference: 'system',
  setPreference: () => {},
});

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState('system');
  const [systemScheme, setSystemScheme] = useState(Appearance.getColorScheme() ?? 'light');

  useEffect(() => {
    AsyncStorage.getItem(THEME_PREF_KEY)
      .then((value) => {
        if (PREFERENCES.includes(value)) setPreferenceState(value);
      })
      .catch(() => {});
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme ?? 'light');
    });
    return () => subscription.remove();
  }, []);

  const setPreference = (value) => {
    if (!PREFERENCES.includes(value)) return;
    setPreferenceState(value);
    AsyncStorage.setItem(THEME_PREF_KEY, value).catch(() => {});
  };

  const mode = preference === 'system' ? systemScheme : preference;
  const value = useMemo(
    () => ({ theme: themes[mode] ?? light, preference, setPreference }),
    [mode, preference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
