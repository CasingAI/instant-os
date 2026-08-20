function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const part of parts) {
    total += part.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff
  }
  return bytes
}

function pad10(value: number): string {
  return String(value).padStart(10, '0')
}

/**
 * Wrap a JPEG as a one-page PDF 1.4 (DCTDecode). Page size is `width`×`height` points.
 */
export function jpegBytesToPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  if (jpeg.byteLength < 3 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error('不是有效的 JPEG 数据')
  }
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`

  const objects: Uint8Array[] = [
    latin1('<< /Type /Catalog /Pages 2 0 R >>\n'),
    latin1('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n'),
    latin1(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\n`,
    ),
    latin1(`<< /Length ${content.length} >>\nstream\n${content}endstream\n`),
    concatBytes([
      latin1(
        `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`,
      ),
      jpeg,
      latin1('\nendstream\n'),
    ]),
  ]

  const header = latin1('%PDF-1.4\n%\x80\x80\x80\x80\n')
  const chunks: Uint8Array[] = [header]
  const offsets = [0]
  let cursor = header.byteLength
  for (let i = 0; i < objects.length; i++) {
    offsets.push(cursor)
    const prefix = latin1(`${i + 1} 0 obj\n`)
    const suffix = latin1('endobj\n')
    chunks.push(prefix, objects[i]!, suffix)
    cursor += prefix.byteLength + objects[i]!.byteLength + suffix.byteLength
  }

  const xrefStart = cursor
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i++) {
    xref += `${pad10(offsets[i]!)} 00000 n \n`
  }
  xref += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  chunks.push(latin1(xref))
  return concatBytes(chunks)
}

export function base64JpegToPdf(base64: string, width: number, height: number): Uint8Array {
  const cleaned = base64.replace(/^data:image\/jpeg;base64,/i, '').replace(/\s/g, '')
  const binary = atob(cleaned)
  const jpeg = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    jpeg[i] = binary.charCodeAt(i)
  }
  return jpegBytesToPdf(jpeg, width, height)
}
