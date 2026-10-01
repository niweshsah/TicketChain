import { PrismaClient, Prisma } from '@prisma/client';

export const db = new PrismaClient();

export type Tx = Prisma.TransactionClient;

export async function rows<T>(
  tx: Tx,
  sql: string,
  ...args: unknown[]
): Promise<T[]> {
  return tx.$queryRawUnsafe<T[]>(sql, ...args);
}

export async function one<T>(
  tx: Tx,
  sql: string,
  ...args: unknown[]
): Promise<T | undefined> {
  return (await rows<T>(tx, sql, ...args))[0];
}

export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(fn, { timeout: 15000, maxWait: 15000 });
}
