import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { config } from '../config';
import { prisma } from '../db';
import { randomToken, sha256 } from '../lib/crypto';

export const ACCESS_COOKIE = 'sv_at';
export const REFRESH_COOKIE = 'sv_rt';

export interface AccessClaims {
  sub: string;
  /** login-session family id */
  sid: string;
}

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign({ sid: claims.sid, typ: 'access' }, config.JWT_ACCESS_SECRET, {
    subject: claims.sub,
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}

export async function isFamilyActive(familyId: string, userId: string): Promise<boolean> {
  const row = await prisma.authSession.findFirst({
    where: { familyId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return !!row;
}

const refreshExpiry = () => new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86400_000);

/** Creates a new login session family and returns the raw refresh token. */
export async function createLoginSession(userId: string, userAgent?: string) {
  const raw = randomToken(32);
  const familyId = randomToken(16);
  await prisma.authSession.create({
    data: { userId, familyId, tokenHash: sha256(raw), expiresAt: refreshExpiry(), userAgent: userAgent?.slice(0, 200) },
  });
  return { refreshToken: raw, familyId };
}

export type RotateResult =
  | { ok: true; userId: string; familyId: string; refreshToken: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'reused' };

/**
 * Refresh-token rotation with reuse detection. The update is conditional on revokedAt
 * being null, so two concurrent refreshes with the same token cannot both succeed.
 */
export async function rotateRefreshToken(raw: string, userAgent?: string): Promise<RotateResult> {
  const row = await prisma.authSession.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.revokedAt) {
    // Grace window: a token rotated <10s ago (parallel tabs racing) is rejected, not treated as theft.
    if (Date.now() - row.revokedAt.getTime() > 10_000) {
      await revokeFamily(row.familyId);
      return { ok: false, reason: 'reused' };
    }
    return { ok: false, reason: 'invalid' };
  }
  if (row.expiresAt <= new Date()) return { ok: false, reason: 'expired' };

  const next = randomToken(32);
  const ok = await prisma.$transaction(async (tx) => {
    const res = await tx.authSession.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (res.count !== 1) return false;
    await tx.authSession.create({
      data: {
        userId: row.userId,
        familyId: row.familyId,
        tokenHash: sha256(next),
        expiresAt: refreshExpiry(),
        userAgent: userAgent?.slice(0, 200) ?? row.userAgent,
      },
    });
    return true;
  });
  if (!ok) return { ok: false, reason: 'invalid' };
  return { ok: true, userId: row.userId, familyId: row.familyId, refreshToken: next };
}

export async function revokeFamily(familyId: string) {
  await prisma.authSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllForUser(userId: string) {
  await prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

const baseCookie = () => ({
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: 'lax' as const,
});

export function setAuthCookies(res: Response, userId: string, familyId: string, refreshToken: string) {
  res.cookie(ACCESS_COOKIE, signAccessToken({ sub: userId, sid: familyId }), {
    ...baseCookie(),
    path: '/',
    maxAge: config.ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookie(),
    path: '/api/auth',
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86400_000,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie(), path: '/api/auth' });
}
