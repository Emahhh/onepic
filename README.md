# OnePic

OnePic is a client-only React SPA that stitches up to 100 original photos into a single, high-resolution collage. Users can switch between masonry and justified algorithms, toggle an optional polaroid footer, and export the final canvas as a crisp JPEG—no backend required.

## Tech Stack

- React 19 + TypeScript on Vite
- Material UI v5 (custom dark theme + Space Grotesk variable font)
- `react-konva` for GPU-accelerated canvas composition
- `date-fns` for friendly default captions

## Getting Started

```bash
npm install
npm run dev
```

Visit the dev server URL shown in the terminal (defaults to http://localhost:5173).

## Core Scripts

- `npm run dev` – start Vite in development mode
- `npm run build` – type-check and produce an optimized production build
- `npm run preview` – serve the build locally
- `npm run lint` – run ESLint across the workspace

## Features

- Upload up to 100 original images at once (drag-and-drop or file picker)
- Live preview that preserves export resolution while scaling down visually for mobile
- Masonry layout with adjustable column count
- Justified layout with adjustable target row height
- Optional footer (default date text) that mimics a polaroid frame
- One-click JPEG export via `Stage.toDataURL`
- Tunable JPEG compression presets (Crisp/Balanced/Compact) with a live estimated file size indicator

## Layout Helpers

Reusable helpers live in `src/layouts.ts`:

- `computeMasonryLayout(photos, { columns, gutter, width })` – packs items into the shortest column each time while preserving aspect ratios.
- `computeJustifiedLayout(photos, { rowHeight, gutter, width })` – groups photos into rows with shared height, scaling each row to span the export width without cropping.

Both functions return `{ width, height, items }`, where `items` are `{ id, x, y, width, height }` ready to drop into the Konva stage.

## Export Workflow

The Konva `Stage` now renders at a responsive preview width (capped at 1400 px) using an internal scale transform, so the UI never needs to push a 3600 px canvas through layout. When you tap **Download JPEG**, the stage temporarily renders at its native framed width (3600 px collage + 48 px padding on each side), captures the bitmap via `toDataURL`, and then snaps back to the lightweight preview scale. The same render path powers the size estimator so the UI can display approximate file weights for each compression preset.

## Performance Notes

- Every upload is decoded into an `ImageBitmap` (or a downscaled `<canvas>` fallback) whose width never exceeds the final export width of 3600 px. That keeps GPU memory predictable while preserving the output resolution.
- The interactive preview layer runs with a capped canvas width and `perfectDrawEnabled={false}` so adding dozens of photos stays smooth, even on mobile.
- Exporting reinstates the full-resolution framed stage only for the duration of the capture, so you still get a high-res JPEG without the UI lag.

