<script lang="ts">
	import { onMount } from 'svelte';
	import CopyButton from '#lib/core/CopyButton.svelte';
	import InfoHint from '#lib/core/InfoHint.svelte';
	import SplitPane from '#lib/core/SplitPane.svelte';
	import {
		asOpenableUrl,
		decodeBase64,
		encodeBytes,
		encodeText,
		encodeTextWithStyle,
		findEmbeddedBase64,
		normalizeBase64,
		type Base64Style
	} from './convert';

	const samplePlain = 'Hello, Base64!\n\nEdit either pane — the other follows.\nShare via the URL hash.';
	const sampleB64 = encodeText(samplePlain);
	const defaultStyle: Base64Style = { urlSafe: false, pad: true };

	let plain = $state(samplePlain);
	let encoded = $state(sampleB64);
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
		bytes = result.bytes;
		if (result.text !== null) {
			plain = result.text;
			binary = false;
			if (fileName === 'decoded.bin') fileName = 'decoded.txt';
		} else {
			plain = '';
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
		error = null;
		blockedFrom = null;
		binary = false;
		bytes = new TextEncoder().encode(plain);
		const b64 = wrapped ? encodeTextWithStyle(plain, b64Style) : encodeText(plain);
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
		bytes = buf;
		encoded = encodeBytes(buf);
		fileName = file.name || 'decoded.bin';
		error = null;
		blockedFrom = null;
		const result = decodeBase64(encoded);
		if (result.ok && result.text !== null) {
			plain = result.text;
			binary = false;
		} else {
			plain = '';
			binary = true;
		}
		writeHash(encoded);
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
			text="Edit either pane — plain text and Base64 stay in sync. Paste a link that embeds Base64 (path, query, hash, or data URL): only that segment is decoded and rewritten when you edit. The payload also lives in this page's URL hash so you can share it without sending data to the server."
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
					<span class="font-medium text-mute">Plain</span>
					{#if binary}
						<span class="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800"
							>Binary · {bytes.length.toLocaleString()} bytes</span
						>
					{/if}
					{#if blockedFrom === 'encoded'}
						<span class="text-red-600">Not updated: fix the Base64 errors first.</span>
					{/if}
				</div>
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
					<textarea
						bind:value={plain}
						oninput={syncFromPlain}
						spellcheck="false"
						aria-label="Plain text"
						class="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-sm leading-relaxed outline-none"
						readonly={blockedFrom === 'encoded'}
					></textarea>
				{/if}
			{/snippet}
			{#snippet second()}
				<div class="flex shrink-0 items-center gap-2 border-b border-line bg-slate-50 px-3 py-1.5 text-xs">
					<span class="font-medium text-mute">{wrapped ? 'URL' : 'Base64'}</span>
					{#if wrapped}
						<span class="rounded bg-accent-soft px-1.5 py-0.5 text-accent">Base64 segment in link</span>
					{/if}
					<span class="ml-auto"><CopyButton text={encoded} /></span>
				</div>
				{#if error}
					<div class="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">✕ {error}</div>
				{/if}
				<textarea
					bind:value={encoded}
					oninput={syncFromEncoded}
					spellcheck="false"
					aria-label={wrapped ? 'URL with Base64' : 'Base64'}
					class="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-sm leading-relaxed outline-none break-all"
				></textarea>
			{/snippet}
		</SplitPane>
	</div>
</div>
