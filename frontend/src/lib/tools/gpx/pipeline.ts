import { angleAt, distance, projector, quantile } from './geo';
import type { OutPoint, TrackPoint } from './gpx';

export type ProfileId = 'walk' | 'run' | 'mtb' | 'road';

export type Profile = {
	label: string;
	/** Above this acceleration (m/s²) a V-shaped detour counts as a GPS spike. */
	maxAcc: number;
	/** Leg speed (m/s) that is implausible even without the acceleration check. */
	maxSpeed: number;
	/** Pause detection: points within `pauseRadius` m for at least `pauseDwell` s. */
	pauseRadius: number;
	pauseDwell: number;
	/** Ramer-Douglas-Peucker tolerance in meters. */
	epsilon: number;
};

export const profiles: Record<ProfileId, Profile> = {
	walk: { label: 'Walk / Hike', maxAcc: 2, maxSpeed: 4, pauseRadius: 15, pauseDwell: 90, epsilon: 2 },
	run: { label: 'Run', maxAcc: 3, maxSpeed: 8, pauseRadius: 12, pauseDwell: 120, epsilon: 3 },
	mtb: { label: 'Mountain Bike', maxAcc: 4, maxSpeed: 22, pauseRadius: 15, pauseDwell: 120, epsilon: 2 },
	road: { label: 'Road Bike', maxAcc: 5, maxSpeed: 28, pauseRadius: 20, pauseDwell: 120, epsilon: 5 }
};

export type Stages = { crop: boolean; spikes: boolean; pauses: boolean; simplify: boolean };

export type Reason = 'crop' | 'spike' | 'pause' | 'simplify';

export type Pause = { lat: number; lon: number; from: number; to: number; seconds: number };

export type Stats = {
	distance: number;
	/** Seconds, undefined without timestamps. */
	elapsed?: number;
	moving?: number;
	ascent?: number;
	points: number;
};

/** Per-point series of the original track, computed once per file. */
export type Analysis = {
	hasTime: boolean;
	/** Cumulative distance in meters. */
	cum: number[];
	/** Speed in m/s: net displacement over ±15 s, so pause jitter and single spikes barely register. */
	speed: number[];
	/** Suggested crop: first original index that belongs to the transit ride, or points.length. */
	autoCrop: number;
};

export type Detection = {
	profile: ProfileId;
	median: number;
	v95: number;
	climb: number;
	reason: string;
};

const MOVING = 0.5; // m/s
const kmh = (v: number) => v * 3.6;

export function analyze(points: TrackPoint[]): Analysis {
	const n = points.length;
	const hasTime = points.every((p) => p.time !== undefined);
	const cum = [0];
	for (let i = 1; i < n; i++) cum.push(cum[i - 1] + distance(points[i - 1], points[i]));

	const speed = new Array<number>(n).fill(0);
	if (hasTime) {
		const t = points.map((p) => p.time! / 1000);
		let lo = 0;
		let hi = 0;
		for (let i = 0; i < n; i++) {
			while (t[i] - t[lo] > 15) lo++;
			while (hi < n - 1 && t[hi + 1] - t[i] <= 15) hi++;
			const dt = t[hi] - t[lo];
			speed[i] = dt > 0 ? distance(points[lo], points[hi]) / dt : 0;
		}
	}
	return { hasTime, cum, speed, autoCrop: hasTime ? detectTransit(points, cum, speed) : n };
}

/**
 * Change-point detection on the final 20 % of the track: fits a two-level step to the smoothed
 * speed and accepts it when the tail is much faster than the activity and stays fast.
 */
function detectTransit(points: TrackPoint[], cum: number[], speed: number[]): number {
	const n = points.length;
	const t = (i: number) => points[i].time! / 1000;
	const total = t(n - 1) - t(0);
	if (total < 300) return n;
	let w0 = 0;
	while (t(w0) < t(0) + total * 0.8) w0++;

	const moving = speed.slice(0, w0).filter((v) => v > MOVING).sort((a, b) => a - b);
	const baseline = quantile(moving, 0.5);

	// Prefix sums over the window for O(1) segment SSE.
	const m = n - w0;
	const s = [0];
	const s2 = [0];
	for (let i = 0; i < m; i++) {
		s.push(s[i] + speed[w0 + i]);
		s2.push(s2[i] + speed[w0 + i] ** 2);
	}
	const sse = (a: number, b: number) => {
		const len = b - a;
		if (len <= 0) return 0;
		const sum = s[b] - s[a];
		return s2[b] - s2[a] - (sum * sum) / len;
	};
	let best = -1;
	let bestCost = Infinity;
	for (let k = 1; k < m - 1; k++) {
		if (t(n - 1) - t(w0 + k) < 60) break;
		const cost = sse(0, k) + sse(k, m);
		if (cost < bestCost) [bestCost, best] = [cost, k];
	}
	if (best < 0) return n;

	let k = w0 + best;
	const tailMean = (cum[n - 1] - cum[k]) / (t(n - 1) - t(k));
	if (tailMean < Math.max(25 / 3.6, 2.5 * baseline)) return n;
	// "No drop-offs": the transit must stay well above the activity speed most of the time.
	const fast = speed.slice(k).filter((v) => v > Math.max(baseline * 2, tailMean * 0.4)).length;
	if (fast / (n - k) < 0.75) return n;

	// The ±15 s smoothing blurs the step; snap to where the raw speed leaves the activity range.
	const raw = (i: number) => {
		const dt = t(i) - t(i - 1);
		return dt > 0 ? (cum[i] - cum[i - 1]) / dt : 0;
	};
	const fastRaw = (i: number) => raw(i) >= baseline * 2;
	const t0 = t(k);
	while (k > 1 && t0 - t(k - 1) <= 60 && fastRaw(k - 1)) k--;
	while (k < n - 1 && t(k) - t0 <= 60 && !fastRaw(k)) k++;
	return k;
}

export function detectProfile(points: TrackPoint[], a: Analysis, end: number): Detection {
	if (!a.hasTime)
		return { profile: 'walk', median: 0, v95: 0, climb: 0, reason: 'No timestamps, so speed is unknown.' };
	const moving = a.speed
		.slice(0, end)
		.filter((v) => v > MOVING)
		.sort((x, y) => x - y);
	const median = kmh(quantile(moving, 0.5));
	const v95 = kmh(quantile(moving, 0.95));
	const km = (a.cum[Math.max(0, end - 1)] - a.cum[0]) / 1000;
	const climb = km > 0 ? (ascent(points.slice(0, end)) ?? 0) / km : 0;

	let profile: ProfileId;
	if (v95 < 7) profile = 'walk';
	else if (v95 < 16) profile = 'run';
	else if (v95 < 26 || (climb >= 20 && v95 < 35)) profile = 'mtb';
	else profile = 'road';
	const reason = `95th percentile speed ${v95.toFixed(1)} km/h, median ${median.toFixed(1)} km/h, climbing ${climb.toFixed(0)} m/km.`;
	return { profile, median, v95, climb, reason };
}

export type Result = {
	out: OutPoint[];
	removed: Map<number, Reason>;
	pauses: Pause[];
};

export function clean(
	points: TrackPoint[],
	hasTime: boolean,
	profile: Profile,
	stages: Stages,
	cropAt: number
): Result {
	const removed = new Map<number, Reason>();
	let pts = stages.crop ? points.slice(0, Math.max(2, cropAt)) : points.slice();
	if (stages.crop) for (let i = pts.length; i < points.length; i++) removed.set(i, 'crop');

	if (stages.spikes) pts = removeSpikes(pts, hasTime, profile, removed);

	let out: OutPoint[] = pts;
	let pauses: Pause[] = [];
	const keep = new Set<number>();
	if (stages.pauses && hasTime) ({ out, pauses } = collapsePauses(pts, profile, removed, keep));

	if (stages.simplify) out = simplify(out, profile.epsilon, keep, removed);
	return { out, removed, pauses };
}

function removeSpikes(pts: TrackPoint[], hasTime: boolean, p: Profile, removed: Map<number, Reason>) {
	// A removed spike can expose its neighbour as the next spike, so repeat a few times.
	for (let pass = 0; pass < 3; pass++) {
		const keep: TrackPoint[] = [pts[0]];
		for (let i = 1; i < pts.length - 1; i++) {
			const a = keep[keep.length - 1];
			const b = pts[i];
			const c = pts[i + 1];
			if (angleAt(a, b, c) < 30 && implausible(a, b, c, hasTime, p)) removed.set(b.idx, 'spike');
			else keep.push(b);
		}
		keep.push(pts[pts.length - 1]);
		if (keep.length === pts.length) break;
		pts = keep;
	}
	return pts;
}

function implausible(a: TrackPoint, b: TrackPoint, c: TrackPoint, hasTime: boolean, p: Profile) {
	const dIn = distance(a, b);
	const dOut = distance(b, c);
	if (!hasTime) return Math.min(dIn, dOut) > 25 && Math.min(dIn, dOut) > 3 * distance(a, c);
	const dtIn = (b.time! - a.time!) / 1000;
	const dtSpan = (c.time! - a.time!) / 1000;
	if (dtIn <= 0 || dtSpan <= 0) return dIn > 10;
	const vIn = dIn / dtIn;
	const vOut = dOut / Math.max(1e-3, (c.time! - b.time!) / 1000);
	if (Math.min(vIn, vOut) > p.maxSpeed) return true;
	// Acceleration needed to go from the speed the straight path implies to the detour's speed.
	const vSpan = distance(a, c) / dtSpan;
	return Math.abs(vIn - vSpan) / dtIn > p.maxAcc;
}

/**
 * Stay-point clustering: consecutive points that remain within `pauseRadius` of their running
 * centroid for at least `pauseDwell` seconds collapse into the centroid. The cluster keeps its first
 * and last point (entry and exit time), so elapsed time is unchanged and the pause shows as a time gap.
 */
function collapsePauses(pts: TrackPoint[], p: Profile, removed: Map<number, Reason>, keep: Set<number>) {
	const out: OutPoint[] = [];
	const pauses: Pause[] = [];
	let i = 0;
	while (i < pts.length) {
		let sLat = pts[i].lat;
		let sLon = pts[i].lon;
		let count = 1;
		let j = i + 1;
		while (j < pts.length) {
			const c = { lat: sLat / count, lon: sLon / count };
			// Like DBSCAN noise: a stray fix or two outside the radius does not end the cluster.
			let k = j;
			while (k < pts.length && k < j + 3 && distance(c, pts[k]) > p.pauseRadius) k++;
			if (k === pts.length || k === j + 3) break;
			for (; j <= k; j++, count++) {
				sLat += pts[j].lat;
				sLon += pts[j].lon;
			}
		}
		const last = j - 1;
		const seconds = (pts[last].time! - pts[i].time!) / 1000;
		if (last - i >= 2 && seconds >= p.pauseDwell) {
			const lat = sLat / count;
			const lon = sLon / count;
			out.push({ ...pts[i], lat, lon, moved: true }, { ...pts[last], lat, lon, moved: true });
			keep.add(pts[i].idx).add(pts[last].idx);
			for (let k = i + 1; k < last; k++) removed.set(pts[k].idx, 'pause');
			pauses.push({ lat, lon, from: pts[i].idx, to: pts[last].idx, seconds });
			i = j;
		} else {
			out.push(pts[i]);
			i++;
		}
	}
	return { out, pauses };
}

/** Ramer-Douglas-Peucker between fixed anchors (track ends and pause entry/exit points). */
function simplify(pts: OutPoint[], eps: number, anchors: Set<number>, removed: Map<number, Reason>) {
	if (pts.length < 3) return pts;
	const proj = projector(pts[0].lat);
	const xy = pts.map(proj);
	const mark = new Uint8Array(pts.length);
	mark[0] = mark[pts.length - 1] = 1;
	pts.forEach((p, i) => anchors.has(p.idx) && (mark[i] = 1));

	const stack: [number, number][] = [];
	let a = 0;
	for (let i = 1; i < pts.length; i++) if (mark[i]) stack.push([a, i]), (a = i);
	while (stack.length) {
		const [s, e] = stack.pop()!;
		const dx = xy[e].x - xy[s].x;
		const dy = xy[e].y - xy[s].y;
		const len = Math.hypot(dx, dy);
		let far = -1;
		let max = eps;
		for (let i = s + 1; i < e; i++) {
			const px = xy[i].x - xy[s].x;
			const py = xy[i].y - xy[s].y;
			const d = len === 0 ? Math.hypot(px, py) : Math.abs(dx * py - dy * px) / len;
			if (d > max) [max, far] = [d, i];
		}
		if (far >= 0) {
			mark[far] = 1;
			stack.push([s, far], [far, e]);
		}
	}
	return pts.filter((p, i) => mark[i] || (removed.set(p.idx, 'simplify'), false));
}

export function ascent(pts: { ele?: number }[]): number | undefined {
	const eles = pts.map((p) => p.ele).filter((e): e is number => e !== undefined);
	if (eles.length < 2) return undefined;
	// Hysteresis keeps sensor noise from adding up.
	let gain = 0;
	let ref = eles[0];
	for (const e of eles) {
		if (e - ref >= 3) (gain += e - ref), (ref = e);
		else if (ref - e >= 3) ref = e;
	}
	return gain;
}

export function stats(pts: TrackPoint[]): Stats {
	let dist = 0;
	let moving = 0;
	const hasTime = pts.every((p) => p.time !== undefined);
	for (let i = 1; i < pts.length; i++) {
		const d = distance(pts[i - 1], pts[i]);
		dist += d;
		if (hasTime) {
			const dt = (pts[i].time! - pts[i - 1].time!) / 1000;
			if (dt > 0 && d / dt > MOVING && dt < 600) moving += dt;
		}
	}
	return {
		distance: dist,
		elapsed: hasTime ? (pts[pts.length - 1].time! - pts[0].time!) / 1000 : undefined,
		moving: hasTime ? moving : undefined,
		ascent: ascent(pts),
		points: pts.length
	};
}
