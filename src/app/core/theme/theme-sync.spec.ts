import { readFileSync } from 'node:fs';
import { THEME_COLORS } from './theme.service';

/**
 * The page background exists in three places that must agree, or the status bar and the first paint
 * flash a different colour from the app: the `--color-bg` token of each theme in src/styles.css, the
 * inline script of src/index.html (applied before Angular starts) and `THEME_COLORS` (ThemeService).
 * The files are read as plain text from the workspace root, where `ng test` runs.
 */
const css = readFileSync('src/styles.css', 'utf8');
const html = readFileSync('src/index.html', 'utf8');

/** The body of the first rule that starts with `opening`. */
function ruleBody(source: string, opening: string): string {
  const start = source.indexOf(opening);
  expect(start, `${opening} not found`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
}

function colorBg(body: string): string {
  const match = /--color-bg:\s*(#[0-9a-fA-F]{6})\s*;/.exec(body);
  expect(match, '--color-bg not found').not.toBeNull();
  return (match as RegExpExecArray)[1].toLowerCase();
}

describe('the page background colour, in three places', () => {
  it('src/styles.css: --color-bg of each theme equals THEME_COLORS', () => {
    expect(colorBg(ruleBody(css, '@theme static {'))).toBe(THEME_COLORS.light);
    expect(colorBg(ruleBody(css, "[data-theme='dark'] {"))).toBe(THEME_COLORS.dark);
  });

  it('src/index.html: the inline script and the initial meta use the same two colours', () => {
    const script = /dark \? '(#[0-9a-fA-F]{6})' : '(#[0-9a-fA-F]{6})'/.exec(html);
    expect(script, 'the theme-color line of the inline script').not.toBeNull();
    expect((script as RegExpExecArray)[1].toLowerCase()).toBe(THEME_COLORS.dark);
    expect((script as RegExpExecArray)[2].toLowerCase()).toBe(THEME_COLORS.light);

    const meta = /<meta name="theme-color" content="(#[0-9a-fA-F]{6})"/.exec(html);
    expect(meta, 'the initial theme-color meta').not.toBeNull();
    expect((meta as RegExpExecArray)[1].toLowerCase()).toBe(THEME_COLORS.light);
  });

  it('the inline script stores the theme under the key ThemeService uses', () => {
    // Same persisted value for both, or the first paint ignores the user's choice.
    expect(html).toContain("localStorage.getItem('elease.theme')");
  });
});
