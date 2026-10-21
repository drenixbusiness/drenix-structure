# Drenix — Interactive Organizational Structure

Next.js 15 + three.js. Two views of the office structure that scale with fleet size (5 / 25 / 50 / 75 / 100 trucks):
a 2D **Chart** and a **3D Company Map**. Every position opens its job description from Google Drive.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start
```

## Where things live

| What | File |
|---|---|
| All data: job descriptions (verbatim from Drive), departments, headcount per truck count | `src/data/drenix-data.ts` |
| Headcount math, deltas | `src/lib/org.ts` |
| 2D chart | `src/components/ChartView.tsx` |
| 3D scene (three.js) | `src/components/three/CompanyScene.ts` |
| 3D UI: labels, drawer, breadcrumb | `src/components/Map3D.tsx` |
| Styles / brand tokens | `src/app/globals.css` |

HR edits only `src/data/drenix-data.ts`. To add a fleet size, add it to `TRUCK_STOPS` and `FLEET_MODELS`.
Keep role `id`s stable between sizes — they drive the ▲/▼ deltas and NEW badges.

## Logo

`public/drenix-mark.png` is the Drenix phoenix mark (transparent, 512×512) and `public/favicon-64.png` the tab icon, both cut from the official logo.
