import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { findOne, insertOne, UserRecord } from '../storage/json-storage';

const router: import('express').Router = Router();

// Login — simple local authentication (no password hash for local app)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = findOne('users', { email } as Partial<UserRecord>);

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Simple password comparison (local app, acceptable)
    if (user.password !== password) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const { password: _pw, ...userWithoutPassword } = user;
    res.json({
      user: userWithoutPassword,
      token: `local-token-${user.id}`,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Login failed', message: error.message });
  }
});

// Register — simple local user creation
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    // Check if user exists
    const existing = findOne('users', { email } as Partial<UserRecord>);
    if (existing) {
      res.status(409).json({ error: 'User already exists' });
      return;
    }

    const now = new Date().toISOString();
    const user = insertOne('users', {
      id: uuidv4(),
      email,
      password,
      name: name || email.split('@')[0],
      avatar_url: '',
      created_at: now,
      updated_at: now,
    } as UserRecord);

    const { password: _pw, ...userWithoutPassword } = user;
    res.status(201).json({
      user: userWithoutPassword,
      token: `local-token-${user.id}`,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Registration failed', message: error.message });
  }
});

export default router;
