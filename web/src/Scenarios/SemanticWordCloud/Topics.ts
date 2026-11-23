// Topics: communities of the visible-term similarity graph (the same links that shape the layout), found with
// Louvain modularity optimization (Blondel et al. 2008) via graphology-communities-louvain. A seeded random number
// generator makes the result repeatable for the same graph, so colors do not flicker on re-render.
//
// Only TOPIC_COLOR_COUNT topics get a color: in a word cloud any two colors can sit side by side, and of the
// documented categorical palette only its first three slots stay distinguishable for color-vision-deficient readers
// in every pair (dataviz validator, --pairs all). Topics are ranked by total score; the rest share muted ink.

import Graph from "graphology";
import louvain from "graphology-communities-louvain";

export const TOPIC_COLOR_COUNT = 3;

export interface Topic {
    id: number;
    keys: string[];
    totalScore: number;
    label: string;
}

export interface TopicAssignment {
    topicByKey: Map<string, number>;
    // Largest first; the first TOPIC_COLOR_COUNT are the colored ones.
    topics: Topic[];
}

export function detectTopics(
    words: { key: string; text: string; weight: number }[],
    links: { source: number; target: number; similarity: number }[],
): TopicAssignment {
    const graph = new Graph({ type: "undirected" });
    words.forEach(word => graph.addNode(word.key));
    for (const link of links) {
        const source = words[link.source]?.key;
        const target = words[link.target]?.key;
        if (source && target && source !== target && !graph.hasEdge(source, target)) {
            graph.addEdge(source, target, { weight: link.similarity });
        }
    }
    const communityByKey: Record<string, number> = graph.size > 0
        ? louvain(graph, { getEdgeWeight: "weight", rng: seededRandom(1) })
        : Object.fromEntries(words.map((word, index) => [word.key, index]));

    const membersByCommunity = new Map<number, { key: string; text: string; weight: number }[]>();
    for (const word of words) {
        const community = communityByKey[word.key];
        membersByCommunity.set(community, [...(membersByCommunity.get(community) ?? []), word]);
    }
    const ranked = [...membersByCommunity.values()]
        .map(members => members.sort((first, second) => second.weight - first.weight))
        .sort((first, second) => total(second) - total(first));
    const topics = ranked.map((members, id) => ({
        id,
        keys: members.map(member => member.key),
        totalScore: total(members),
        label: members.slice(0, 3).map(member => member.text).join(", "),
    }));
    const topicByKey = new Map<string, number>();
    topics.forEach(topic => topic.keys.forEach(key => topicByKey.set(key, topic.id)));
    return { topicByKey, topics };
}

function total(members: { weight: number }[]): number {
    return members.reduce((sum, member) => sum + member.weight, 0);
}

// mulberry32: a small, fast 32-bit seeded generator; quality is ample for Louvain's node-visit order.
function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}
