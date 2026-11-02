import { describe, expect, it } from 'vitest';
import { inviteLink, parseInvite, scriptEndpoint } from './connection';

const book = { fileId: 'FILE', name: '貓辣市集', scriptUrl: 'https://script.google.com/macros/s/ABC/exec' };

describe('invites', () => {
  it('round-trips the book and key through the link, as a guest connection', () => {
    const link = inviteLink(book, 'KEY-1', 'https://www.glenn.tw/till-book/');
    expect(link.startsWith('https://www.glenn.tw/till-book/#join=')).toBe(true);
    expect(parseInvite(new URL(link).hash)).toEqual({ ...book, key: 'KEY-1', role: 'guest' });
  });

  it('ignores other hashes and links that do not point at Apps Script', () => {
    expect(parseInvite('#tab=1')).toBeNull();
    expect(parseInvite('#join=not-base64!')).toBeNull();
    const evil = inviteLink({ ...book, scriptUrl: 'https://evil.example/exec' }, 'K', 'https://www.glenn.tw/till-book/');
    expect(parseInvite(new URL(evil).hash)).toBeNull();
  });

  it('adds the key to every script call', () => {
    expect(scriptEndpoint(book)).toBe(book.scriptUrl);
    expect(scriptEndpoint({ ...book, key: 'a/b' })).toBe('https://script.google.com/macros/s/ABC/exec?key=a%2Fb');
  });
});
