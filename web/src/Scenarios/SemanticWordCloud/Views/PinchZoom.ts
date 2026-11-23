import { useEffect, useRef, useState, type RefObject } from "react";

// Touch screens: two fingers pinch to zoom the cloud (and drag it while pinching); once zoomed, one finger pans.
// At 1× a single finger is left to the browser, so the page still scrolls past the cloud.
//
// View: a cloud point p (px from the container's top left at 1×) is drawn at scale·p + (x, y). Panning is clamped so
// the zoomed cloud always covers the container: x ∈ [width·(1 − scale), 0], likewise y.
const MAX_SCALE = 4;

type View = { scale: number; x: number; y: number };
type Point = { x: number; y: number };
type Gesture =
    | { kind: "pinch"; start: View; startDistance: number; startMidpoint: Point }
    | { kind: "pan"; start: View; startPoint: Point };

const IDENTITY: View = { scale: 1, x: 0, y: 0 };

// The transform is written to the zoomed element's style directly: re-rendering 150 words on every touchmove would lag.
export function usePinchZoom(containerRef: RefObject<HTMLElement | null>, zoomedRef: RefObject<HTMLElement | null>,
                             resetKey: unknown) {
    const viewRef = useRef<View>(IDENTITY);
    const [zoomed, setZoomed] = useState(false);

    const apply = (view: View) => {
        viewRef.current = view;
        const container = containerRef.current;
        const target = zoomedRef.current;
        if (target) {
            target.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
        }
        if (container) {
            container.style.touchAction = view.scale > 1 ? "none" : "pan-y";
        }
    };

    const reset = () => {
        apply(IDENTITY);
        setZoomed(false);
    };

    useEffect(reset, [resetKey]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }
        let gesture: Gesture | null = null;

        const local = (touch: Touch): Point => {
            const bounds = container.getBoundingClientRect();
            return { x: touch.clientX - bounds.left, y: touch.clientY - bounds.top };
        };

        const clamped = (view: View): View => {
            const { width, height } = container.getBoundingClientRect();
            const scale = Math.min(MAX_SCALE, Math.max(1, view.scale));
            return {
                scale,
                x: Math.min(0, Math.max(width * (1 - scale), view.x)),
                y: Math.min(0, Math.max(height * (1 - scale), view.y)),
            };
        };

        // Called whenever the set of fingers changes, so a pinch that drops to one finger continues as a pan.
        const begin = (touches: TouchList) => {
            const start = viewRef.current;
            if (touches.length >= 2) {
                const first = local(touches[0]);
                const second = local(touches[1]);
                gesture = {
                    kind: "pinch", start,
                    startDistance: Math.hypot(second.x - first.x, second.y - first.y),
                    startMidpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
                };
            } else if (touches.length === 1 && start.scale > 1) {
                gesture = { kind: "pan", start, startPoint: local(touches[0]) };
            } else {
                gesture = null;
            }
        };

        const onTouchStart = (event: TouchEvent) => begin(event.touches);

        const onTouchMove = (event: TouchEvent) => {
            if (!gesture) {
                return;
            }
            event.preventDefault();
            const { start } = gesture;
            if (gesture.kind === "pinch" && event.touches.length >= 2) {
                const first = local(event.touches[0]);
                const second = local(event.touches[1]);
                const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
                const scale = start.scale * Math.hypot(second.x - first.x, second.y - first.y) / Math.max(1, gesture.startDistance);
                // Keep the cloud point that was under the starting midpoint under the current midpoint.
                const ratio = scale / start.scale;
                apply(clamped({
                    scale,
                    x: midpoint.x - (gesture.startMidpoint.x - start.x) * ratio,
                    y: midpoint.y - (gesture.startMidpoint.y - start.y) * ratio,
                }));
            } else if (gesture.kind === "pan" && event.touches.length === 1) {
                const point = local(event.touches[0]);
                apply(clamped({ scale: start.scale, x: start.x + point.x - gesture.startPoint.x,
                                y: start.y + point.y - gesture.startPoint.y }));
            }
        };

        const onTouchEnd = (event: TouchEvent) => {
            begin(event.touches);
            setZoomed(viewRef.current.scale > 1);
        };

        container.addEventListener("touchstart", onTouchStart, { passive: true });
        container.addEventListener("touchmove", onTouchMove, { passive: false });
        container.addEventListener("touchend", onTouchEnd);
        container.addEventListener("touchcancel", onTouchEnd);
        return () => {
            container.removeEventListener("touchstart", onTouchStart);
            container.removeEventListener("touchmove", onTouchMove);
            container.removeEventListener("touchend", onTouchEnd);
            container.removeEventListener("touchcancel", onTouchEnd);
        };
    }, [containerRef]);

    return { zoomed, reset };
}
