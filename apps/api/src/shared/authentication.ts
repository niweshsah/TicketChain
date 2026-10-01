import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { config } from './config';
import { db, one } from './db';
import { AppError, requireValue } from './errors';
import { serviceRequest } from './service-client';
import { type Account } from './types';

export async function authenticate(header?: string): Promise<Account> {
  try {
    const claims = jwt.verify(
      header?.replace(/^Bearer /, '') || '',
      config.JWT_PUBLIC_KEY_PATH
        ? readFileSync(config.JWT_PUBLIC_KEY_PATH)
        : config.JWT_SECRET,
      {
        algorithms: config.JWT_PUBLIC_KEY_PATH ? ['RS256'] : ['HS256'],
        issuer: 'ticketchain',
        audience: 'ticketchain-web',
      },
    );
    if (typeof claims === 'string' || !claims.sub) throw new Error();
    if (!['standalone', 'identity'].includes(config.SERVICE_NAME)) {
      const user = await serviceRequest<Account>(
        config.IDENTITY_URL,
        `/internal/accounts/${claims.sub}`,
      );
      if (!user.active) throw new Error('Inactive account');
      if (config.SERVICE_NAME === 'booking')
        await db.$executeRawUnsafe(
          `
            INSERT INTO tc_account(id,name,email,role,active,wallet) VALUES($1::uuid,$2,$3,$4,$5,$6) ON CONFLICT(id)
            DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,role=EXCLUDED.role,active=EXCLUDED.active,wallet=EXCLUDED.wallet
          `,
          user.id,
          user.name,
          user.email,
          user.role,
          user.active,
          user.wallet,
        );
      return { ...user, password_hash: null };
    }
    return requireValue(
      await one<Account>(
        db,
        'SELECT * FROM tc_account WHERE id=$1::uuid AND active',
        claims.sub,
      ),
    );
  } catch (error) {
    if (error instanceof AppError && error.status === 503) throw error;
    throw new AppError(401, 'UNAUTHORIZED', 'Please sign in');
  }
}
