import { expect, it } from 'vitest';
import { generateId } from './helpers.ts';

it('generates fixed-length short IDs', () => {
  for (let index = 0; index < 100; index++) {
    expect(generateId()).toMatch(/^[0-9a-z]{9}$/);
  }
});