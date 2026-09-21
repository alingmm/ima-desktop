import { Router } from 'express';
import { loadConfig, saveConfig, AppConfig, sanitizeConfig } from '../config';

const router: import('express').Router = Router();

// Get current settings (API keys masked)
router.get('/', (_req, res) => {
  try {
    const config = loadConfig();
    res.json({ settings: sanitizeConfig(config) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load settings', message: error.message });
  }
});

// Update settings
router.post('/', (req, res) => {
  try {
    const currentConfig = loadConfig();
    const updates: Partial<AppConfig> = req.body || {};

    // Only allow certain fields to be updated
    const allowedFields: (keyof AppConfig)[] = [
      'openaiBaseUrl',
      'openaiApiKey',
      'chatModel',
      'embeddingModel',
      'searchApiKey',
      'searchProvider',
    ];

    const newConfig: AppConfig = { ...currentConfig };

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        (newConfig as any)[field] = updates[field];
      }
    }

    saveConfig(newConfig);
    res.json({ success: true, settings: sanitizeConfig(newConfig) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to save settings', message: error.message });
  }
});

export default router;
