// Render entirely client-side — no SSR.
// Avoids build-time env var issues on Vercel and prevents
// any SSR error from causing fallback to the root route.
export const ssr = false
