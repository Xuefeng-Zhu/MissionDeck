/** Generate demo narration through the project's configured OpenRouter account. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { createHash } from 'node:crypto';

loadEnvFile('.env');
const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) throw new Error('The existing project OpenRouter key is required.');
const manifestPath = resolve(process.argv[2] || 'artifacts/demo-video/manifest-natural.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const target = resolve(dirname(manifestPath), 'natural-narration');
await mkdir(target, { recursive: true });
const selected = process.argv[3] ? [Number(process.argv[3]) - 1] : manifest.scenes.map((_, i) => i);
// Both models/voices are listed by the current official OpenRouter speech catalog.
// MAI-Voice-2 returned 502 twice; use the alternate neural model on the same
// user-approved OpenRouter destination. No automatic model/provider fallback.
const model = 'x-ai/grok-voice-tts-1.0';
const voice = 'eve';
const results = [];

for (const index of selected) {
  const scene = manifest.scenes[index];
  if (!scene) throw new Error('Invalid scene number.');
  const destination = resolve(target, `scene-${String(index + 1).padStart(2, '0')}.mp3`);
  const narrationHash = createHash('sha256').update(scene.narration).digest('hex');
  try {
    const previous = JSON.parse(await readFile(destination.replace(/\.mp3$/, '.json'), 'utf8'));
    if (previous.model === model && previous.voice === voice && previous.narrationHash === narrationHash && (await readFile(destination)).length === previous.bytes) {
      results.push(previous); console.log(JSON.stringify({ scene: index + 1, reused: true, seconds: previous.speech_seconds })); continue;
    }
    throw new Error('An existing scene has a different model or narration. Preserve it before replacing it.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const payload = {
    model, voice, input: scene.narration, response_format: 'mp3', speed: 1.0,
    provider: { allow_fallbacks: false },
  };
  const response = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Speech request failed: HTTP ${response.status}. No automatic retry or model fallback was attempted.`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (!response.headers.get('content-type')?.includes('audio') || audio.length < 1000)
    throw new Error('Speech provider returned an empty or non-audio response.');
  await writeFile(destination, audio);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', destination], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error('Generated speech is not valid audio.');
  const originalDuration = Number(JSON.parse(probe.stdout).format.duration);
  let duration = originalDuration; let playbackTempo = 1; let outputBytes = audio.length;
  if (duration > scene.duration - 0.8) {
    playbackTempo = Math.ceil((duration / (scene.duration - 0.86)) * 100) / 100;
    if (playbackTempo > 1.08) throw new Error(`Scene ${index + 1} needs a narration edit or more screen time; the original neural clip is retained.`);
    const original = destination.replace(/\.mp3$/, '.original.mp3');
    await writeFile(original, audio);
    const adjusted = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', original, '-af', `atempo=${playbackTempo}`, '-c:a', 'libmp3lame', '-b:a', '128k', destination], { encoding: 'utf8' });
    if (adjusted.status !== 0) throw new Error('Neural speech tempo fitting failed; the original clip is retained.');
    const checked = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', destination], { encoding: 'utf8' });
    if (checked.status !== 0) throw new Error('Adjusted neural clip is invalid.');
    duration = Number(JSON.parse(checked.stdout).format.duration); outputBytes = (await readFile(destination)).length;
  }
  const record = { scene: index + 1, model, voice, style: 'provider-default', speed: 1, narrationHash,
    speech_seconds: duration, original_speech_seconds: originalDuration, playback_tempo: playbackTempo, scene_seconds: scene.duration, bytes: outputBytes,
    target_max_seconds: scene.duration - 0.8, fits_scene_with_headroom: duration <= scene.duration - 0.8,
    generation_id: response.headers.get('x-generation-id'), narration: scene.narration };
  results.push(record);
  await writeFile(destination.replace(/\.mp3$/, '.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ scene: index + 1, seconds: duration, available: scene.duration - 0.8, fits: record.fits_scene_with_headroom, bytes: audio.length }));
}
await writeFile(resolve(target, 'generation-summary.json'), JSON.stringify({ source_manifest: manifestPath, api_destination: 'https://openrouter.ai/api/v1/audio/speech', generated_at: new Date().toISOString(), model, voice, narration_words: manifest.scenes.reduce((total, scene) => total + scene.narration.trim().split(/\s+/).length, 0), total_clips: results.length, all_fit: results.every(record => record.fits_scene_with_headroom), clips: results }, null, 2) + '\n');
console.log(`Generated ${results.length} neural narration clips.`);
