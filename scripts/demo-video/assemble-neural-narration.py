#!/usr/bin/env python3
"""Assemble existing neural clips locally; never generates speech or edits video."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import textwrap
import wave


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "artifacts/demo-video/manifest-user-flow.json"
DESTINATION = MANIFEST.parent / "natural-narration"
RATE = 48_000
CHANNELS = 2
LEAD_SECONDS = 0.4


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True)


def loudness(path):
    result = run("ffmpeg", "-hide_banner", "-i", str(path), "-af",
                 "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-")
    return json.loads(re.search(r'\{\s*"input_i".*?\}', result.stderr, re.S).group())


def speech_bounds(path, duration):
    result = run("ffmpeg", "-hide_banner", "-i", str(path), "-af",
                 "silencedetect=noise=-40dB:d=0.08", "-f", "null", "-")
    intervals = []
    start = None
    for line in result.stderr.splitlines():
        match = re.search(r"silence_start: ([0-9.]+)", line)
        if match:
            start = float(match.group(1))
        match = re.search(r"silence_end: ([0-9.]+)", line)
        if match and start is not None:
            intervals.append((start, float(match.group(1))))
            start = None
    beginning = intervals[0][1] if intervals and intervals[0][0] < 0.01 else 0
    ending = intervals[-1][0] if intervals and intervals[-1][1] >= duration - 0.02 else duration
    if ending <= beginning:
        raise ValueError("A narration clip contains no detected speech.")
    return beginning, ending


def timestamp(seconds, separator):
    value = round(seconds * 1000)
    hours, value = divmod(value, 3_600_000)
    minutes, value = divmod(value, 60_000)
    seconds, milliseconds = divmod(value, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}{separator}{milliseconds:03d}"


def caption_chunks(text):
    words = text.split()
    chunks = []
    while words:
        count = min(14, len(words))
        while len(textwrap.wrap(" ".join(words[:count]), width=46)) > 2:
            count -= 1
        boundaries = [i + 1 for i, word in enumerate(words[:count])
                      if (i >= 4 and word.endswith((".", "!", "?", ";", ":")))
                      or (i >= 7 and word.endswith(","))]
        if boundaries:
            count = boundaries[-1]
        if len(words) - count in (1, 2):
            count = (len(words) + 1) // 2
        chunks.append(words[:count])
        words = words[count:]
    return chunks


def main():
    manifest = json.loads(MANIFEST.read_text())
    total_frames = sum(round(scene["duration"] * RATE) for scene in manifest["scenes"])
    if total_frames != 120 * RATE:
        raise ValueError("The user-flow manifest must total exactly 120 seconds.")
    records = []
    cues = []
    with tempfile.TemporaryDirectory(prefix="missiondeck-narration-") as temporary:
        temporary = Path(temporary)
        assembled = temporary / "assembled.wav"
        cursor = 0
        with wave.open(str(assembled), "wb") as soundtrack:
            soundtrack.setparams((CHANNELS, 2, RATE, 0, "NONE", "not compressed"))
            for index, scene in enumerate(manifest["scenes"], start=1):
                source = DESTINATION / f"scene-{index:02d}.mp3"
                metadata = json.loads(source.with_suffix(".json").read_text())
                digest = hashlib.sha256(scene["narration"].encode()).hexdigest()
                if metadata["narrationHash"] != digest:
                    raise ValueError(f"Scene {index} narration differs from the manifest.")
                decoded = temporary / f"scene-{index:02d}.wav"
                # Resampling and channel conversion only: no additional tempo changes.
                run("ffmpeg", "-v", "error", "-y", "-i", str(source), "-ar", str(RATE),
                    "-ac", str(CHANNELS), "-c:a", "pcm_s16le", str(decoded))
                with wave.open(str(decoded), "rb") as clip:
                    frames = clip.getnframes()
                    samples = clip.readframes(frames)
                scene_frames = round(scene["duration"] * RATE)
                lead_frames = round(LEAD_SECONDS * RATE)
                tail_frames = scene_frames - lead_frames - frames
                if tail_frames < 0:
                    raise ValueError(f"Scene {index} does not fit without trimming or speeding up.")
                soundtrack.writeframesraw(bytes(lead_frames * CHANNELS * 2))
                soundtrack.writeframesraw(samples)
                soundtrack.writeframesraw(bytes(tail_frames * CHANNELS * 2))
                speech_start, speech_end = speech_bounds(decoded, frames / RATE)
                subtitle_start = cursor / RATE + LEAD_SECONDS + speech_start
                subtitle_end = cursor / RATE + LEAD_SECONDS + speech_end
                chunks = caption_chunks(scene["narration"])
                word_count = sum(len(chunk) for chunk in chunks)
                elapsed_words = 0
                for chunk in chunks:
                    beginning = subtitle_start + (subtitle_end - subtitle_start) * elapsed_words / word_count
                    elapsed_words += len(chunk)
                    ending = subtitle_start + (subtitle_end - subtitle_start) * elapsed_words / word_count
                    cues.append({"scene": index, "start": beginning, "end": ending,
                                 "text": "\n".join(textwrap.wrap(" ".join(chunk), width=46))})
                records.append({"scene": index, "start_seconds": cursor / RATE,
                                "duration_seconds": scene_frames / RATE,
                                "lead_seconds": LEAD_SECONDS, "clip_seconds": frames / RATE,
                                "tail_seconds": tail_frames / RATE,
                                "speech_start_seconds": subtitle_start,
                                "speech_end_seconds": subtitle_end,
                                "source_playback_tempo": metadata.get("playback_tempo", 1),
                                "assembly_playback_tempo": 1, "narration_hash": digest})
                cursor += scene_frames
        measured = loudness(assembled)
        normalization = ("loudnorm=I=-16:TP=-1.5:LRA=11:"
                         f"measured_I={measured['input_i']}:measured_TP={measured['input_tp']}:"
                         f"measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}:"
                         f"offset={measured['target_offset']}:linear=true:print_format=json")
        destination = DESTINATION / "narration.wav"
        run("ffmpeg", "-hide_banner", "-y", "-i", str(assembled), "-af",
            f"{normalization},aresample={RATE},apad=whole_len={total_frames},atrim=end_sample={total_frames}",
            "-ar", str(RATE), "-ac", str(CHANNELS), "-c:a", "pcm_s16le", str(destination))
    verified = loudness(destination)
    with wave.open(str(destination), "rb") as soundtrack:
        actual = {"sample_rate": soundtrack.getframerate(), "channels": soundtrack.getnchannels(),
                  "sample_width_bytes": soundtrack.getsampwidth(), "sample_frames": soundtrack.getnframes(),
                  "duration_seconds": soundtrack.getnframes() / soundtrack.getframerate()}
    if actual["sample_frames"] != total_frames or actual["sample_rate"] != RATE or actual["channels"] != 2:
        raise ValueError("Final soundtrack format or duration is incorrect.")
    if abs(float(verified["input_i"]) + 16) > 0.3 or float(verified["input_tp"]) > -1.0:
        raise ValueError("Final soundtrack failed loudness or peak verification.")
    srt = []
    vtt = ["WEBVTT\n"]
    for index, cue in enumerate(cues, start=1):
        srt.append(f"{index}\n{timestamp(cue['start'], ',')} --> {timestamp(cue['end'], ',')}\n{cue['text']}\n")
        vtt.append(f"{timestamp(cue['start'], '.')} --> {timestamp(cue['end'], '.')}\n{cue['text']}\n")
    (MANIFEST.parent / "user-flow.srt").write_text("\n".join(srt))
    (MANIFEST.parent / "user-flow.vtt").write_text("\n".join(vtt))
    report = {"source_manifest": str(MANIFEST), "audio": str(destination), **actual,
              "integrated_lufs": float(verified["input_i"]), "true_peak_dbtp": float(verified["input_tp"]),
              "loudness_range_lu": float(verified["input_lra"]), "normalization": "two-pass loudnorm",
              "additional_tempo_changes": False, "subtitle_cues": len(cues),
              "subtitle_timing": "Approximate word-proportional cues within detected speech boundaries; not forced alignment.",
              "scenes": records, "cues": cues}
    (DESTINATION / "assembly-qa.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key not in ("scenes", "cues")}, indent=2))


if __name__ == "__main__":
    main()
