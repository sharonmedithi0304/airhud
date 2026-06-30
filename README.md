# AirHUD — Touchless Gesture Interface

A browser-based, zero-install evolution of the original Python virtual-keyboard project.
Runs entirely client-side (MediaPipe Hand Landmarker via WASM/GPU), so it deploys as a
plain static site — no Python, no backend, no install step for anyone who opens the link.

## Why this is the web version

The original project used `pynput` to move your **real OS mouse** — that only works as a
local desktop process and can never run on a host like Vercel (no website can control your
system input device, by design, for security). This rebuild keeps the spirit — bare-hands
control — but the cursor and keyboard live **inside the page**, which is what makes it
deployable, instantly shareable, and safe to run from any link.

## Features

- **Live skeletal hand tracking** rendered as a glowing neon rig over the webcam feed
- **Pinch-to-click / pinch-to-type**, with a charging reticle ring so clicks feel intentional, not accidental
- **Peace sign ✌ → scroll**, move your hand vertically to scroll the page
- **Fist ✊ → drag** gesture state (extend with your own drag targets)
- **Two-hand pinch + spread → zoom** the interface
- **Glassmorphism virtual keyboard** with hover/charge/press states
- Adjustable **sensitivity** and **smoothing**
- **Sound + voice feedback** toggles
- Three HUD **themes** (cyan / violet / amber)
- Live FPS / hand-count / event log panel

## Run locally

No build step needed — it's plain HTML/CSS/JS loading MediaPipe from CDN.

```bash
npx serve .
# or
python -m http.server 8080
```

Then open the printed URL and click **Enable Camera & Begin**.

## Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Or: push this folder to a GitHub repo → import it in the Vercel dashboard → deploy.
No framework, build command, or environment variables are required — Vercel will
serve it as a static site automatically.

## Notes

- Needs a webcam and a browser with WebGPU/WebGL support (Chrome/Edge recommended).
- All processing happens on-device; nothing is uploaded anywhere.
- The original Python desktop app (`key.py`) is a separate, more "real OS control"
  tool and is not part of this web build — keep it as a local-only companion project
  if you want actual system-level mouse/keyboard control.