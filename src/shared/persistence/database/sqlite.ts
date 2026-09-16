import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { logger } from '@/shared/logging/logger';
import { isWslUncPath } from '@/shared/platform/wslPlatform';

export interface LocalDatabaseOptions {
  readonly?: boolean;
}

export function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { code?: string; message?: string };
  if (candidate.code === 'SQLITE_BUSY' || candidate.code === 'SQLITE_LOCKED') {
    return true;
  }
  if (typeof candidate.message === 'string') {
    const msg = candidate.message.toLowerCase();
    return (
      candidate.message.includes('SQLITE_BUSY') ||
      candidate.message.includes('SQLITE_LOCKED') ||
      msg.includes('database is locked') ||
      msg.includes('database table is locked')
    );
  }
  return false;
}

export function withLocalDatabasePath<T>(
  dbPath: string,
  options: LocalDatabaseOptions,
  fn: (localDbPath: string) => T,
): T {
  if (!isWslUncPath(dbPath)) {
    return fn(dbPath);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-wsl-db-'));
  const localDbPath = path.join(tempDir, path.basename(dbPath));

  try {
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, localDbPath);
    }

    const result = fn(localDbPath);

    if (!options.readonly && fs.existsSync(localDbPath)) {
      const walPath = `${localDbPath}-wal`;
      if (fs.existsSync(walPath)) {
        try {
          const cleanupDb = new Database(localDbPath);
          cleanupDb.pragma('wal_checkpoint(TRUNCATE)');
          cleanupDb.pragma('journal_mode = DELETE');
          cleanupDb.close();
        } catch (checkpointError) {
          logger.warn('Failed to checkpoint WAL on staged WSL database', checkpointError);
        }
      }

      const targetDir = path.dirname(dbPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.copyFileSync(localDbPath, dbPath);
    }

    return result;
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      logger.warn('Failed to clean up staged WSL database temp directory', cleanupError);
    }
  }
}

interface StatementGet {
  get: (...args: unknown[]) => unknown;
}

interface StatementAll {
  all: (...args: unknown[]) => unknown[];
}

function logSchemaIssues(context: string, issues: z.core.$ZodIssue[]): void {
  logger.warn('SQLite row failed schema validation', {
    context,
    issues,
  });
}

export function parseRow<T extends z.ZodTypeAny>(
  schema: T,
  row: unknown,
  context: string,
): z.infer<T> | null {
  if (!row) {
    return null;
  }
  const parsed = schema.safeParse(row);
  if (!parsed.success) {
    logSchemaIssues(context, parsed.error.issues);
    return null;
  }
  return parsed.data;
}

export function parseRows<T extends z.ZodTypeAny>(
  schema: T,
  rows: unknown[],
  context: string,
): z.infer<T>[] {
  const parsed: z.infer<T>[] = [];
  for (const row of rows) {
    const parsedRow = parseRow(schema, row, context);
    if (parsedRow) {
      parsed.push(parsedRow);
    }
  }
  return parsed;
}

export function parseRowFromStatement<T extends z.ZodTypeAny>(
  stmt: StatementGet,
  schema: T,
  context: string,
  params: unknown[] = [],
): z.infer<T> | null {
  const row: unknown = stmt.get(...params);
  return parseRow(schema, row, context);
}

export function parseRowsFromStatement<T extends z.ZodTypeAny>(
  stmt: StatementAll,
  schema: T,
  context: string,
  params: unknown[] = [],
): z.infer<T>[] {
  const rows: unknown[] = stmt.all(...params);
  return parseRows(schema, rows, context);
}
