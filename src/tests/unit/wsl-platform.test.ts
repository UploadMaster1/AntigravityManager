import { describe, expect, it } from 'vitest';
import {
  getWslGeminiPaths,
  setWslTargetEnvironmentForTesting,
  toWslUncPath,
} from '@/shared/platform/wslPlatform';
import { CredentialStoreInjectionAdapter } from '@/modules/cloud-account/persistence/credential-store-injection-adapter';
import { resolveAntigravityAppTarget } from '@/shared/platform/antigravityAppTarget';

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
});
