import { useEffect, useRef } from "react";
import { observer } from "mobx-react-lite";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { Panel } from "@core/Panels/Panel";
import { useScenario } from "@core/ScenarioManager/ScenarioManager";
import type { SemanticWordCloudGlobalContext } from "../SemanticWordCloudGlobalContext";
import { WordCloud } from "@core/Renderers/Graph";
import { topicColors, venueColorScale, venuePoles } from "../WordColors";
import { TOPIC_COLOR_COUNT } from "../Topics";

// Distinctiveness color: venue share = 0.5 − 0.5·tanh(z / Z_COLOR_SCALE), so |z| of about 4 and more reaches the
// full pole color and z = 0 (no difference) is neutral ink.
const Z_COLOR_SCALE = 4;

export default observer(function CloudPanel() {
    const context = useScenario().globalContext as SemanticWordCloudGlobalContext;
    const theme = useTheme();
    const tokens = theme.tokens;
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            if (height > 0) {
                context.setAspectRatio(width / height);
            }
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [context]);

    const words = context.placedWords;

    const colorBy = context.effectiveColorBy;
    const venueColor = venueColorScale(tokens.mode, tokens.text);
    const topicPalette = topicColors(tokens.mode);
    const topicByKey = colorBy === "topic" ? context.topics.topicByKey : new Map<string, number>();
    const scoredByKey = context.scoredTermByKey;
    const colorOf = (key: string) => {
        if (colorBy === "topic") {
            const topic = topicByKey.get(key);
            return topic !== undefined && topic < TOPIC_COLOR_COUNT ? topicPalette[topic] : tokens.textSecondary;
        }
        const scored = scoredByKey.get(key);
        if (!scored || scored.score <= 0) {
            return tokens.text;
        }
        if (scored.zScore !== undefined) {
            return venueColor(0.5 - 0.5 * Math.tanh(scored.zScore / Z_COLOR_SCALE));
        }
        return venueColor(scored.scoreByConference.sc / scored.score);
    };

    return (
        <Panel panelName="Cloud">
            <Box ref={containerRef} sx={{ width: "100%", height: "100%", position: "relative", minHeight: 0 }}>
                {context.loadError && <Typography color="error" sx={{ p: 2 }}>{context.loadError}</Typography>}
                {!context.corpus && !context.loadError && <Typography sx={{ p: 2, color: "text.secondary" }}>Loading corpus…</Typography>}
                {context.corpus && context.scoredTerms.length === 0 && (
                    <Typography sx={{ p: 2, color: "text.secondary" }}>No documents selected.</Typography>
                )}
                <WordCloud
                    words={words}
                    colorOf={colorOf}
                    fontFamily={context.fontFamily}
                    fontWeight={context.fontWeight}
                    links={context.drawnLinks}
                    showAllLinks={context.showAllLinks}
                    selectedKey={context.selectedTermKey}
                    focusKey={context.hoveredTermKey ?? context.selectedTermKey}
                    onHover={key => context.hoverTerm(key)}
                    onSelect={key => context.selectTerm(key)}
                />
                {colorBy === "venue" && words.length > 0 && <VenueLegend distinctiveness={context.isDistinctiveness} />}
                {colorBy === "topic" && words.length > 0 && <TopicLegend />}
                {context.layoutPending && (
                    <Typography variant="caption" sx={{ position: "absolute", top: 4, left: 8, color: "text.secondary" }}>
                        Laying out…
                    </Typography>
                )}
            </Box>
        </Panel>
    );
});

const TopicLegend = observer(function TopicLegend() {
    const context = useScenario().globalContext as SemanticWordCloudGlobalContext;
    const tokens = useTheme().tokens;
    const palette = topicColors(tokens.mode);
    const topics = context.topics.topics;
    const uncolored = topics.slice(TOPIC_COLOR_COUNT);
    const otherTopicCount = uncolored.filter(topic => topic.keys.length > 1).length;
    const unlinkedCount = uncolored.filter(topic => topic.keys.length === 1).length;
    const otherLabel = [
        otherTopicCount > 0 ? `${otherTopicCount} more topic${otherTopicCount === 1 ? "" : "s"}` : "",
        unlinkedCount > 0 ? `${unlinkedCount} unlinked word${unlinkedCount === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(", ");
    return (
        <Box sx={{ position: "absolute", left: 12, bottom: 10, maxWidth: 360 }}>
            {topics.slice(0, TOPIC_COLOR_COUNT).map(topic => (
                <Typography key={topic.id} variant="caption" sx={{ display: "flex", alignItems: "center", color: "text.secondary" }}>
                    <Box component="span" sx={{ flex: "none", width: 8, height: 8, borderRadius: "2px", bgcolor: palette[topic.id], mr: 0.75 }} />
                    {topic.label}
                </Typography>
            ))}
            {otherLabel && (
                <Typography variant="caption" sx={{ display: "flex", alignItems: "center", color: "text.secondary" }}>
                    <Box component="span" sx={{ flex: "none", width: 8, height: 8, borderRadius: "2px", bgcolor: tokens.textSecondary, mr: 0.75 }} />
                    {otherLabel}
                </Typography>
            )}
        </Box>
    );
});

const VenueLegend = observer(function VenueLegend({ distinctiveness }: { distinctiveness: boolean }) {
    const tokens = useTheme().tokens;
    const poles = venuePoles(tokens.mode);
    const scale = venueColorScale(tokens.mode, tokens.text);
    const stops = [0, 0.25, 0.5, 0.75, 1].map(share => `${scale(share)} ${share * 100}%`).join(", ");
    return (
        <Box sx={{ position: "absolute", left: 12, bottom: 10, width: 220 }}>
            <Box sx={{ height: 8, borderRadius: "4px", background: `linear-gradient(to right, ${stops})` }} />
            <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5 }}>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    <Box component="span" sx={{ display: "inline-block", width: 8, height: 8, borderRadius: "2px", bgcolor: poles.vis, mr: 0.5 }} />
                    {distinctiveness ? "more VIS" : "VIS"}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>{distinctiveness ? "no difference" : "shared"}</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {distinctiveness ? "more SC" : "SC"}
                    <Box component="span" sx={{ display: "inline-block", width: 8, height: 8, borderRadius: "2px", bgcolor: poles.sc, ml: 0.5 }} />
                </Typography>
            </Box>
        </Box>
    );
});
