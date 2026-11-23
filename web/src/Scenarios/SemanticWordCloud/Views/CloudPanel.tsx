import { useEffect, useRef } from "react";
import { observer } from "mobx-react-lite";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { Panel } from "@core/Panels/Panel";
import { useScenario } from "@core/ScenarioManager/ScenarioManager";
import type { SemanticWordCloudGlobalContext } from "../SemanticWordCloudGlobalContext";
import { WordCloud } from "@core/Renderers/Graph";
import { topicColors, uncoloredTopicInk, venueColorScale, venueNeutralInk, venuePoles } from "../WordColors";
import { TOPIC_COLOR_COUNT } from "../Topics";
import { usePinchZoom } from "./PinchZoom";

// Distinctiveness color: venue share = 0.5 − 0.5·tanh(z / Z_COLOR_SCALE), so |z| of about 4 and more reaches the
// full pole color and z = 0 (no difference) is neutral ink.
const Z_COLOR_SCALE = 4;

export default observer(function CloudPanel() {
    const context = useScenario().globalContext as SemanticWordCloudGlobalContext;
    const theme = useTheme();
    const tokens = theme.tokens;
    const containerRef = useRef<HTMLDivElement>(null);
    const zoomedRef = useRef<HTMLDivElement>(null);

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
    const pinchZoom = usePinchZoom(containerRef, zoomedRef, words);

    const colorBy = context.effectiveColorBy;
    const neutralInk = venueNeutralInk(tokens.mode, tokens.text);
    const venueColor = venueColorScale(tokens.mode, neutralInk);
    const topicPalette = topicColors(tokens.mode);
    const uncoloredInk = uncoloredTopicInk(tokens.mode, tokens.textSecondary);
    const topicByKey = colorBy === "topic" ? context.topics.topicByKey : new Map<string, number>();
    const topicColorSlots = colorBy === "topic" ? context.topicColorSlots : new Map<number, number>();
    const scoredByKey = context.scoredTermByKey;
    const colorOf = (key: string) => {
        if (colorBy === "topic") {
            const topic = topicByKey.get(key);
            const slot = topic === undefined ? undefined : topicColorSlots.get(topic);
            return slot !== undefined ? topicPalette[slot] : uncoloredInk;
        }
        const scored = scoredByKey.get(key);
        if (!scored || scored.score <= 0) {
            return neutralInk;
        }
        if (scored.zScore !== undefined) {
            return venueColor(0.5 - 0.5 * Math.tanh(scored.zScore / Z_COLOR_SCALE));
        }
        return venueColor(scored.scoreByConference.sc / scored.score);
    };

    return (
        <Panel panelName="Cloud">
            <Box ref={containerRef} sx={{ width: "100%", height: "100%", position: "relative", minHeight: 0, overflow: "hidden" }}>
                {context.loadError && <Typography color="error" sx={{ p: 2 }}>{context.loadError}</Typography>}
                {!context.corpus && !context.loadError && <Typography sx={{ p: 2, color: "text.secondary" }}>Loading corpus…</Typography>}
                {context.corpus && context.scoredTerms.length === 0 && (
                    <Typography sx={{ p: 2, color: "text.secondary" }}>No documents selected.</Typography>
                )}
                <Box ref={zoomedRef} sx={{ position: "absolute", inset: 0, transformOrigin: "0 0" }}>
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
                </Box>
                {pinchZoom.zoomed && (
                    <Button size="small" variant="outlined" color="inherit" onClick={pinchZoom.reset}
                            sx={{ position: "absolute", top: 8, right: 8, color: "text.primary", borderColor: tokens.border,
                                bgcolor: tokens.surface, "&:hover": { bgcolor: tokens.surface } }}>
                        Reset zoom
                    </Button>
                )}
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
    const uncoloredInk = uncoloredTopicInk(tokens.mode, tokens.textSecondary);
    const slots = context.topicColorSlots;
    const topics = context.topics.topics;
    const linkedTopics = topics.filter(topic => topic.keys.length > 1 || slots.has(topic.id));
    const unlinkedCount = topics.length - linkedTopics.length;
    const allSlotsTaken = slots.size >= TOPIC_COLOR_COUNT;
    const row = { display: "flex", alignItems: "center", width: "100%", justifyContent: "flex-start", textAlign: "left",
                  borderRadius: "4px", px: 0.5, color: "text.secondary" };
    const swatch = { flex: "none", width: 8, height: 8, borderRadius: "2px", mr: 0.75 };
    return (
        <Box sx={{ position: "absolute", left: 8, bottom: 10, maxWidth: 360, maxHeight: "45%", overflowY: "auto" }}>
            <Typography variant="caption" sx={{ display: "block", px: 0.5, color: "text.secondary", opacity: 0.8 }}>
                {allSlotsTaken ? "Click a colored topic to clear it, then pick another" : "Click a topic to color it"}
                {context.topicColorAnchors && (
                    <Link component="button" variant="caption" underline="hover" onClick={() => context.resetTopicColors()}
                          sx={{ ml: 1, verticalAlign: "baseline" }}>
                        largest three
                    </Link>
                )}
            </Typography>
            {linkedTopics.map(topic => {
                const slot = slots.get(topic.id);
                const disabled = slot === undefined && allSlotsTaken;
                return (
                    <ButtonBase key={topic.id} disabled={disabled} onClick={() => context.toggleTopicColor(topic.id)}
                                aria-pressed={slot !== undefined}
                                sx={{ ...row, opacity: disabled ? 0.55 : 1, "&:hover": { bgcolor: tokens.controlFill } }}>
                        <Box component="span" sx={{ ...swatch, bgcolor: slot !== undefined ? palette[slot] : uncoloredInk }} />
                        <Typography variant="caption" noWrap sx={{ color: slot !== undefined ? "text.primary" : "text.secondary" }}>
                            {`${topic.label} (${topic.keys.length})`}
                        </Typography>
                    </ButtonBase>
                );
            })}
            {unlinkedCount > 0 && (
                <Typography variant="caption" sx={{ ...row }}>
                    <Box component="span" sx={{ ...swatch, bgcolor: uncoloredInk }} />
                    {`${unlinkedCount} unlinked word${unlinkedCount === 1 ? "" : "s"}`}
                </Typography>
            )}
        </Box>
    );
});

const VenueLegend = observer(function VenueLegend({ distinctiveness }: { distinctiveness: boolean }) {
    const tokens = useTheme().tokens;
    const poles = venuePoles(tokens.mode);
    const scale = venueColorScale(tokens.mode, venueNeutralInk(tokens.mode, tokens.text));
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
