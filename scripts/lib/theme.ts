/**
 * The look of ReelsEasy: one set of colours for our own screens, and a skin
 * that lays the same colours over the timeline editor (HyperFrames Studio).
 *
 * Studio keeps its colours in CSS variables, each a pair of light and dark
 * values. The skin forces the dark half and replaces the base variables; the
 * rest of Studio's variables are derived from those, so they follow.
 */

export const BRAND = "ReelsEasy";

export const TOKENS = {
  bg: "#0a0e17",
  panel: "#101624",
  raised: "#172033",
  input: "#0d1320",
  line: "rgba(148, 163, 184, 0.14)",
  lineStrong: "rgba(148, 163, 184, 0.26)",
  ink: "#e8ecf4",
  muted: "#94a0b8",
  off: "#6f7b93",
  accent: "#4f8cff",
  accentHover: "#6ea1ff",
  onAccent: "#051022",
  danger: "#ff8a80",
  // The logo's own colours: used on the mark, never for controls.
  brandFrom: "#ff7a59",
  brandTo: "#f0339b",
} as const;

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** `:root` with every token as a CSS variable. */
export function tokensCss(): string {
  const vars = Object.entries(TOKENS)
    .map(([name, value]) => `--${kebab(name)}: ${value};`)
    .join(" ");
  return `:root { color-scheme: dark; ${vars} }`;
}

/** Our colours on Studio's base variables. */
const STUDIO_VARS: Record<string, string> = {
  "--color-bg-0": TOKENS.bg,
  "--color-surface": TOKENS.panel,
  "--color-raised": TOKENS.raised,
  "--color-input": TOKENS.input,
  "--color-text-0": TOKENS.ink,
  "--color-text-2": "#c9d1e0",
  "--color-text-muted": TOKENS.muted,
  "--color-text-off": TOKENS.off,
  "--color-accent": TOKENS.accent,
  "--color-accent-hover": TOKENS.accentHover,
  "--color-accent-ink": "#8fb6ff",
  "--color-on-accent": TOKENS.onAccent,
  "--timeline-row-bg": "#0e1421",
  "--timeline-gutter-bg": "#0c111c",
};

export function studioSkinCss(): string {
  const vars = Object.entries(STUDIO_VARS)
    .map(([name, value]) => `${name}: ${value} !important;`)
    .join(" ");
  return `html[data-theme], html { color-scheme: dark !important; ${vars} }
html, body { background: ${TOKENS.bg} !important; }
[data-reelseasy-hidden] { display: none !important; }
::selection { background: color-mix(in oklab, ${TOKENS.accent} 45%, transparent); }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-thumb { background: ${TOKENS.lineStrong}; border-radius: 10px; border: 2px solid transparent; background-clip: content-box; }
*::-webkit-scrollbar-track, *::-webkit-scrollbar-corner { background: transparent; }
`;
}

/**
 * Buttons in Studio that belong to HeyGen's own product or would mislead:
 * its desktop app, its sharing service, and its Export, which renders the
 * empty working room after the last piece (our Export stops at the reel's end).
 */
const HIDDEN_BUTTONS = ["Install the desktop app", "Share", "Export"];

/** HeyGen's "describe a change to the agent" card: its agent, not ours. */
const HIDDEN_TEXT = "Describe a change to the agent";

/**
 * Runs inside the Studio page: hides those controls, puts our mark where
 * Studio's maker had its logo, and keeps both that way as the page redraws.
 * `home` is our own local server, which serves the mark.
 */
export function studioSkinJs(home = ""): string {
  return `(() => {
  const labels = new Set(${JSON.stringify(HIDDEN_BUTTONS)});
  const gone = "data-reelseasy-hidden";
  const tidy = () => {
    for (const el of document.querySelectorAll("button, a")) {
      const text = (el.textContent || "").trim() || el.getAttribute("aria-label") || "";
      if (labels.has(text) && !el.hasAttribute(gone)) el.setAttribute(gone, "");
    }
    for (const el of document.querySelectorAll("button, [role=button]")) {
      const label = el.getAttribute("aria-label") || el.title || "";
      const theirs = /^Switch to (dark|light) theme$/.test(label) || (el.textContent || "").trim().startsWith(${JSON.stringify(HIDDEN_TEXT)});
      if (theirs && !el.hasAttribute(gone)) el.setAttribute(gone, "");
    }
    // The agent card is not a button: find it by its words and hide the row that holds them.
    const found = document.evaluate('//*[text()[normalize-space()=' + JSON.stringify(${JSON.stringify(HIDDEN_TEXT)}) + ']]', document.body, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    const card = found && (found.closest("button, [role=button], a, li") || found.parentElement);
    if (card && !card.hasAttribute(gone)) card.setAttribute(gone, "");
    const logo = document.querySelector('svg[aria-label="Hyperframes"]');
    if (logo && !logo.hasAttribute(gone)) {
      logo.setAttribute(gone, "");
      const ours = document.createElement("span");
      ours.style.cssText = "display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:15px;letter-spacing:-0.01em;color:${TOKENS.ink}";
      const mark = document.createElement("img");
      mark.src = ${JSON.stringify(home + "/brand/icon.png")};
      mark.alt = "";
      mark.width = 24;
      mark.height = 24;
      mark.onerror = () => mark.remove();
      ours.append(mark, ${JSON.stringify(BRAND)});
      logo.before(ours);
    }
  };
  tidy();
  new MutationObserver(tidy).observe(document.documentElement, { childList: true, subtree: true });
})();
`;
}
