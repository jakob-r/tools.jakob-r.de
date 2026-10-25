# IDEA

This website is a collection of random helpful tools and mini apps that only run on the browser and don't need backend.

The landing page shows

- a small introduction
- a gallery grid of the available tools
- a search function
- every tool has a thumbnail, short title and description, and possible tags
- Let the user know that data never leaves the browser.

Principles:

- Every tool lives in a separate page and if the components are loaded, the user should not need to load unneeded components from the whole page.
- Every tool should be as simple and lightweight as possible.

Design:

- friendly, slightly colorful but still professional and minimal.
- we use the space of the screen wisely
- we give the user hints where it's really needed, adding small info icons
- all UI should follow the same conventions and not surprise the user
- Tools are desktop use first unless stated otherwise

## Tools

### Markdown Converter

- Converts between Markdown, HTML and rich text
- Two panes: Input and Output
- Layout: User can choose between horizontal or vertical split
- Light syntax highlighting for Markdown and HTML that also shows errors.
- The data will always stay in sync between the two panes, no matter where I modify it.
- Copy to clipboard button for the output.

### Base64 Encoder / Decoder

- Converts plain text or binary data into an ASCII-safe Base64 string, and reverses the process to decode Base64 strings back to their original text or binary representation.
- Two panes: Input and Output: Only horizontal split
- If I paste a link that has a base64 encoded string, it will be decoded automatically; I can modify the data and the link will update automatically.
- The data will always stay in sync between the two panes, no matter where I modify it.
- Copy to clipboard button for the output.
- If it's a URL with base64 encoded data, also always show a link that opens in a new tab.

### JSON Formatter, Validator

- Parses unformatted, minified, or broken JSON strings to validate syntax and pretty-print the structure with uniform indentation.
- two panes: Input and Output
- Layout: User can choose between horizontal or vertical split
- Light syntax highlighting for JSON that also shows errors.
- Option to load and save JSON files from the local file system.
- Option to paste and copy JSON data from the clipboard.
- Export can be minified or pretty-printed.

### JSON Diff

- Compares two JSON objects and shows the differences.
- two panes: Left and Right; user can choose between horizontal or vertical split
- Option to load json from local file system or paste from clipboard
- json will be automatically beautified
- Option to sort the json by key recursively
- Option to ignore Case