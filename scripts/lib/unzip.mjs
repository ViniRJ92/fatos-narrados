/**
 * Leitor mínimo de arquivos ZIP (sem dependências), suficiente para os pacotes de
 * dados abertos da CGU: entradas "stored" (0) ou "deflate" (8), sem ZIP64.
 */
import { inflateRawSync } from 'node:zlib';

/** @returns {{name:string, size:number, read:()=>Buffer}[]} */
export function listZip(buf) {
  // Fim do diretório central: assinatura 0x06054b50 nos últimos ~64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP inválido: diretório central não encontrado');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP inválido: entrada corrompida');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('latin1', p + 46, p + 46 + nameLen);
    if (compSize === 0xffffffff || localOffset === 0xffffffff) throw new Error('ZIP64 não suportado');
    entries.push({
      name, size,
      read() {
        const lNameLen = buf.readUInt16LE(localOffset + 26), lExtraLen = buf.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + lNameLen + lExtraLen;
        const data = buf.subarray(start, start + compSize);
        if (method === 0) return Buffer.from(data);
        if (method === 8) return inflateRawSync(data);
        throw new Error(`Método de compressão ${method} não suportado`);
      },
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
