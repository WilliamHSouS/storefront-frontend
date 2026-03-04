import { describe, it, expect } from 'vitest';
import { sanitizeHtml, escapeHtml } from './sanitize';

describe('sanitizeHtml', () => {
  // --- Dangerous tags ---
  it('strips <script> tags with content', () => {
    expect(sanitizeHtml('<p>Hi</p><script>alert(1)</script>')).toBe('<p>Hi</p>');
  });

  it('strips <script> tags with attributes', () => {
    expect(sanitizeHtml('<script src="evil.js"></script>')).toBe('');
  });

  it('strips <iframe> tags', () => {
    expect(sanitizeHtml('<iframe src="evil.html"></iframe>')).toBe('');
  });

  it('strips <object> tags', () => {
    expect(sanitizeHtml('<object data="evil.swf"></object>')).toBe('');
  });

  it('strips <embed> tags', () => {
    expect(sanitizeHtml('<embed src="evil.swf">')).toBe('');
  });

  it('strips <form> tags', () => {
    expect(sanitizeHtml('<form action="evil"><input></form>')).toBe('');
  });

  it('strips <base> tags', () => {
    expect(sanitizeHtml('<base href="https://evil.com">')).toBe('');
  });

  it('strips case-insensitive tags', () => {
    expect(sanitizeHtml('<SCRIPT>alert(1)</SCRIPT>')).toBe('');
    expect(sanitizeHtml('<ScRiPt>alert(1)</sCrIpT>')).toBe('');
  });

  // --- Event handlers ---
  it('strips double-quoted event handlers', () => {
    const result = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(result).not.toContain('onerror');
    expect(result).toContain('src="x"');
  });

  it('strips single-quoted event handlers', () => {
    const result = sanitizeHtml("<div onclick='alert(1)'>Hi</div>");
    expect(result).not.toContain('onclick');
  });

  it('strips unquoted event handlers', () => {
    const result = sanitizeHtml('<a onmouseover=alert(1)>click</a>');
    expect(result).not.toContain('onmouseover');
  });

  it('strips HTML entity-encoded quote event handlers', () => {
    const input = '<img src="x" onerror=&quot;alert(1)&quot;>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('onerror');
  });

  // --- javascript: URIs ---
  it('blocks javascript: URIs in href', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
  });

  it('blocks case-insensitive javascript: URIs', () => {
    const result = sanitizeHtml('<a href="JAVASCRIPT:alert(1)">click</a>');
    expect(result).not.toContain('JAVASCRIPT:');
    expect(result).not.toContain('javascript:');
  });

  // --- data: URIs ---
  it('blocks data:text/html URIs', () => {
    const input = '<a href="data:text/html,<script>alert(1)</script>">click</a>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('data:text/html');
  });

  // --- Safe HTML preserved ---
  it('preserves safe HTML tags', () => {
    const safe = '<h1>Title</h1><p>Paragraph with <strong>bold</strong> and <em>italic</em></p>';
    expect(sanitizeHtml(safe)).toBe(safe);
  });

  it('preserves <img> tags without event handlers', () => {
    const img = '<img src="photo.jpg" alt="A photo" width="300">';
    expect(sanitizeHtml(img)).toBe(img);
  });

  it('preserves links with normal hrefs', () => {
    const link = '<a href="https://example.com">Visit</a>';
    expect(sanitizeHtml(link)).toBe(link);
  });

  it('preserves data: URIs that are not text/html', () => {
    const img = '<img src="data:image/png;base64,abc123">';
    expect(sanitizeHtml(img)).toBe(img);
  });

  // --- Edge cases ---
  it('handles empty string', () => {
    expect(sanitizeHtml('')).toBe('');
  });

  it('handles plain text', () => {
    expect(sanitizeHtml('Just some text')).toBe('Just some text');
  });

  it('handles multiple dangerous elements', () => {
    const input = '<p>Safe</p><script>bad1</script><p>Also safe</p><iframe src="evil"></iframe>';
    expect(sanitizeHtml(input)).toBe('<p>Safe</p><p>Also safe</p>');
  });

  // --- New DOMPurify-specific tests ---
  it('strips SVG namespace with event handlers', () => {
    const input = '<svg><animate onbegin="alert(1)"></svg>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('onbegin');
    expect(result).not.toContain('alert');
  });

  it('strips nested script tag reconstruction', () => {
    const input = '<scr<script>ipt>alert(1)</script>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('<script');
    expect(result).not.toMatch(/<scr.*ipt>/i);
  });

  it('strips <style> tags', () => {
    const input = '<p>Hi</p><style>body { display: none; }</style>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('<style');
    expect(result).not.toContain('display');
  });

  it('strips <meta> tags', () => {
    const input = '<meta http-equiv="refresh" content="0;url=evil"><p>Hi</p>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('<meta');
    expect(result).toContain('<p>Hi</p>');
  });
});

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#x27;s');
  });

  it('escapes all special characters together', () => {
    expect(escapeHtml('<a href="x&y">it\'s</a>')).toBe(
      '&lt;a href=&quot;x&amp;y&quot;&gt;it&#x27;s&lt;/a&gt;',
    );
  });

  it('returns plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});
