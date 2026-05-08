// Format-aware byte mangler.
// Goal: produce partial-render glitches, not "broken image" icons.
// Strategy varies per format because each decoder rejects on different invariants.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(bytes, start, length) {
  let c = 0xFFFFFFFF;
  const end = start + length;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function randomBitFlip() { return 1 << ((Math.random() * 8) | 0); }

// JPEG: structure is markers (FF xx) + segments. Quant tables (DQT), Huffman
// tables (DHT), frame header (SOF) all come BEFORE entropy-coded data.
// Flipping bytes in those = decode failure. Entropy data starts AFTER SOS
// (FF DA) marker's segment header.
//
// Two more rules in entropy data: 0xFF must be byte-stuffed as FF 00, and
// any new FF we accidentally create looks like a marker boundary to the
// scanner. Solution: never produce or destroy 0xFF.
function mangleJPEG(bytes, intensity) {
  let sos = -1;
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xDA) {
      const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
      sos = i + 2 + segLen;
      break;
    }
  }
  if (sos < 0) return; // malformed; bail

  let eoi = bytes.length;
  for (let i = bytes.length - 2; i > sos; i--) {
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xD9) { eoi = i; break; }
  }

  for (let i = sos; i < eoi; i++) {
    if (bytes[i] === 0xFF) continue;          // don't break stuffing
    if (i > 0 && bytes[i - 1] === 0xFF) continue; // don't disturb FF 00 stuff bytes
    if (Math.random() < intensity) {
      const flipped = bytes[i] ^ randomBitFlip();
      if (flipped === 0xFF) continue;          // don't manufacture markers
      bytes[i] = flipped;
    }
  }
}

// PNG: 8-byte sig, then chunks: [len(4)][type(4)][data(len)][crc32(4)].
// CRC covers type+data and is strictly checked. We mangle IDAT data and
// recompute the CRC so the decoder accepts the chunk. Deflate streams are
// fragile, so flips often produce dramatic but rare results — that's fine.
function manglePNG(bytes, intensity) {
  if (bytes.length < 8) return;
  // PNG sig: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return;

  let off = 8;
  while (off + 12 <= bytes.length) {
    const len = (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3];
    if (len < 0 || off + 8 + len + 4 > bytes.length) break;
    const t0 = bytes[off + 4], t1 = bytes[off + 5], t2 = bytes[off + 6], t3 = bytes[off + 7];
    const isIDAT = t0 === 0x49 && t1 === 0x44 && t2 === 0x41 && t3 === 0x54;
    const isIEND = t0 === 0x49 && t1 === 0x45 && t2 === 0x4E && t3 === 0x44;
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (isIDAT && len > 4) {
      // Skip first 2 bytes of zlib stream (CMF+FLG header) at start of first IDAT
      const flipStart = dataStart + 2;
      let touched = false;
      for (let i = flipStart; i < dataEnd; i++) {
        if (Math.random() < intensity) {
          bytes[i] ^= randomBitFlip();
          touched = true;
        }
      }
      if (touched) {
        const crc = crc32(bytes, off + 4, 4 + len);
        bytes[dataEnd]     = (crc >>> 24) & 0xFF;
        bytes[dataEnd + 1] = (crc >>> 16) & 0xFF;
        bytes[dataEnd + 2] = (crc >>> 8)  & 0xFF;
        bytes[dataEnd + 3] = crc          & 0xFF;
      }
    }
    if (isIEND) break;
    off = dataEnd + 4;
  }
}

// WebP: RIFF container. VP8/VP8L/VP8X chunks. Lossy VP8 is similar to JPEG
// in that bitstream corruption mid-frame can produce smear. Skip RIFF header
// + first chunk header (~30 bytes) and flip carefully.
function mangleWebP(bytes, intensity) {
  if (bytes.length < 30) return;
  // 'RIFF' ... 'WEBP'
  if (bytes[0] !== 0x52 || bytes[1] !== 0x49) return;
  const start = 30;
  for (let i = start; i < bytes.length; i++) {
    if (Math.random() < intensity * 0.4) bytes[i] ^= randomBitFlip();
  }
}

// GIF: header + LSD + GCT + image blocks. LZW is brittle. Low intensity,
// skip first ~800 bytes to clear color table and image descriptor.
function mangleGIF(bytes, intensity) {
  if (bytes.length < 1000) return;
  for (let i = 800; i < bytes.length - 1; i++) {
    if (Math.random() < intensity * 0.2) bytes[i] ^= randomBitFlip();
  }
}

// Generic: skip a header window, flip the rest.
function mangleGeneric(bytes, intensity, skipFront) {
  const start = Math.min(skipFront, bytes.length);
  for (let i = start; i < bytes.length; i++) {
    if (Math.random() < intensity) bytes[i] ^= randomBitFlip();
  }
}

// MP4 / fragmented MP4 (YouTube serves H.264/AV1 in this).
// Boxes: [size:4 BE][type:4 ascii][data]. size==1 means 64-bit size follows.
// Only flip inside mdat boxes; anywhere else (ftyp, moov, moof, sidx, mfra)
// is structural and one bit kills the stream.
function mangleMP4(bytes, intensity) {
  let off = 0;
  let touched = false;
  while (off + 8 <= bytes.length) {
    let size = (bytes[off] * 0x1000000) + (bytes[off + 1] << 16) + (bytes[off + 2] << 8) + bytes[off + 3];
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    let dataStart = off + 8;
    if (size === 1) {
      // 64-bit size at off+8; we only care about low 32 bits
      const lo = (bytes[off + 12] * 0x1000000) + (bytes[off + 13] << 16) + (bytes[off + 14] << 8) + bytes[off + 15];
      size = lo;
      dataStart = off + 16;
    }
    if (size < 8) break;
    if (size === 0) { off = bytes.length; break; }
    const end = Math.min(off + size, bytes.length);
    if (type === 'mdat') {
      // Skip first ~32 bytes of mdat to clear NAL start codes / OBU headers
      const flipStart = Math.min(dataStart + 32, end);
      for (let i = flipStart; i < end; i++) {
        if (Math.random() < intensity) {
          bytes[i] ^= randomBitFlip();
          touched = true;
        }
      }
    }
    if (end <= off) break;
    off = end;
  }
  return touched;
}

// WebM / Matroska heuristic: Cluster element ID is 0x1F43B675. Flip only
// AFTER the first Cluster start, never before (that would kill init data).
function mangleWebM(bytes, intensity) {
  let cluster = -1;
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === 0x1F && bytes[i + 1] === 0x43 && bytes[i + 2] === 0xB6 && bytes[i + 3] === 0x75) {
      cluster = i + 16; // skip past the cluster size vint + a margin
      break;
    }
  }
  if (cluster < 0) return;
  for (let i = cluster; i < bytes.length; i++) {
    if (Math.random() < intensity * 0.6) bytes[i] ^= randomBitFlip();
  }
}

function isMP4(bytes) {
  // Look for 'ftyp' or 'styp' or 'moof' in the first 64 bytes
  if (bytes.length < 12) return false;
  for (let off = 0; off < Math.min(64, bytes.length - 8); off += 4) {
    const t0 = bytes[off + 4], t1 = bytes[off + 5], t2 = bytes[off + 6], t3 = bytes[off + 7];
    if (t0 === 0x66 && t1 === 0x74 && t2 === 0x79 && t3 === 0x70) return true; // ftyp
    if (t0 === 0x73 && t1 === 0x74 && t2 === 0x79 && t3 === 0x70) return true; // styp
    if (t0 === 0x6D && t1 === 0x6F && t2 === 0x6F && t3 === 0x66) return true; // moof
  }
  return false;
}

function isWebM(bytes) {
  return bytes.length > 4 && bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3;
}

function mangle(bytes, contentType, intensity) {
  if (intensity <= 0) return;
  if (contentType.startsWith('image/jpeg') || contentType.startsWith('image/jpg')) {
    mangleJPEG(bytes, intensity);
  } else if (contentType.startsWith('image/png')) {
    manglePNG(bytes, intensity);
  } else if (contentType.startsWith('image/webp')) {
    mangleWebP(bytes, intensity);
  } else if (contentType.startsWith('image/gif')) {
    mangleGIF(bytes, intensity);
  } else if (contentType.startsWith('image/avif') || contentType.startsWith('image/heic')) {
    mangleGeneric(bytes, intensity * 0.3, 4096);
  } else if (contentType.startsWith('image/svg')) {
    // SVG is XML — byte flipping just produces parse errors. Skip.
  } else if (contentType.startsWith('image/')) {
    mangleGeneric(bytes, intensity * 0.5, 256);
  } else if (contentType.startsWith('video/') || contentType === 'application/octet-stream') {
    // YouTube/many CDNs serve fragmented mp4 chunks; sniff container.
    if (isMP4(bytes)) mangleMP4(bytes, intensity * 0.8);
    else if (isWebM(bytes)) mangleWebM(bytes, intensity * 0.6);
    else if (contentType.startsWith('video/')) mangleGeneric(bytes, intensity * 0.2, 16384);
  } else if (contentType.startsWith('audio/')) {
    if (isMP4(bytes)) mangleMP4(bytes, intensity * 0.6);
    else mangleGeneric(bytes, intensity * 0.25, 4096);
  }
}

module.exports = { mangle };
