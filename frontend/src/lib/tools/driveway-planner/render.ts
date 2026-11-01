// Draws the plan in world meters. Shared by the interactive canvas and the PNG export.

import type { MultiPolygon } from 'polygon-clipping';
import { footprint, rearFromFront, type Car } from './cars';
import type { Pose, Vec } from './geometry';
import type { PlanImage } from './importPlan';
import type { Drive, Spline } from './spline';

export type LayerScene = {
	id: string;
	name: string;
	color: string;
	visible: boolean;
	union: boolean;
	car: Car;
	/** Front-axle poses. */
	start: Pose | null;
	end: Pose | null;
	spline: Spline | null;
	drive: Drive | null;
	pieces: Vec[][];
};

export type Scene = {
	plan: PlanImage | null;
	/** Meters per plan pixel. */
	mpp: number;
	area: Vec[];
	areaClosed: boolean;
	layers: LayerScene[];
	pathway: MultiPolygon | null;
};

export const colors = {
	area: '#10b981',
	pathway: 'rgba(100,116,139,0.42)',
	pathwayLine: '#334155',
	bad: '#dc2626',
	start: '#16a34a',
	end: '#1e293b'
};

/** `px` is the size of one screen pixel in meters, so strokes keep their screen width. */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, px: number) {
	ctx.lineJoin = ctx.lineCap = 'round';
	if (scene.plan) ctx.drawImage(scene.plan.source, 0, 0, scene.plan.width * scene.mpp, scene.plan.height * scene.mpp);

	if (scene.area.length) {
		path(ctx, scene.area, scene.areaClosed);
		if (scene.areaClosed) {
			ctx.fillStyle = 'rgba(16,185,129,0.08)';
			ctx.fill();
		}
		ctx.setLineDash([6 * px, 4 * px]);
		ctx.strokeStyle = colors.area;
		ctx.lineWidth = 2 * px;
		ctx.stroke();
		ctx.setLineDash([]);
	}

	// Pieces are convex and wound the same way, so one nonzero fill draws their union.
	const fillPieces = (pieces: Vec[][], style: string) => {
		ctx.beginPath();
		for (const p of pieces) addRing(ctx, p);
		ctx.fillStyle = style;
		ctx.fill('nonzero');
	};
	const visible = scene.layers.filter((l) => l.visible);
	for (const l of visible) if (!l.union) fillPieces(l.pieces, l.color + '22');
	fillPieces(
		visible.filter((l) => l.union).flatMap((l) => l.pieces),
		colors.pathway
	);
	if (scene.pathway) {
		ctx.beginPath();
		for (const poly of scene.pathway) for (const r of poly) addRing(ctx, r.map(([x, y]) => ({ x, y })));
		ctx.strokeStyle = colors.pathwayLine;
		ctx.lineWidth = 1.5 * px;
		ctx.stroke();
	}

	for (const l of visible) {
		if (l.drive) {
			ctx.setLineDash([5 * px, 4 * px]);
			ctx.strokeStyle = l.color;
			ctx.lineWidth = 1.5 * px;
			path(ctx, l.drive.poses, false);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.lineWidth = 2.5 * px;
			path(ctx, l.drive.front, false);
			ctx.stroke();
			// Problem stretches on top.
			ctx.strokeStyle = colors.bad;
			ctx.lineWidth = 4 * px;
			ctx.beginPath();
			l.drive.front.forEach((f, i) => {
				if (!l.drive!.bad[i]) return;
				const prev = l.drive!.front[Math.max(0, i - 1)];
				ctx.moveTo(prev.x, prev.y);
				ctx.lineTo(f.x, f.y);
			});
			ctx.stroke();
		}
		if (l.start) marker(ctx, l.car, l.start, colors.start, px);
		if (l.end) marker(ctx, l.car, l.end, colors.end, px);
	}
}

/** Car outline at a front-axle pose plus an arrow along its heading. */
export function marker(ctx: CanvasRenderingContext2D, car: Car, f: Pose, color: string, px: number) {
	path(ctx, footprint(car, 0, rearFromFront(car, f)), true);
	ctx.fillStyle = color + '14';
	ctx.fill();
	ctx.strokeStyle = color;
	ctx.lineWidth = 1.5 * px;
	ctx.stroke();
	const c = Math.cos(f.th);
	const s = Math.sin(f.th);
	const len = 22 * px;
	ctx.beginPath();
	ctx.moveTo(f.x, f.y);
	ctx.lineTo(f.x + c * len, f.y + s * len);
	ctx.moveTo(f.x + c * len - (c * 7 - s * 5) * px, f.y + s * len - (s * 7 + c * 5) * px);
	ctx.lineTo(f.x + c * len, f.y + s * len);
	ctx.lineTo(f.x + c * len - (c * 7 + s * 5) * px, f.y + s * len - (s * 7 - c * 5) * px);
	ctx.lineWidth = 2.5 * px;
	ctx.stroke();
	ctx.beginPath();
	ctx.arc(f.x, f.y, 5 * px, 0, Math.PI * 2);
	ctx.fillStyle = color;
	ctx.fill();
	ctx.strokeStyle = '#fff';
	ctx.lineWidth = 1.5 * px;
	ctx.stroke();
}

/** The car seen from above at a rear-axle pose, front wheels turned by `steer`. */
export function drawCar(ctx: CanvasRenderingContext2D, car: Car, p: Pose, steer: number, color: string, px: number) {
	ctx.save();
	ctx.translate(p.x, p.y);
	ctx.rotate(p.th);
	const rear = -(car.length - car.wheelbase - car.frontOverhang);
	const bodyWidth = car.width - 0.22;
	ctx.fillStyle = '#1e293b';
	const wheel = (x: number, y: number, a: number) => {
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(a);
		ctx.fillRect(-0.34, -0.12, 0.68, 0.24);
		ctx.restore();
	};
	for (const side of [-1, 1]) {
		wheel(0, (side * car.track) / 2, 0);
		wheel(car.wheelbase, (side * car.track) / 2, steer);
	}
	ctx.beginPath();
	ctx.roundRect(rear, -bodyWidth / 2, car.length, bodyWidth, 0.35);
	ctx.fillStyle = color + 'cc';
	ctx.fill();
	ctx.strokeStyle = '#fff';
	ctx.lineWidth = 1.5 * px;
	ctx.stroke();
	// Mirrors and windscreen, so the direction is obvious.
	ctx.fillStyle = color;
	ctx.fillRect(car.wheelbase - 0.75, -car.width / 2, 0.14, car.width);
	ctx.fillStyle = 'rgba(255,255,255,0.75)';
	ctx.fillRect(car.wheelbase - 0.55, -bodyWidth / 2 + 0.15, 0.35, bodyWidth - 0.3);
	ctx.restore();
}

export function path(ctx: CanvasRenderingContext2D, pts: Vec[], closed: boolean) {
	ctx.beginPath();
	pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
	if (closed) ctx.closePath();
}

function addRing(ctx: CanvasRenderingContext2D, pts: Vec[]) {
	pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
	ctx.closePath();
}

/** World bounds of everything worth exporting or fitting into view. */
export function sceneBounds(scene: Scene) {
	let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
	const add = (p: Vec) => {
		x0 = Math.min(x0, p.x);
		y0 = Math.min(y0, p.y);
		x1 = Math.max(x1, p.x);
		y1 = Math.max(y1, p.y);
	};
	if (scene.plan) {
		add({ x: 0, y: 0 });
		add({ x: scene.plan.width * scene.mpp, y: scene.plan.height * scene.mpp });
	}
	scene.area.forEach(add);
	for (const l of scene.layers) {
		for (const piece of l.pieces) piece.forEach(add);
		for (const m of [l.start, l.end]) if (m) footprint(l.car, 0, rearFromFront(l.car, m)).forEach(add);
	}
	return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}
