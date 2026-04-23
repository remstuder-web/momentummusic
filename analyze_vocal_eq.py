#!/opt/homebrew/bin/python3.11
"""
Stem EQ curve analyzer using Demucs + Essentia
Extracts 30-band ISO third-octave spectrum from all 4 stems
"""

import sys
import json
import os
import numpy as np
import subprocess
import tempfile
import shutil


def separate_stems(audio_path, output_dir):
    """Use Demucs htdemucs model to separate all 4 stems"""
    try:
        result = subprocess.run([
            '/opt/homebrew/bin/python3.11', '-m', 'demucs',
            '--name', 'htdemucs',
            '--out', output_dir,
            audio_path
        ], capture_output=True, text=True, timeout=360)

        if result.returncode != 0:
            return result.stderr
        return None
    except Exception as e:
        return str(e)


def find_stem_file(output_dir, stem_name):
    """Find a stem file by name in the output directory"""
    for root, dirs, files in os.walk(output_dir):
        for f in files:
            if stem_name in f.lower() and (f.endswith('.wav') or f.endswith('.mp3')):
                return os.path.join(root, f)
    return None


def analyze_spectrum(audio_path):
    """Extract 30-band ISO third-octave EQ curve, mean-normalized"""
    import essentia.standard as es

    loader = es.MonoLoader(filename=audio_path, sampleRate=44100)
    audio = loader()

    # Use 25%-75% to skip intro/outro
    start = int(len(audio) * 0.25)
    end = int(len(audio) * 0.75)
    audio = audio[start:end]

    fft_size = 8192
    hop_size = 4096

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

    curve = {}
    for cf in iso_freqs:
        if band_powers[cf]:
            avg_power = np.mean(band_powers[cf])
            db = 10 * np.log10(avg_power + 1e-10)
            curve[cf] = round(float(db), 2)

    mean_db = np.mean(list(curve.values()))
    return {str(k): round(v - mean_db, 2) for k, v in curve.items()}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: analyze_vocal_eq.py <audio_path>'}))
        return

    audio_path = sys.argv[1]
    if not os.path.exists(audio_path):
        print(json.dumps({'error': 'File not found: ' + audio_path}))
        return

    temp_dir = tempfile.mkdtemp(prefix='stem_eq_')

    try:
        error = separate_stems(audio_path, temp_dir)
        if error:
            print(json.dumps({'error': 'Demucs failed: ' + str(error)}))
            return

        stems_to_analyze = ['vocals', 'drums', 'bass', 'other']
        results = {}
        for stem in stems_to_analyze:
            stem_path = find_stem_file(temp_dir, stem)
            if stem_path:
                try:
                    results[stem] = analyze_spectrum(stem_path)
                except Exception as e:
                    results[stem] = None

        if not results:
            print(json.dumps({'error': 'No stems found after separation'}))
            return

        print(json.dumps({
            'ok': True,
            'stems': results,
            'stem_count': len(results)
        }))

    except Exception as e:
        print(json.dumps({'error': str(e)}))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == '__main__':
    main()
