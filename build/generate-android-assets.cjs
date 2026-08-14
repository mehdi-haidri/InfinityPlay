/**
 * Generates all Android launcher icons, round icons, foreground icons, TV banners,
 * and splash screen assets from the high-res app icon (build/icon.png).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const sourceIcon = path.join(root, 'build', 'icon.png');
const androidRes = path.join(root, 'android', 'app', 'src', 'main', 'res');

let ffmpegBin = 'ffmpeg';
if (process.platform !== 'linux') {
  try {
    const FFmpeg = require('@rse/ffmpeg');
    if (FFmpeg.supported && fs.existsSync(FFmpeg.binary)) {
      ffmpegBin = FFmpeg.binary;
    }
  } catch (e) {
    // fallback to PATH
  }
}

function resizeImage(input, output, width, height) {
  const dir = path.dirname(output);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const result = spawnSync(ffmpegBin, [
    '-y',
    '-i', input,
    '-vf', `scale=${width}:${height}`,
    '-update', '1',
    '-frames:v', '1',
    output
  ], { stdio: 'ignore' });

  if (result.status === 0) {
    console.log(`Generated ${path.relative(root, output)} (${width}x${height})`);
  } else {
    console.error(`Failed generating ${output}`);
  }
}

const iconDensities = [
  { folder: 'mipmap-mdpi', size: 48, fgSize: 108 },
  { folder: 'mipmap-hdpi', size: 72, fgSize: 162 },
  { folder: 'mipmap-xhdpi', size: 96, fgSize: 216 },
  { folder: 'mipmap-xxhdpi', size: 144, fgSize: 324 },
  { folder: 'mipmap-xxxhdpi', size: 192, fgSize: 432 },
];

console.log('Generating Android app launcher icons from build/icon.png...');

for (const { folder, size, fgSize } of iconDensities) {
  const dir = path.join(androidRes, folder);
  resizeImage(sourceIcon, path.join(dir, 'ic_launcher.png'), size, size);
  resizeImage(sourceIcon, path.join(dir, 'ic_launcher_round.png'), size, size);
  resizeImage(sourceIcon, path.join(dir, 'ic_launcher_foreground.png'), fgSize, fgSize);
}

// Generate splash screen drawables
const splashDirs = [
  'drawable',
  'drawable-port-mdpi',
  'drawable-port-hdpi',
  'drawable-port-xhdpi',
  'drawable-port-xxhdpi',
  'drawable-port-xxxhdpi',
  'drawable-land-mdpi',
  'drawable-land-hdpi',
  'drawable-land-xhdpi',
  'drawable-land-xxhdpi',
  'drawable-land-xxxhdpi'
];

console.log('Generating Android splash screen assets...');
for (const dirName of splashDirs) {
  resizeImage(sourceIcon, path.join(androidRes, dirName, 'splash.png'), 512, 512);
}

console.log('Android assets generated successfully!');
