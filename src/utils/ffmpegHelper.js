import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';

let ffmpeg = null;

export const loadFFmpeg = async (onLog, onProgress) => {
  if (ffmpeg) return ffmpeg;

  ffmpeg = new FFmpeg();

  ffmpeg.on('log', ({ message }) => {
    if (onLog) onLog(message);
    console.log(message);
  });

  ffmpeg.on('progress', ({ progress, time }) => {
    if (onProgress) onProgress(progress);
  });

  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  return ffmpeg;
};

export const splitVideo = async (ffmpeg, file, slices, direction) => {
  // Logic to run crop commands
  // This will be called from the component
};
