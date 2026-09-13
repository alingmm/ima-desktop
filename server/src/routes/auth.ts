import { Router } from 'express';
import { getSupabaseClient } from '../storage/database/supabase-client.js';
import { v4 as uuidv4 } from 'uuid';

const router: import("express").Router = Router();

// Simple auth endpoints for demo
// In production, use Supabase Auth, Auth0, etc.

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const supabase = getSupabaseClient();

    // Demo: find or create user (password not verified for demo purposes)
    let { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      // Create demo user
      const userId = uuidv4();
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          id: userId,
          email,
          name: email.split('@')[0],
        })
        .select()
        .single();

      if (createError) {
        res.status(500).json({ error: 'Login failed' });
        return;
      }
      user = newUser;
    }

    // Generate simple token (demo only)
    const token = Buffer.from(`${user.id}:${Date.now()}`).toString('base64');

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const supabase = getSupabaseClient();
    const userId = uuidv4();

    const { data: user, error } = await supabase
      .from('users')
      .insert({
        id: userId,
        email,
        name: name || email.split('@')[0],
      })
      .select()
      .single();

    if (error) {
      res.status(400).json({ error: 'Registration failed, email may already exist' });
      return;
    }

    const token = Buffer.from(`${user.id}:${Date.now()}`).toString('base64');

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
      },
      token,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/logout', (_req, res) => {
  // In a real app, invalidate the token
  res.json({ success: true });
});

export default router;
