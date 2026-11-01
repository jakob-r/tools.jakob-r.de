// World coordinates are meters with the plan's top-left corner as origin, y pointing down.

export type Vec = { x: number; y: number };
/** Rear-axle center and heading (radians). */
export type Pose = { x: number; y: number; th: number };
export type Polygon = Vec[];

export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;

/** Wrap to (-π, π]. */
export function wrap(a: number) {
	a = (a + Math.PI) % (2 * Math.PI);
	if (a < 0) a += 2 * Math.PI;
	return a - Math.PI;
}

export function pointInPolygon(p: Vec, poly: Polygon) {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i];
		const b = poly[j];
		if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
	}
	return inside;
}

function segmentsCross(a: Vec, b: Vec, c: Vec, d: Vec) {
	const d1 = cross(sub(b, a), sub(c, a));
	const d2 = cross(sub(b, a), sub(d, a));
	const d3 = cross(sub(d, c), sub(a, c));
	const d4 = cross(sub(d, c), sub(b, c));
	return d1 * d2 < 0 && d3 * d4 < 0;
}

/** True when the convex shape lies completely inside the polygon. */
export function shapeInside(shape: Vec[], poly: Polygon) {
	if (poly.length < 3) return true;
	for (const p of shape) if (!pointInPolygon(p, poly)) return false;
	for (let i = 0; i < shape.length; i++) {
		const a = shape[i];
		const b = shape[(i + 1) % shape.length];
		for (let j = 0, k = poly.length - 1; j < poly.length; k = j++)
			if (segmentsCross(a, b, poly[j], poly[k])) return false;
	}
	return true;
}

/** Counter-clockwise (in a y-up sense) convex hull, Andrew's monotone chain. */
export function convexHull(pts: Vec[]): Vec[] {
	const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
	if (p.length < 3) return p;
	const lower: Vec[] = [];
	for (const q of p) {
		while (lower.length >= 2 && cross(sub(lower[lower.length - 1], lower[lower.length - 2]), sub(q, lower[lower.length - 2])) <= 0)
			lower.pop();
		lower.push(q);
	}
	const upper: Vec[] = [];
	for (let i = p.length - 1; i >= 0; i--) {
		const q = p[i];
		while (upper.length >= 2 && cross(sub(upper[upper.length - 1], upper[upper.length - 2]), sub(q, upper[upper.length - 2])) <= 0)
			upper.pop();
		upper.push(q);
	}
	return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function polygonArea(poly: Vec[]) {
	let a = 0;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += cross(poly[j], poly[i]);
	return a / 2;
}

/** Distance from p to segment ab, and the parameter of the closest point. */
export function segmentDistance(p: Vec, a: Vec, b: Vec) {
	const ab = sub(b, a);
	const len2 = ab.x * ab.x + ab.y * ab.y;
	const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2)) : 0;
	return { d: Math.hypot(a.x + ab.x * t - p.x, a.y + ab.y * t - p.y), t };
}
