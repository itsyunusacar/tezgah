# docs

- `images/` — the cover, screenshots and demo used by the README, in English and Turkish (`-tr`). Screenshots and recordings come from the real app running the demo below, in the light theme.
- `brand/cover.html` — the cover: `electron docs/brand/render.cjs docs/brand/cover.html docs/images/cover.png 1280 640` (add `lang=tr` for Turkish). `images/social-preview.png` is the same with square corners, for the repository's social preview.
- `brand/frame.py` — puts a screenshot or recording on the light grid-paper stage as a rounded card, like the first-run tour: `python3 docs/brand/frame.py image shot.png framed.png`, or `layers` for ffmpeg.
- `demo/fake-agent.mjs` — a stand-in agent that prints a Claude Code-like transcript and reports its state with OSC 7501, so screenshots show real statuses without real conversations. `demo/site/` is the page shown in the browser pane.
