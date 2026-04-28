// lib/hash.ts
// MurmurHash3 32-bit — optimal for hash-table keying of short-to-medium strings.
// Chosen over FNV-1a for superior avalanche and distribution on structurally similar inputs (paragraph text with shared prefixes).
// Chosen over SHA-256 to avoid async poison in the MutationObserver chain.
// P(collision) ≈ 0.00047% at N=200 blocks. Documented, accepted.

function rotl32(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r));
}

function murmur3_32(str: string, seed = 0): number {
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const length = str.length;
  const nblocks = Math.floor(length / 4);
  let h1 = seed;

  // body — process 4 chars at a time
  for (let i = 0; i < nblocks; i++) {
    let k1 =
      (str.charCodeAt(i * 4)     & 0xff)        |
      ((str.charCodeAt(i * 4 + 1) & 0xff) << 8)  |
      ((str.charCodeAt(i * 4 + 2) & 0xff) << 16) |
      ((str.charCodeAt(i * 4 + 3) & 0xff) << 24);

    k1 = Math.imul(k1, c1);
    k1 = rotl32(k1, 15);
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = rotl32(h1, 13);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
  }

  // tail — handle remaining chars
  let k1 = 0;
  const tail = nblocks * 4;
  switch (length & 3) {
    //@ts-ignore
    case 3: k1 ^= (str.charCodeAt(tail + 2) & 0xff) << 16; // fallthrough
    //@ts-ignore
    case 2: k1 ^= (str.charCodeAt(tail + 1) & 0xff) << 8;  // fallthrough
    case 1:
      k1 ^= str.charCodeAt(tail) & 0xff;
      k1 = Math.imul(k1, c1);
      k1 = rotl32(k1, 15);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
    break;
  }

  // finalization — fmix32, the key differentiator vs FNV-1a
  // forces all bits to avalanche, guarantees uniform distribution
  h1 ^= length;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 >>> 0; // coerce to unsigned 32-bit
}

export function hashText(text: string): string {
  return murmur3_32(text).toString(16).padStart(8, "0");
}