import { describe, expect, test } from "bun:test";
import { BRAND, studioSkinCss, studioSkinJs, TOKENS, tokensCss } from "./theme";

/** WCAG contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("the theme", () => {
  test("the app has one name", () => {
    expect(BRAND).toBe("ReelsEasy");
  });

  test("text can be read on every surface", () => {
    for (const surface of [TOKENS.bg, TOKENS.panel, TOKENS.raised]) {
      expect(contrast(TOKENS.ink, surface)).toBeGreaterThan(7);
      expect(contrast(TOKENS.muted, surface)).toBeGreaterThan(4.5);
    }
    expect(contrast(TOKENS.onAccent, TOKENS.accent)).toBeGreaterThan(4.5);
    expect(contrast(TOKENS.accent, TOKENS.bg)).toBeGreaterThan(4.5);
  });

  test("the tokens are written as CSS variables for a dark page", () => {
    const css = tokensCss();
    expect(css).toContain("color-scheme: dark");
    expect(css).toContain(`--bg: ${TOKENS.bg}`);
    expect(css).toContain(`--accent: ${TOKENS.accent}`);
  });
});

describe("the skin over the timeline editor", () => {
  const css = studioSkinCss();

  test("forces the editor dark, whatever theme it was left in", () => {
    expect(css).toMatch(/html\[data-theme\][^{]*\{[^}]*color-scheme: dark !important/);
  });

  test("replaces the editor's base colours with ours", () => {
    for (const name of ["--color-bg-0", "--color-surface", "--color-raised", "--color-input", "--color-text-0", "--color-text-muted",
      "--color-accent", "--color-accent-hover", "--color-accent-ink", "--color-on-accent", "--timeline-row-bg", "--timeline-gutter-bg"]) {
      expect(css).toContain(`${name}:`);
    }
    expect(css).toContain(TOKENS.bg);
    expect(css).toContain(TOKENS.accent);
  });

  test("hides the buttons that belong to another product, and nothing else", () => {
    const js = studioSkinJs();
    for (const label of ["Install the desktop app", "Share", "Export"]) expect(js).toContain(JSON.stringify(label));
    expect(js).toContain("Describe a change to the agent");
    expect(js).not.toContain('"Play"');
    expect(js).toContain("MutationObserver");
  });

  test("puts our name where the editor's maker had its logo, served from this Mac", () => {
    const js = studioSkinJs("http://127.0.0.1:4310");
    expect(js).toContain('svg[aria-label="Hyperframes"]');
    expect(js).toContain("http://127.0.0.1:4310/brand/icon.png");
    expect(js).toContain(BRAND);
  });

  test("the script is one self-running function with no outside requests", () => {
    const js = studioSkinJs();
    expect(js.trim().startsWith("(() => {")).toBe(true);
    expect(js).not.toMatch(/fetch\(|XMLHttpRequest|https:\/\//);
  });
});
