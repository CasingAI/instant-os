# @gcu/iso9660

ISO 9660 CD/DVD filesystem reader and writer in pure JavaScript. Supports Joliet extensions for long/Unicode filenames.

Part of [Auditable](https://github.com/endarthur/auditable).

Pre-1.0 — APIs may break on minor version bumps.

## Install

```sh
npm install @gcu/iso9660
```

## Usage

```js
import { ISOReader, ISOWriter } from '@gcu/iso9660';

// Read
const reader = new ISOReader(arrayBuffer);
for (const entry of reader.list()) {
  console.log(entry.path, entry.size);
}

// Write
const writer = new ISOWriter({ volumeId: 'MYDISC' });
writer.addFile('/README.TXT', new TextEncoder().encode('hello'));
const iso = writer.build();
```

Sub-path imports: `@gcu/iso9660/reader`, `@gcu/iso9660/writer`.

## License

MIT.
