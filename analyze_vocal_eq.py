#!/opt/homebrew/bin/python3.11
"""
Vocal EQ curve analyzer using Demucs + Essentia
Extracts 30-band ISO third-octave spectrum from vocal stem
"""

import sys
import json
import os
import numpy as np
import subprocess
import tempfile
import shutil


def separate_vocals(audio_path, output_dir):
    """Use Demucs to separate vocals from mix"""
    try:
        result = subprocess.run([
            '/opt/homebrew/bin/python3.11', '-m', 'demucs',
            '--two-stems', 'vocals',
            '--out', output_dir,
            '--mp3',
            audio_path
        ], capture_output=True, text=True, timeout=300)

        if result.returncode != 0:
            return None, result.stderr

        # Find vocals file
        for root, dirs, files in os.walk(output_dir):
            for f in files:
                if 'vocals' in f and f.endswith('.mp3'):
                    return os.path.join(root, f), None
        return None, 'Vocals file not found'
    except Exception as e:
        return None, str(e)


def analyze_vocal_spectrum(vocal_path):
    """Extract 30-band ISO third-octave EQ curve"""
    import essentia.standard as es

    # Load audio
    loader = es.MonoLoader(filename=vocal_path, sampleRate=44100)
    audio = loader()

    # Start from 25% to skip intros
    start = int(len(audio) * 0.25)
    end = int(len(audio) * 0.75)
    audio = audio[start:end]

    fft_size = 8192
    hop_size = 4096

    # ISO third-octave center frequencies (20Hz - 16kHz)
    iso_freqs = [
        20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
        200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
        2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000
    ]

    band_powers = {f: [] for f in iso_freqs}

    window = es.Windowing(type='hann')
    spectrum_extractor = es.Spectrum(size=fft_size)

    for i in range(0, len(audio) - fft_size, hop_size):
        frame = audio[i:i + fft_size]
        windowed = window(frame)
        spec = spectrum_extractor(windowed)

        power = np.maximum(spec ** 2, 1e-10)
        freq_resolution = 44100 / fft_size

        for cf in iso_freqs:
            f_low = cf / (2 ** (1/6))
            f_high = cf * (2 ** (1/6))
            bin_low = max(0, int(f_low / freq_resolution))
            bin_high = min(len(power)-1, int(f_high / freq_resolution))
            if bin_high > bin_low:
                band_power = np.mean(power[bin_low:bin_high+1])
                band_powers[cf].append(float(band_power))

    # Average across frames, convert to dB
    curve = {}
    for cf in iso_freqs:
        if band_powers[cf]:
            avg_power = np.mean(band_powers[cf])
            db = 10 * np.log10(avg_power + 1e-10)
            curve[cf] = round(float(db), 2)

    # Mean-normalize
    mean_db = np.mean(list(curve.values()))
    normalized = {str(k): round(v - mean_db, 2) for k, v in curve.items()}

    return normalized


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: analyze_vocal_eq.py <audio_path>'}))
        return

    audio_path = sys.argv[1]
    if not os.path.exists(audio_path):
        print(json.dumps({'error': 'File not found: ' + audio_path}))
        return

    temp_dir = tempfile.mkdtemp(prefix='vocal_eq_')

    try:
        vocals_path, error = separate_vocals(audio_path, temp_dir)
        if error or not vocals_path:
            print(json.dumps({'error': 'Demucs failed: ' + str(error)}))
            return

        curve = analyze_vocal_spectrum(vocals_path)

        print(json.dumps({
            'ok': True,
            'curve': curve,
            'bands': len(curve),
            'vocals_extracted': True
        }))

    except Exception as e:
        print(json.dumps({'error': str(e)}))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == '__main__':
    main()
