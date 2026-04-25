import essentia.standard as es
import essentia
import sys, json, math, numpy as np

audio_file = sys.argv[1]

try:
    loader = es.MonoLoader(filename=audio_file, sampleRate=44100)
    audio = loader()
except Exception as e:
    print(json.dumps({'error': str(e)}))
    sys.exit(1)

results = {}

# BPM + rhythm
try:
    rhythm = es.RhythmExtractor2013(method='multifeature')
    bpm, beats, bpm_confidence, _, _ = rhythm(audio)
    results['bpm'] = round(float(bpm), 1)
    results['bpm_confidence'] = round(float(bpm_confidence), 3)
    results['beats_count'] = len(beats)
except Exception:
    results['bpm'] = None
    results['bpm_confidence'] = None

# Key + scale
try:
    key, scale, key_strength = es.KeyExtractor()(audio)
    results['key'] = key
    results['scale'] = scale
    results['key_strength'] = round(float(key_strength), 3)

    CAMELOT = {
        'C major': '8B',  'G major': '9B',  'D major': '10B', 'A major': '11B',
        'E major': '12B', 'B major': '1B',  'F# major': '2B', 'Db major': '3B',
        'Ab major': '4B', 'Eb major': '5B', 'Bb major': '6B', 'F major': '7B',
        'A minor': '8A',  'E minor': '9A',  'B minor': '10A', 'F# minor': '11A',
        'C# minor': '12A','G# minor': '1A', 'Eb minor': '2A', 'Bb minor': '3A',
        'F minor': '4A',  'C minor': '5A',  'G minor': '6A',  'D minor': '7A',
    }
    results['camelot'] = CAMELOT.get(key + ' ' + scale, '?')
except Exception:
    results['key'] = None
    results['scale'] = None
    results['camelot'] = None

# Loudness + RMS + Energy
try:
    rms_val = float(es.RMS()(audio))
    results['rms'] = round(rms_val, 4)
    if rms_val > 0:
        loudness_lufs = round(20 * math.log10(rms_val) + 3.0, 1)
        loudness_lufs = max(-20.0, min(-4.0, loudness_lufs))
    else:
        loudness_lufs = -20.0
    results['loudness_lufs'] = loudness_lufs
    results['energy'] = round(min(1.0, rms_val * 10), 3)
except Exception as e:
    results['rms'] = None
    results['loudness_lufs'] = None
    results['energy'] = None
    print('LUFS error:', str(e), file=sys.stderr)

# LRA — proper windowed loudness range
try:
    window_size = 3 * 44100
    hop = window_size // 2
    short_term_loudness = []
    for i in range(0, len(audio) - window_size, hop):
        window = audio[i:i + window_size]
        rms_w = float(es.RMS()(window))
        if rms_w > 0:
            lufs_w = round(20 * math.log10(rms_w) + 3.0, 1)
            short_term_loudness.append(lufs_w)
    if len(short_term_loudness) > 4:
        sorted_l = sorted(short_term_loudness)
        p10 = sorted_l[int(len(sorted_l) * 0.10)]
        p95 = sorted_l[int(len(sorted_l) * 0.95)]
        results['loudness_range'] = round(abs(p95 - p10), 1)
        results['dynamic_complexity'] = round(float(np.std(short_term_loudness)), 2)
    else:
        results['loudness_range'] = None
        results['dynamic_complexity'] = None
except Exception:
    results['loudness_range'] = None
    results['dynamic_complexity'] = None

# Danceability
try:
    dance, _ = es.Danceability()(audio)
    results['danceability'] = round(min(1.0, float(dance) / 3.0), 3)
except Exception:
    results['danceability'] = None

# Spectral features (frame-based)
try:
    frame_size = 2048
    hop_size = 1024
    centroids = []
    fluxes = []
    rolloffs = []
    contrasts = []

    for i in range(0, len(audio) - frame_size, hop_size):
        frame = audio[i:i + frame_size]
        windowed = es.Windowing(type='hann')(frame)
        spectrum = es.Spectrum()(windowed)

        if len(spectrum) > 0 and np.max(spectrum) > 0:
            centroids.append(float(es.Centroid(range=22050)(spectrum)))
            fluxes.append(float(es.Flux()(spectrum)))
            rolloffs.append(float(es.RollOff()(spectrum)))
            try:
                sc = es.SpectralContrast(frameSize=frame_size)
                contrast, valley = sc(spectrum)
                contrasts.append(float(np.mean(contrast)))
            except Exception:
                pass

    if centroids:
        results['spectral_centroid'] = round(float(np.mean(centroids)), 1)
        results['brightness'] = round(min(1.0, float(np.mean(centroids)) / 8000), 3)
        results['spectral_flux'] = round(float(np.mean(fluxes)), 4)
        results['spectral_rolloff'] = round(float(np.mean(rolloffs)), 1)
    if contrasts:
        results['spectral_contrast'] = round(float(np.mean(contrasts)), 3)
except Exception:
    results['brightness'] = None
    results['spectral_centroid'] = None

# MFCCs (timbre fingerprint — 13 coefficients)
try:
    mfcc_extractor = es.MFCC(numberCoefficients=13)
    mfccs = []
    for i in range(0, len(audio) - 2048, 1024):
        frame = audio[i:i + 2048]
        windowed = es.Windowing(type='hann')(frame)
        spectrum = es.Spectrum()(windowed)
        _, mfcc = mfcc_extractor(spectrum)
        mfccs.append(mfcc)
    if mfccs:
        mean_mfcc = np.mean(mfccs, axis=0).tolist()
        results['mfcc_mean'] = [round(float(v), 3) for v in mean_mfcc]
except Exception:
    results['mfcc_mean'] = None

# Valence — multi-factor
try:
    valence_score = 0.0
    if results.get('scale') == 'major': valence_score += 0.30
    bpm_val = results.get('bpm') or 0
    if bpm_val > 120: valence_score += 0.20
    elif bpm_val > 90: valence_score += 0.10
    dnc = results.get('danceability') or 0
    if dnc > 0.6: valence_score += 0.20
    elif dnc > 0.4: valence_score += 0.10
    brt = results.get('brightness') or 0
    if brt > 0.5: valence_score += 0.15
    nrg = results.get('energy') or 0
    if nrg > 0.6: valence_score += 0.15
    results['valence'] = round(min(1.0, valence_score), 2)
except Exception:
    results['valence'] = 0.5

# Acousticness proxy
try:
    if results.get('spectral_centroid'):
        results['acousticness'] = round(max(0, min(1, 1 - results['spectral_centroid'] / 8000)), 3)
except Exception:
    results['acousticness'] = None

# Bass energy proxy
try:
    bass_audio = audio[:len(audio) // 4]
    bass_rms = float(es.RMS()(bass_audio))
    results['bass_energy'] = round(min(1.0, bass_rms * 15), 3)
except Exception:
    results['bass_energy'] = None

# Duration
results['duration_seconds'] = round(len(audio) / 44100.0, 1)
results['key_source'] = 'essentia'

# Onset rate
try:
    od = es.OnsetRate()(audio)
    results['onset_rate'] = round(float(od[1]), 3)
except Exception:
    results['onset_rate'] = None

# Rhythm regularity
try:
    _, beats_loud, _ = es.BeatLoudness()(audio)
    if len(beats_loud) > 1:
        beat_var = float(np.std(beats_loud) / (np.mean(beats_loud) + 1e-6))
        results['rhythm_regularity'] = round(max(0, min(1, 1 - beat_var)), 3)
except Exception:
    results['rhythm_regularity'] = None

# Vocal pitch statistics (run before speechiness so instrumentalness can use it)
try:
    pitch_extractor = es.PredominantPitchMelodia(frameSize=2048, hopSize=128)
    pitch_values, pitch_confidence = pitch_extractor(audio)
    confident_pitches = [
        float(p) for p, c in zip(pitch_values, pitch_confidence)
        if c > 0.8 and float(p) > 80
    ]
    if confident_pitches:
        results['vocal_pitch_mean'] = round(float(np.mean(confident_pitches)), 1)
        results['vocal_pitch_range'] = round(float(np.max(confident_pitches) - np.min(confident_pitches)), 1)
        midi = 12 * math.log2(results['vocal_pitch_mean'] / 440.0) + 69
        notes = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
        results['vocal_root_note'] = notes[int(midi) % 12]
        results['vocal_octave'] = int(midi) // 12 - 1
        results['vibrato_presence'] = round(min(1.0, float(np.std(confident_pitches)) / 50), 3)
    else:
        results['vocal_pitch_mean'] = None
        results['vocal_pitch_range'] = None
        results['vocal_root_note'] = None
        results['vibrato_presence'] = None
except Exception:
    results['vocal_pitch_mean'] = None
    results['vocal_pitch_range'] = None
    results['vocal_root_note'] = None
    results['vibrato_presence'] = None

# Speechiness via spectral flatness
try:
    flatness_vals = []
    for i in range(0, len(audio) - 2048, 1024):
        frame = audio[i:i+2048]
        windowed = es.Windowing(type='hann')(frame)
        spectrum = es.Spectrum()(windowed)
        if np.max(spectrum) > 0:
            flat = float(es.Flatness()(spectrum))
            flatness_vals.append(flat)
    if flatness_vals:
        mean_flat = float(np.mean(flatness_vals))
        results['speechiness'] = round(min(1.0, mean_flat * 3), 3)
        has_vocal = (results.get('vocal_pitch_mean') or 0) > 0
        results['instrumentalness'] = round(max(0, 1 - (has_vocal * 0.8)), 3)
except Exception:
    results['speechiness'] = None
    results['instrumentalness'] = None

# Liveness proxy
try:
    onset_irreg = results.get('dynamic_complexity') or 0
    noise_f = results.get('speechiness') or 0
    results['liveness'] = round(min(1.0, (onset_irreg * 0.1) + (noise_f * 0.3)), 3)
except Exception:
    results['liveness'] = None

# Harmonic complexity via HPCP
try:
    hpcps = []
    for i in range(0, len(audio) - 4096, 2048):
        frame = audio[i:i+4096]
        windowed = es.Windowing(type='blackmanharris62')(frame)
        spectrum = es.Spectrum()(windowed)
        peaks_freq, peaks_mag = es.SpectralPeaks()(spectrum)
        if len(peaks_freq) > 0:
            hpcp = es.HPCP()(peaks_freq, peaks_mag)
            hpcps.append(hpcp)
    if hpcps:
        mean_hpcp = np.mean(hpcps, axis=0)
        hpcp_norm = mean_hpcp / (np.sum(mean_hpcp) + 1e-6)
        entropy = -np.sum(hpcp_norm * np.log2(hpcp_norm + 1e-6))
        results['harmonic_complexity'] = round(float(entropy) / 4.0, 3)
except Exception:
    results['harmonic_complexity'] = None

# Warmth
try:
    if results.get('spectral_centroid'):
        results['warmth'] = round(max(0, min(1, 1 - results['spectral_centroid'] / 12000)), 3)
except Exception:
    results['warmth'] = None

# Emotional arc — 8 segments
try:
    segment_count = 8
    segment_size = len(audio) // segment_count
    arc = []
    for i in range(segment_count):
        start = i * segment_size
        end = start + segment_size
        segment = audio[start:end]
        if len(segment) < 1024:
            continue
        seg_rms = float(es.RMS()(segment))
        seg_energy = round(min(1.0, seg_rms * 10), 3)
        seg_centroids = []
        for j in range(0, len(segment) - 2048, 1024):
            frame = segment[j:j+2048]
            windowed = es.Windowing(type='hann')(frame)
            spectrum = es.Spectrum()(windowed)
            if len(spectrum) > 0 and np.max(spectrum) > 0:
                seg_centroids.append(float(es.Centroid(range=22050)(spectrum)))
        seg_brightness = round(min(1.0, float(np.mean(seg_centroids)) / 8000), 3) if seg_centroids else 0
        seg_bass_rms = float(es.RMS()(segment[:max(1, len(segment)//4)]))
        seg_bass = round(min(1.0, seg_bass_rms * 15), 3)
        arc.append({
            'segment': i + 1,
            'position_pct': round((i / segment_count) * 100),
            'energy': seg_energy,
            'brightness': seg_brightness,
            'bass': seg_bass
        })
    results['emotional_arc'] = arc
    if arc:
        energies = [s['energy'] for s in arc]
        results['arc_peak_segment'] = max(range(len(energies)), key=lambda i: energies[i]) + 1
        results['arc_contrast'] = round(max(energies) - min(energies), 3)
        results['arc_buildup'] = round(energies[-1] - energies[0], 3)
except Exception as e:
    results['emotional_arc'] = None
    results['arc_contrast'] = None
    results['arc_peak_segment'] = None

# Tonal balance + stereo analysis
def analyze_stereo_and_tonal(audio_path):
    res = {}

    loader = es.AudioLoader(filename=audio_path)
    audio_stereo, sr, nch, _, _, _ = loader()

    if nch < 2:
        res['stereo_width'] = 0
        res['stereo_width_per_band'] = {}
        left = audio_stereo[:, 0] if len(audio_stereo.shape) > 1 else audio_stereo
        right = left
    else:
        left = audio_stereo[:, 0]
        right = audio_stereo[:, 1]

    mid = (left + right) / 2
    side = (left - right) / 2

    mid_rms = float(np.sqrt(np.mean(mid**2)))
    side_rms = float(np.sqrt(np.mean(side**2)))
    res['stereo_width'] = round(side_rms / (mid_rms + 1e-9), 4)

    bands = {
        'bass':     (20, 200),
        'low_mid':  (200, 2000),
        'high_mid': (2000, 8000),
        'air':      (8000, 20000)
    }

    from scipy.fft import rfft, rfftfreq

    chunk_size = 65536
    n_chunks = max(1, len(mid) // chunk_size)
    band_energies = {b: [] for b in bands}

    for i in range(n_chunks):
        chunk = mid[i*chunk_size:(i+1)*chunk_size]
        if len(chunk) < 1024:
            continue
        fft_mag = np.abs(rfft(chunk))
        freqs = rfftfreq(len(chunk), 1/sr)
        total_energy = np.sum(fft_mag**2) + 1e-9
        for band_name, (f_low, f_high) in bands.items():
            mask = (freqs >= f_low) & (freqs < f_high)
            energy = np.sum(fft_mag[mask]**2) / total_energy
            band_energies[band_name].append(float(energy))

    res['tonal_balance'] = {
        b: round(float(np.mean(v)), 4)
        for b, v in band_energies.items()
    }
    res['tonal_bands'] = {b: {'low': lo, 'high': hi} for b, (lo, hi) in bands.items()}

    if nch >= 2:
        width_per_band = {}
        for band_name, (f_low, f_high) in bands.items():
            band_widths = []
            for i in range(n_chunks):
                cl = left[i*chunk_size:(i+1)*chunk_size]
                cr = right[i*chunk_size:(i+1)*chunk_size]
                if len(cl) < 1024:
                    continue
                fl_mag = np.abs(rfft(cl))
                fr_mag = np.abs(rfft(cr))
                freqs = rfftfreq(len(cl), 1/sr)
                mask = (freqs >= f_low) & (freqs < f_high)
                m = (fl_mag[mask] + fr_mag[mask]) / 2
                s = (fl_mag[mask] - fr_mag[mask]) / 2
                m_e = np.sum(m**2) + 1e-9
                s_e = np.sum(s**2)
                band_widths.append(s_e / m_e)
            width_per_band[band_name] = round(
                float(np.mean(band_widths)) if band_widths else 0, 4
            )
        res['stereo_width_per_band'] = width_per_band

    crest_per_band = {}
    for band_name, (f_low, f_high) in bands.items():
        crests = []
        for i in range(n_chunks):
            chunk = mid[i*chunk_size:(i+1)*chunk_size]
            if len(chunk) < 1024:
                continue
            fft_mag = np.abs(rfft(chunk))
            freqs = rfftfreq(len(chunk), 1/sr)
            mask = (freqs >= f_low) & (freqs < f_high)
            if np.any(mask):
                band_fft = fft_mag[mask]
                peak = np.max(band_fft)
                rms = np.sqrt(np.mean(band_fft**2)) + 1e-9
                crests.append(float(peak / rms))
        crest_per_band[band_name] = round(
            float(np.mean(crests)) if crests else 0, 2
        )
    res['crest_factor_per_band'] = crest_per_band

    return res

try:
    stereo_tonal = analyze_stereo_and_tonal(audio_file)
    results.update(stereo_tonal)
except Exception as e:
    results['stereo_width'] = None
    results['tonal_balance'] = None
    results['stereo_width_per_band'] = None
    results['crest_factor_per_band'] = None
    print('stereo/tonal error:', str(e), file=sys.stderr)

print(json.dumps(results))
