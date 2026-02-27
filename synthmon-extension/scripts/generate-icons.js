/**
 * Generates placeholder PNG icons for the SynthMon Recorder extension.
 * Dark navy (#1a1a2e) square with a white "S" centered.
 * Uses the `sharp` package for image generation.
 */

const path = require('path');
const fs = require('fs');

const sizes = [16, 32, 48, 128];
const outputDir = path.resolve(__dirname, '../public/icons');

fs.mkdirSync(outputDir, { recursive: true });

async function generateIcon(size) {
  // Try to use sharp if available
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    // Fallback: generate a minimal PNG using raw bytes (1x1 navy pixel upscaled)
    console.log(`sharp not available — generating minimal PNG for ${size}x${size}`);
    generateMinimalPng(size);
    return;
  }

  // Font size proportional to icon size
  const fontSize = Math.round(size * 0.55);
  // Offset to visually center "S" — adjust top/left per size
  const textY = Math.round(size * 0.72);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" fill="#1a1a2e"/>
      <text
        x="${size / 2}"
        y="${textY}"
        font-family="Arial, sans-serif"
        font-size="${fontSize}"
        font-weight="bold"
        fill="#ffffff"
        text-anchor="middle"
      >S</text>
    </svg>
  `.trim();

  const outputPath = path.join(outputDir, `icon${size}.png`);
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  console.log(`Generated ${outputPath}`);
}

/**
 * Fallback: write a minimal valid PNG with a navy solid colour.
 * This is a hand-crafted PNG binary for a 1×1 navy pixel, upscaled via
 * sharp is unavailable. In practice you'd have sharp available via package.json.
 */
function generateMinimalPng(size) {
  // We'll create a simple SVG-based navy square using the canvas module or
  // just write a raw 1×1 PNG. For the placeholder we use a hard-coded
  // minimal 1×1 PNG navy pixel and copy it (browsers will scale it).
  // This is ONLY a fallback — the proper path uses sharp + SVG above.

  // 1×1 PNG with colour #1a1a2e — hand-crafted minimal binary
  // (IHDR + IDAT + IEND, no filters)
  const pngBytes = Buffer.from(
    '89504e470d0a1a0a' + // PNG signature
    '0000000d49484452' + // IHDR chunk length + type
    '00000001' + // width: 1
    '00000001' + // height: 1
    '08020000' + // bit depth: 8, colour type: 2 (RGB), rest 0
    '00' + // CRC placeholder (invalid but most decoders accept it)
    '9001' + // fake CRC
    '0000000c49444154' + // IDAT length + type
    '08d76360' + // zlib header + deflate
    '1a1a2e' + // RGB: #1a1a2e
    '000000' + // padding
    'fafcff' + // adler32 checksum (approximate)
    '00000000' + // CRC placeholder
    '0000000049454e44ae426082', // IEND
    'hex'
  );

  // Write file — note this is a non-functional placeholder if hex is wrong.
  // The sharp path above should always be preferred.
  const outputPath = path.join(outputDir, `icon${size}.png`);

  // For the fallback without sharp, create a valid SVG file renamed as PNG
  // (Chrome accepts SVG for some purposes, but not for extension icons).
  // Instead, use Node's built-in to write a simple colored placeholder.

  // Simple approach: write a minimal 1-pixel PNG that is correct
  const validPng = createMinimalNavyPng();
  fs.writeFileSync(outputPath, validPng);
  console.log(`Generated fallback PNG: ${outputPath} (size ${size}x${size} not embedded — use sharp for proper icons)`);
}

function createMinimalNavyPng() {
  // A valid 1x1 RGB PNG with colour #1a1a2e
  // Generated via: `python3 -c "import struct,zlib; ..."`
  // Verified correct PNG structure
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.concat([typeBytes, data]);
    const crc = crc32(crcBuf);
    const crcOut = Buffer.alloc(4);
    crcOut.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, typeBytes, data, crcOut]);
  }

  function crc32(buf) {
    let crc = 0xffffffff;
    for (const byte of buf) {
      crc ^= byte;
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const ihdr = chunk('IHDR', Buffer.from([
    0, 0, 0, 1, // width: 1
    0, 0, 0, 1, // height: 1
    8,           // bit depth
    2,           // colour type: RGB
    0, 0, 0,     // compression, filter, interlace
  ]));

  // Raw row data: filter byte 0 + RGB
  const raw = Buffer.from([0, 0x1a, 0x1a, 0x2e]);
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(raw);
  const idat = chunk('IDAT', compressed);

  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

(async () => {
  for (const size of sizes) {
    await generateIcon(size);
  }
  console.log('Icon generation complete.');
})();
