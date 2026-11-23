import { makeAutoObservable, observable, reaction, runInAction } from "mobx";
import type { GlobalContext } from "@core/Types/GlobalContext";
import {
    type Conference, type Corpus, type CorpusDocument, loadCorpus, loadNeighbors, type Source, SOURCES, trackKey,
} from "./CorpusData";
import { distinctiveTerms, type Scope, scopeConferences, type ScoredTerm, scoreTerms } from "./TermScoring";
import { detectTopics, TOPIC_COLOR_COUNT, type TopicAssignment } from "./Topics";
import { blendedSimilarity, indexSimilarities, type SimilarityLink, type TermSimilarities, visibleLinks } from "./Similarity";
import { type MeasuredWord, measureWords, type PlacedWord, WordCloudLayoutRunner } from "@core/Renderers/Graph";

// Expected global_data keys (all optional):
//   corpus_url, neighbors_url: string     where corpus.json / neighbors.json are served
//   scope: "vis" | "sc" | "combined"
//   sources: Source[]                     selected sources
//   excluded_tracks: string[]             "conference|source|track" keys left out
//   balance_venues: boolean               combined scope only
//   term_limit: number
//   include_phrases: boolean
//   embedding_weight: number              0 = co-occurrence only, 1 = contextual embedding only
//   links_per_term: number
//   link_strength: number
//   show_all_links: boolean
//   measure: "prominence" | "distinctiveness"   distinctiveness (VIS vs SC log-odds) applies to the combined scope
//   color_by: "venue" | "topic"                 venue applies to the combined scope
//   topic_color_anchors: (string | null)[]      per color slot, a term key whose topic gets that color; omitted:
//                                               the largest topics

const FONT_FAMILY = '"Inter Variable", Inter, system-ui, sans-serif';
const FONT_WEIGHT = 500;
const MINIMUM_LINK_SIMILARITY = 0.15;
// Debounce for layout requests: slider drags settle before the worker starts.
const LAYOUT_DELAY_MS = 80;

export type Measure = "prominence" | "distinctiveness";
export type ColorBy = "venue" | "topic";

export interface TermDetail {
    termIndex: number;
    key: string;
    display: string;
    idf: number;
    backgroundDf: number;
    corpusDf: number;
    score: number;
    scoreByConference: Record<Conference, number>;
    zScore?: number;
    scoreBySource: Partial<Record<Source, number>>;
    neighbors: { termIndex: number; display: string; similarity: number; visible: boolean }[];
    documents: { document: CorpusDocument; weight: number }[];
    documentCount: number;
}

export class SemanticWordCloudGlobalContext implements GlobalContext {
    corpusUrl = "data/corpus.json";
    neighborsUrl = "data/neighbors.json";
    corpus: Corpus | null = null;
    similarities: TermSimilarities | null = null;
    loadError: string | null = null;

    scope: Scope = "combined";
    selectedSources = new Set<Source>(["accepted_entries", "keynote", "website"]);
    excludedTracks = new Set<string>();
    balanceVenues = true;
    termLimit = 150;
    includePhrases = true;
    embeddingWeight = 0.5;
    linksPerTerm = 3;
    linkStrength = 0.6;
    showAllLinks = false;
    measure: Measure = "prominence";
    colorBy: ColorBy = "venue";
    // null: the largest topics take the color slots. Otherwise one entry per slot: a term key whose topic takes that
    // slot's color, wherever Louvain puts it after a filter change (topic ids are re-ranked on every change).
    topicColorAnchors: (string | null)[] | null = null;
    aspectRatio = 1.6;

    selectedTermKey: string | null = null;
    hoveredTermKey: string | null = null;
    placedWords: PlacedWord[] = [];
    layoutPending = false;

    private layoutRunner: WordCloudLayoutRunner | null = null;
    // relayout() bumps the counter (observable, so the layout reaction re-runs) and sets startFresh (not observable),
    // which that next run reads once to ignore the previous positions.
    private relayoutCounter = 0;
    private startFresh = false;

    constructor() {
        makeAutoObservable<this, "layoutRunner" | "startFresh">(this, {
            corpus: observable.ref,
            similarities: observable.ref,
            placedWords: observable.ref,
            layoutRunner: false,
            startFresh: false,
        });
    }

    initialize(globalData: any): void {
        const data = globalData ?? {};
        this.corpusUrl = data.corpus_url ?? this.corpusUrl;
        this.neighborsUrl = data.neighbors_url ?? this.neighborsUrl;
        this.scope = data.scope ?? this.scope;
        if (Array.isArray(data.sources)) {
            this.selectedSources = new Set(data.sources);
        }
        if (Array.isArray(data.excluded_tracks)) {
            this.excludedTracks = new Set(data.excluded_tracks);
        }
        this.balanceVenues = data.balance_venues ?? this.balanceVenues;
        this.termLimit = data.term_limit ?? this.termLimit;
        this.includePhrases = data.include_phrases ?? this.includePhrases;
        this.embeddingWeight = data.embedding_weight ?? this.embeddingWeight;
        this.linksPerTerm = data.links_per_term ?? this.linksPerTerm;
        this.linkStrength = data.link_strength ?? this.linkStrength;
        this.showAllLinks = data.show_all_links ?? this.showAllLinks;
        this.measure = data.measure ?? this.measure;
        this.colorBy = data.color_by ?? this.colorBy;
        this.topicColorAnchors = Array.isArray(data.topic_color_anchors) ? data.topic_color_anchors : null;
    }

    async asyncInitialize(): Promise<void> {
        try {
            const [corpus, neighbors] = await Promise.all([loadCorpus(this.corpusUrl), loadNeighbors(this.neighborsUrl)]);
            await document.fonts?.ready;
            runInAction(() => {
                this.corpus = corpus;
                this.similarities = indexSimilarities(neighbors);
            });
            this.startLayoutWorker();
        } catch (error) {
            runInAction(() => {
                this.loadError = String(error);
            });
        }
    }

    toObject(): any {
        return {
            corpus_url: this.corpusUrl,
            neighbors_url: this.neighborsUrl,
            scope: this.scope,
            sources: SOURCES.filter(source => this.selectedSources.has(source)),
            excluded_tracks: [...this.excludedTracks].sort(),
            balance_venues: this.balanceVenues,
            term_limit: this.termLimit,
            include_phrases: this.includePhrases,
            embedding_weight: this.embeddingWeight,
            links_per_term: this.linksPerTerm,
            link_strength: this.linkStrength,
            show_all_links: this.showAllLinks,
            measure: this.measure,
            color_by: this.colorBy,
            ...(this.topicColorAnchors ? { topic_color_anchors: this.topicColorAnchors } : {}),
        };
    }

    // The runner's worker lives as long as the page: GlobalContext has no teardown hook, so switching scenarios
    // leaves it idle.
    private startLayoutWorker(): void {
        this.layoutRunner = new WordCloudLayoutRunner(placed => runInAction(() => {
            this.placedWords = placed;
            this.layoutPending = false;
        }));
        reaction(
            () => ({ words: this.measuredWords, links: this.layoutLinks, aspectRatio: this.aspectRatio,
                     linkStrength: this.linkStrength, relayout: this.relayoutCounter }),
            ({ words, links, aspectRatio, linkStrength }) => {
                const fresh = this.startFresh;
                this.startFresh = false;
                const previousPositions = fresh ? {} : Object.fromEntries(this.placedWords.map(word => [word.key, { x: word.x, y: word.y }]));
                runInAction(() => {
                    this.layoutPending = true;
                });
                this.layoutRunner?.request(words, links, { aspectRatio, linkStrength, previousPositions });
            },
            { delay: LAYOUT_DELAY_MS, fireImmediately: true },
        );
    }

    setScope(scope: Scope): void {
        this.scope = scope;
    }

    toggleSource(source: Source): void {
        const next = new Set(this.selectedSources);
        next.has(source) ? next.delete(source) : next.add(source);
        this.selectedSources = next;
    }

    toggleTrack(key: string): void {
        const next = new Set(this.excludedTracks);
        next.has(key) ? next.delete(key) : next.add(key);
        this.excludedTracks = next;
    }

    setBalanceVenues(balance: boolean): void {
        this.balanceVenues = balance;
    }

    setTermLimit(limit: number): void {
        this.termLimit = limit;
    }

    setIncludePhrases(include: boolean): void {
        this.includePhrases = include;
    }

    setEmbeddingWeight(weight: number): void {
        this.embeddingWeight = weight;
    }

    setLinksPerTerm(count: number): void {
        this.linksPerTerm = count;
    }

    setLinkStrength(strength: number): void {
        this.linkStrength = strength;
    }

    setMeasure(measure: Measure): void {
        this.measure = measure;
    }

    setColorBy(colorBy: ColorBy): void {
        this.colorBy = colorBy;
    }

    // A colored topic loses its color; an uncolored one takes the first free slot (none free: no change, the legend
    // says to clear one first).
    toggleTopicColor(topicId: number): void {
        const topic = this.topics.topics[topicId];
        if (!topic) {
            return;
        }
        const anchors = this.topicColorAnchors ?? this.currentTopicAnchors();
        const slot = this.topicColorSlots.get(topicId);
        if (slot !== undefined) {
            this.topicColorAnchors = anchors.map((anchor, index) => index === slot ? null : anchor);
            return;
        }
        const freeSlot = Array.from({ length: TOPIC_COLOR_COUNT }, (_, index) => index)
            .find(index => ![...this.topicColorSlots.values()].includes(index));
        if (freeSlot !== undefined) {
            this.topicColorAnchors = anchors.map((anchor, index) => index === freeSlot ? topic.keys[0] : anchor);
        }
    }

    resetTopicColors(): void {
        this.topicColorAnchors = null;
    }

    private currentTopicAnchors(): (string | null)[] {
        const anchors: (string | null)[] = Array(TOPIC_COLOR_COUNT).fill(null);
        this.topicColorSlots.forEach((slot, topicId) => {
            anchors[slot] = this.topics.topics[topicId].keys[0];
        });
        return anchors;
    }

    setShowAllLinks(show: boolean): void {
        this.showAllLinks = show;
    }

    // Start from scratch instead of the previous positions.
    relayout(): void {
        this.startFresh = true;
        this.relayoutCounter += 1;
    }

    setAspectRatio(aspectRatio: number): void {
        if (Number.isFinite(aspectRatio) && aspectRatio > 0 && Math.abs(aspectRatio - this.aspectRatio) > 0.05) {
            this.aspectRatio = aspectRatio;
        }
    }

    selectTerm(key: string | null): void {
        this.selectedTermKey = key === this.selectedTermKey ? null : key;
    }

    hoverTerm(key: string | null): void {
        this.hoveredTermKey = key;
    }

    // Documents of the scope, before source and track filters: what the filter counts are computed over.
    get scopeDocuments(): CorpusDocument[] {
        if (!this.corpus) {
            return [];
        }
        const conferences = new Set(scopeConferences(this.scope));
        return this.corpus.documents.filter(document => conferences.has(document.conference));
    }

    get selectedDocuments(): CorpusDocument[] {
        return this.scopeDocuments.filter(document =>
            this.selectedSources.has(document.source) && !this.excludedTracks.has(trackKey(document)));
    }

    get isDistinctiveness(): boolean {
        return this.scope === "combined" && this.measure === "distinctiveness";
    }

    get isVenueBalanced(): boolean {
        return this.scope === "combined" && this.balanceVenues && !this.isDistinctiveness;
    }

    // What color encodes: venue only makes sense with both venues in scope.
    get effectiveColorBy(): ColorBy {
        return this.scope === "combined" ? this.colorBy : "topic";
    }

    get scoredTerms(): ScoredTerm[] {
        if (!this.corpus) {
            return [];
        }
        const score = this.isDistinctiveness ? distinctiveTerms : scoreTerms;
        return score(this.corpus, this.selectedDocuments, {
            balanceVenues: this.isVenueBalanced,
            includePhrases: this.includePhrases,
            termLimit: this.termLimit,
        });
    }

    get scoredTermByKey(): Map<string, ScoredTerm> {
        const corpus = this.corpus;
        return new Map(corpus ? this.scoredTerms.map(scored => [corpus.terms[scored.termIndex].key, scored]) : []);
    }

    get measuredWords(): MeasuredWord[] {
        const corpus = this.corpus;
        if (!corpus) {
            return [];
        }
        return measureWords(this.scoredTerms.map(scored => ({
            key: corpus.terms[scored.termIndex].key,
            text: corpus.terms[scored.termIndex].display,
            weight: scored.score,
        })), { maxFontSize: 56, minFontSize: 10, fontFamily: FONT_FAMILY, fontWeight: FONT_WEIGHT });
    }

    get layoutLinks(): SimilarityLink[] {
        if (!this.similarities) {
            return [];
        }
        return visibleLinks(this.scoredTerms.map(scored => scored.termIndex), this.similarities, this.embeddingWeight,
                            this.linksPerTerm, MINIMUM_LINK_SIMILARITY);
    }

    get topics(): TopicAssignment {
        return detectTopics(this.measuredWords, this.layoutLinks);
    }

    // Topic id -> color slot.
    get topicColorSlots(): Map<number, number> {
        const { topics, topicByKey } = this.topics;
        const slots = new Map<number, number>();
        if (!this.topicColorAnchors) {
            topics.slice(0, TOPIC_COLOR_COUNT).forEach(topic => slots.set(topic.id, topic.id));
            return slots;
        }
        this.topicColorAnchors.forEach((anchor, slot) => {
            const topicId = anchor === null ? undefined : topicByKey.get(anchor);
            if (topicId !== undefined && !slots.has(topicId)) {
                slots.set(topicId, slot);
            }
        });
        return slots;
    }

    // Links between placed words, by key, for drawing.
    get drawnLinks(): { source: string; target: string; similarity: number }[] {
        const words = this.measuredWords;
        const placedKeys = new Set(this.placedWords.map(word => word.key));
        return this.layoutLinks
            .map(link => ({ source: words[link.source]?.key, target: words[link.target]?.key, similarity: link.similarity }))
            .filter(link => placedKeys.has(link.source) && placedKeys.has(link.target));
    }

    get selectedTermDetail(): TermDetail | null {
        const corpus = this.corpus;
        const key = this.selectedTermKey;
        if (!corpus || !key) {
            return null;
        }
        const termIndex = corpus.terms.findIndex(term => term.key === key);
        if (termIndex < 0) {
            return null;
        }
        const term = corpus.terms[termIndex];
        const scored = this.scoredTermByKey.get(key);
        const scoreBySource: Partial<Record<Source, number>> = {};
        const documents: { document: CorpusDocument; weight: number }[] = [];
        for (const document of this.selectedDocuments) {
            const position = document.term_indices.indexOf(termIndex);
            if (position >= 0) {
                const weight = document.weights[position];
                scoreBySource[document.source] = (scoreBySource[document.source] ?? 0) + weight;
                documents.push({ document, weight });
            }
        }
        documents.sort((first, second) => second.weight - first.weight);
        const visibleKeys = this.scoredTermByKey;
        const neighbors = [...(this.similarities?.byTerm.get(termIndex) ?? new Map()).entries()]
            .map(([other, pair]) => ({
                termIndex: other,
                display: corpus.terms[other].display,
                similarity: blendedSimilarity(pair, this.embeddingWeight),
                visible: visibleKeys.has(corpus.terms[other].key),
            }))
            .sort((first, second) => second.similarity - first.similarity)
            .slice(0, 12);
        return {
            termIndex,
            key,
            display: term.display,
            idf: term.idf,
            backgroundDf: term.background_df,
            corpusDf: term.df,
            score: scored?.score ?? 0,
            scoreByConference: scored?.scoreByConference ?? { vis: 0, sc: 0 },
            zScore: scored?.zScore,
            scoreBySource,
            neighbors,
            documents: documents.slice(0, 25),
            documentCount: documents.length,
        };
    }

    get fontFamily(): string {
        return FONT_FAMILY;
    }

    get fontWeight(): number {
        return FONT_WEIGHT;
    }
}
