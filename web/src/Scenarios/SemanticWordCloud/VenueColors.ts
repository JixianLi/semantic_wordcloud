// Diverging color for the combined scope: which venue a term belongs to.
//     scShare(t) = score_SC(t) / (score_VIS(t) + score_SC(t))      (after venue balancing, if on)
// 0 → VIS blue, 0.5 → neutral ink (shared), 1 → SC red; interpolated in CIELAB so lightness changes evenly.
//
// Poles are the dataviz reference diverging pair (blue ↔ red), validated against each mode's panel surface for
// contrast ≥ 3:1 and color-vision-deficiency separation (protan ΔE 19–22). The neutral display mode's mid-gray surface
// needs lighter tints (the standard poles reach only 2.1–2.3:1 there). The midpoint is the theme's text ink rather
// than the reference gray midpoint: in a word cloud the words are the marks, and a gray close to the surface would
// make shared terms vanish.

import { interpolateLab } from "d3-interpolate";

type DisplayMode = "bright" | "dark" | "neutral";

const POLES: Record<DisplayMode, { vis: string; sc: string }> = {
    bright: { vis: "#2a78d6", sc: "#e34948" },
    dark: { vis: "#3987e5", sc: "#e66767" },
    neutral: { vis: "#8fbaf0", sc: "#f0a3a3" },
};

export function venueColorScale(mode: DisplayMode, neutralInk: string): (scShare: number) => string {
    const poles = POLES[mode] ?? POLES.dark;
    const towardVis = interpolateLab(neutralInk, poles.vis);
    const towardSc = interpolateLab(neutralInk, poles.sc);
    return scShare => scShare < 0.5 ? towardVis((0.5 - scShare) * 2) : towardSc((scShare - 0.5) * 2);
}

export function venuePoles(mode: DisplayMode): { vis: string; sc: string } {
    return POLES[mode] ?? POLES.dark;
}
