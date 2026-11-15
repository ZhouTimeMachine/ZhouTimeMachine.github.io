# JVT project page

Static English project page with generated videos, paper figures and results,
interactive geometry, and annotated camera-following comparisons. No build step.

## Preview and deployment

From this directory:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000/>. Serve over HTTP because the interactive demos use
`fetch()`. Deploy the contents of this directory together; asset paths are relative
and work under a subpath such as `/JVT/`.

Google Fonts and three.js 0.164.1 currently load from external CDNs. System fonts
and static scene images remain available if those services are unavailable.
Point clouds load when the geometry section enters the viewport. Videos load
near the viewport and pause offscreen. The full-width benchmark carousel scrolls
continuously at 32 CSS pixels per second and loops without cloning video elements. Hover,
keyboard focus, touch interaction, fullscreen, or the Pause button suspend automatic
scrolling. Reduced-motion preferences disable automatic scrolling and playback,
while manual browsing and playback remain available.

## Content and sources

- `index.html`: paper metadata, English copy, accessible HTML tables, and static
  first-scene previews. `styles.css`: responsive layout and visual styling.
- `site.js`: video loading/playback, lazy demo initialization, and citation copy.
  `geometry.js`: frame controls and three.js viewer. `camera.js`: annotated
  camera-following comparison.
- `assets/jvt.pdf`: copied from `../jvt_paper_arxiv/jvt.pdf`.
- `assets/figures/`: paper figures rasterized from `transformer-and-register.pdf`,
  `3dpatchify.pdf`, and `joint-pcd.pdf` at 180 dpi. The joint-generation figure also
  has a smaller WebP preview; its original PNG remains linked for full-size viewing.
- `assets/videos/`: copies of the four `../cases/*_grid.mp4` videos. Posters are
  extracted at 1 second. The supplied grids are 1280 × 1280, 16 frames, 8 fps.
- Generation tables follow `../jvt_paper_arxiv/tables/fvd-main.tex`, the table
  actually included by the paper. Camera results follow `tables/rgbd-eval.tex`.
  When updating results, update both the selected and full benchmark tables.
- `data/`: existing geometry and camera-comparison exports, unchanged. The
  camera carousel respects the selection/order in `data/camctrl/boxes.json`.

The GitHub link is intentionally active without checking repository availability.
The Arxiv button and BibTeX use `XXXX.XXXXX` as an arXiv ID placeholder. When the
official entry is available, replace all three occurrences in `index.html`
(button URL, BibTeX eprint, and BibTeX URL). No publication year or venue is inferred.

## Useful additional material

These additions are optional and do not block the current page:

1. UCF101 class names mapped to grid positions, numbered row by row from top left.
2. Sampling configurations for each grid: checkpoint, steps, CFG scale, RG status
   and scale, and any sample-selection protocol. The page does not infer these.
3. Baseline videos under matching generation settings for qualitative comparisons.
4. Author homepages, official arXiv/BibTeX details, and a short narrated overview.

When changing a static first-scene preview or the exported camera selection,
keep the initial HTML images/boxes in sync with the corresponding JSON data.
