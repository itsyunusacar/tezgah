# docs

- `images/` — the cover, screenshots and demo used by the README. Screenshots come from the real app running the demo below.
- `brand/cover.html` — the cover, rendered with `electron docs/brand/render.cjs docs/brand/cover.html docs/images/cover.png 1280 640` (add `lang=tr` for the Turkish one).
- `demo/fake-agent.mjs` — a stand-in agent that prints a Claude Code-like transcript and reports its state with OSC 7501, so screenshots show real statuses without real conversations. `demo/site/` is the page shown in the browser pane.
