import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface AccessConfig { issuer: string; audience: string; allowedEmails: string[]; }
export interface AccessPrincipal { email: string; subject: string; }

export function accessVerifier(config: AccessConfig, keys?: JWTVerifyGetKey) {
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(config.issuer) || !config.audience || !config.allowedEmails.length) return null;
  const jwks = keys ?? createRemoteJWKSet(new URL(`${config.issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 600_000 });
  const emails = new Set(config.allowedEmails.map(email => email.trim().toLowerCase()).filter(Boolean));
  if (!emails.size) return null;
  return async (token: string): Promise<AccessPrincipal> => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer, audience: config.audience, algorithms: ['RS256'],
      requiredClaims: ['exp', 'sub', 'email', 'type'], clockTolerance: 5,
    });
    if (payload.type !== 'app' || typeof payload.email !== 'string' || !emails.has(payload.email.toLowerCase()) || typeof payload.sub !== 'string') throw new Error('access_denied');
    return { email: payload.email, subject: payload.sub };
  };
}
