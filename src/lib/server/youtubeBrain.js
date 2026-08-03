// src/lib/server/youtubeBrain.js
//
// Pipeline: YouTube URL -> transcript (yt-dlp) -> Claude extraction -> Brain entry
//
// Assumes yt-dlp is installed on the server/VPS (already used in the audio reference pipeline).
// Assumes ANTHROPIC_API_KEY is set as an env var.
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
async function extractInsights(title, transcript) {
    const prompt = `You are extracting actionable knowledge from a YouTube video transcript for a music producer's permanent knowledge base.

Video title: "${title}"

Transcript:
"""
${transcript.slice(0, 60000)}
"""

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
            'x-api-key': process.env.ANTHROPIC_API_KEY,
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
async function addToBrain({ title, sourceUrl, content, tags }) {
    const { data, error } = await supabase
        .from('brain_knowledge')
        .insert({
            category: 'production_style',
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
 * Full pipeline for a single URL. Never throws past this point —
 * returns a result object so batch processing can continue on failure.
 */
export async function ingestYoutubeVideo(url) {
    try {
        const { title, transcript } = await extractTranscript(url);
        const notes = await extractInsights(title, transcript);

        // crude tag pull from the "## Tags" section Claude was asked to produce
        const tagMatch = notes.match(/## Tags\s*\n(.+)/);
        const tags = tagMatch ? tagMatch[1].split(',').map((t) => t.trim()) : [];

        const entry = await addToBrain({ title, sourceUrl: url, content: notes, tags });
        return { url, status: 'success', title, entry };
    } catch (err) {
        return { url, status: 'error', error: err.message };
    }
}

/**
 * Batch entry point — accepts multiple URLs, processes sequentially
 * (yt-dlp + API calls don't need to hammer in parallel; sequential
 * is safer for rate limits and easier to debug).
 */
export async function ingestYoutubeVideos(urls) {
    const results = [];
    for (const url of urls) {
        results.push(await ingestYoutubeVideo(url.trim()));
    }
    return results;
}
