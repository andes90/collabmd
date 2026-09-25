import { deflateRawSync } from 'node:zlib';

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const PLANTUML_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

export function encodePlantUmlText(source = '') {
  const compressed = deflateRawSync(Buffer.from(String(source), 'utf-8'));
  const padded = Buffer.alloc(Math.ceil(compressed.length / 3) * 3);
  compressed.copy(padded);
  return padded.toString('base64url').replace(/./gu, (character) => (
    PLANTUML_ALPHABET[BASE64URL_ALPHABET.indexOf(character)]
  ));
}
