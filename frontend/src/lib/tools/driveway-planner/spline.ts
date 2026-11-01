// The editable path is a spline through front-axle positions. Gear changes split it into segments
// (a cusp point is shared by both). The rear axle is not edited: it follows the front axle like a
// trailer (tractrix), so every spline describes exactly one drive that can then be checked.

import { footprint, frontAxle, type Car } from './cars';
import { dist, shapeInside, wrap, type Pose, type Vec } from './geometry';

export type Spline = {
	pts: Vec[];
	/** Indices of cusp points (gear changes), ascending, never the first or last point. */
	cusps: number[];
	/** Gear per segment: +1 forward, -1 reverse. Length = cusps.length + 1. */
	gears: number[];
};

export type Drive = {
	/** Rear-axle poses. */
	poses: Pose[];
	front: Vec[];
	gears: number[];
	/** Steering angle (radians) used to reach each sample. */
	steer: number[];
	bad: boolean[];
	problems: string[];
};

const EVAL_STEP = 0.03;

/**
 * Editable spline for a planned path (rear-axle poses with gears). Starts with few points and
 * only adds more where needed, until driving the spline passes the same checks as the plan.
 */
export function fitDrivable(car: Car, buffer: number, area: Vec[], poses: Pose[], gears: number[], endTh: number) {
	let s = fitSpline(car, poses, gears, 0.6);
	for (const spacing of [0.4, 0.25, 0.15]) {
		if (!drive(car, buffer, area, s, poses[0].th, endTh).problems.length) break;
		s = fitSpline(car, poses, gears, spacing);
	}
	return s;
}

/** Control points from a planned path, evenly spaced per gear segment. */
export function fitSpline(car: Car, poses: Pose[], gears: number[], spacing: number): Spline {
	const front = poses.map((p) => frontAxle(car, p));
	const pts: Vec[] = [front[0]];
	const cusps: number[] = [];
	const segGears: number[] = [];
	let a = 0;
	for (let i = 1; i < front.length; i++) {
		const last = i === front.length - 1;
		if (!last && gears[i + 1] === gears[i]) continue;
		const run = front.slice(a, i + 1);
		const cum = [0];
		for (let k = 1; k < run.length; k++) cum.push(cum[k - 1] + dist(run[k], run[k - 1]));
		const total = cum[cum.length - 1];
		if (total > 0.02) {
			const n = Math.max(1, Math.round(total / spacing));
			let k = 0;
			for (let j = 1; j < n; j++) {
				const target = (total * j) / n;
				while (cum[k + 1] < target) k++;
				const w = (target - cum[k]) / (cum[k + 1] - cum[k] || 1);
				pts.push({ x: run[k].x + (run[k + 1].x - run[k].x) * w, y: run[k].y + (run[k + 1].y - run[k].y) * w });
			}
			pts.push(run[run.length - 1]);
			segGears.push(gears[i]);
			if (!last) cusps.push(pts.length - 1);
		}
		a = i;
	}
	if (!segGears.length) segGears.push(gears[0] ?? 1);
	// A trailing cusp without a segment after it is no cusp.
	if (cusps.length >= segGears.length) cusps.pop();
	return { pts, cusps, gears: segGears };
}

export function segments(s: Spline) {
	const bounds = [0, ...s.cusps, s.pts.length - 1];
	return s.gears.map((gear, i) => ({ gear, pts: s.pts.slice(bounds[i], bounds[i + 1] + 1) }));
}

/** Dense points along the spline (centripetal Catmull-Rom per segment) with their gear. */
export function evaluate(s: Spline): { p: Vec; gear: number }[] {
	const out: { p: Vec; gear: number }[] = [{ p: s.pts[0], gear: s.gears[0] }];
	for (const { gear, pts } of segments(s)) {
		const n = pts.length;
		for (let i = 0; i < n - 1; i++) {
			const p1 = pts[i];
			const p2 = pts[i + 1];
			const p0 = i > 0 ? pts[i - 1] : phantom(pts[0], pts[1], pts[2]);
			const p3 = i + 2 < n ? pts[i + 2] : phantom(pts[n - 1], pts[n - 2], pts[n - 3]);
			const steps = Math.max(1, Math.ceil(dist(p1, p2) / EVAL_STEP));
			for (let k = 1; k <= steps; k++) out.push({ p: catmullRom(p0, p1, p2, p3, k / steps), gear });
		}
	}
	return out;
}

/** Extra point beyond an end that keeps the end's curvature (a plain mirror would straighten it). */
function phantom(a: Vec, b: Vec, c: Vec | undefined): Vec {
	const mirror = { x: 2 * a.x - b.x, y: 2 * a.y - b.y };
	if (!c) return mirror;
	// Continue along the circle through c, b, a by the length of the last chord.
	const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
	if (Math.abs(d) < 1e-9) return mirror;
	const a2 = a.x * a.x + a.y * a.y;
	const b2 = b.x * b.x + b.y * b.y;
	const c2 = c.x * c.x + c.y * c.y;
	const o = {
		x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
		y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
	};
	if (dist(o, a) > 1e3) return mirror;
	const step = Math.atan2(a.y - o.y, a.x - o.x) - Math.atan2(b.y - o.y, b.x - o.x);
	const ang = Math.atan2(a.y - o.y, a.x - o.x) + Math.atan2(Math.sin(step), Math.cos(step));
	const r = dist(o, a);
	return { x: o.x + r * Math.cos(ang), y: o.y + r * Math.sin(ang) };
}

function catmullRom(p0: Vec, p1: Vec, p2: Vec, p3: Vec, u: number): Vec {
	const knot = (a: Vec, b: Vec) => Math.max(1e-6, Math.sqrt(dist(a, b)));
	const t1 = knot(p0, p1);
	const t2 = t1 + knot(p1, p2);
	const t3 = t2 + knot(p2, p3);
	const t = t1 + (t2 - t1) * u;
	const lerp = (a: Vec, b: Vec, ta: number, tb: number): Vec => {
		const w = (t - ta) / (tb - ta);
		return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
	};
	const a1 = lerp(p0, p1, 0, t1);
	const a2 = lerp(p1, p2, t1, t2);
	const a3 = lerp(p2, p3, t2, t3);
	const b1 = lerp(a1, a2, 0, t2);
	const b2 = lerp(a2, a3, t1, t3);
	return lerp(b1, b2, t1, t2);
}

/**
 * Drive the spline: integrate the rear axle from the start heading and check steering, the area
 * and the final heading.
 */
export function drive(car: Car, buffer: number, area: Vec[], s: Spline, startTh: number, endTh: number): Drive {
	const samples = evaluate(s);
	const L = car.wheelbase;
	// 2° of slack: the spline only approximates arcs, and turning-circle figures are rounded.
	const maxSteer = ((car.maxSteerDeg + 2) * Math.PI) / 180;
	let th = startTh;
	const poses: Pose[] = [];
	const steer: number[] = [];
	const front: Vec[] = [];
	const gears: number[] = [];
	for (let i = 0; i < samples.length; i++) {
		const f = samples[i].p;
		let delta = 0;
		if (i > 0) {
			const dx = f.x - samples[i - 1].p.x;
			const dy = f.y - samples[i - 1].p.y;
			// θ' = (Ḟ · n) / L with n the heading normal; midpoint rule.
			const dTh = (h: number) => (-dx * Math.sin(h) + dy * Math.cos(h)) / L;
			const mid = th + dTh(th) / 2;
			const along = dx * Math.cos(mid) + dy * Math.sin(mid);
			const across = -dx * Math.sin(mid) + dy * Math.cos(mid);
			delta = Math.atan2(across, Math.abs(along)) * (along < 0 ? -1 : 1);
			th += dTh(mid);
		}
		front.push(f);
		poses.push({ x: f.x - L * Math.cos(th), y: f.y - L * Math.sin(th), th });
		steer.push(delta);
		gears.push(samples[i].gear);
	}
	steer[0] = steer[1] ?? 0;

	const bounded = area.length >= 3;
	let tooSharp = 0;
	let outside = 0;
	// Right next to a gear change the car stands still while steering, so the spline's end
	// direction there says little about the steering angle.
	const nearSwitch = (i: number) => gears.slice(Math.max(0, i - 2), i + 3).some((g) => g !== gears[i]);
	const bad = poses.map((p, i) => {
		const sharp = Math.abs(steer[i]) > maxSteer && !nearSwitch(i);
		const out = bounded && !shapeInside(footprint(car, buffer, p), area);
		if (sharp) tooSharp++;
		if (out) outside++;
		return sharp || out;
	});
	const problems: string[] = [];
	if (tooSharp) problems.push(`Needs more than ${car.maxSteerDeg}° of steering`);
	if (outside) problems.push('The car leaves the area');
	const off = Math.abs(wrap(th - endTh)) * (180 / Math.PI);
	if (off > 5) problems.push(`Ends ${Math.round(off)}° off the end direction`);
	return { poses, front, gears, steer, bad, problems };
}

/** Index of the control point nearest to p within `tol`, or -1. */
export function nearestPoint(s: Spline, p: Vec, tol: number) {
	let best = -1;
	let bestD = tol;
	s.pts.forEach((q, i) => {
		const d = dist(p, q);
		if (d < bestD) [best, bestD] = [i, d];
	});
	return best;
}

export function insertPoint(s: Spline, after: number, p: Vec): Spline {
	const pts = [...s.pts.slice(0, after + 1), p, ...s.pts.slice(after + 1)];
	return { pts, cusps: s.cusps.map((c) => (c > after ? c + 1 : c)), gears: s.gears };
}

export function removePoint(s: Spline, i: number): Spline {
	if (i <= 0 || i >= s.pts.length - 1) return s;
	const ci = s.cusps.indexOf(i);
	const gears = ci < 0 ? s.gears : s.gears.filter((_, k) => k !== ci + 1);
	return {
		pts: s.pts.filter((_, k) => k !== i),
		cusps: s.cusps.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c)),
		gears
	};
}
