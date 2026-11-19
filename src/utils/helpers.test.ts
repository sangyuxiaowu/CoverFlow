import { expect, it } from 'vitest';
import { formatCanvasRatio, generateId, isNewerProjectVersion } from './helpers.ts';

it.each([
  [1200, 630, '40:21'],
  [900, 383, '2.35:1'],
  [1800, 766, '2.35:1'],
  [2350, 1000, '2.35:1'],
  [10.5, 7, '3:2'],
  [1000, 426, '500:213'],
])('formats %s by %s as %s', (width, height, expected) => {
  expect(formatCanvasRatio(width, height)).toBe(expected);
});

it('generates fixed-length short IDs', () => {
  for (let index = 0; index < 100; index++) {
    expect(generateId()).toMatch(/^[0-9a-z]{9}$/);
  }
});

it.each([
  ['9.0.0', '8.0.0', true],
  ['8.1.0', '8.0.0', true],
  ['8.0.1', '8.0.0', true],
  ['8.10.0', '8.9.0', true],
  ['8.0.0', '8.0.0', false],
  ['7.9.9', '8.0.0', false],
  ['8.0.0+build.2', '8.0.0+build.1', false],
  ['8.0.0-beta.1', '8.0.0', false],
  ['8.0.0', '8.0.0-beta.1', true],
  ['8.0.0-beta.10', '8.0.0-beta.9', true],
  ['8.0.0-beta.1', '8.0.0-beta', true],
  ['8.0.0-beta', '8.0.0-alpha', true],
  ['8.0.0-beta', '8.0.0-beta', false],
  [undefined, '8.0.0', false],
  [null, '8.0.0', false],
  [9, '8.0.0', false],
  ['invalid', '8.0.0', false],
])('compares project version %s against %s', (projectVersion, currentVersion, expected) => {
  expect(isNewerProjectVersion(projectVersion, currentVersion)).toBe(expected);
});