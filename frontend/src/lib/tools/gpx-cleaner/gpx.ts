export type TrackPoint = {
	/** Index in the original track; stable across all pipeline stages. */
	idx: number;
	lat: number;
	lon: number;
	ele?: number;
	/** Epoch milliseconds. */
	time?: number;
	/** The original <trkpt>, cloned on export so <extensions> and other children survive. */
	el: Element;
};

export type ParsedGpx = {
	doc: XMLDocument;
	points: TrackPoint[];
	name: string;
};

const childText = (el: Element, name: string) => {
	for (const c of el.children) if (c.localName === name) return c.textContent?.trim();
	return undefined;
};

export function parseGpx(text: string): ParsedGpx {
	const doc = new DOMParser().parseFromString(text, 'application/xml');
	const err = doc.getElementsByTagName('parsererror')[0];
	if (err) throw new Error('This is not valid XML.');
	if (doc.documentElement.localName !== 'gpx') throw new Error('This file is not a GPX file.');

	const points: TrackPoint[] = [];
	for (const el of doc.getElementsByTagNameNS('*', 'trkpt')) {
		const lat = parseFloat(el.getAttribute('lat') ?? '');
		const lon = parseFloat(el.getAttribute('lon') ?? '');
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		const ele = parseFloat(childText(el, 'ele') ?? '');
		const time = Date.parse(childText(el, 'time') ?? '');
		points.push({
			idx: points.length,
			lat,
			lon,
			ele: Number.isFinite(ele) ? ele : undefined,
			time: Number.isFinite(time) ? time : undefined,
			el
		});
	}
	if (points.length < 2) throw new Error('The file has no track with at least two points.');

	// Some devices write points out of order; the pipeline assumes time order.
	if (points.every((p) => p.time !== undefined)) {
		const sorted = [...points].sort((a, b) => a.time! - b.time!);
		if (sorted.some((p, i) => p !== points[i])) sorted.forEach((p, i) => ((p.idx = i), (points[i] = p)));
	}

	const name = childText(doc.getElementsByTagNameNS('*', 'trk')[0] ?? doc.documentElement, 'name') ?? '';
	return { doc, points, name };
}

/** A point of the cleaned track. Pause centroids reuse an original point with moved coordinates. */
export type OutPoint = TrackPoint & { moved?: boolean };

/**
 * Writes the cleaned points into a copy of the original document as one <trk> with a single <trkseg>.
 * Waypoints, routes, metadata and per-point children (time, ele, extensions) are kept.
 */
export function exportGpx(src: ParsedGpx, points: OutPoint[]): string {
	const doc = src.doc.cloneNode(true) as XMLDocument;
	const trks = [...doc.getElementsByTagNameNS('*', 'trk')];
	const trk = trks[0];
	trks.slice(1).forEach((t) => t.remove());
	const ns = trk.namespaceURI;
	const segs = [...trk.children].filter((c) => c.localName === 'trkseg');
	const seg = doc.createElementNS(ns, 'trkseg');
	segs[0].before(seg);
	segs.forEach((s) => s.remove());

	for (const p of points) {
		const el = doc.importNode(p.el, true) as Element;
		if (p.moved) {
			el.setAttribute('lat', p.lat.toFixed(7));
			el.setAttribute('lon', p.lon.toFixed(7));
		}
		seg.appendChild(el);
	}
	let xml = new XMLSerializer().serializeToString(doc);
	if (!xml.startsWith('<?xml')) xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
	return xml;
}
