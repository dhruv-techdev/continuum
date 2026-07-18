import { describe, it, expect } from 'vitest';
import { VERSION, PRODUCT_NAME, DESCRIPTION, MIN_NODE_VERSION } from '../src/index';

describe('@continuum/core', () => {
  it('should export VERSION as a valid semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should export PRODUCT_NAME', () => {
    expect(PRODUCT_NAME).toBe('Continuum');
  });

  it('should export DESCRIPTION', () => {
    expect(DESCRIPTION).toContain('state transfer');
  });

  it('should require Node.js >= 18', () => {
    expect(MIN_NODE_VERSION).toBe(18);
  });
});
