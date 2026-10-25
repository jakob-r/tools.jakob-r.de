const R = 6371008.8;
const rad = Math.PI / 180;

export type LatLon = { lat: number; lon: number };

/** Great-circle distance in meters. */
export function distance(a: LatLon, b: LatLon): number {
	const dLat = (b.lat - a.lat) * rad;
	const dLon = (b.lon - a.lon) * rad;
	const h =
		Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Equirectangular projection around a reference latitude: x/y in meters, y grows north. */
export function projector(refLat: number) {
	const k = Math.cos(refLat * rad);
	return (p: LatLon) => ({ x: p.lon * rad * R * k, y: p.lat * rad * R });
}

/** Angle at b (degrees) between b→a and b→c. 180 = straight line, 0 = full reversal. */
export function angleAt(a: LatLon, b: LatLon, c: LatLon): number {
	const proj = projector(b.lat);
	const pa = proj(a);
	const pb = proj(b);
	const pc = proj(c);
	const ux = pa.x - pb.x;
	const uy = pa.y - pb.y;
	const vx = pc.x - pb.x;
	const vy = pc.y - pb.y;
	const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
	if (n === 0) return 180;
	return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n))) / rad;
}

export function quantile(sorted: number[], q: number): number {
	if (!sorted.length) return 0;
	const i = (sorted.length - 1) * q;
	const lo = Math.floor(i);
	const hi = Math.ceil(i);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
