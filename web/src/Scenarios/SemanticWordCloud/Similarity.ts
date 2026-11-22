// Term-term similarity for the layout, blended from two measures (both scaled to 0..1 by the pipeline):
//     similarity(a, b) = α · embedding(a, b) + (1 − α) · cooccurrence(a, b)
// α = 0: terms that appear in the same sentences; α = 1: terms used in similar contexts. A pair missing from a
// measure's neighbor lists counts as 0 for that measure.

import type { NeighborLists } from "./CorpusData";

export interface TermSimilarities {
    // term index -> neighbor term index -> [cooccurrence, embedding]
    byTerm: Map<number, Map<number, [number, number]>>;
}

export interface SimilarityLink {
    source: number;   // positions in the visible-term list
    target: number;
    similarity: number;
}

export function indexSimilarities(lists: NeighborLists): TermSimilarities {
    const byTerm = new Map<number, Map<number, [number, number]>>();
    const add = (first: number, second: number, measure: 0 | 1, value: number) => {
        for (const [from, to] of [[first, second], [second, first]]) {
            let neighbors = byTerm.get(from);
            if (!neighbors) {
                neighbors = new Map();
                byTerm.set(from, neighbors);
            }
            const pair = neighbors.get(to) ?? [0, 0];
            pair[measure] = Math.max(pair[measure], value);
            neighbors.set(to, pair);
        }
    };
    lists.terms.forEach((termIndex, row) => {
        const [cooccurrenceNeighbors, cooccurrenceValues] = lists.cooccurrence[row];
        cooccurrenceNeighbors.forEach((other, column) => add(termIndex, other, 0, cooccurrenceValues[column]));
        const [embeddingNeighbors, embeddingValues] = lists.embedding[row];
        embeddingNeighbors.forEach((other, column) => add(termIndex, other, 1, embeddingValues[column]));
    });
    return { byTerm };
}

export function blendedSimilarity(pair: [number, number], embeddingWeight: number): number {
    return embeddingWeight * pair[1] + (1 - embeddingWeight) * pair[0];
}

// Each visible term links to its linksPerTerm most similar visible terms (at least minimumSimilarity); a pair chosen
// from both ends is one link. Keeping only a few strongest links per term (a k-nearest-neighbor graph) gives the
// layout a sparse structure to follow instead of a hairball where everything pulls on everything.
export function visibleLinks(
    visibleTermIndices: number[],
    similarities: TermSimilarities,
    embeddingWeight: number,
    linksPerTerm: number,
    minimumSimilarity: number,
): SimilarityLink[] {
    const positionByTerm = new Map(visibleTermIndices.map((termIndex, position) => [termIndex, position]));
    const strongest = new Map<string, SimilarityLink>();
    visibleTermIndices.forEach((termIndex, position) => {
        const neighbors = similarities.byTerm.get(termIndex);
        if (!neighbors) {
            return;
        }
        const candidates: SimilarityLink[] = [];
        neighbors.forEach((pair, other) => {
            const otherPosition = positionByTerm.get(other);
            const similarity = blendedSimilarity(pair, embeddingWeight);
            if (otherPosition !== undefined && similarity >= minimumSimilarity) {
                candidates.push({ source: position, target: otherPosition, similarity });
            }
        });
        candidates.sort((first, second) => second.similarity - first.similarity);
        for (const link of candidates.slice(0, linksPerTerm)) {
            const key = link.source < link.target ? `${link.source}-${link.target}` : `${link.target}-${link.source}`;
            if ((strongest.get(key)?.similarity ?? -1) < link.similarity) {
                strongest.set(key, link);
            }
        }
    });
    return [...strongest.values()];
}
