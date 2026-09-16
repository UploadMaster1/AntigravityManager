import { describe, expect, it } from 'vitest';
import {
  getWslGeminiPaths,
  isWslUncPath,
  setWslTargetEnvironmentForTesting,
  toWslUncPath,
} from '@/shared/platform/wslPlatform';
import { CredentialStoreInjectionAdapter } from '@/modules/cloud-account/persistence/credential-store-injection-adapter';
import { resolveAntigravityAppTarget } from '@/shared/platform/antigravityAppTarget';
import {
  isSqliteBusyError,
  withLocalDatabasePath,
} from '@/shared/persistence/database/sqlite';

describe('WSL Platform integration', () => {
  it('converts Linux posix paths to UNC paths correctly', () => {
    const distroRoot = '\\\\wsl.localhost\\Ubuntu-24.04';
    const linuxPath = '/home/sarab/.config/Antigravity/User/globalStorage/state.vscdb';
    const unc = toWslUncPath(distroRoot, linuxPath);

    expect(unc).toBe(
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\sarab\\.config\\Antigravity\\User\\globalStorage\\state.vscdb',
    );
  });

  it('rejects invalid or root Linux paths', () => {
    const distroRoot = '\\\\wsl.localhost\\Ubuntu-24.04';
    expect(toWslUncPath(distroRoot, '/')).toBeNull();
    expect(toWslUncPath(distroRoot, 'relative/path')).toBeNull();
  });

  it('configures WSL target to use SQLite injection rather than system credential store', () => {
    expect(resolveAntigravityAppTarget('wsl')).toBe('wsl');
    expect(CredentialStoreInjectionAdapter.shouldInjectTokenIntoCredentialStore('wsl')).toBe(false);
  });

  it('includes standalone token and state pb path in WSL gemini paths', () => {
    setWslTargetEnvironmentForTesting({
      distro: 'Ubuntu-24.04',
      linuxHome: '/home/sarab',
      uncHome: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\sarab',
      user: 'sarab',
    });
    try {
      const paths = getWslGeminiPaths();
      expect(paths).not.toBeNull();
      expect(paths?.standaloneTokenPath).toContain('jetski-standalone-oauth-token');
      expect(paths?.antigravityStatePbPath).toContain('antigravity_state.pbtxt');
    } finally {
      setWslTargetEnvironmentForTesting(null);
    }
  });

  it('identifies WSL UNC paths accurately', () => {
    expect(isWslUncPath('\\\\wsl.localhost\\Ubuntu-24.04\\home\\user\\.config\\state.vscdb')).toBe(
      true,
    );
    expect(isWslUncPath('//wsl.localhost/Ubuntu-24.04/home/user/.config/state.vscdb')).toBe(true);
    expect(isWslUncPath('\\\\wsl$\\Ubuntu-24.04\\home\\user\\.config\\state.vscdb')).toBe(true);
    expect(isWslUncPath('//wsl$/Ubuntu-24.04/home/user/.config/state.vscdb')).toBe(true);
    expect(isWslUncPath('C:\\Users\\user\\AppData\\Roaming\\Antigravity\\state.vscdb')).toBe(false);
    expect(isWslUncPath('/home/user/.config/Antigravity/state.vscdb')).toBe(false);
    expect(isWslUncPath(null)).toBe(false);
    expect(isWslUncPath(undefined)).toBe(false);
  });

  it('detects SQLite busy and locked errors properly', () => {
    expect(isSqliteBusyError({ code: 'SQLITE_BUSY' })).toBe(true);
    expect(isSqliteBusyError({ code: 'SQLITE_LOCKED' })).toBe(true);
    expect(isSqliteBusyError(new Error('database is locked'))).toBe(true);
    expect(isSqliteBusyError(new Error('SqliteError: database is locked'))).toBe(true);
    expect(isSqliteBusyError(new Error('database table is locked'))).toBe(true);
    expect(isSqliteBusyError(new Error('SQLITE_BUSY: resource temporarily unavailable'))).toBe(true);
    expect(isSqliteBusyError(new Error('no such table: ItemTable'))).toBe(false);
    expect(isSqliteBusyError(null)).toBe(false);
  });

  it('bypasses staging for non-WSL local paths in withLocalDatabasePath', () => {
    const localPath = 'C:\\some\\local\\path\\state.vscdb';
    let executedWith: string | null = null;
    const result = withLocalDatabasePath(localPath, { readonly: false }, (target) => {
      executedWith = target;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(executedWith).toBe(localPath);
  });
});
