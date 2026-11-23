// Diverging color for the combined scope: which venue a term belongs to.
//     scShare(t) = score_SC(t) / (score_VIS(t) + score_SC(t))      (after venue balancing, if on)
// 0 → VIS blue, 0.5 → neutral ink (shared), 1 → SC red; interpolated in CIELAB so lightness changes evenly.
//
// Poles are the dataviz reference diverging pair (blue ↔ red), validated for color-vision-deficiency separation
// (protan ΔE 19–22) and for contrast ≥ 3:1 on the bright and dark panel surfaces. The neutral display mode uses the
// dark poles too, so both dark-based modes show the same saturation (OKLCH chroma 0.16); on its #4A4A4A canvas they
// reach only 2.4:1 (VIS) and 2.7:1 (SC), accepted because that mode is for judging color. Lighter tints would pass
// 3:1 but at about half the chroma.
//
// The midpoint is a readable ink rather than the reference light-gray midpoint: in a word cloud the words are the
// marks, and a gray close to the surface would make shared terms vanish. Bright mode uses a mid gray,
// BRIGHT_NEUTRAL_INK: clearly gray rather than near-black, at 3.5:1 on the canvas the cloud sits on (#EEF0F0), so even
// 10 px words stay legible. The dark modes use their primary text ink.

import { interpolateLab } from "d3-interpolate";

type DisplayMode = "bright" | "dark" | "neutral";

const POLES: Record<DisplayMode, { vis: string; sc: string }> = {
    bright: { vis: "#2a78d6", sc: "#e34948" },
    dark: { vis: "#3987e5", sc: "#e66767" },
    neutral: { vis: "#3987e5", sc: "#e66767" },
};

export function venueColorScale(mode: DisplayMode, neutralInk: string): (scShare: number) => string {
    const poles = POLES[mode] ?? POLES.dark;
    const towardVis = interpolateLab(neutralInk, poles.vis);
    const towardSc = interpolateLab(neutralInk, poles.sc);
    return scShare => scShare < 0.5 ? towardVis((0.5 - scShare) * 2) : towardSc((scShare - 0.5) * 2);
}

const BRIGHT_NEUTRAL_INK = "#7A8086";

export function venueNeutralInk(mode: DisplayMode, text: string): string {
    return mode === "bright" ? BRIGHT_NEUTRAL_INK : text;
}

export function venuePoles(mode: DisplayMode): { vis: string; sc: string } {
    return POLES[mode] ?? POLES.dark;
}

// Topic colors: slots 1-3 of the dataviz reference categorical palette (blue, orange, aqua), the only slots that
// pass the all-pairs color-vision check. Bright mode uses the light steps, dark and neutral the dark steps; on the
// neutral mode's mid-gray surface they reach only ~2:1 contrast (no documented trio passes there: lighter tints
// fail the separation check), accepted because that mode is for judging color, not reading.
const TOPIC_COLORS: Record<DisplayMode, string[]> = {
    bright: ["#2a78d6", "#eb6834", "#1baf7a"],
    dark: ["#3987e5", "#d95926", "#199e70"],
    neutral: ["#3987e5", "#d95926", "#199e70"],
};

export function topicColors(mode: DisplayMode): string[] {
    return TOPIC_COLORS[mode] ?? TOPIC_COLORS.dark;
}
