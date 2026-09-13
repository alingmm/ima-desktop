import { Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../storage/database/supabase-client.js';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

// Simple auth middleware - extracts user ID from header
// In production, integrate with Supabase Auth or JWT
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const userId = req.headers['x-user-id'] as string;
  const userEmail = req.headers['x-user-email'] as string;

  const finalUserId = userId || 'anonymous';
  const finalUserEmail = userEmail || 'anonymous@local.dev';

  // Upsert user to ensure it exists in the database
  const supabase = getSupabaseClient();
  supabase
    .from('users')
    .upsert(
      { id: finalUserId, email: finalUserEmail, name: '用户' },
      { onConflict: 'email' }
    )
    .then(() => {
      req.userId = finalUserId;
      req.userEmail = finalUserEmail;
      next();
    })
    .catch((_err) => {
      // Even if upsert fails, continue with the request
      req.userId = finalUserId;
      req.userEmail = finalUserEmail;
      next();
    });
}
