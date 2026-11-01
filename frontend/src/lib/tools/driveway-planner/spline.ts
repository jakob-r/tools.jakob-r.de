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

/** How closely a route has to pass its via point (front axle; meters, radians). */
export const VIA_TOLERANCE = { pos: 0.4, th: (20 * Math.PI) / 180 };

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
export function drive(
	car: Car,
	buffer: number,
	area: Vec[],
	s: Spline,
	startTh: number,
	endTh: number,
	via: Pose | null = null
): Drive {
	const samples = evaluate(s);
	const L = car.wheelbase;
	// 2° of slack: the spline only approximates arcs, and turning-circle figures are rounded.
	const maxSteer = ((car.maxSteerDeg + 2) * Math.PI) / 180;
	const front = samples.map((s) => s.p);
	const gears = samples.map((s) => s.gear);
	const n = samples.length;
	// Heading after moving the front axle from a to b; θ' = (Ḟ · n) / L with n the heading
	// normal, midpoint rule.
	const move = (h: number, a: Vec, b: Vec) => {
		const dTh = (h: number) => (-(b.x - a.x) * Math.sin(h) + (b.y - a.y) * Math.cos(h)) / L;
		return h + dTh(h + dTh(h) / 2);
	};
	// Reversing, the rear axle is pushed like a trailer: integrated forward, any small error in
	// the spline doubles about every 1.2 wheelbases and the car seems to swerve off. Integrated
	// backward from where the run ends it is stable, so reverse runs are driven that way: the
	// final run from the end direction, one ending in a gear change from the heading there that
	// fits the start of the run best. What is left at the start is steered out within about a
	// wheelbase.
	const ths = [startTh];
	let reverseOff = 0;
	for (let a = 0; a < n - 1; ) {
		let b = a + 1;
		while (b + 1 < n && gears[b + 1] === gears[a + 1]) b++;
		if (gears[a + 1] > 0) for (let i = a + 1; i <= b; i++) ths[i] = move(ths[i - 1], front[i - 1], front[i]);
		else {
			const back: number[] = [];
			const backFrom = (end: number) => {
				back[b] = end;
				for (let i = b; i > a; i--) back[i - 1] = move(back[i], front[i], front[i - 1]);
				return wrap(back[a] - ths[a]);
			};
			if (b === n - 1) backFrom(endTh);
			else {
				// At the gear change the front wheels point at most the steering limit off the
				// heading. Within that the start heading grows with the end heading: bisect.
				const t = Math.atan2(front[b - 1].y - front[b].y, front[b - 1].x - front[b].x);
				let [lo, hi] = [t - maxSteer, t + maxSteer];
				for (let k = 0; k < 24; k++) {
					const mid = (lo + hi) / 2;
					if (backFrom(mid) < 0) lo = mid;
					else hi = mid;
				}
				backFrom((lo + hi) / 2);
			}
			const off = wrap(ths[a] - back[a]);
			reverseOff = Math.max(reverseOff, Math.abs(off));
			let s = 0;
			for (let i = a + 1; i <= b; i++) {
				s += dist(front[i], front[i - 1]);
				ths[i] = ths[a] - off + (back[i] - back[a]) + off * Math.exp(-s / L);
			}
		}
		a = b;
	}
	const poses: Pose[] = ths.map((th, i) => ({ x: front[i].x - L * Math.cos(th), y: front[i].y - L * Math.sin(th), th }));
	const steer = ths.map((th, i) => {
		if (i === 0) return 0;
		const dx = front[i].x - front[i - 1].x;
		const dy = front[i].y - front[i - 1].y;
		const mid = ths[i - 1] + wrap(th - ths[i - 1]) / 2;
		const along = dx * Math.cos(mid) + dy * Math.sin(mid);
		const across = -dx * Math.sin(mid) + dy * Math.cos(mid);
		return Math.atan2(across, Math.abs(along)) * (along < 0 ? -1 : 1);
	});
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
	const off = Math.abs(wrap(ths[n - 1] - endTh)) * (180 / Math.PI);
	if (off > 5) problems.push(`Ends ${Math.round(off)}° off the end direction`);
	const jump = reverseOff * (180 / Math.PI);
	if (jump > 5) problems.push(`Starts reversing ${Math.round(jump)}° off the path`);
	// A little more slack than the planner gets, for the spline fitted to its result.
	if (
		via &&
		!front.some(
			(f, i) =>
				dist(f, via) < VIA_TOLERANCE.pos * 1.5 && Math.abs(wrap(poses[i].th - via.th)) < VIA_TOLERANCE.th * 1.5
		)
	)
		problems.push('Does not pass the via point in its direction');
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

/** One spline driving `a` and then `b` (which starts where `a` ends). The joint stays a control point. */
export function joinSplines(a: Spline, b: Spline): Spline {
	const j = a.pts.length - 1;
	const shift = b.cusps.map((c) => c + j);
	const gearChange = a.gears[a.gears.length - 1] !== b.gears[0];
	return {
		pts: [...a.pts, ...b.pts.slice(1)],
		cusps: [...a.cusps, ...(gearChange ? [j] : []), ...shift],
		gears: [...a.gears, ...(gearChange ? b.gears : b.gears.slice(1))]
	};
}
