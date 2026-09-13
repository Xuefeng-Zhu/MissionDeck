#!/usr/bin/env python3
"""Encode observed browser frames using their recorded timestamps.

No UI or cursor is generated. Each captured frame stays visible until the next
observed frame. The final frame stays only until capture elapsedSeconds. The
output is CFR 30 fps, so presentation timestamps are quantized to video frames.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess


def run(command):
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    capture = args.capture.resolve()
    manifest_path = capture / "frames.json"
    manifest = json.loads(manifest_path.read_text())
    frames = manifest["frames"]
    elapsed = float(manifest["elapsedSeconds"])
    if manifest.get("captureError") or len(frames) < 2 or not math.isfinite(elapsed):
        raise ValueError("A complete capture with at least two actual frames is required.")
    if frames[0]["time"] != 0 or elapsed <= frames[-1]["time"]:
        raise ValueError("Capture timestamps must span zero to the final elapsed time.")
    destination = args.output.resolve()
    if destination.exists():
        raise ValueError(f"Preserve the existing capture video: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    concat = destination.with_suffix(".ffconcat")
    rows = ["ffconcat version 1.0"]
    gaps = []
    dimensions = None
    hashes = []
    for index, frame in enumerate(frames):
        image = (capture / frame["file"]).resolve()
        if image.parent != capture or not image.is_file() or "'" in str(image):
            raise ValueError("Each input must be an existing frame directly inside the capture directory.")
        end = float(frames[index + 1]["time"]) if index + 1 < len(frames) else elapsed
        duration = end - float(frame["time"])
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError("Frame timestamps must be finite and strictly increasing.")
        if index == 0:
            info = json.loads(run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "json", str(image)]))
            dimensions = [info["streams"][0]["width"], info["streams"][0]["height"]]
        gaps.append(duration)
        hashes.append({"file": frame["file"], "time": frame["time"], "sha256": hashlib.sha256(image.read_bytes()).hexdigest()})
        rows += [f"file '{image}'", "option framerate 1000", f"duration {duration:.6f}"]
    # Repeating the final real frame terminates concat's last duration correctly.
    rows += [f"file '{image}'", "option framerate 1000"]
    concat.write_text("\n".join(rows) + "\n")
    output_frames = math.ceil(elapsed * 30)
    filters = "fps=30,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:color=black,setsar=1,format=yuv420p,setparams=range=limited"
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(concat),
         "-an", "-vf", filters, "-frames:v", str(output_frames), "-r", "30", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "16", "-pix_fmt", "yuv420p", "-color_range", "tv", "-threads", "2", "-video_track_timescale", "90000",
         "-movflags", "+faststart", str(destination)])
    info = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(destination)]))
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    duration = float(info["format"]["duration"])
    if video["codec_name"] != "h264" or abs(duration-elapsed) > 1/30 + 0.001:
        raise ValueError("Encoded video failed codec or timing checks.")
    report = {"capture_manifest": str(manifest_path), "output": str(destination), "capture_duration": elapsed,
              "output_duration": duration, "captured_frames": len(frames), "output_frames": int(video["nb_frames"]),
              "source_size": dimensions, "output_size": [video["width"], video["height"]], "max_capture_gap_seconds": max(gaps),
              "method": "Hold each observed browser frame until the next recorded timestamp; no interpolation or generated UI.",
              "frame_sha256": hashes}
    destination.with_suffix(".qa.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "frame_sha256"}))


if __name__ == "__main__":
    main()
