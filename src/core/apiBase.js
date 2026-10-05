// Where the two server-backed endpoints live. Empty means "same origin" (node server.mjs, Vercel, Netlify).
// On a static host such as GitHub Pages there is no backend: set VITE_API_BASE at build time to point at one.
export const API_BASE = String(import.meta.env?.VITE_API_BASE ?? '').replace(/\/$/, '');
