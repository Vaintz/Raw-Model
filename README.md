# VRM Web Viewer

Browser-based viewer for a VRM avatar built with HTML, CSS, JavaScript, Three.js, and `@pixiv/three-vrm`.

## Features
- Load a VRM avatar and discover its supported expressions.
- Orbit, zoom, and pan the 3D camera with automatic avatar framing.
- Procedural idle, nod, wave, and bow motions.
- Load compatible `.vrma` animation clips with play, pause, stop, and speed controls.

## Run locally
Run `python -m http.server 8000` in this folder, then open http://localhost:8000.

The libraries are loaded from a CDN, so an internet connection is required. Check the avatar's license before redistributing it.