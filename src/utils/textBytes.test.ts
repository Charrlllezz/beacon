import { describe, test, expect } from 'vitest';
import { utf8Length, bytesLeft, MAX_MESSAGE_BYTES } from './textBytes';

describe('textBytes', () => {
  test('counts bytes, not characters', () => {
    expect(utf8Length('hi')).toBe(2);
    expect(utf8Length('🎉')).toBe(4);
    expect(utf8Length('é')).toBe(2);
  });

  test('50 emoji fill the message', () => {
    expect(utf8Length('🎉'.repeat(50))).toBe(MAX_MESSAGE_BYTES);
    expect(bytesLeft('🎉'.repeat(50))).toBe(0);
  });

  test('no counter while there is room', () => {
    expect(bytesLeft('meet at the left speaker stack')).toBeNull();
    expect(bytesLeft('x'.repeat(170))).toBe(30);
  });
});
