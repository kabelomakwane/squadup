# Squad Up

A dependency-free, Netlify-ready five-a-side Premier League match simulator.

## Run locally

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Deploy

Connect this folder to Netlify. No build command is required; the publish directory is `.`.

## Commentary architecture

The first version uses a deterministic local commentary engine in `app.js`. Match events are generated from player ratings, positions, attributes, and a match seed. The `generateMatch()` boundary can later be replaced or enriched by a server-side AI provider without changing the UI.
