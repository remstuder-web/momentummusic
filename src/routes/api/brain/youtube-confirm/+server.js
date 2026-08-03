// src/routes/api/brain/youtube-confirm/+server.js
//
// POST { title, sourceUrl, content, tags, category } -> writes a drafted
// YouTube ingest entry into the Brain once the user has picked a category
// from the suggestions returned by /api/brain/youtube-ingest.

import { json } from '@sveltejs/kit';
import { saveYoutubeEntry } from '$lib/server/youtubeBrain.js';

export async function POST({ request }) {
    const { title, sourceUrl, content, tags, category } = await request.json();

    if (!content || !category) {
        return json({ error: 'Missing content or category' }, { status: 400 });
    }

    try {
        const entry = await saveYoutubeEntry({ title, sourceUrl, content, tags, category });
        return json({ ok: true, entry });
    } catch (err) {
        return json({ ok: false, error: err.message }, { status: 500 });
    }
}
