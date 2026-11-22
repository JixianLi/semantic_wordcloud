// Force-directed placement of words as rectangles. Phase 2: no edges yet, only a pull to the center (elliptical,
// to fill a wide panel) against rectangle collision. Phase 3 adds similarity links.
//
// Font size encodes score by area: a word's ink area grows with fontSize², so fontSize ∝ √score keeps area ∝ score.
// Sizes below minFontSize are clamped up, which overstates the smallest words; that is the price of legibility.

import { forceSimulation, forceX, forceY } from "d3-force";
import { forceRectangleCollision, removeOverlaps, type RectangleNode } from "./RectangleCollisionForce";

export interface WordInput {
    key: string;
    text: string;
    weight: number;
}

export interface PlacedWord extends RectangleNode {
    key: string;
    text: string;
    weight: number;
    fontSize: number;
    x: number;
    y: number;
}

export interface WordLayoutOptions {
    maxFontSize: number;
    minFontSize: number;
    fontFamily: string;
    fontWeight: number;
    aspectRatio: number;
    // Previous positions by key: words that stay keep their place, so a filter change does not scatter the cloud.
    previousPositions?: Map<string, { x: number; y: number }>;
    ticks?: number;
}

const TEXT_HEIGHT_FACTOR = 1.05;
const COLLISION_PADDING = 2;

export function layoutWords(words: WordInput[], options: WordLayoutOptions): PlacedWord[] {
    const maxWeight = Math.max(...words.map(word => word.weight), Number.EPSILON);
    const measure = textMeasurer(options.fontFamily, options.fontWeight);
    const nodes: PlacedWord[] = words.map((word, index) => {
        const fontSize = Math.max(options.minFontSize, options.maxFontSize * Math.sqrt(word.weight / maxWeight));
        const previous = options.previousPositions?.get(word.key);
        const angle = index * 2.399963; // golden angle: an even spiral of starting points
        const radius = 4 * Math.sqrt(index) * options.minFontSize;
        return {
            ...word,
            fontSize,
            width: measure(word.text, fontSize),
            height: fontSize * TEXT_HEIGHT_FACTOR,
            x: previous?.x ?? radius * Math.cos(angle) * options.aspectRatio,
            y: previous?.y ?? radius * Math.sin(angle),
        };
    });

    const simulation = forceSimulation(nodes)
        .force("x", forceX<PlacedWord>(0).strength(0.04))
        .force("y", forceY<PlacedWord>(0).strength(0.04))
        .force("collide", forceRectangleCollision<PlacedWord>(COLLISION_PADDING))
        .stop();
    const ticks = options.ticks ?? 300;
    for (let tick = 0; tick < ticks; tick++) {
        simulation.tick();
    }
    removeOverlaps(nodes, COLLISION_PADDING);
    return nodes;
}

function textMeasurer(fontFamily: string, fontWeight: number): (text: string, fontSize: number) => number {
    const context = document.createElement("canvas").getContext("2d");
    return (text, fontSize) => {
        if (!context) {
            return text.length * fontSize * 0.55;
        }
        context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        return context.measureText(text).width;
    };
}

export function layoutBounds(words: PlacedWord[]): { x: number; y: number; width: number; height: number } {
    if (words.length === 0) {
        return { x: -1, y: -1, width: 2, height: 2 };
    }
    const left = Math.min(...words.map(word => word.x - word.width / 2));
    const right = Math.max(...words.map(word => word.x + word.width / 2));
    const top = Math.min(...words.map(word => word.y - word.height / 2));
    const bottom = Math.max(...words.map(word => word.y + word.height / 2));
    return { x: left, y: top, width: right - left, height: bottom - top };
}
