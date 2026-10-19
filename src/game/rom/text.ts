// Gen-3 (English) character set decoder. Browser-safe.
import { RomReader } from './reader';

const EOS = 0xff;

/** Byte -> string for printable characters (English Emerald charmap). */
const CHARS: string[] = (() => {
  const t: string[] = new Array(256).fill('');
  const put = (code: number, s: string) => (t[code] = s);
  put(0x00, ' ');
  const accents = 'ÀÁÂÇÈÉÊËÌ'; // 0x01-0x09
  for (let i = 0; i < accents.length; i++) put(0x01 + i, accents[i]);
  const accents2: [number, string][] = [
    [0x0b, 'Î'], [0x0c, 'Ï'], [0x0d, 'Ò'], [0x0e, 'Ó'], [0x0f, 'Ô'], [0x10, 'Œ'], [0x11, 'Ù'],
    [0x12, 'Ú'], [0x13, 'Û'], [0x14, 'Ñ'], [0x15, 'ß'], [0x16, 'à'], [0x17, 'á'], [0x19, 'ç'],
    [0x1a, 'è'], [0x1b, 'é'], [0x1c, 'ê'], [0x1d, 'ë'], [0x1e, 'ì'], [0x20, 'î'], [0x21, 'ï'],
    [0x22, 'ò'], [0x23, 'ó'], [0x24, 'ô'], [0x25, 'œ'], [0x26, 'ù'], [0x27, 'ú'], [0x28, 'û'],
    [0x29, 'ñ'], [0x2a, 'º'], [0x2b, 'ª'], [0x2c, 'ᵉʳ'], [0x2d, '&'], [0x2e, '+'], [0x34, 'Lv'],
    [0x35, '='], [0x36, ';'], [0x51, '¿'], [0x52, '¡'], [0x53, 'PK'], [0x54, 'MN'], [0x55, 'PO'],
    [0x56, 'Ké'], [0x57, 'BL'], [0x58, 'OC'], [0x59, 'K'], [0x5a, 'Í'], [0x5b, '%'], [0x5c, '('],
    [0x5d, ')'], [0x68, 'â'], [0x6f, 'í'], [0x79, '↑'], [0x7a, '↓'], [0x7b, '←'], [0x7c, '→'],
    [0x84, 'ᵉ'], [0x85, '<'], [0x86, '>'], [0xa0, 'ʳᵉ'], [0xab, '!'], [0xac, '?'], [0xad, '.'],
    [0xae, '-'], [0xaf, '·'], [0xb0, '…'], [0xb1, '“'], [0xb2, '”'], [0xb3, '‘'], [0xb4, '’'],
    [0xb5, '♂'], [0xb6, '♀'], [0xb7, '¥'], [0xb8, ','], [0xb9, '×'], [0xba, '/'], [0xef, '▶'],
    [0xf0, ':'], [0xf1, 'Ä'], [0xf2, 'Ö'], [0xf3, 'Ü'], [0xf4, 'ä'], [0xf5, 'ö'], [0xf6, 'ü'],
  ];
  for (const [c, s] of accents2) put(c, s);
  for (let i = 0; i < 10; i++) put(0xa1 + i, String.fromCharCode(48 + i)); // 0-9
  for (let i = 0; i < 26; i++) put(0xbb + i, String.fromCharCode(65 + i)); // A-Z
  for (let i = 0; i < 26; i++) put(0xd5 + i, String.fromCharCode(97 + i)); // a-z
  return t;
})();

/** Total byte length (including the code byte) of each 0xFC extended control code. */
const EXT_CTRL_LEN = [1, 2, 2, 2, 4, 2, 2, 1, 2, 1, 1, 3, 2, 2, 2, 1, 3, 2, 2, 2, 2, 1, 1, 1, 1];

const PLACEHOLDERS: Record<number, string> = {
  0x01: '{PLAYER}', 0x02: '{STR_VAR_1}', 0x03: '{STR_VAR_2}', 0x04: '{STR_VAR_3}', 0x05: '{KUN}',
  0x06: '{RIVAL}', 0x07: '{VERSION}', 0x08: '{AQUA}', 0x09: '{MAGMA}', 0x0a: '{ARCHIE}',
  0x0b: '{MAXIE}', 0x0c: '{KYOGRE}', 0x0d: '{GROUDON}',
};

/**
 * Decodes a 0xFF-terminated Gen-3 string.
 * - `decodeText(bytes, offset?, maxLen?)` reads from a byte array.
 * - `decodeText(rom, addr, maxLen?)` reads from a ROM at a GBA address.
 * Control codes: 0xFE (newline) and 0xFA (scroll) -> "\n", 0xFB (new page) -> "\n\n",
 * 0xFD xx placeholders -> "{PLAYER}" etc., 0xFC extended codes are skipped.
 */
export function decodeText(src: Uint8Array | RomReader, addr = 0, maxLen = 1024): string {
  const bytes = src instanceof RomReader ? src.data : src;
  const start = src instanceof RomReader ? src.offset(addr) : addr;
  const end = Math.min(bytes.length, start + maxLen);
  let out = '';
  let i = start;
  while (i < end) {
    const c = bytes[i++];
    if (c === EOS) break;
    switch (c) {
      case 0xfe:
      case 0xfa:
        out += '\n';
        break;
      case 0xfb:
        out += '\n\n';
        break;
      case 0xfd: {
        const p = bytes[i++];
        out += PLACEHOLDERS[p] ?? `{STRING ${p}}`;
        break;
      }
      case 0xfc: {
        const code = bytes[i];
        i += code < EXT_CTRL_LEN.length ? EXT_CTRL_LEN[code] : 1;
        break;
      }
      case 0xf7: // dynamic
      case 0xf8: // keypad icon
      case 0xf9: // extra symbol
        i++;
        break;
      default:
        out += CHARS[c] || '';
    }
  }
  return out;
}

/** Encodes plain ASCII letters/digits/basic punctuation into Gen-3 bytes (0xFF-terminated). */
export function encodeText(s: string): Uint8Array {
  const rev = new Map<string, number>();
  for (let c = 0; c < 256; c++) if (CHARS[c].length === 1 && !rev.has(CHARS[c])) rev.set(CHARS[c], c);
  const out: number[] = [];
  for (const ch of s) {
    if (ch === '\n') out.push(0xfe);
    else {
      const b = rev.get(ch);
      if (b === undefined) throw new Error(`Character not encodable: ${ch}`);
      out.push(b);
    }
  }
  out.push(EOS);
  return Uint8Array.from(out);
}
