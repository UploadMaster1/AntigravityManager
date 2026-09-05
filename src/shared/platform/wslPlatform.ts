import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '@/shared/logging/logger';

export interface WslTargetEnvironment {
  distro: string;
  linuxHome: string;
  uncHome: string;
  user: string;
}

const WSL_DISTRO_CACHE_TTL_MS = 30_000;
let cachedDistros: { names: string[]; readAt: number } | null = null;
let cachedTargetEnv: { env: WslTargetEnvironment | null; readAt: number } | null = null;

export function isWslHostAvailable(): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  try {
    const distros = getWslDistros();
    return distros.length > 0;
  } catch {
    return false;
  }
}

export function getWslDistros(forceRefresh = false): string[] {
  if (process.platform !== 'win32') {
    return [];
  }

  const now = Date.now();
  if (!forceRefresh && cachedDistros && now - cachedDistros.readAt < WSL_DISTRO_CACHE_TTL_MS) {
    return cachedDistros.names;
  }

  let names: string[] = [];
  try {
    const raw = execFileSync('wsl.exe', ['-l', '-q'], {
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    const text = raw.includes(0) ? raw.toString('utf16le') : raw.toString('utf-8');
    names = text
      .split(/\r?\n/u)
      .map((line) => line.replaceAll('\0', '').trim())
      .filter(Boolean);
  } catch (error) {
    logger.debug('Failed to query WSL distributions', error);
    names = [];
  }

  cachedDistros = { names, readAt: now };
  return names;
}

export function getRunningWslDistros(): string[] {
  if (process.platform !== 'win32') {
    return [];
  }

  try {
    const raw = execFileSync('wsl.exe', ['-l', '-q', '--running'], {
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    const text = raw.includes(0) ? raw.toString('utf16le') : raw.toString('utf-8');
    return text
      .split(/\r?\n/u)
      .map((line) => line.replaceAll('\0', '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function getDefaultWslDistro(): string | null {
  const running = getRunningWslDistros();
  if (running.length > 0) {
    return running[0];
  }

  const distros = getWslDistros();
  return distros.length > 0 ? distros[0] : null;
}

export function toWslUncPath(distroRoot: string, linuxPath: string): string | null {
  const normalizedPath = path.posix.normalize(linuxPath.trim());
  if (!path.posix.isAbsolute(normalizedPath) || normalizedPath === '/') {
    return null;
  }

  return path.win32.join(distroRoot, normalizedPath.slice(1).replaceAll('/', '\\'));
}

export function resolveWslHomeDirectory(distro: string): string | null {
  try {
    const home = execFileSync('wsl.exe', ['-d', distro, '--', 'sh', '-lc', 'printf %s "$HOME"'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    return home || null;
  } catch (error) {
    logger.debug(`Failed to resolve home directory for WSL distro ${distro}`, error);
    return null;
  }
}

export function resolveWslTargetEnvironment(
  targetDistro?: string,
  forceRefresh = false,
): WslTargetEnvironment | null {
  if (process.platform !== 'win32') {
    return null;
  }

  const now = Date.now();
  if (!forceRefresh && !targetDistro && cachedTargetEnv && now - cachedTargetEnv.readAt < WSL_DISTRO_CACHE_TTL_MS) {
    return cachedTargetEnv.env;
  }

  const distro = targetDistro || getDefaultWslDistro();
  if (!distro) {
    return null;
  }

  const linuxHome = resolveWslHomeDirectory(distro);
  if (!linuxHome) {
    return null;
  }

  const distroRoot = `\\\\wsl.localhost\\${distro}`;
  const uncHome = toWslUncPath(distroRoot, linuxHome);
  if (!uncHome) {
    return null;
  }

  const user = path.posix.basename(linuxHome);
  const env: WslTargetEnvironment = {
    distro,
    linuxHome,
    uncHome,
    user,
  };

  if (!targetDistro) {
    cachedTargetEnv = { env, readAt: now };
  }

  return env;
}

export function setWslTargetEnvironmentForTesting(env: WslTargetEnvironment | null): void {
  cachedTargetEnv = env ? { env, readAt: Date.now() } : null;
}

export function getWslAntigravityDbPaths(distro?: string): string[] {
  const env = resolveWslTargetEnvironment(distro);
  if (!env) {
    return [];
  }

  const uncHome = env.uncHome;
  const candidates = [
    path.win32.join(uncHome, '.config', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
    path.win32.join(uncHome, '.config', 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'),
    path.win32.join(uncHome, '.config', 'Antigravity', 'User', 'state.vscdb'),
    path.win32.join(uncHome, '.config', 'Antigravity', 'state.vscdb'),
  ];

  const existing = candidates.filter((candidate) => fs.existsSync(candidate));
  return existing.length > 0 ? existing : [candidates[0]];
}

export function getWslAntigravityStoragePaths(distro?: string): string[] {
  const env = resolveWslTargetEnvironment(distro);
  if (!env) {
    return [];
  }

  const uncHome = env.uncHome;
  const candidates = [
    path.win32.join(uncHome, '.config', 'Antigravity', 'User', 'globalStorage', 'storage.json'),
    path.win32.join(uncHome, '.config', 'Antigravity IDE', 'User', 'globalStorage', 'storage.json'),
    path.win32.join(uncHome, '.config', 'Antigravity', 'User', 'storage.json'),
    path.win32.join(uncHome, '.config', 'Antigravity', 'storage.json'),
  ];

  const existing = candidates.filter((candidate) => fs.existsSync(candidate));
  return existing.length > 0 ? existing : [candidates[0]];
}

export function getWslGeminiPaths(distro?: string): {
  geminiDir: string;
  oauthPath: string;
  accountsPath: string;
  cliTokenPath: string;
  standaloneTokenPath: string;
  profilesDir: string;
  antigravityDir: string;
  antigravityStatePbPath: string;
} | null {
  const env = resolveWslTargetEnvironment(distro);
  if (!env) {
    return null;
  }

  const geminiDir = path.win32.join(env.uncHome, '.gemini');
  const antigravityDir = path.win32.join(geminiDir, 'antigravity');
  return {
    geminiDir,
    oauthPath: path.win32.join(geminiDir, 'oauth_creds.json'),
    accountsPath: path.win32.join(geminiDir, 'google_accounts.json'),
    cliTokenPath: path.win32.join(geminiDir, 'antigravity-cli', 'antigravity-oauth-token'),
    standaloneTokenPath: path.win32.join(geminiDir, 'jetski-standalone-oauth-token'),
    profilesDir: path.win32.join(geminiDir, 'auth_profiles'),
    antigravityDir,
    antigravityStatePbPath: path.win32.join(antigravityDir, 'antigravity_state.pbtxt'),
  };
}

export function getWslAntigravityExecutable(distro?: string): string | null {
  const env = resolveWslTargetEnvironment(distro);
  if (!env) {
    return null;
  }

  // Candidates in UNC and Linux format
  const uncCandidates = [
    path.win32.join(env.uncHome, 'antigravity', 'Antigravity-x64', 'antigravity'),
    path.win32.join(env.uncHome, '.local', 'share', 'antigravity', 'antigravity'),
    path.win32.join(env.uncHome, '.local', 'share', 'antigravity-ide', 'antigravity-ide'),
    path.win32.join(env.uncHome, '.local', 'bin', 'antigravity'),
    path.win32.join(env.uncHome, '.local', 'bin', 'agy'),
  ];

  for (const candidate of uncCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // System binary check in WSL
  const systemCandidates = [
    '/usr/bin/antigravity',
    '/usr/local/bin/antigravity',
    '/usr/bin/antigravity-ide',
    '/usr/local/bin/antigravity-ide',
  ];

  for (const candidate of systemCandidates) {
    const unc = toWslUncPath(`\\\\wsl.localhost\\${env.distro}`, candidate);
    if (unc && fs.existsSync(unc)) {
      return unc;
    }
  }

  return uncCandidates[0];
}

export function isWslAntigravityRunning(distro?: string): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  const env = resolveWslTargetEnvironment(distro);
  if (!env) {
    return false;
  }

  try {
    const stdout = execFileSync('wsl.exe', ['-d', env.distro, '--', 'pgrep', '-f', 'antigravity'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();

    return stdout.length > 0;
  } catch {
    return false;
  }
}

export function closeWslAntigravity(distro?: string): void {
  if (process.platform !== 'win32') {
    return;
  }

  const env = resolveWslTargetEnvironment(distro);
  if (!env) {
    return;
  }

  logger.info(`Closing WSL Antigravity in distro ${env.distro}...`);
  try {
    execFileSync('wsl.exe', ['-d', env.distro, '--', 'pkill', '-15', '-f', 'antigravity'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 5000,
    });
  } catch (error) {
    logger.debug('SIGTERM pkill on WSL Antigravity returned non-zero', error);
  }

  // Allow graceful shutdown
  const sleepBuffer = new SharedArrayBuffer(4);
  const sleepArray = new Int32Array(sleepBuffer);
  Atomics.wait(sleepArray, 0, 0, 500);

  if (isWslAntigravityRunning(distro)) {
    try {
      execFileSync('wsl.exe', ['-d', env.distro, '--', 'pkill', '-9', '-f', 'antigravity'], {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 5000,
      });
    } catch {
      // Ignore if already gone
    }
  }
}

export function startWslAntigravity(distro?: string): void {
  if (process.platform !== 'win32') {
    return;
  }

  const env = resolveWslTargetEnvironment(distro);
  if (!env) {
    throw new Error('No WSL environment available to start Antigravity');
  }

  logger.info(`Starting WSL Antigravity in distro ${env.distro}...`);

  // Preferred strategy:
  // 1. If ~/antigravity/Antigravity-x64/antigravity exists in Linux home, launch it.
  // 2. Otherwise run through login bash to respect aliases like `alias agy="..."`
  const launchScript = `
if [ -f "$HOME/antigravity/Antigravity-x64/antigravity" ]; then
  nohup "$HOME/antigravity/Antigravity-x64/antigravity" . >/dev/null 2>&1 &
elif command -v agy >/dev/null 2>&1; then
  nohup agy . >/dev/null 2>&1 &
elif command -v antigravity >/dev/null 2>&1; then
  nohup antigravity . >/dev/null 2>&1 &
elif command -v antigravity-ide >/dev/null 2>&1; then
  nohup antigravity-ide . >/dev/null 2>&1 &
fi
`;

  const child = spawn('wsl.exe', ['-d', env.distro, '--', 'bash', '-lic', launchScript], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

export function getWslActiveAccountEmail(distro?: string): string {
  const geminiPaths = getWslGeminiPaths(distro);
  if (!geminiPaths) {
    return '';
  }

  try {
    if (fs.existsSync(geminiPaths.accountsPath)) {
      const content = fs.readFileSync(geminiPaths.accountsPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (typeof parsed?.active === 'string' && parsed.active.trim()) {
        return parsed.active.trim().toLowerCase();
      }
    }
  } catch (error) {
    logger.debug('Failed to read WSL google_accounts.json', error);
  }

  return '';
}

export function getWslStandaloneRefreshToken(distro?: string): string {
  const geminiPaths = getWslGeminiPaths(distro);
  if (!geminiPaths) {
    return '';
  }

  try {
    if (fs.existsSync(geminiPaths.standaloneTokenPath)) {
      const content = fs.readFileSync(geminiPaths.standaloneTokenPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (typeof parsed?.token?.refresh_token === 'string' && parsed.token.refresh_token.trim()) {
        return parsed.token.refresh_token.trim();
      }
    }
  } catch (error) {
    logger.debug('Failed to read WSL standalone token file', error);
  }

  return '';
}


