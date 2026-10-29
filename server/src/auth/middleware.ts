import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { forbidden, unauthorized } from '../lib/errors';
import { ACCESS_COOKIE, isFamilyActive, verifyAccessToken } from './tokens';

export interface AuthUser {
  id: string;
  sid: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function readAccessToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[ACCESS_COOKIE];
}

/** Verifies the JWT and that its login session has not been revoked (logout takes effect immediately). */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readAccessToken(req);
  if (!token) return next(unauthorized());
  const claims = verifyAccessToken(token);
  if (!claims) return next(unauthorized('Oturum süresi doldu.', 'TOKEN_EXPIRED'));
  if (!(await isFamilyActive(claims.sid, claims.sub))) return next(unauthorized('Oturum sonlandırılmış.', 'SESSION_REVOKED'));
  req.user = { id: claims.sub, sid: claims.sid };
  next();
}

export const uid = (req: Request) => {
  if (!req.user) throw unauthorized();
  return req.user.id;
};

/**
 * CSRF defence for cookie auth: state-changing requests must carry a custom header
 * (cannot be set cross-site without a CORS preflight, which only our origin passes)
 * and, when the browser sends one, an allowed Origin.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'studyverse') return next(forbidden('CSRF doğrulaması başarısız.', 'CSRF'));
  const origin = req.headers.origin;
  if (origin && !config.clientOrigins.includes(origin)) return next(forbidden('İzin verilmeyen kaynak.', 'CSRF'));
  next();
}
