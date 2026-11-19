# Material lab — three experiential studies

Review only. This directory is self-contained; no runtime, existing review, edition, archive, or publication changes.

## Open

- Existing scoped server: http://localhost:4198/experiments/
- Temporary tunnel: https://background-office-subsidiaries-charms.trycloudflare.com/experiments/
- The tunnel returned byte-identical index HTML, and Playwright loaded the real shader and advancing video through it.

## The three stances

1. **Mercury / refractive matter.** Actual WebGL fragment shader samples the current plate. Three source-coordinate masks separate heart, raised bevel, and metal shell. Pointer/touch impulses drive an underdamped spring, localized refraction, metallic edge response, and chromatic dispersion. No idle sweep. At rest the plate is crisp; Freeze returns to the undisturbed plate. Strong at material response, deliberately not a replacement illustration.
2. **Transmission / projected cinema.** A real local H.264 MP4 is perspective-mapped into the heart with an aperture mask, edge emission, and scan texture. Tap the heart or Open motion study to open a contained native player with controls, close button, keyboard Escape, and source link. Strong at dimensional moving imagery; its explicit limitation is that this is generated motion, not linked original video.
3. **Borrowed room / local reflection.** A user-enabled front-camera stream is horizontally mirrored and fractured across angled reflective planes in the beveled shell. Before enabling, a touch-driven fractured plate reflection is explicitly labeled as not live. Strong at making the viewer's surroundings part of the material. The stylized optical treatment is not physically accurate ray tracing.

Review navigation uses keyboard-operable tabs. Immerse hides editorial chrome but retains a reachable exit; camera status and Off remain visible even while immersed. On portrait screens the heart is reframed rather than tightly center-cropped; the outer metal object may extend outside the viewport. Open media remains contained at 320px portrait and 667×375 landscape.

## Provenance / no invented source video

Bounded source discovery read the current edition's source-bindings.json and source-visual-metadata.json. The single source binding declares `source_media_type: image`, not video. Rather than chase unrelated footage or claim a still is original video, this review uses the authorized, openly labeled generated-motion alternative.

- Original post: https://x.com/benoit_tokyo_/status/2055146711660826781
- Exact original image: https://pbs.twimg.com/media/HIVWmeNbYAARUq0.jpg?name=orig
- Saved title: @benoit_tokyo_: yesterday at @emikusano’s opening ✨ 📍@rk_contemporary
- True primary-source image: `assets/source.jpg`, resized from the supplied cached original photograph. The source-notes dialog displays it intact, uncropped.
- Generated landscape plate: `public/editions/2026-11-03-the-heart-behind-the-bevel-v1/assets/plate.png`, compressed locally to `assets/plate.jpg`.
- Motion: `assets/transmission.mp4`, generated **from that plate**, not the photograph or an original exhibition video. 768×768, 30 fps, 180 frames, 6 seconds, H.264, no audio stream.

Visible disclosure: **GENERATED MOTION STUDY OF STILL SOURCE / not source footage**. No stock media or external media service.

Motion generation (from repository root, overwrite deliberately if regenerating):

```sh
ffmpeg -i public/review/creative-directions/experiments/assets/plate.jpg \
  -vf "crop=780:760:680:140,scale=1000:1000,zoompan=z='1.06+0.09*sin(on/180*6.283185)':x='iw/2-(iw/zoom/2)+30*sin(on/180*6.283185)':y='ih/2-(ih/zoom/2)+20*cos(on/180*6.283185)':d=180:s=768x768:fps=30" \
  -c:v libx264 -preset fast -crf 21 -pix_fmt yuv420p -movflags +faststart -an -t 6 \
  public/review/creative-directions/experiments/assets/transmission.mp4
```

## Camera and motion safety

- No camera API call before an explicit Enable camera click. No microphone request (`audio: false`).
- No recording, upload, storage, analytics, or external scripts. Camera frames are local video/GPU textures only.
- Off, changing studies, opening notes/media, visibility-hidden, pagehide, and WebGL context loss stop all acquired tracks.
- A permission epoch invalidates pending requests: late-resolving streams are stopped immediately, including requests canceled with Off or navigation.
- Returning to the page never automatically reacquires camera.
- Denied/missing/unavailable capture preserves an honestly labeled touch alternative.
- Reduced-motion starts frozen and does not autoplay the motion video. The user can explicitly resume or open the native player.
- No WebGL or shader/context failure: honest still artwork remains; native media/source notes still work. Context restoration requires reload.

## Exercised evidence

`tmp/experiential-review/verify.mjs`: **89/89 passing**.
`tmp/experiential-review/extra-verify.mjs`: **13/13 passing**.
**Total: 102/102 assertions**, zero page errors in the main suite.

Run from repository root with the existing scoped server available:

```sh
node tmp/experiential-review/verify.mjs
node tmp/experiential-review/extra-verify.mjs
```

Evidence: `tmp/experiential-review/results.json`, `extra-results.json`, and **26 PNG screenshots**. Viewports: desktop 1440×1000, touch portrait 390×844, small touch portrait 320×568, short touch landscape 667×375.

Coverage includes actual shader compilation, framebuffer pixel changes after mouse/touch input, spring settling, frozen pixel stability, real MP4 time advancement both projected and native, source/plate image decoding, all modes' no-overflow checks, contained opened media, keyboard close/navigation, immersion exit, live local-only camera status and Off in immersion, touch-only fallback pixel changes without sensor requests, synthetic capture pixel changes, all-track cleanup/re-enable, late permissions across switch/Off/hidden/pagehide, simulated permission denial/API absence, actual browser unavailable-capture fallback, reduced motion, WebGL unavailable/context-loss fallback, no broken local responses, and real public-tunnel shader/video readback.

Desktop gesture changed 366,287 framebuffer pixels (25.44%); portrait changed 45,638 (13.86%). These are executed measurements, not screenshot interpretation.

Camera tests used Chromium's **fake-device stream only**. Screenshots containing it carry a conspicuous **SYNTHETIC TEST STREAM — NOT NICK’S CAMERA** banner. No physical camera was requested. The denial case deterministically throws NotAllowedError; this headless Mac build without fake UI returned real NotSupportedError rather than exposing a usable browser permission prompt. Both paths were exercised, not conflated.

An initial native-player test sampled currentTime during a pending seek; the final test waits for readyState≥3, not seeking, and not paused, then measures real advancement. The initial result is retained as `initial-results.json`. The GPU loop also pauses under open dialogs to avoid competing with the native player.

Screenshots were visually inspected with vision analysis; the initial mobile background seam and joined headline word boundary were fixed and final mobile framing re-inspected. Independent parent review is still required; this is not a claim of independent acceptance.

## Limitations

- **Actual camera on Nick's device is unverified; synthetic capture only.** Safari/iOS camera permission UX, real front-camera orientation, and real-device GPU performance still need a consented on-device check.
- This is a disposable local/tunneled experiment, not a production deployment or edition publication. The temporary tunnel can expire.
- Transmission is generated motion of a still plate, not genuine footage from the linked exhibition post.
- Reflective masks are hand-traced approximate source geometry, not exact segmentation or physically accurate 3D optics.
- Tiny peripheral editorial labels remain intentionally quiet; immersion is available for an unobstructed artwork view.
