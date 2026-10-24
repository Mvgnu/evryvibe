# Collector video fixtures

`intro-flyer.webm` is a silent, synthetic 5-second clip (640×360). A red/blue
intro lasts until 0.9 seconds, the flyer appears from 0.9–2.4 seconds, and a black
outro follows. Thus 1- and 2-second samples recover the flyer while 0/mid/end
samples miss it. `short.webm` is its first 0.4 seconds for bounded seek tests.

Tests consume these tiny committed files and require no video encoder. To
regenerate locally, install `ffmpeg` and run from the project directory:

```sh
npx tsx tests/fixtures/video/generate.mts
```

Chromium generates the source text image. No external media or personal data is
included. ffmpeg is only a fixture-generation tool, never a collector dependency.
