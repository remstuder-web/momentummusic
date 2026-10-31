// src/routes/api/brain/youtube-ingest/+server.js
//
// POST { urls: string[], personalNote?: string } -> ingests each YouTube video into the Brain.
// Wire the DailyTab textarea/input to POST here.

import { json } from '@sveltejs/kit';
import { ingestYoutubeVideos, youtubeBrainAvailable } from '$lib/server/youtubeBrain.js';

export async function POST({ request }) {
    const { urls, personalNote } = await request.json();

    if (!Array.isArray(urls) || urls.length === 0) {
        return json({ error: 'Provide at least one YouTube URL' }, { status: 400 });
    }

    if (!youtubeBrainAvailable()) {
        return json({ error: 'ANTHROPIC_API_KEY is not set — YouTube → Brain only runs locally' }, { status: 503 });
    }

    // Fire and let it run — for a handful of links this finishes in
    // seconds to low minutes. If you start batching 20+ at once,
    // switch this to a background job queue instead of awaiting inline.
    const results = await ingestYoutubeVideos(urls, personalNote);

    return json({ results });
}
