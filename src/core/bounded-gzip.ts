import { Gunzip, gzipSync } from 'fflate';

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  }
  return btoa(binary);
}

export function decodeBase64(text: string, maximumBytes: number): Uint8Array {
  if (!text || text.length > 4 * Math.ceil(maximumBytes / 3) || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('Invalid compressed base64.');
  const binary = atob(text);
  if (binary.length > maximumBytes || btoa(binary) !== text) throw new Error('Invalid compressed byte length.');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

/** Decode only our single-member, fixed-header gzip format. Feeding small input
 * chunks bounds expansion before the output-length callback can reject it;
 * trusting gzip's advertised length or a fixed output buffer alone cannot. */
export function gunzipBounded(compressed: Uint8Array, expectedBytes: number, maximumBytes: number): Uint8Array {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > maximumBytes) throw new Error('Decoded length is outside its bound.');
  if (compressed.length < 18 || compressed[0] !== 31 || compressed[1] !== 139 || compressed[2] !== 8 || compressed[3] !== 0) throw new Error('Unsupported gzip header.');
  const trailer = new DataView(compressed.buffer, compressed.byteOffset + compressed.length - 8, 8);
  if (trailer.getUint32(4, true) !== expectedBytes) throw new Error('Gzip length changed.');
  const output = new Uint8Array(expectedBytes);
  let offset = 0, checksum = 0xffffffff, finished = false;
  const decoder = new Gunzip((chunk, final) => {
    if (chunk.length > expectedBytes - offset) throw new Error('Decoded data exceeds its declared length.');
    output.set(chunk, offset); offset += chunk.length;
    for (const byte of chunk) checksum = crcTable[(checksum ^ byte) & 255] ^ (checksum >>> 8);
    finished = final;
  });
  for (let start = 0; start < compressed.length; start += 1024) {
    const end = Math.min(start + 1024, compressed.length);
    decoder.push(compressed.subarray(start, end), end === compressed.length);
  }
  if (!finished || offset !== expectedBytes || ((checksum ^ 0xffffffff) >>> 0) !== trailer.getUint32(0, true)) throw new Error('Gzip integrity check failed.');
  // fflate 0.7.4 does not expose its consumed-byte count and can ignore bytes
  // after the first DEFLATE end. Our version-1 formats use this pinned,
  // deterministic encoder; exact recompression rejects extra members or junk.
  // A future encoder change must retain this format's decoder compatibility.
  const canonical = gzipSync(output, { level: 6, mtime: 0 });
  if (canonical.length !== compressed.length || canonical.some((byte, index) => byte !== compressed[index])) throw new Error('Noncanonical gzip payload.');
  return output;
}
