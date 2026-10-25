/**
 * A synthetic two-hour hike with the usual problems: GPS jitter, a few multipath spikes,
 * a lunch break that scribbles around one spot, and a car ride at the end.
 */
export function sampleGpx(): string {
	let seed = 42;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
	const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

	const mLat = 1 / 111_320;
	const mLon = 1 / (111_320 * Math.cos((47.95 * Math.PI) / 180));
	let x = 0;
	let y = 0;
	let heading = 0.6;
	let t = Date.UTC(2026, 5, 14, 8, 30);
	const pts: string[] = [];

	const push = (jitter: number, ele: number, hr: number) => {
		const lat = 47.95 + (y + gauss() * jitter) * mLat;
		const lon = 8.0 + (x + gauss() * jitter) * mLon;
		pts.push(
			`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>${(ele + gauss()).toFixed(1)}</ele>` +
				`<time>${new Date(t).toISOString()}</time><extensions><gpxtpx:TrackPointExtension>` +
				`<gpxtpx:hr>${Math.round(hr + gauss() * 3)}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`
		);
	};
	const ele = () => 420 + 180 * Math.sin(Math.min(1, Math.hypot(x, y) / 4000) * Math.PI);

	const walk = (steps: number, speed: number) => {
		for (let s = 0; s < steps; s++) {
			heading += gauss() * 0.08 + Math.sin(s / 40) * 0.02;
			x += Math.cos(heading) * speed * 5;
			y += Math.sin(heading) * speed * 5;
			t += 5000;
			push(3, ele(), 115 + speed * 10);
			if (rnd() < 0.006) {
				// Multipath spike: one point far off, then back on track.
				const a = rnd() * Math.PI * 2;
				x += Math.cos(a) * 220;
				y += Math.sin(a) * 220;
				t += 5000;
				push(0, ele(), 120);
				x -= Math.cos(a) * 220;
				y -= Math.sin(a) * 220;
			}
		}
	};

	walk(560, 1.3);
	for (let s = 0; s < 240; s++) {
		t += 5000;
		push(6, ele(), 80);
	}
	heading += Math.PI * 0.7;
	walk(560, 1.25);
	for (let s = 0; s < 130; s++) {
		heading += gauss() * 0.02;
		x += Math.cos(heading) * 17 * 5;
		y += Math.sin(heading) * 17 * 5;
		t += 5000;
		push(3, ele(), 85);
	}

	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="tools.jakob-r.de sample" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<trk><name>Sample hike</name><trkseg>
${pts.join('\n')}
</trkseg></trk>
</gpx>`;
}
