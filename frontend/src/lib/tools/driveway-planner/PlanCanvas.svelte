<script lang="ts" module>
	export type Mode = 'select' | 'area' | 'ruler' | MarkerKind;
	export type Playback = { pose: Pose; steer: number; car: Car; color: string };
	import type { MarkerKind } from './render';
</script>

<script lang="ts">
	import type { Car } from './cars';
	import { dist, segmentDistance, type Pose, type Vec } from './geometry';
	import { drawCar, drawScene, path, sceneBounds, type LayerScene, type Scene } from './render';
	import { insertPoint, removePoint, type Spline } from './spline';

	let {
		scene,
		active,
		mode = $bindable(),
		ruler = $bindable(),
		playback,
		dragging = $bindable(false),
		onarea,
		onmarker,
		onspline
	}: {
		scene: Scene;
		active: LayerScene | null;
		mode: Mode;
		ruler: [Vec, Vec] | null;
		playback: Playback | null;
		dragging?: boolean;
		onarea: (pts: Vec[], closed: boolean) => void;
		/** `placing` is true while a marker is being put down in its own mode, false when it is dragged. */
		onmarker: (which: MarkerKind, pose: Pose, placing: boolean) => void;
		onspline: (s: Spline) => void;
	} = $props();

	type View = { s: number; ox: number; oy: number };
	type Drag =
		| { kind: 'pan'; x: number; y: number; ox: number; oy: number }
		| { kind: 'marker'; which: MarkerKind; turn: boolean }
		| { kind: 'spline'; i: number }
		| { kind: 'area'; i: number }
		| { kind: 'ruler' }
		| { kind: 'place'; which: MarkerKind; at: Vec };

	let canvas: HTMLCanvasElement;
	let width = $state(0);
	let height = $state(0);
	let view = $state<View | null>(null);
	let selected = $state<{ kind: 'spline' | 'area'; i: number } | null>(null);
	let draft = $state<Vec[]>([]);
	let pointer = $state<Vec | null>(null);
	let hoverKind = $state<string>('');
	let drag: Drag | null = null;

	const HANDLE = 22;
	const HIT = 8;

	export function fit() {
		if (!width || !height) return;
		const b = sceneBounds(scene) ?? { x0: 0, y0: 0, x1: 20, y1: 15 };
		const w = Math.max(1, b.x1 - b.x0);
		const h = Math.max(1, b.y1 - b.y0);
		const s = Math.min((width - 40) / w, (height - 40) / h);
		view = { s, ox: width / 2 - ((b.x0 + b.x1) / 2) * s, oy: height / 2 - ((b.y0 + b.y1) / 2) * s };
	}

	$effect(() => {
		if (!view && width && height) fit();
	});

	$effect(() => {
		// Leaving area mode drops an unfinished outline.
		if (mode !== 'area') draft = [];
	});

	const toWorld = (e: MouseEvent): Vec => {
		const r = canvas.getBoundingClientRect();
		return { x: (e.clientX - r.left - view!.ox) / view!.s, y: (e.clientY - r.top - view!.oy) / view!.s };
	};

	const markers = ['start', 'via', 'end'] as const;
	function markerOf(which: MarkerKind) {
		return active?.[which] ?? null;
	}
	const tip = (m: Pose, s: number): Vec => ({ x: m.x + (Math.cos(m.th) * HANDLE) / s, y: m.y + (Math.sin(m.th) * HANDLE) / s });

	/** What a select-mode press at `w` would grab. */
	function hit(w: Vec): Drag | { kind: 'none' } {
		const tol = HIT / view!.s;
		for (const which of markers) {
			const m = markerOf(which);
			if (m && dist(w, tip(m, view!.s)) < tol) return { kind: 'marker', which, turn: true };
		}
		for (const which of markers) {
			const m = markerOf(which);
			if (m && dist(w, m) < tol * 1.3) return { kind: 'marker', which, turn: false };
		}
		const pts = active?.spline?.pts ?? [];
		for (let i = 1; i < pts.length - 1; i++) if (dist(w, pts[i]) < tol) return { kind: 'spline', i };
		return { kind: 'none' };
	}

	/** Area corner under `w` (area mode, once the outline is closed), or -1. */
	function hitArea(w: Vec) {
		if (!scene.areaClosed) return -1;
		return scene.area.findIndex((p) => dist(w, p) < HIT / view!.s);
	}

	function pointerdown(e: PointerEvent) {
		if (!view) return;
		canvas.setPointerCapture(e.pointerId);
		const w = toWorld(e);
		const pan = (): Drag => ({ kind: 'pan', x: e.clientX, y: e.clientY, ox: view!.ox, oy: view!.oy });
		if (e.button === 1) drag = pan();
		else if (mode === 'area' && scene.areaClosed) {
			// The outline stays and is edited in place.
			const i = hitArea(w);
			selected = i >= 0 ? { kind: 'area', i } : null;
			drag = i >= 0 ? { kind: 'area', i } : pan();
		} else if (mode === 'area') {
			if (draft.length >= 3 && dist(w, draft[0]) < (HIT * 1.5) / view.s) finishArea();
			else draft = [...draft, w];
		} else if (mode === 'ruler') {
			ruler = [w, w];
			drag = { kind: 'ruler' };
		} else if (mode === 'start' || mode === 'via' || mode === 'end') {
			// NaN: no direction yet, the tool picks a sensible one unless the user drags.
			onmarker(mode, { x: w.x, y: w.y, th: markerOf(mode)?.th ?? NaN }, true);
			drag = { kind: 'place', which: mode, at: w };
		} else {
			const h = hit(w);
			selected = h.kind === 'spline' ? { kind: h.kind, i: h.i } : null;
			drag = h.kind === 'none' ? pan() : h;
		}
		dragging = drag !== null && drag.kind !== 'pan';
	}

	function pointermove(e: PointerEvent) {
		if (!view) return;
		const w = toWorld(e);
		pointer = w;
		if (!drag) {
			hoverKind = mode === 'select' ? hit(w).kind : mode === 'area' && hitArea(w) >= 0 ? 'area' : '';
			return;
		}
		switch (drag.kind) {
			case 'pan':
				view = { ...view, ox: drag.ox + e.clientX - drag.x, oy: drag.oy + e.clientY - drag.y };
				break;
			case 'marker': {
				const m = markerOf(drag.which);
				if (!m) break;
				onmarker(drag.which, drag.turn ? { ...m, th: Math.atan2(w.y - m.y, w.x - m.x) } : { ...m, x: w.x, y: w.y }, false);
				break;
			}
			case 'place':
				if (dist(w, drag.at) > HIT / view.s)
					onmarker(drag.which, { ...drag.at, th: Math.atan2(w.y - drag.at.y, w.x - drag.at.x) }, true);
				break;
			case 'spline': {
				const s = active?.spline;
				if (s) onspline({ ...s, pts: s.pts.map((p, i) => (i === (drag as { i: number }).i ? w : p)) });
				break;
			}
			case 'area':
				onarea(
					scene.area.map((p, i) => (i === (drag as { i: number }).i ? w : p)),
					true
				);
				break;
			case 'ruler':
				if (ruler) ruler = [ruler[0], w];
				break;
		}
	}

	function pointerup() {
		if (drag?.kind === 'place') mode = 'select';
		drag = null;
		dragging = false;
	}

	function dblclick(e: MouseEvent) {
		if (!view) return;
		const w = toWorld(e);
		const tol = HIT / view.s;
		const s = active?.spline;
		if (mode === 'select' && s) {
			const near = nearestSpan(s.pts, w, false);
			if (near && near.d < tol) {
				onspline(insertPoint(s, near.i, w));
				selected = { kind: 'spline', i: near.i + 1 };
				return;
			}
		}
		if (mode === 'area' && scene.areaClosed) {
			const near = nearestSpan(scene.area, w, true);
			if (near && near.d < tol) {
				onarea([...scene.area.slice(0, near.i + 1), w, ...scene.area.slice(near.i + 1)], true);
				selected = { kind: 'area', i: near.i + 1 };
			}
		}
	}

	function nearestSpan(pts: Vec[], w: Vec, closed: boolean) {
		let best: { i: number; d: number } | null = null;
		const n = closed ? pts.length : pts.length - 1;
		for (let i = 0; i < n; i++) {
			const { d } = segmentDistance(w, pts[i], pts[(i + 1) % pts.length]);
			if (!best || d < best.d) best = { i, d };
		}
		return best;
	}

	function finishArea() {
		if (draft.length >= 3) onarea(draft, true);
		draft = [];
		mode = 'select';
	}

	function keydown(e: KeyboardEvent) {
		const t = e.target as HTMLElement;
		if (t.closest('input, select, textarea, [contenteditable]')) return;
		if (draft.length && e.key === 'Enter') finishArea();
		else if (e.key === 'Escape') {
			if (draft.length) finishArea();
			else mode = 'select';
			selected = null;
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
			e.preventDefault();
			if (selected.kind === 'area' && scene.area.length > 3)
				onarea(
					scene.area.filter((_, i) => i !== selected!.i),
					true
				);
			else if (selected.kind === 'spline' && active?.spline) onspline(removePoint(active.spline, selected.i));
			selected = null;
		}
	}

	function wheel(e: WheelEvent) {
		if (!view) return;
		e.preventDefault();
		const r = canvas.getBoundingClientRect();
		const mx = e.clientX - r.left;
		const my = e.clientY - r.top;
		const f = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015));
		const s = Math.min(2000, Math.max(0.5, view.s * f));
		const k = s / view.s;
		view = { s, ox: mx - (mx - view.ox) * k, oy: my - (my - view.oy) * k };
	}

	$effect(() => draw());

	function draw() {
		const v = view;
		if (!canvas || !v || !width) return;
		const dpr = devicePixelRatio || 1;
		canvas.width = width * dpr;
		canvas.height = height * dpr;
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = '#f8fafc';
		ctx.fillRect(0, 0, width, height);
		ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.ox, dpr * v.oy);
		const px = 1 / v.s;
		if (!scene.plan) grid(ctx, v);
		drawScene(ctx, scene, px);

		if (draft.length) {
			path(ctx, pointer && mode === 'area' ? [...draft, pointer] : draft, false);
			ctx.strokeStyle = '#10b981';
			ctx.lineWidth = 2 * px;
			ctx.stroke();
			draft.forEach((p, i) => handle(ctx, p, px, i === 0 && draft.length >= 3 ? '#10b981' : '#fff', '#10b981', 'square'));
		}
		if (mode === 'area' && scene.areaClosed)
			scene.area.forEach((p, i) =>
				handle(ctx, p, px, selected?.kind === 'area' && selected.i === i ? '#10b981' : '#fff', '#10b981', 'square')
			);
		if (active?.visible && active.spline)
			active.spline.pts.forEach((p, i) => {
				if (i === 0 || i === active.spline!.pts.length - 1) return;
				const sel = selected?.kind === 'spline' && selected.i === i;
				handle(ctx, p, px, sel ? active.color : '#fff', active.color, active.spline!.cusps.includes(i) ? 'diamond' : 'circle');
			});
		if (active?.visible)
			for (const m of [active.start, active.via, active.end])
				if (m) handle(ctx, tip(m, v.s), px, '#fff', '#334155', 'circle');
		if (ruler) {
			ctx.beginPath();
			ctx.moveTo(ruler[0].x, ruler[0].y);
			ctx.lineTo(ruler[1].x, ruler[1].y);
			ctx.strokeStyle = '#db2777';
			ctx.lineWidth = 2 * px;
			ctx.stroke();
			for (const p of ruler) handle(ctx, p, px, '#db2777', '#fff', 'circle');
		}
		if (playback) drawCar(ctx, playback.car, playback.pose, playback.steer, playback.color, px);

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		scaleBar(ctx, v);
	}

	function handle(ctx: CanvasRenderingContext2D, p: Vec, px: number, fill: string, stroke: string, shape: 'circle' | 'square' | 'diamond') {
		const r = 4.5 * px;
		ctx.beginPath();
		if (shape === 'circle') ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
		else if (shape === 'square') ctx.rect(p.x - r, p.y - r, 2 * r, 2 * r);
		else {
			ctx.moveTo(p.x, p.y - r * 1.4);
			ctx.lineTo(p.x + r * 1.4, p.y);
			ctx.lineTo(p.x, p.y + r * 1.4);
			ctx.lineTo(p.x - r * 1.4, p.y);
			ctx.closePath();
		}
		ctx.fillStyle = fill;
		ctx.fill();
		ctx.strokeStyle = stroke;
		ctx.lineWidth = 1.5 * px;
		ctx.stroke();
	}

	/** One-meter grid when there is no plan to orient by. */
	function grid(ctx: CanvasRenderingContext2D, v: View) {
		const step = v.s > 15 ? 1 : 5;
		const x0 = Math.floor(-v.ox / v.s / step) * step;
		const y0 = Math.floor(-v.oy / v.s / step) * step;
		const x1 = (width - v.ox) / v.s;
		const y1 = (height - v.oy) / v.s;
		ctx.beginPath();
		for (let x = x0; x <= x1; x += step) {
			ctx.moveTo(x, y0);
			ctx.lineTo(x, y1);
		}
		for (let y = y0; y <= y1; y += step) {
			ctx.moveTo(x0, y);
			ctx.lineTo(x1, y);
		}
		ctx.strokeStyle = '#e2e8f0';
		ctx.lineWidth = 1 / v.s;
		ctx.stroke();
	}

	function scaleBar(ctx: CanvasRenderingContext2D, v: View) {
		const target = 100 / v.s;
		const unit = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].find((u) => u >= target) ?? 100;
		const len = unit * v.s;
		const x = 12;
		const y = height - 14;
		ctx.fillStyle = 'rgba(255,255,255,0.8)';
		ctx.fillRect(x - 4, y - 16, len + 8, 22);
		ctx.strokeStyle = '#334155';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(x, y - 4);
		ctx.lineTo(x, y);
		ctx.lineTo(x + len, y);
		ctx.lineTo(x + len, y - 4);
		ctx.stroke();
		ctx.fillStyle = '#334155';
		ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
		ctx.fillText(unit < 1 ? `${unit * 100} cm` : `${unit} m`, x + 2, y - 6);
	}

	const cursor = $derived(
		hoverKind === 'marker' || hoverKind === 'spline' || hoverKind === 'area'
			? 'move'
			: mode === 'select' || (mode === 'area' && scene.areaClosed)
				? 'grab'
				: 'crosshair'
	);
</script>

<svelte:window onkeydown={keydown} />

<div class="relative min-h-0 flex-1" bind:clientWidth={width} bind:clientHeight={height}>
	<canvas
		bind:this={canvas}
		class="absolute inset-0 size-full touch-none select-none"
		style="cursor: {cursor}"
		onpointerdown={pointerdown}
		onpointermove={pointermove}
		onpointerup={pointerup}
		onpointercancel={pointerup}
		onpointerleave={() => (pointer = null)}
		ondblclick={dblclick}
		onwheel={wheel}
		oncontextmenu={(e) => e.preventDefault()}
	></canvas>
</div>
