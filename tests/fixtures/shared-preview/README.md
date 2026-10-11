# Shared-preview captured HTML

These are byte-identical copies of retained run8 diagnostic HTML, not hand-authored approximations.

- `design-root.html`: `tmp/run8-richer-material/design.html`, captured `https://designcore.org/`; 96,266 bytes; SHA-256 `9cc4ad6a9a4a5060814d74006e216654c3252a16044876ac493864c72bba81ae`.
- `design-child.html`: `tmp/run8-richer-material/design-project.html`, captured `https://designcore.org/news/drinks-by-design-light-sound`; 76,352 bytes; SHA-256 `bc84945964a18dfa8b619c7e3b26c9f2bfbd05bc4b0bee60648d85e3e5d12572`.

The root contains the observed child link. Both pages declare the same preview. The child contains main-context event photography; no exact pictured-artist attribution is established. Fixture URLs are test evidence only, not production source seeds.

`source-inspection-shared-preview.test.mjs` intercepts the real adapter's emitted JavaScript and evaluates it in Chromium against these bytes at their original URLs. Page scripts are disabled and all other requests aborted. Image health transport is stubbed, so this is deterministic extraction/reduction/normalization coverage, not live image availability or creative-vision proof. Chromium can expose either literal `src` or the responsive `currentSrc` from the retained `srcset`; neither is reconstructed. Unrelated-host synthetic fixtures exercise the same emitted code.
