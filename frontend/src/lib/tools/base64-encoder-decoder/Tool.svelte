<script lang="ts">
	import { onMount } from 'svelte';
	import CopyButton from '#lib/core/CopyButton.svelte';
	import InfoHint from '#lib/core/InfoHint.svelte';
	import SplitPane from '#lib/core/SplitPane.svelte';
	import {
		asOpenableUrl,
		decodeBase64,
		encodeBytes,
		encodeBytesWithStyle,
		encodeText,
		findEmbeddedBase64,
		normalizeBase64,
		type Base64Style
	} from './convert';
	import { codecLabels, compress, detectPayload, type Codec } from './compress';
	import { canonicalFromPlain, viewForDecodedText } from './json';
	import PlainEditor from './PlainEditor.svelte';

	const samplePlain = 'Hello, Base64!\n\nEdit either pane — the other follows.\nShare via the URL hash.';
	const sampleB64 = encodeText(samplePlain);
	const defaultStyle: Base64Style = { urlSafe: false, pad: true };

	let plain = $state(samplePlain);
	let encoded = $state(sampleB64);
	let isJson = $state(false);
	/** Compression between the Base64 bytes and the text (auto-detected on decode). */
	let codec = $state<Codec>('none');
	/** Surroundings of an embedded Base64 segment (e.g. URL path before/after the payload). */
	let prefix = $state('');
	let suffix = $state('');
	let b64Style = $state<Base64Style>(defaultStyle);
	/** Last successful decoded bytes (for binary download / re-encode). */
	let bytes = $state<Uint8Array>(new TextEncoder().encode(samplePlain));
	let binary = $state(false);
	let error = $state<string | null>(null);
	/** Which pane last drove the sync; the other is stale while this has an error. */
	let blockedFrom = $state<'plain' | 'encoded' | null>(null);
	let fileName = $state('decoded.txt');
	let fileInput: HTMLInputElement;

	const wrapped = $derived(prefix !== '' || suffix !== '');
	const openUrl = $derived(
		!error && blockedFrom === null
			? (asOpenableUrl(encoded) ?? (!binary ? asOpenableUrl(plain) : null))
			: null
	);

	function clearWrapper() {
		prefix = '';
		suffix = '';
		b64Style = defaultStyle;
	}

	function composeEncoded(b64: string) {
		return prefix + b64 + suffix;
	}

	function setPlainFromDecodedText(text: string) {
		const view = viewForDecodedText(text);
		plain = view.display;
		isJson = view.isJson;
		// Keep original decoded bytes so the left pane is not rewritten until the user edits.
		bytes = new TextEncoder().encode(text);
		return view.canonical;
	}

	function applyDecoded(b64: string, source: 'plain' | 'encoded' | 'hash' | 'file') {
		const result = decodeBase64(b64);
		if (result.ok === false) {
			if (source === 'encoded' || source === 'hash') {
				error = result.error;
				blockedFrom = 'encoded';
				if (source === 'hash') encoded = composeEncoded(b64);
			}
			return false;
		}
		error = null;
		blockedFrom = null;
		const payload = detectPayload(result.bytes);
		codec = payload.codec;
		if (payload.text !== null) {
			setPlainFromDecodedText(payload.text);
			binary = false;
			if (fileName === 'decoded.bin') fileName = 'decoded.txt';
		} else {
			plain = '';
			isJson = false;
			bytes = payload.bytes;
			binary = true;
			if (fileName === 'decoded.txt') fileName = 'decoded.bin';
		}
		return true;
	}

	function writeHash(content: string) {
		const next = content ? `#${content}` : '';
		const current = location.hash === '#' ? '' : location.hash;
		if (current === next) return;
		history.replaceState(null, '', `${location.pathname}${location.search}${next}`);
	}

	/** Adopt a pasted/embedded Base64 find: keep the URL (or other) wrapper intact. */
	function adoptEmbedded(
		found: NonNullable<ReturnType<typeof findEmbeddedBase64>>,
		source: 'plain' | 'encoded' | 'hash'
	) {
		prefix = found.prefix;
		suffix = found.suffix;
		b64Style = found.style;
		if (!applyDecoded(found.base64, source)) return false;
		// Keep the original segment until the user edits the plain side.
		encoded = composeEncoded(found.base64);
		return true;
	}

	function syncFromPlain() {
		const found = findEmbeddedBase64(plain);
		// Decode when the plain pane is a link/data-URL with Base64, or is itself Base64.
		if (found && (found.prefix !== '' || found.suffix !== '' || found.base64 === plain.trim())) {
			adoptEmbedded(found, 'plain');
			writeHash(encoded);
			return;
		}

		const canon = canonicalFromPlain(plain);
		if (canon.ok === false) {
			// Looks like JSON but is broken — keep the Base64 side until it parses again.
			if (isJson || plain.trim().startsWith('{') || plain.trim().startsWith('[')) {
				error = canon.error;
				blockedFrom = 'plain';
				return;
			}
		}

		error = null;
		blockedFrom = null;
		binary = false;
		const text = canon.ok ? canon.text : plain;
		isJson = canon.ok ? canon.isJson : false;
		bytes = new TextEncoder().encode(text);
		const packed = compress(bytes, codec);
		const b64 = wrapped ? encodeBytesWithStyle(packed, b64Style) : encodeBytes(packed);
		if (!wrapped) b64Style = defaultStyle;
		encoded = composeEncoded(b64);
		fileName = 'decoded.txt';
		writeHash(encoded);
	}

	function syncFromEncoded() {
		const found = findEmbeddedBase64(encoded);
		if (found) {
			if (!adoptEmbedded(found, 'encoded')) return;
			writeHash(encoded);
			return;
		}
		clearWrapper();
		if (!applyDecoded(encoded, 'encoded')) return;
		encoded = normalizeBase64(encoded.trim()) || encodeBytes(bytes);
		writeHash(encoded);
	}

	function loadHash() {
		const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
		if (!raw) return;
		let payload = raw;
		try {
			payload = decodeURIComponent(raw);
		} catch {
			payload = raw;
		}
		const found = findEmbeddedBase64(payload);
		if (found) {
			adoptEmbedded(found, 'hash');
			writeHash(encoded);
			return;
		}
		if (applyDecoded(payload, 'hash')) writeHash(encoded);
	}

	function onHashChange() {
		const raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';
		if (!raw) return;
		let payload = raw;
		try {
			payload = decodeURIComponent(raw);
		} catch {
			payload = raw;
		}
		if (payload === encoded) return;
		loadHash();
	}

	onMount(() => {
		loadHash();
	});

	async function openFile(file: File | undefined) {
		if (!file) return;
		clearWrapper();
		const buf = new Uint8Array(await file.arrayBuffer());
		fileName = file.name || 'decoded.bin';
		error = null;
		blockedFrom = null;
		encoded = encodeBytes(buf);
		const payload = detectPayload(buf);
		codec = payload.codec;
		if (payload.text !== null) {
			setPlainFromDecodedText(payload.text);
			binary = false;
		} else {
			plain = '';
			isJson = false;
			bytes = payload.bytes;
			binary = true;
		}
		writeHash(encoded);
	}

	/** Changing the codec re-encodes the Base64 side from the text. */
	function setCodec(next: Codec) {
		codec = next;
		syncFromPlain();
	}

	function downloadDecoded() {
		const type = binary ? 'application/octet-stream' : 'text/plain;charset=utf-8';
		const name = fileName || (binary ? 'decoded.bin' : 'decoded.txt');
		const copy = new Uint8Array(bytes);
		const blob = new Blob([copy], { type });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = name;
		a.click();
		URL.revokeObjectURL(a.href);
	}
</script>

<svelte:window onhashchange={onHashChange} />

<div class="flex h-full flex-col">
	<div class="flex shrink-0 items-center gap-2 border-b border-line bg-white px-4 py-2 text-sm">
		<h1 class="font-semibold">Base64 Encoder / Decoder</h1>
		<InfoHint
			text="Base64 (or a link with an embedded Base64 segment) on the left, decoded text on the right. JSON is shown pretty-printed with light highlighting; the Base64 side stays minified. Paste a link that embeds Base64 (path, query, hash, or data URL) and only that segment is rewritten when you edit. Compressed payloads (gzip, zlib, raw deflate as written by pako) are detected and inflated when that yields more plausible text; the Compression menu overrides it and re-encodes."
		/>
		{#if openUrl}
			<a
				href={openUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="ml-2 rounded-md border border-accent bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent hover:text-white"
			>
				Open URL ↗
			</a>
		{/if}
		<div class="ml-auto flex items-center gap-2">
			<input
				bind:this={fileInput}
				type="file"
				class="hidden"
				onchange={(e) => openFile(e.currentTarget.files?.[0])}
			/>
			<button
				type="button"
				onclick={() => fileInput.click()}
				class="rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
			>
				Open file
			</button>
			{#if binary || bytes.length > 0}
				<button
					type="button"
					onclick={downloadDecoded}
					class="rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
					title="Download the decoded bytes"
				>
					Download
				</button>
			{/if}
		</div>
	</div>

	<div class="min-h-0 flex-1">
		<SplitPane orientation="horizontal">
			{#snippet first()}
				<div class="flex shrink-0 items-center gap-2 border-b border-line bg-slate-50 px-3 py-1.5 text-xs">
					<span class="font-medium text-mute">{wrapped ? 'URL' : 'Base64'}</span>
					{#if wrapped}
						<span class="rounded bg-accent-soft px-1.5 py-0.5 text-accent">Base64 segment in link</span>
					{/if}
					{#if blockedFrom === 'plain'}
						<span class="text-red-600">Not updated: fix the JSON on the right first.</span>
					{/if}
					<span class="ml-auto"><CopyButton text={encoded} label={wrapped ? 'Copy URL' : 'Copy'} /></span>
				</div>
				{#if error && blockedFrom === 'encoded'}
					<div class="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">✕ {error}</div>
				{/if}
				<textarea
					bind:value={encoded}
					oninput={syncFromEncoded}
					spellcheck="false"
					aria-label={wrapped ? 'URL with Base64' : 'Base64'}
					class="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-sm leading-relaxed outline-none break-all"
					readonly={blockedFrom === 'plain'}
				></textarea>
			{/snippet}
			{#snippet second()}
				<div class="flex shrink-0 items-center gap-2 border-b border-line bg-slate-50 px-3 py-1.5 text-xs">
					<span class="font-medium text-mute">{isJson ? 'JSON' : 'Plain'}</span>
					{#if isJson}
						<span class="rounded bg-accent-soft px-1.5 py-0.5 text-accent">prettified · Base64 stays minified</span>
					{/if}
					{#if binary}
						<span class="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800"
							>Binary · {bytes.length.toLocaleString()} bytes</span
						>
					{/if}
					{#if blockedFrom === 'encoded'}
						<span class="text-red-600">Not updated: fix the Base64 on the left first.</span>
					{/if}
					<label class="ml-auto flex items-center gap-1.5 text-mute">
						Compression
						<select
							value={codec}
							onchange={(e) => setCodec(e.currentTarget.value as Codec)}
							disabled={binary || blockedFrom !== null}
							class="rounded border px-1 py-0.5 text-xs {codec === 'none'
								? 'border-line bg-white text-ink'
								: 'border-accent bg-accent-soft text-accent'}"
						>
							{#each Object.entries(codecLabels) as [value, label] (value)}
								<option {value}>{label}</option>
							{/each}
						</select>
					</label>
					<CopyButton text={plain} />
				</div>
				{#if error && blockedFrom === 'plain'}
					<div class="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">✕ {error}</div>
				{/if}
				{#if binary}
					<div class="flex flex-1 flex-col items-start justify-center gap-3 px-4 py-6 text-sm text-mute">
						<p>
							Decoded data is not valid UTF-8 text ({bytes.length.toLocaleString()} bytes). Download it, or
							edit the Base64 pane.
						</p>
						<button
							type="button"
							onclick={downloadDecoded}
							class="rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium hover:border-accent hover:text-accent"
						>
							Download binary
						</button>
					</div>
				{:else}
					<PlainEditor bind:value={plain} json={isJson} readonly={blockedFrom === 'encoded'} oninput={syncFromPlain} />
				{/if}
			{/snippet}
		</SplitPane>
	</div>
</div>
