// Hybrid A*: searches over rear-axle poses with short circular arcs (forward and reverse), so the
// result is drivable by construction. Gear changes are allowed but cost extra, which is what makes
// K-turns appear only when they are needed. Near the goal it tries to finish with a Reeds-Shepp path.

import { footprint, minRadius, type Car } from './cars';
import { pointInPolygon, shapeInside, wrap, type Pose, type Vec } from './geometry';
import { arc, rsDistance, rsPaths, sampleRs, type RsPath } from './reedsShepp';

export type PlanInput = {
	car: Car;
	buffer: number;
	area: Vec[];
	start: Pose;
	goal: Pose;
	/** How the two ends are called in messages. */
	names?: [string, string];
};
export type PlanResult = { ok: true; poses: Pose[]; gears: number[]; expanded: number } | { ok: false; error: string };

const HEADINGS = 72;
const SAMPLE = 0.1;
const REVERSE_COST = 1.5;
const SWITCH_COST = 5;
const STEER_COST = 0.15;
const WEIGHT = 1.3;
const MAX_EXPANSIONS = 250_000;
const MARGIN = 0.05;
/** Shortest stretch between gear changes worth doing in the final maneuver. */
const MIN_RUN = 0.6;
const STEER_USE = 0.88;

/** Binary min-heap of ids keyed by a score array. */
class Heap {
	private items: number[] = [];
	private key: (id: number) => number;
	constructor(key: (id: number) => number) {
		this.key = key;
	}
	get size() {
		return this.items.length;
	}
	push(id: number) {
		const a = this.items;
		a.push(id);
		let i = a.length - 1;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (this.key(a[p]) <= this.key(a[i])) break;
			[a[p], a[i]] = [a[i], a[p]];
			i = p;
		}
	}
	pop() {
		const a = this.items;
		const top = a[0];
		const last = a.pop()!;
		if (a.length) {
			a[0] = last;
			let i = 0;
			for (;;) {
				const l = 2 * i + 1;
				const r = l + 1;
				let m = i;
				if (l < a.length && this.key(a[l]) < this.key(a[m])) m = l;
				if (r < a.length && this.key(a[r]) < this.key(a[m])) m = r;
				if (m === i) break;
				[a[m], a[i]] = [a[i], a[m]];
				i = m;
			}
		}
		return top;
	}
}

export function plan({ car, buffer, area, start, goal, names = ['start', 'end'] }: PlanInput): PlanResult {
	const bounded = area.length >= 3;
	// A little slack in steering and clearance, so the editable spline fitted to the result
	// (which only approximates it) still passes the same checks.
	const free = (p: Pose) => !bounded || shapeInside(footprint(car, buffer + MARGIN, p), area);
	if (!free(start)) return { ok: false, error: `The car does not fit inside the area at the ${names[0]}.` };
	if (!free(goal)) return { ok: false, error: `The car does not fit inside the area at the ${names[1]}.` };

	const R = minRadius({ ...car, maxSteerDeg: car.maxSteerDeg * STEER_USE });
	const kMax = 1 / R;

	// Grid over the area (or around start and goal when no area is drawn).
	let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const p of bounded ? area : [start, goal]) {
		x0 = Math.min(x0, p.x);
		y0 = Math.min(y0, p.y);
		x1 = Math.max(x1, p.x);
		y1 = Math.max(y1, p.y);
	}
	if (!bounded) {
		const m = 3 * R + car.length;
		[x0, y0, x1, y1] = [x0 - m, y0 - m, x1 + m, y1 + m];
	}
	const cell = Math.max(0.25, Math.max(x1 - x0, y1 - y0) / 300);
	const nx = Math.ceil((x1 - x0) / cell) + 1;
	const ny = Math.ceil((y1 - y0) / cell) + 1;
	const cellOf = (p: Vec) => {
		const ix = Math.floor((p.x - x0) / cell);
		const iy = Math.floor((p.y - y0) / cell);
		return ix < 0 || iy < 0 || ix >= nx || iy >= ny ? -1 : iy * nx + ix;
	};

	const holo = holonomic(nx, ny, cell, x0, y0, bounded ? area : null, cellOf(goal));
	const step = Math.max(0.5, cell * 1.5);
	const steers = [-1, -0.5, 0, 0.5, 1].map((s) => s * kMax);

	// Node storage as parallel arrays.
	const X: number[] = [];
	const Y: number[] = [];
	const TH: number[] = [];
	const G: number[] = [];
	const F: number[] = [];
	const parent: number[] = [];
	const gear: number[] = [];
	const curv: number[] = [];
	const best = new Map<number, number>();
	const open = new Heap((id) => F[id]);

	const key = (p: Pose, c: number) => {
		const h = ((Math.round((wrap(p.th) / (2 * Math.PI)) * HEADINGS) % HEADINGS) + HEADINGS) % HEADINGS;
		return c * HEADINGS + h;
	};
	const heuristic = (p: Pose, c: number) => WEIGHT * Math.max(rsDistance(p, goal, R), holo[c]);

	function add(p: Pose, g: number, par: number, gr: number, k: number) {
		const c = cellOf(p);
		if (c < 0 || !Number.isFinite(holo[c])) return;
		const kk = key(p, c);
		const prev = best.get(kk);
		if (prev !== undefined && prev <= g) return;
		best.set(kk, g);
		const id = X.length;
		X.push(p.x);
		Y.push(p.y);
		TH.push(p.th);
		G.push(g);
		F.push(g + heuristic(p, c));
		parent.push(par);
		gear.push(gr);
		curv.push(k);
		open.push(id);
	}

	/** Collision-checked Reeds-Shepp finish from node `id`, or null. */
	function shoot(id: number) {
		const from = { x: X[id], y: Y[id], th: TH[id] };
		// Rank by the search's own cost, so a slightly longer finish without extra gear changes wins.
		// Finishes that shuffle back and forth by a few centimeters are skipped while the search
		// still has a fair chance of finding a cleaner one.
		const rate = (p: RsPath) => {
			let c = 0;
			let g = gear[id];
			let run = 0;
			let fiddly = false;
			p.lengths.forEach((l) => {
				if (Math.abs(l) < 1e-9) return;
				const m = Math.abs(l) * R;
				c += m * (l < 0 ? REVERSE_COST : 1);
				if (g && Math.sign(l) !== g) {
					c += SWITCH_COST;
					if (run && run < MIN_RUN) fiddly = true;
					run = 0;
				}
				run += m;
				g = Math.sign(l);
			});
			if (run < MIN_RUN && c > run) fiddly = true;
			return { p, c, fiddly };
		};
		const ranked = rsPaths(from, goal, R)
			.slice(0, 12)
			.map(rate)
			.filter((r) => !r.fiddly || expanded > MAX_EXPANSIONS / 10)
			.sort((a, b) => a.c - b.c);
		for (const { p: path } of ranked.slice(0, 4)) {
			const samples = sampleRs(from, path, R, SAMPLE);
			if (samples.every((s) => free(s.pose))) return samples;
		}
		return null;
	}

	add(start, 0, -1, 0, 0);
	let expanded = 0;
	const deadline = Date.now() + 15_000;
	while (open.size) {
		const id = open.pop();
		const p = { x: X[id], y: Y[id], th: TH[id] };
		const kk = key(p, cellOf(p));
		if ((best.get(kk) ?? Infinity) < G[id]) continue;
		if (++expanded > MAX_EXPANSIONS || Date.now() > deadline) break;

		const rs = rsDistance(p, goal, R);
		if (rs < 6 * R || expanded % 8 === 0) {
			const finish = shoot(id);
			if (finish) return { ok: true, expanded, ...reconstruct(id, finish) };
		}

		for (const gr of [1, -1])
			for (const k of steers) {
				let q = p;
				let ok = true;
				const n = Math.ceil(step / 0.2);
				for (let i = 1; i <= n && ok; i++) {
					q = arc(p, (gr * step * i) / n, k);
					ok = free(q);
				}
				if (!ok) continue;
				let g = G[id] + step * (gr < 0 ? REVERSE_COST : 1) + (STEER_COST * Math.abs(k)) / kMax;
				if (gear[id] && gear[id] !== gr) g += SWITCH_COST;
				if (gear[id]) g += (STEER_COST * Math.abs(k - curv[id])) / kMax;
				add(q, g, id, gr, k);
			}
	}
	return {
		ok: false,
		error:
			expanded > MAX_EXPANSIONS || Date.now() > deadline
				? 'Gave up: no path found in time. Try a larger area or a smaller buffer.'
				: 'No drivable path inside the area. Try a larger area, a smaller buffer or another end direction.'
	};

	function reconstruct(last: number, finish: { pose: Pose; gear: number }[]) {
		const chain: number[] = [];
		for (let id = last; id >= 0; id = parent[id]) chain.unshift(id);
		const poses: Pose[] = [start];
		const gears: number[] = [];
		for (const id of chain.slice(1)) {
			const from = poses[poses.length - 1];
			const n = Math.ceil(step / SAMPLE);
			for (let i = 1; i <= n; i++) {
				poses.push(arc(from, (gear[id] * step * i) / n, curv[id]));
				gears.push(gear[id]);
			}
		}
		for (const s of finish) {
			poses.push(s.pose);
			gears.push(s.gear);
		}
		// gears[i] is the gear used to reach poses[i + 1]; give the start the first move's gear.
		gears.unshift(gears[0] ?? 1);
		return { poses, gears };
	}
}

/** Shortest distances (meters) from the goal cell over free cells, ignoring the car's shape. */
function holonomic(nx: number, ny: number, cell: number, x0: number, y0: number, area: Vec[] | null, goal: number) {
	const dist = new Float64Array(nx * ny).fill(Infinity);
	const freeCell = new Uint8Array(nx * ny);
	for (let iy = 0; iy < ny; iy++)
		for (let ix = 0; ix < nx; ix++)
			freeCell[iy * nx + ix] = !area || pointInPolygon({ x: x0 + (ix + 0.5) * cell, y: y0 + (iy + 0.5) * cell }, area) ? 1 : 0;
	if (goal < 0) return dist;
	freeCell[goal] = 1;
	dist[goal] = 0;
	const heap = new Heap((i) => dist[i]);
	heap.push(goal);
	const moves = [
		[1, 0, 1],
		[-1, 0, 1],
		[0, 1, 1],
		[0, -1, 1],
		[1, 1, Math.SQRT2],
		[1, -1, Math.SQRT2],
		[-1, 1, Math.SQRT2],
		[-1, -1, Math.SQRT2]
	];
	const done = new Uint8Array(nx * ny);
	while (heap.size) {
		const i = heap.pop();
		if (done[i]) continue;
		done[i] = 1;
		const ix = i % nx;
		const iy = (i - ix) / nx;
		for (const [dx, dy, c] of moves) {
			const jx = ix + dx;
			const jy = iy + dy;
			if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
			const j = jy * nx + jx;
			if (!freeCell[j]) continue;
			const d = dist[i] + c * cell;
			if (d < dist[j]) {
				dist[j] = d;
				heap.push(j);
			}
		}
	}
	return dist;
}
