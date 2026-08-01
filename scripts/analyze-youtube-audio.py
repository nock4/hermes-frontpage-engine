#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

import librosa
import numpy as np


def safe_float(value, digits=4):
    try:
        return round(float(value), digits)
    except Exception:
        return None


def describe(features):
    bass, mid, high = features["spectral"]["bass_mid_high_ratio"]
    centroid = features["spectral"]["centroid_mean_hz"]
    onset_density = features["onset"]["density_per_second"]
    repetition = features["self_similarity_density"]
    tempo = features["tempo_bpm"]

    return {
        "bass_pressure": "heavy lower-field weight" if bass >= 0.55 else "thin low-end floor" if bass < 0.25 else "moderate low-end bed",
        "brightness": "bright high-frequency scratch field" if centroid and centroid >= 2400 else "dark/midrange-heavy surface" if centroid and centroid < 1800 else "warm mid-bright grain",
        "pulse": "dense beat grid usable as seam rhythm" if onset_density >= 2.0 else "slow pulse with sparse puncture marks" if onset_density >= 0.8 else "drone/no clear beat; use slow bands",
        "tempo_posture": "fast procession" if tempo and tempo >= 120 else "walking procession" if tempo and tempo >= 80 else "slow suspended drift",
        "repetition": "folded-loop structure" if repetition >= 0.20 else "linear procession structure",
        "source_window_marks": [
            "bass ridge / lower pressure field",
            "high-frequency scratch veil",
            "onset puncture cluster",
            "silence aperture or dropout slit",
            "repeat seam / loop fold" if repetition >= 0.20 else "linear measure cut",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description="Analyze an audio slice for Daily Frontpage audio material.")
    parser.add_argument("audio", help="WAV/MP3/audio file")
    parser.add_argument("--source-url", default=None)
    parser.add_argument("--output", required=True)
    parser.add_argument("--sample-rate", type=int, default=22050)
    args = parser.parse_args()

    y, sr = librosa.load(args.audio, sr=args.sample_rate, mono=True)
    if not len(y):
        raise SystemExit("audio file decoded empty")

    duration = len(y) / sr
    rms = librosa.feature.rms(y=y)[0]
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)[0]
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr)

    stft = np.abs(librosa.stft(y))
    freqs = librosa.fft_frequencies(sr=sr)
    bass = float(stft[(freqs >= 20) & (freqs < 160)].mean())
    mid = float(stft[(freqs >= 160) & (freqs < 2000)].mean())
    high = float(stft[(freqs >= 2000) & (freqs < 9000)].mean())
    total = bass + mid + high + 1e-9

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = chroma.mean(axis=1)
    note_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    top_notes = [note_names[int(i)] for i in chroma_mean.argsort()[-3:][::-1]]

    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
    normalized = (mfcc - mfcc.mean(axis=1, keepdims=True)) / (mfcc.std(axis=1, keepdims=True) + 1e-6)
    similarity = np.dot(normalized.T, normalized) / normalized.shape[0]
    self_similarity_density = float((similarity > 0.65).mean())

    features = {
        "schema_version": 1,
        "source_url": args.source_url,
        "audio_file": str(Path(args.audio).resolve()),
        "duration_seconds": safe_float(duration, 2),
        "tempo_bpm": safe_float(np.atleast_1d(tempo)[0], 1),
        "beat_count": int(len(beats)),
        "loudness": {
            "mean": safe_float(rms.mean()),
            "peak": safe_float(rms.max()),
            "dynamic_range": safe_float(np.percentile(rms, 95) - np.percentile(rms, 10)),
        },
        "spectral": {
            "centroid_mean_hz": safe_float(centroid.mean(), 1),
            "rolloff_mean_hz": safe_float(rolloff.mean(), 1),
            "bass_mid_high_ratio": [safe_float(v / total, 3) for v in (bass, mid, high)],
        },
        "onset": {
            "density_per_second": safe_float(len(onsets) / duration, 3),
            "strength_mean": safe_float(onset_env.mean(), 3),
            "strength_peak": safe_float(onset_env.max(), 3),
        },
        "pitch_color": {
            "top_chroma": top_notes,
            "chroma_vector": [safe_float(x, 3) for x in chroma_mean],
        },
        "self_similarity_density": safe_float(self_similarity_density, 3),
    }
    features["visual_translation"] = describe(features)

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(features, indent=2), encoding="utf-8")
    print(json.dumps(features, indent=2))


if __name__ == "__main__":
    main()
