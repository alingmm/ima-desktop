import { Request, Response, NextFunction } from 'express';
import { selectOne, insertOne } from '../storage/json-storage';
import type { UserRecord } from '../storage/json-storage';
import { v4 as uuidv4 } from 'uuid';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

// 简化的 auth 中间件：从 header 提取用户标识，本地存储 upsert
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const userId = req.headers['x-user-id'] as string;
  const userEmail = req.headers['x-user-email'] as string;

  const finalUserId = userId || 'local-user';
  const finalUserEmail = userEmail || 'user@local.dev';

  // upsert user
  try {
    const existing = selectOne('users', { id: finalUserId });
    if (!existing) {
      insertOne('users', {
        id: finalUserId,
        email: finalUserEmail,
        name: '用户',
        avatar_url: null,
        created_at: new Date().toISOString(),
      } as UserRecord);
    }
  } catch {
    // ignore
  }

  req.userId = finalUserId;
  req.userEmail = finalUserEmail;
  next();
}
