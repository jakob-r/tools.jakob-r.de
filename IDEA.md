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

### GPX Cleaner

#### 1. Product Overview

The **GPX Cleaner** is a web-based, automated utility designed to repair and optimize GPS track files. It utilizes a "one-click" pipeline powered by intelligent algorithms rather than manual threshold sliders. Users can instantly compare their original raw data against the cleaned track via a synchronized dual-pane interface, with the ability to override automated decisions before export.

#### 2. User Interface & Experience (UX)

##### 2.1 Core Layout

* **Top Bar:** File upload (Drag & Drop), Export button, and global stats comparison (Original vs. Cleaned: Distance, Time, Elevation, Point Count).
* **Main Stage (Split View):**
* **Left Pane:** Original Track (Red/Orange styling, showing all messy data and spikes).
* **Right Pane:** Cleaned Track (Blue/Green styling).
* *Interaction:* Panning and zooming in one pane automatically synchronizes the other. Hovering over a point in one map highlights the corresponding point in the other.


* **Bottom Panel (Timeline & Overrides):**
* **Profile Selector:** Auto-detected activity profile (with a dropdown to change it manually).
* **Toggle Switches:** Simple on/off switches for each cleaning phase (e.g., "Remove Spikes", "Clean Pauses", "Auto-Crop End").
* **Interactive Elevation/Speed Chart:** A timeline scrubber allowing the user to visually inspect the data and manually adjust the "End of Activity" crop marker if the algorithm misjudged the car ride home.

---

#### 3. Data Processing Pipeline

When a file is uploaded, the system executes the following steps sequentially.

##### Step 1: Pre-Processing & Provisional Truncation

Before identifying the activity, the system must filter out obvious "transit" data (driving away with the GPS still on), otherwise, a 100 km/h drive will skew the data and misclassify a walking track as a cycling track.

* **Algorithm:** Change-Point Detection (CPD).
* **Logic:** Scans the final 20% of the track for an abrupt, sustained step-change in average speed (e.g., jumping from a baseline of 5 km/h to a sustained >40 km/h with no drop-offs).
* **Action:** Provisionally marks the track end at the step-change timestamp.

##### Step 2: Auto-Profiling (Decision Tree)

Using the provisionally truncated track, the system calculates the **Median Moving Speed**, **95th Percentile Speed ($V_{95}$)**, and **Elevation Variance** to determine the baseline physical limits.

| Auto-Detected Profile | Decision Tree Logic | Processing Characteristics applied later |
| --- | --- | --- |
| **Walk / Hike** | $V_{95} < 7$ km/h | Very sensitive to pause-drift. High tolerance for low speeds. Acceleration limits set to human walking limits. |
| **Run** | $7 \le V_{95} < 16$ km/h | Lower pause tolerance (runners stop less). Moderate acceleration limits. |
| **Mountain Bike (MTB)** | $16 \le V_{95} < 26$ km/h OR (High Elevation Variance + V95 < 35) | Expects rapid speed changes and tight switchbacks (RDP simplification must be gentle to preserve corners). |
| **Road Bike** | $V_{95} \ge 26$ km/h | Very high speed limits. Low tolerance for sharp angles (spikes are easier to detect). |

##### Step 3: The One-Click Cleaning Algorithms

With the profile selected, the system runs the data through four algorithmic filters.

##### A. GPS Spike Removal (Angle/Acceleration Filter)

* **Problem:** Multipath errors where a point jumps 200m away and immediately back.
* **Solution:** Calculates the angle between $P_{i-1} \to P_i$ and $P_i \to P_{i+1}$. If the angle is highly acute (e.g., $< 30^\circ$, forming a sharp "V") **AND** the required acceleration to reach $P_i$ exceeds the physical limits of the selected Activity Profile, $P_i$ is flagged for deletion.

##### B. Pause Drift Cleaning (DBSCAN Clustering)

* **Problem:** Recording stationary movement (lunch breaks, stoplights) creates "scribbles" that add phantom distance.
* **Solution:** Density-Based Spatial Clustering of Applications with Noise (DBSCAN).
* **Logic:** The algorithm looks for clusters where points remain within a small spatial radius ($r = 15$ meters) for a minimum dwell time ($t = 120$ seconds).
* **Action:** All points within this temporal/spatial cluster are deleted and replaced by a single centroid point. The timestamps of the entry and exit are preserved so total elapsed time remains correct, but moving time and distance are fixed.

##### C. Track Simplification (Ramer-Douglas-Peucker)

* **Problem:** Over-sampled straight lines making the file size unnecessarily large.
* **Solution:** RDP Algorithm.
* **Logic:** Removes points that deviate less than $\epsilon$ (epsilon) from the straight line between two anchor points.
* **Profile tuning:** $\epsilon$ is set to 2 meters for walking (preserving micro-curves) and 5 meters for road cycling (smoothing out road jitter).

#### 4. Manual Overrides (User Control)

Despite the one-click automation, users must retain control. They can:

1. **Change the Activity Profile:** If "Run" was detected but the user was on an "MTB" on a slow, steep climb, changing the dropdown instantly re-runs the pipeline with MTB thresholds.
2. **Toggle Pipeline Stages:** The user can uncheck "Clean Pauses" if they actually *want* to see their movement around a campsite.
3. **Adjust the Crop Markers:** On the bottom elevation/speed timeline chart, a red vertical marker shows where the "Forgot to stop" truncation occurred. The user can drag this marker left or right to fine-tune exactly where they got into the car.

#### 5. Output & File Integrity

* **GPX Tag Preservation:** The exporter must faithfully preserve all non-location data, including `<time>`, `<ele>` (elevation), and `<extensions>` (Heart Rate, Cadence, Power, Temperature).
* **Single Segment Preference:** Rather than splitting the GPX into multiple `<trkseg>` blocks (which breaks platforms like Strava), the cleaned file exports as a single continuous segment. Pauses are handled simply by a large timestamp gap between two points, which modern fitness platforms interpret correctly as a pause.