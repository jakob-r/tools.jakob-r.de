// The area a car covers while driving: the union of the convex hulls of consecutive footprints.

import polygonClipping, { type MultiPolygon, type Polygon as PcPolygon } from 'polygon-clipping';
import { footprint, type Car } from './cars';
import { convexHull, polygonArea, type Pose, type Vec } from './geometry';

const STEP = 0.15;

/** Convex pieces whose union is the swept area. Cheap; good enough to draw while dragging. */
export function sweepPieces(car: Car, buffer: number, poses: Pose[]): Vec[][] {
	if (!poses.length) return [];
	const pieces: Vec[][] = [];
	let prev = footprint(car, buffer, poses[0]);
	let last = poses[0];
	for (let i = 1; i < poses.length; i++) {
		const p = poses[i];
		const end = i === poses.length - 1;
		if (!end && Math.hypot(p.x - last.x, p.y - last.y) < STEP && Math.abs(p.th - last.th) < 0.05) continue;
		const fp = footprint(car, buffer, p);
		pieces.push(convexHull([...prev, ...fp]));
		prev = fp;
		last = p;
	}
	if (!pieces.length) pieces.push(prev);
	return pieces;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const ring = (pts: Vec[]): PcPolygon => [[...pts, pts[0]].map((p) => [round(p.x), round(p.y)])];

/** Exact union of all pieces, as outer rings with holes. */
export function unionOf(pieces: Vec[][]): MultiPolygon {
	if (!pieces.length) return [];
	const [first, ...rest] = pieces.map(ring);
	try {
		return polygonClipping.union(first, ...rest);
	} catch {
		// Degenerate input can trip the sweep line; merging in halves usually gets around it.
		const mid = pieces.length >> 1;
		if (mid === 0) return [first];
		return polygonClipping.union(unionOf(pieces.slice(0, mid)), unionOf(pieces.slice(mid)));
	}
}

export function multiArea(mp: MultiPolygon) {
	let a = 0;
	for (const poly of mp)
		poly.forEach((r, i) => {
			const v = Math.abs(polygonArea(r.map(([x, y]) => ({ x, y }))));
			a += i === 0 ? v : -v;
		});
	return a;
}
