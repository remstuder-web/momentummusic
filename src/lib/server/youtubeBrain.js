// src/lib/server/youtubeBrain.js
//
// Pipeline: YouTube URL -> transcript (yt-dlp) -> Claude extraction -> category
// suggestion -> (user picks topic) -> Brain entry
//
// Assumes yt-dlp is installed on the server/VPS (already used in the audio reference pipeline).
// Needs ANTHROPIC_API_KEY at runtime (local .env). Read via $env/dynamic/private so the build
// does not require it — on Vercel it is deliberately not set and this pipeline reports itself unavailable.
//
// Brain writes go through the same `brain_knowledge` table and anon-key client
// that every other write path in this app uses (momentum-watcher.cjs's
// add_brain_entry tool writes to brain_knowledge with the publishable/anon key —
// there is no SUPABASE_SERVICE_KEY in .env, so this mirrors that pattern instead
// of a service-role client).

import { spawn } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { supabase } from '$lib/supabase.js';
import { env } from '$env/dynamic/private';

export function youtubeBrainAvailable() {
    return !!env.ANTHROPIC_API_KEY;
}

function anthropicKey() {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set — YouTube → Brain only runs locally');
    return env.ANTHROPIC_API_KEY;
}

/**
 * Runs a shell command and resolves with stdout, rejects on non-zero exit.
 */
function run(cmd, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => (stdout += d));
        proc.stderr.on('data', (d) => (stderr += d));
        proc.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(`${cmd} exited ${code}: ${stderr}`));
        });
    });
}

/**
 * Strips WebVTT timestamps/formatting down to plain spoken text.
 */
function parseVtt(vttContent) {
    return vttContent
        .split('\n')
        .filter((line) => {
            const trimmed = line.trim();
            if (!trimmed) return false;
            if (trimmed === 'WEBVTT') return false;
            if (/^\d+$/.test(trimmed)) return false; // cue numbers
            if (/-->/.test(trimmed)) return false; // timestamp lines
            return true;
        })
        .join(' ')
        .replace(/<[^>]+>/g, '') // inline vtt tags
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Downloads auto-generated (or manual, if available) subtitles for a video
 * and returns plain transcript text plus the video title.
 */
async function extractTranscript(url) {
    const dir = await mkdtemp(path.join(tmpdir(), 'yt-'));
    const outputTemplate = path.join(dir, '%(id)s.%(ext)s');

    // Get title first
    const title = (await run('yt-dlp', ['--print', '%(title)s', '--skip-download', url])).trim();

    // Pull subtitles (prefers manual, falls back to auto-generated)
    await run('yt-dlp', [
        '--skip-download',
        '--write-sub',
        '--write-auto-sub',
        '--sub-lang',
        'en',
        '--sub-format',
        'vtt',
        '-o',
        outputTemplate,
        url
    ]);

    const files = await run('bash', ['-c', `ls "${dir}"`]);
    const vttFile = files
        .split('\n')
        .map((f) => f.trim())
        .find((f) => f.endsWith('.vtt'));

    if (!vttFile) {
        await run('rm', ['-rf', dir]);
        throw new Error('No subtitles/captions available for this video');
    }

    const raw = await readFile(path.join(dir, vttFile), 'utf-8');
    const transcript = parseVtt(raw);
    await run('rm', ['-rf', dir]);

    return { title, transcript };
}

/**
 * Sends the transcript to Claude and gets back a clean, structured,
 * actionable note — fluff stripped.
 */
async function extractInsights(title, transcript, personalNote) {
    const noteBlock = personalNote
        ? `\n\nThe user added this personal note about why they saved this video: '${personalNote}'\nMake sure to highlight anything related to this note in the actionable points.`
        : '';

    const prompt = `You are extracting actionable knowledge from a YouTube video transcript for a music producer's permanent knowledge base.

Video title: "${title}"

Transcript:
"""
${transcript.slice(0, 60000)}
"""
${noteBlock}

Extract ONLY the concrete, actionable techniques, steps, numbers, tool names, or settings mentioned. Ignore intros, sponsor reads, filler, and generic motivational talk.

Respond in this exact format, nothing else:

## Summary
(1-2 sentences on what this video actually teaches)

## Actionable Points
- (bullet per concrete technique/step/setting, be specific)

## Tags
(comma-separated: e.g. mixing, vocal-chain, distribution, ai-tools, mastering)`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey(),
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', // cheap/fast — this is pure extraction, not creative work
            max_tokens: 1500,
            messages: [{ role: 'user', content: prompt }]
        })
    });

    if (!response.ok) {
        throw new Error(`Claude API error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const text = data.content.find((block) => block.type === 'text')?.text ?? '';
    return text;
}

/**
 * Writes the extracted note into the Brain.
 *
 * Mirrors the exact shape of momentum-watcher.cjs's `add_brain_entry` tool
 * (table `brain_knowledge`; columns category, title, content, entry_type_v2,
 * confidence, source_type, active) plus `source_url` and `metadata`, both of
 * which are real columns already used elsewhere in the watcher for other
 * brain_knowledge inserts (source_url e.g. in the chart-analysis agent;
 * metadata is part of the documented brain_knowledge schema in CLAUDE.md).
 */
async function addToBrain({ title, sourceUrl, content, tags, category }) {
    const { data, error } = await supabase
        .from('brain_knowledge')
        .insert({
            category,
            title: (title || '').slice(0, 80),
            content,
            entry_type_v2: 'reference',
            confidence: 'medium',
            source_type: 'youtube_ingest',
            source_url: sourceUrl,
            metadata: { tags },
            active: true
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Asks the watcher's existing /suggest-category endpoint (same one BrainTab's
 * dump flow uses) to classify the extracted notes against real brain_knowledge
 * categories/content. Runs server-side using the env ANTHROPIC_API_KEY rather
 * than a browser-supplied key.
 */
async function suggestCategory(text) {
    const res = await fetch('http://localhost:4242/suggest-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, apiKey: anthropicKey() })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'suggest-category failed');
    return data;
}

/**
 * Extracts + drafts a single URL — does NOT write to the Brain yet.
 * Returns the note plus a suggested category (and alternatives) so the
 * user can pick the topic before it's saved. Never throws past this
 * point — returns a result object so batch processing can continue on
 * failure.
 */
export async function ingestYoutubeVideo(url, personalNote) {
    try {
        const { title, transcript } = await extractTranscript(url);
        const notes = await extractInsights(title, transcript, personalNote);

        // crude tag pull from the "## Tags" section Claude was asked to produce
        const tagMatch = notes.match(/## Tags\s*\n(.+)/);
        const tags = tagMatch ? tagMatch[1].split(',').map((t) => t.trim()) : [];

        // Prepend the note so it stays attached to the entry permanently in the Brain
        const content = personalNote ? `📌 Personal note: ${personalNote}\n\n${notes}` : notes;

        let suggestion;
        try {
            suggestion = await suggestCategory(content);
        } catch (err) {
            suggestion = { category: '', action: 'new', reason: `Category suggestion failed: ${err.message}`, alternatives: [], allCategories: [] };
        }

        return {
            url,
            status: 'draft',
            title,
            sourceUrl: url,
            content,
            tags,
            category: suggestion.category || suggestion.suggestion || '',
            categoryAction: suggestion.action || 'new',
            categoryReason: suggestion.reason || '',
            alternatives: suggestion.alternatives || [],
            allCategories: suggestion.allCategories || []
        };
    } catch (err) {
        return { url, status: 'error', error: err.message };
    }
}

/**
 * Confirm step — writes a drafted entry (with the user's chosen category)
 * into the Brain. Called once the user has picked a topic from the
 * suggestions returned by ingestYoutubeVideo.
 */
export async function saveYoutubeEntry({ title, sourceUrl, content, tags, category }) {
    if (!category) throw new Error('category is required');
    return addToBrain({ title, sourceUrl, content, tags, category });
}

/**
 * Batch entry point — accepts multiple URLs, processes sequentially
 * (yt-dlp + API calls don't need to hammer in parallel; sequential
 * is safer for rate limits and easier to debug).
 */
export async function ingestYoutubeVideos(urls, personalNote) {
    const results = [];
    for (const url of urls) {
        results.push(await ingestYoutubeVideo(url.trim(), personalNote));
    }
    return results;
}
