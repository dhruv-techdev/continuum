import { describe, it, expect } from 'vitest';
import { VERSION, PRODUCT_NAME } from '../src/index';

describe('@continuum/mcp', () => {
  it('should re-export VERSION from core', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should re-export PRODUCT_NAME from core', () => {
    expect(PRODUCT_NAME).toBe('Continuum');
  });
});
