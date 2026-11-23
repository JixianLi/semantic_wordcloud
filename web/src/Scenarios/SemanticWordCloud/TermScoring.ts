// Term scores of a document selection.
//
// A term's score in venue v is the sum of its BM25 weights over v's selected documents:
//     score_v(t) = Σ_{d ∈ S_v} w(t, d)
// With one venue in scope that is the score. In the combined scope:
//     unbalanced:  score(t) = Σ_v score_v(t)
//     balanced:    score(t) = Σ_v score_v(t) · T̄ / T_v
// where T_v is the total term count of v's selected documents and T̄ the mean of T_v over venues with any text.
// Balancing gives each venue the same total mass, so the venue with more text (SC) does not dominate by volume.

import { type Conference, CONFERENCES, type Corpus, type CorpusDocument } from "./CorpusData";

export type Scope = Conference | "combined";

export interface ScoredTerm {
    termIndex: number;
    // What word size encodes: the BM25 sum (prominence), or |z| (distinctiveness).
    score: number;
    // Prominence: each venue's share of score, after balancing; the two sum to score.
    // Distinctiveness: the term's raw counts in each venue's selected documents.
    scoreByConference: Record<Conference, number>;
    // Distinctiveness only: log-odds z-score, positive = more VIS, negative = more SC.
    zScore?: number;
}

export interface ScoringOptions {
    balanceVenues: boolean;
    includePhrases: boolean;
    termLimit: number;
}

export function scopeConferences(scope: Scope): Conference[] {
    return scope === "combined" ? CONFERENCES : [scope];
}

export function scoreTerms(corpus: Corpus, selectedDocuments: CorpusDocument[], options: ScoringOptions): ScoredTerm[] {
    const termCount = corpus.terms.length;
    const scoresByConference = Object.fromEntries(
        CONFERENCES.map(conference => [conference, new Float64Array(termCount)])
    ) as Record<Conference, Float64Array>;
    const totalTermsByConference: Record<Conference, number> = { vis: 0, sc: 0 };

    for (const document of selectedDocuments) {
        const scores = scoresByConference[document.conference];
        totalTermsByConference[document.conference] += document.term_count;
        for (let index = 0; index < document.term_indices.length; index++) {
            scores[document.term_indices[index]] += document.weights[index];
        }
    }

    const venueFactor = venueFactors(totalTermsByConference, options.balanceVenues);
    const scored: ScoredTerm[] = [];
    for (let termIndex = 0; termIndex < termCount; termIndex++) {
        if (!options.includePhrases && corpus.terms[termIndex].tokens > 1) {
            continue;
        }
        const scoreByConference = {
            vis: scoresByConference.vis[termIndex] * venueFactor.vis,
            sc: scoresByConference.sc[termIndex] * venueFactor.sc,
        };
        const score = scoreByConference.vis + scoreByConference.sc;
        if (score > 0) {
            scored.push({ termIndex, score, scoreByConference });
        }
    }
    scored.sort((first, second) => second.score - first.score);
    return scored.slice(0, options.termLimit);
}

function venueFactors(totalTermsByConference: Record<Conference, number>, balance: boolean): Record<Conference, number> {
    const venuesWithText = CONFERENCES.filter(conference => totalTermsByConference[conference] > 0);
    if (!balance || venuesWithText.length < 2) {
        return { vis: 1, sc: 1 };
    }
    const meanTotal = venuesWithText.reduce((sum, conference) => sum + totalTermsByConference[conference], 0) / venuesWithText.length;
    return {
        vis: totalTermsByConference.vis > 0 ? meanTotal / totalTermsByConference.vis : 0,
        sc: totalTermsByConference.sc > 0 ? meanTotal / totalTermsByConference.sc : 0,
    };
}

// Distinctiveness: which terms separate VIS from SC, by the log-odds ratio with an informative Dirichlet prior
// (Monroe, Colaresi & Quinn 2008, "Fightin' Words", eq. 16-22):
//     δ_w = ln((y_w^V + α_w) / (n^V + α_0 − y_w^V − α_w)) − ln((y_w^S + α_w) / (n^S + α_0 − y_w^S − α_w))
//     σ²(δ_w) ≈ 1 / (y_w^V + α_w) + 1 / (y_w^S + α_w)          z_w = δ_w / σ(δ_w)
//   y_w^V, y_w^S   occurrences of term w in VIS's / SC's selected documents
//   n^V, n^S       all term occurrences in those documents
//   α_w = α_0 · (y_w^V + y_w^S) / (n^V + n^S)   prior: the pooled frequency, worth α_0 pseudo-occurrences in total
// Unlike a raw frequency ratio, the prior shrinks rare terms toward "no difference" and σ turns δ into a z-score,
// so a term seen 3 times in one venue and never in the other does not outrank a term used 300 times vs 30.
// Venue size is part of the model (n^V, n^S), so this needs no venue balancing.
const PRIOR_PSEUDO_OCCURRENCES = 1000;

export function distinctiveTerms(corpus: Corpus, selectedDocuments: CorpusDocument[], options: ScoringOptions): ScoredTerm[] {
    const termCount = corpus.terms.length;
    const countsByConference = { vis: new Float64Array(termCount), sc: new Float64Array(termCount) };
    const totals: Record<Conference, number> = { vis: 0, sc: 0 };
    for (const document of selectedDocuments) {
        const counts = countsByConference[document.conference];
        for (let index = 0; index < document.term_indices.length; index++) {
            counts[document.term_indices[index]] += document.counts[index];
            totals[document.conference] += document.counts[index];
        }
    }
    if (totals.vis === 0 || totals.sc === 0) {
        return [];
    }
    const pooledTotal = totals.vis + totals.sc;
    const scored: ScoredTerm[] = [];
    for (let termIndex = 0; termIndex < termCount; termIndex++) {
        if (!options.includePhrases && corpus.terms[termIndex].tokens > 1) {
            continue;
        }
        const vis = countsByConference.vis[termIndex];
        const sc = countsByConference.sc[termIndex];
        if (vis + sc === 0) {
            continue;
        }
        const prior = PRIOR_PSEUDO_OCCURRENCES * (vis + sc) / pooledTotal;
        const logOddsVis = Math.log((vis + prior) / (totals.vis + PRIOR_PSEUDO_OCCURRENCES - vis - prior));
        const logOddsSc = Math.log((sc + prior) / (totals.sc + PRIOR_PSEUDO_OCCURRENCES - sc - prior));
        const zScore = (logOddsVis - logOddsSc) / Math.sqrt(1 / (vis + prior) + 1 / (sc + prior));
        scored.push({ termIndex, score: Math.abs(zScore), scoreByConference: { vis, sc }, zScore });
    }
    scored.sort((first, second) => second.score - first.score);
    return scored.slice(0, options.termLimit);
}
