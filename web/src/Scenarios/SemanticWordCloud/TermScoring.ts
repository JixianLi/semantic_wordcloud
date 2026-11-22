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
    score: number;
    // Each venue's share of score, after balancing; the two sum to score.
    scoreByConference: Record<Conference, number>;
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
