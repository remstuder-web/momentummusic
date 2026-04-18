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

# Loudness (RMS-based, reliable for short clips)
try:
    rms = float(es.RMS()(audio))
    if rms > 0:
        loudness_lufs = round(20 * math.log10(rms) + 3.0, 1)
        loudness_lufs = max(-20.0, min(-4.0, loudness_lufs))
    else:
        loudness_lufs = -20.0
    results['loudness_lufs'] = loudness_lufs
    results['rms'] = round(rms, 4)
except Exception:
    results['loudness_lufs'] = None

# Energy
try:
    results['energy'] = round(min(1.0, float(es.RMS()(audio)) * 10), 3)
except Exception:
    results['energy'] = None

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

# Valence proxy (mode-based)
try:
    results['valence'] = round(0.65 if results.get('scale') == 'major' else 0.35, 2)
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

# Loudness range (static placeholder — requires longer audio)
results['loudness_range'] = 0.0

print(json.dumps(results))
