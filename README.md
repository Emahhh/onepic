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

## Layout Helpers

Reusable helpers live in `src/layouts.ts`:

- `computeMasonryLayout(photos, { columns, gutter, width })` – packs items into the shortest column each time while preserving aspect ratios.
- `computeJustifiedLayout(photos, { rowHeight, gutter, width })` – groups photos into rows with shared height, scaling each row to span the export width without cropping.

Both functions return `{ width, height, items }`, where `items` are `{ id, x, y, width, height }` ready to drop into the Konva stage.

## Export Workflow

The Konva `Stage` is kept at the final export size (default 3600×N). The preview is scaled using pure CSS transforms so the download button can call `stageRef.current.toDataURL({ mimeType: 'image/jpeg', quality: 0.95 })` without any extra re-rendering.

