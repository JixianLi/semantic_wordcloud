// Runs simulateLayout off the main thread. Message in: { requestId, words, links, options }; message out:
// { requestId, placed }. The caller keeps only the answer to its latest request, so slider drags never queue up
// stale layouts on screen.

import { simulateLayout, type LayoutLink, type MeasuredWord, type SimulationOptions } from "./WordLayout";

export interface LayoutRequest {
    requestId: number;
    words: MeasuredWord[];
    links: LayoutLink[];
    options: SimulationOptions;
}

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
    const { requestId, words, links, options } = event.data;
    const placed = simulateLayout(words, links, options);
    self.postMessage({ requestId, placed });
};
