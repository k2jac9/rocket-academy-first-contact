# FIRST CONTACT concept film

[← Project README](../../README.md) · [Watch the original MP4](rocket-academy-first-contact.mp4)

The project owner supplied this film for the README. It illustrates the product vision, including future world-model exploration and learning workflows; it is not a recording of the current application or evidence of validated simulation/training results.

| Asset | Details |
| --- | --- |
| `rocket-academy-first-contact.mp4` | Unmodified original; 7,112,702 bytes; 1280 × 720; H.264 at 24 fps; AAC audio; approximately 10 seconds |
| `first-contact-preview.webp` | Silent looping preview derived from the original; 960 × 540 at 12 fps; approximately 3.52 MB |
| `first-contact-poster.jpg` | Still extracted at 1.7 seconds; used when reduced motion is requested |

Original MP4 SHA-256:

```text
c3d30c131472c5f77f8a3a1e6ff037ec6e52277c35aa5424f63f404f6501c74b
```

The README links the preview to the repository's MP4 and includes a separate text link. The animation is an image preview; full video playback and sound are available by opening the MP4. All links are relative so they follow the checked-out branch and do not depend on the original Windows Downloads path.

To regenerate the presentation assets with FFmpeg, run from the repository root:

```bash
ffmpeg -i docs/media/rocket-academy-first-contact.mp4 -an -vf "fps=12,scale=960:-1:flags=lanczos" -c:v libwebp_anim -lossless 0 -quality 65 -compression_level 5 -loop 0 docs/media/first-contact-preview.webp
ffmpeg -ss 1.7 -i docs/media/rocket-academy-first-contact.mp4 -frames:v 1 -q:v 2 -update 1 docs/media/first-contact-poster.jpg
```

Keep the original MP4 unchanged. These files live under `docs/`, so they are not automatically shipped with the Vite application build.
