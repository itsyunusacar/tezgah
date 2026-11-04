# docs

- `images/` — the cover, screenshots and demo used by the README, in English and Turkish (`-tr`). Screenshots and recordings come from the real app running the demo below, in the light theme.
- `brand/cover.html` — the cover: `electron docs/brand/render.cjs docs/brand/cover.html docs/images/cover.png 1280 640` (add `lang=tr` for Turkish). `images/social-preview.png` is the same with square corners, for the repository's social preview.
- `brand/frame.py` — puts a screenshot or recording on the light grid-paper stage as a rounded card, like the first-run tour: `python3 docs/brand/frame.py image shot.png framed.png`, or `layers` for ffmpeg.
- `demo/fake-agent.mjs` — a stand-in agent that prints a Claude Code-like transcript and reports its state with OSC 7501, so screenshots show real statuses without real conversations. `demo/site/` is the page shown in the browser pane.

## Making the screenshots and demo again

Everything runs against a throwaway profile, with the demo projects in `/Users/Shared/demo` (three small git repos: acme-web with uncommitted changes on a `fix-expired-tokens` branch, acme-api, acme-docs) and the Tezgah window driven over the DevTools protocol on port 9333.

```sh
docs/demo/stage.sh en light                          # launch with six sessions; Turkish: tr light "<six titles>"
node docs/demo/shot.mjs out.png                      # screenshot the window
node docs/demo/record.mjs rec/ docs/demo/scenario.js # record the click-through (frames + timing)
python3 docs/brand/frame.py image out.png docs/images/hero.png
python3 docs/brand/frame.py layers 1000 2720 1720 layers/ && python3 docs/demo/gifframes.py rec/ gif/ layers/
```

`shoot-hero.sh` stages and waits until the first agent asks for permission before taking the shot. Then the GIF: `ffmpeg -framerate 12 -i gif/g%04d.png` with palettegen/paletteuse over a white background (transparent corners make GIFs about 40 times bigger).
