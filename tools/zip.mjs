// Minimal zip writer (deflate, UTF-8 names), no dependencies. Enough for the benchmark archives:
// fewer than 65535 entries and less than 4 GB per archive (no zip64).
import fs from 'node:fs';
import zlib from 'node:zlib';

const kCrcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function Crc32(aBuffer) {
  if (typeof zlib.crc32 === 'function') {
    return zlib.crc32(aBuffer) >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < aBuffer.length; i++) {
    crc = kCrcTable[(crc ^ aBuffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function DosTime(aDate) {
  const time = (aDate.getHours() << 11) | (aDate.getMinutes() << 5) | (aDate.getSeconds() >> 1);
  const date = ((aDate.getFullYear() - 1980) << 9) | ((aDate.getMonth() + 1) << 5) | aDate.getDate();
  return { time, date };
}

export class ZipWriter {
  constructor(aFile) {
    this.fd = fs.openSync(aFile, 'w');
    this.offset = 0;
    this.entries = [];
  }

  Write(aBuffer) {
    fs.writeSync(this.fd, aBuffer);
    this.offset += aBuffer.length;
  }

  Add(aName, aData, aDate = new Date()) {
    const name = Buffer.from(aName, 'utf8');
    const data = Buffer.isBuffer(aData) ? aData : Buffer.from(aData, 'utf8');
    const compressed = zlib.deflateRawSync(data, { level: 6 });
    const crc = Crc32(data);
    const { time, date } = DosTime(aDate);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);

    this.entries.push({ name, crc, time, date, size: data.length, compressedSize: compressed.length, offset: this.offset });
    this.Write(header);
    this.Write(name);
    this.Write(compressed);
  }

  Close() {
    const start = this.offset;
    for (const e of this.entries) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4); // made by
      header.writeUInt16LE(20, 6); // version needed
      header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(8, 10);
      header.writeUInt16LE(e.time, 12);
      header.writeUInt16LE(e.date, 14);
      header.writeUInt32LE(e.crc, 16);
      header.writeUInt32LE(e.compressedSize, 20);
      header.writeUInt32LE(e.size, 24);
      header.writeUInt16LE(e.name.length, 28);
      header.writeUInt32LE(e.offset, 42);
      this.Write(header);
      this.Write(e.name);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    this.Write(end);
    fs.closeSync(this.fd);
  }
}
