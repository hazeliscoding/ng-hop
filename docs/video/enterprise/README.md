# The enterprise upgrade, on video

The source of M7's tutorial, where Claude Code with ng-hop takes [`examples/enterprise`](../../../examples/enterprise/) from Angular 21 to 22, the team's own libraries first. It's made with [HyperFrames](https://hyperframes.heygen.com) from the real run: the terminal lines, diffs and screenshots come from what the run did, and the narration is a synthetic voice.

`script.mjs` holds the narration, a sentence at a time, and the styles every chapter shares. `scenes/<chapter>.html` holds a chapter's visuals, where `data-cue="s12"` brings an element in as sentence `s12` starts and `data-out` takes it away.

## Make it

It needs Node 22 or newer and FFmpeg. The voice also needs a Python with `kokoro-onnx` and `soundfile`, named in `HYPERFRAMES_PYTHON`.

```sh
node tools/voice.mjs   # the narration, and timings.json from it
node tools/build.mjs   # index.html and compositions/, from the script, the scenes and the timings
npx --yes hyperframes@0.9.22 check
npx --yes hyperframes@0.9.22 render --quality delivery --output enterprise.mp4
```

After a scene changes, build, check and render again. After the narration changes, make the voice first, since every cue moves with it. The build also writes `chapters.txt`, the chapter list for the video's description.

JetBrains Mono is under the SIL Open Font License, in `assets/fonts/LICENSE`.
