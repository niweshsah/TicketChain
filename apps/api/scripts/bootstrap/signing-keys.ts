import {
  mkdirSync,
  existsSync,
  writeFileSync,
  chmodSync,
  chownSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

export function ensureSigningKeys(root: string) {
  const privateDirectory =
    process.env.JWT_PRIVATE_DIRECTORY || resolve(root, '.runtime/private');
  const publicDirectory =
    process.env.JWT_PUBLIC_DIRECTORY || resolve(root, '.runtime/public');
  mkdirSync(privateDirectory, { recursive: true });
  mkdirSync(publicDirectory, { recursive: true });
  const privateFile = resolve(privateDirectory, 'jwt.pem'),
    publicFile = resolve(publicDirectory, 'jwt.pub');
  if (!existsSync(privateFile)) {
    const keys = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    writeFileSync(privateFile, keys.privateKey, { mode: 0o600 });
    writeFileSync(publicFile, keys.publicKey, { mode: 0o644 });
  }
  chmodSync(privateFile, 0o600);
  if (process.getuid?.() === 0) {
    chownSync(privateFile, 1000, 1000);
    chownSync(privateDirectory, 1000, 1000);
  }
}
