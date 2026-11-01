export type PlanImage = {
	source: CanvasImageSource;
	/** Pixels. */
	width: number;
	height: number;
	/** For embedding in the SVG export. */
	dataUrl: string;
	name: string;
	/** Resolution the pixels correspond to, when the file tells us (PDF); otherwise a guess. */
	dpi: number;
};

const PDF_DPI = 150;

export async function importPlan(file: File): Promise<PlanImage> {
	if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return importPdf(file);
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(r.result as string);
		r.onerror = () => reject(new Error('Could not read the file.'));
		r.readAsDataURL(file);
	});
	const img = new Image();
	img.src = dataUrl;
	try {
		await img.decode();
	} catch {
		throw new Error(`${file.name} is not an image this browser can show.`);
	}
	// SVGs without width/height report 0 here; give them a usable size.
	const width = img.naturalWidth || 1000;
	const height = img.naturalHeight || Math.round(width * 0.75);
	return { source: img, width, height, dataUrl, name: file.name, dpi: 96 };
}

async function importPdf(file: File): Promise<PlanImage> {
	// pdf.js is large, so it is only fetched when someone actually opens a PDF.
	const [pdfjs, worker] = await Promise.all([
		import('pdfjs-dist'),
		import('pdfjs-dist/build/pdf.worker.min.mjs?url')
	]);
	pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
	const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
	const doc = await task.promise;
	const page = await doc.getPage(1);
	let scale = PDF_DPI / 72;
	const base = page.getViewport({ scale: 1 });
	// Keep huge sheets within what a canvas can hold.
	scale = Math.min(scale, 8000 / Math.max(base.width, base.height));
	const viewport = page.getViewport({ scale });
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(viewport.width);
	canvas.height = Math.round(viewport.height);
	await page.render({ canvas, viewport }).promise;
	await task.destroy();
	return {
		source: canvas,
		width: canvas.width,
		height: canvas.height,
		dataUrl: canvas.toDataURL('image/png'),
		name: file.name,
		dpi: scale * 72
	};
}
