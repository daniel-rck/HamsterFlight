import { describe, expect, it } from 'vitest';
import { versionLabel } from '@/app/build.ts';

describe('versionLabel', () => {
  it('reads as hash then date', () => {
    expect(versionLabel({ commit: '2c1e3d4c', date: '2026-09-01' })).toBe('2c1e3d4c · 2026-09-01');
  });

  it('keeps the dirty marker, because that hash does not describe the build', () => {
    expect(versionLabel({ commit: '2c1e3d4c+', date: '2026-09-01' })).toContain('+');
  });

  it('says dev rather than inventing a hash when there was none to read', () => {
    expect(versionLabel({ commit: 'unknown', date: '2026-09-01' })).toBe('dev · 2026-09-01');
  });
});
