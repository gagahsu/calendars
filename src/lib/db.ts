import { PrismaClient } from '@prisma/client';

// Next.js dev mode re-evaluates modules on every hot reload, which would open a
// new pool each time. Cache the client on globalThis to keep a single pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** Prisma returns Decimal objects; the UI and JSON only ever want numbers. */
export function toNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}
