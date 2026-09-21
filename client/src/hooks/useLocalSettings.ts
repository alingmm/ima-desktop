import { useState, useEffect } from 'react';

const SETTINGS_KEY = 'ima-workstation-settings';

export interface LocalSettings {
  ollamaUrl: string;
  defaultModel: string;
  useLocalModel: boolean;
}

const defaultSettings: LocalSettings = {
  ollamaUrl: 'http://127.0.0.1:11434',
  defaultModel: 'qwen2.5:7b',
  useLocalModel: false,
};

export function useLocalSettings() {
  const [settings, setSettings] = useState<LocalSettings>(defaultSettings);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        setSettings({ ...defaultSettings, ...JSON.parse(saved) });
      }
    } catch (e) {
      console.warn('Failed to load local settings:', e);
    }
    setLoaded(true);
  }, []);

  const updateSettings = (updates: Partial<LocalSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
    } catch (e) {
      console.warn('Failed to save local settings:', e);
    }
  };

  return { settings, updateSettings, loaded };
}
