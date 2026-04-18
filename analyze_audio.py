import essentia.standard as es
import essentia
import sys, json, numpy as np

audio_file = sys.argv[1]

loader = es.MonoLoader(filename=audio_file, sampleRate=44100)
audio = loader()

# BPM + rhythm
rhythm = es.RhythmExtractor2013(method='multifeature')
bpm, beats, bpm_confidence, _, _ = rhythm(audio)

# Key
key_extractor = es.KeyExtractor()
key, scale, key_strength = key_extractor(audio)

# Loudness LUFS — pass mono as stereo channels
try:
    loudness_extractor = es.LoudnessEBUR128(hopSize=0.1)
    _, _, integrated_loudness, loudness_range = loudness_extractor(audio, audio)
except Exception:
    try:
        _, _, integrated_loudness, loudness_range = es.LoudnessEBUR128(startAtZero=True)(audio, audio)
    except Exception:
        integrated_loudness = -70.0
        loudness_range = 0.0

# Energy RMS
rms = float(es.RMS()(audio))
energy = round(min(1.0, rms * 10), 3)

# Danceability
try:
    dance, _ = es.Danceability()(audio)
    danceability = round(min(1.0, float(dance) / 3.0), 3)
except Exception:
    danceability = None

# Valence proxy via mode
valence = round(0.65 if scale == 'major' else 0.35, 2)

# Spectral features
frame = es.Windowing(type='hann')(audio[:4096])
spec = es.Spectrum()(frame)
centroid = float(es.SpectralCentroidTime()(audio))
brightness = round(min(1.0, centroid / 8000), 3)

# Acousticness — inverse of spectral complexity
try:
    spectral_complexity = float(es.SpectralComplexity()(spec))
    acousticness = round(max(0, min(1, 1 - spectral_complexity / 50)), 3)
except Exception:
    acousticness = None

# Dynamic range
dynamic_range = round(float(loudness_range), 1)

# Duration
duration = round(len(audio) / 44100.0, 1)

# Bass energy (lower quarter of signal as proxy)
eq_bands = es.EqualLoudness()(audio)
bass_audio = audio[:len(audio)//4]
bass_rms = float(es.RMS()(bass_audio))
bass_energy = round(min(1.0, bass_rms * 15), 3)

result = {
    'bpm': round(float(bpm), 1),
    'bpm_confidence': round(float(bpm_confidence), 3),
    'key': key,
    'scale': scale,
    'key_strength': round(float(key_strength), 3),
    'loudness_lufs': round(float(integrated_loudness), 1),
    'loudness_range': dynamic_range,
    'energy': energy,
    'danceability': danceability,
    'valence': valence,
    'brightness': brightness,
    'acousticness': acousticness,
    'bass_energy': bass_energy,
    'duration_seconds': duration
}
print(json.dumps(result))
