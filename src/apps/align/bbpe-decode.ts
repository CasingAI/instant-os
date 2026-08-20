/**
 * 字节 BPE（byte BPE）解码：sherpa-onnx zipformer-ctc-zh 的 token 形如 `▁ƎĽĥ`，
 * 每个字符对应一个原始字节（sherpa-onnx/csrc/bbpe.cc 的固定 256 项映射表）。
 * 把 token 字符串的每个字符还原成字节，再按 UTF-8 拼成中文文本。
 *
 * 例：`▁ƎĽĥ` → ▁(词边界) + [0xE7 0x9A 0x84] = " 的"
 *
 * 纯函数，可 node --experimental-strip-types 单测。
 */

/** byte → 字符（sherpa-onnx bbpe.cc 固定表，自动生成） */
export const BYTE_TO_CHAR: string[] = [
  '\u{100}', '\u{101}', '\u{102}', '\u{103}', '\u{104}', '\u{105}', '\u{106}', '\u{107}',
  '\u{108}', '\u{109}', '\u{10A}', '\u{10B}', '\u{10C}', '\u{10D}', '\u{10E}', '\u{10F}',
  '\u{110}', '\u{111}', '\u{112}', '\u{113}', '\u{114}', '\u{115}', '\u{116}', '\u{117}',
  '\u{118}', '\u{119}', '\u{11A}', '\u{11B}', '\u{11C}', '\u{11D}', '\u{11E}', '\u{11F}',
  '\u{2047}', '\u{21}', '\u{5C}', '\u{23}', '\u{24}', '\u{25}', '\u{26}', '\u{27}',
  '\u{28}', '\u{29}', '\u{2A}', '\u{2B}', '\u{2C}', '\u{2D}', '\u{2E}', '\u{2F}',
  '\u{30}', '\u{31}', '\u{32}', '\u{33}', '\u{34}', '\u{35}', '\u{36}', '\u{37}',
  '\u{38}', '\u{39}', '\u{3A}', '\u{3B}', '\u{3C}', '\u{3D}', '\u{3E}', '\u{3F}',
  '\u{40}', '\u{41}', '\u{42}', '\u{43}', '\u{44}', '\u{45}', '\u{46}', '\u{47}',
  '\u{48}', '\u{49}', '\u{4A}', '\u{4B}', '\u{4C}', '\u{4D}', '\u{4E}', '\u{4F}',
  '\u{50}', '\u{51}', '\u{52}', '\u{53}', '\u{54}', '\u{55}', '\u{56}', '\u{57}',
  '\u{58}', '\u{59}', '\u{5A}', '\u{5B}', '\u{5C}', '\u{5D}', '\u{5E}', '\u{5F}',
  '\u{60}', '\u{61}', '\u{62}', '\u{63}', '\u{64}', '\u{65}', '\u{66}', '\u{67}',
  '\u{68}', '\u{69}', '\u{6A}', '\u{6B}', '\u{6C}', '\u{6D}', '\u{6E}', '\u{6F}',
  '\u{70}', '\u{71}', '\u{72}', '\u{73}', '\u{74}', '\u{75}', '\u{76}', '\u{77}',
  '\u{78}', '\u{79}', '\u{7A}', '\u{7B}', '\u{7C}', '\u{7D}', '\u{7E}', '\u{120}',
  '\u{121}', '\u{122}', '\u{123}', '\u{124}', '\u{125}', '\u{126}', '\u{127}', '\u{128}',
  '\u{129}', '\u{12A}', '\u{12B}', '\u{12C}', '\u{12D}', '\u{12E}', '\u{12F}', '\u{130}',
  '\u{131}', '\u{134}', '\u{135}', '\u{136}', '\u{137}', '\u{138}', '\u{139}', '\u{13A}',
  '\u{13B}', '\u{13C}', '\u{13D}', '\u{13E}', '\u{141}', '\u{142}', '\u{143}', '\u{144}',
  '\u{145}', '\u{146}', '\u{147}', '\u{148}', '\u{14A}', '\u{14B}', '\u{14C}', '\u{14D}',
  '\u{14E}', '\u{14F}', '\u{150}', '\u{151}', '\u{152}', '\u{153}', '\u{154}', '\u{155}',
  '\u{156}', '\u{157}', '\u{158}', '\u{159}', '\u{15A}', '\u{15B}', '\u{15C}', '\u{15D}',
  '\u{15E}', '\u{15F}', '\u{160}', '\u{161}', '\u{162}', '\u{163}', '\u{164}', '\u{165}',
  '\u{166}', '\u{167}', '\u{168}', '\u{169}', '\u{16A}', '\u{16B}', '\u{16C}', '\u{16D}',
  '\u{16E}', '\u{16F}', '\u{170}', '\u{171}', '\u{172}', '\u{173}', '\u{174}', '\u{175}',
  '\u{176}', '\u{177}', '\u{178}', '\u{179}', '\u{17A}', '\u{17B}', '\u{17C}', '\u{17D}',
  '\u{17E}', '\u{180}', '\u{181}', '\u{182}', '\u{183}', '\u{184}', '\u{185}', '\u{186}',
  '\u{187}', '\u{188}', '\u{189}', '\u{18A}', '\u{18B}', '\u{18C}', '\u{18D}', '\u{18E}',
  '\u{18F}', '\u{190}', '\u{191}', '\u{192}', '\u{193}', '\u{194}', '\u{195}', '\u{196}',
  '\u{197}', '\u{198}', '\u{199}', '\u{19A}', '\u{19B}', '\u{19C}', '\u{19D}', '\u{19E}',
  '\u{19F}', '\u{1A0}', '\u{1A1}', '\u{1A2}', '\u{1A3}', '\u{1A4}', '\u{1A5}', '\u{1A6}',
]

/** 字符 → byte（含 ASCII 空格与 ⁇ 两条 byte 32 表示） */
const CHAR_TO_BYTE = new Map<string, number>()
for (let b = 0; b < 256; b++) CHAR_TO_BYTE.set(BYTE_TO_CHAR[b], b)
CHAR_TO_BYTE.set(' ', 32)
CHAR_TO_BYTE.set('⁇', 32)

/**
 * 把一个字节 BPE token 字符串解码成文本。
 * `▁` 表示词边界（空格）；其余字符按表还原为字节，再按 UTF-8 拼接。
 * 无法识别的可打印 ASCII 字符直接保留（与 sherpa isprint 兜底一致）。
 */
export function decodeByteBpe(text: string): string {
  const chars = Array.from(text)
  const bytes: number[] = []
  for (const ch of chars) {
    if (ch === '▁') {
      bytes.push(0x20)
      continue
    }
    const b = CHAR_TO_BYTE.get(ch)
    if (b !== undefined) {
      bytes.push(b)
      continue
    }
    if (ch >= ' ' && ch <= '~') bytes.push(ch.codePointAt(0) ?? 0x20)
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes))
}

/** 把一个 token 解码为字符序列（去掉前导/尾部空格，供逐字对齐） */
export function decodeTokenToUnits(token: string): string[] {
  const text = decodeByteBpe(token)
  return Array.from(text.replace(/^\s+|\s+$/g, ''))
}

/**
 * 文本 → 字节字符序列（编码方向，与 decodeByteBpe 互逆）。
 * 空白（含空格）→ `▁`（模型词边界标记）；其余字符按 UTF-8 逐字节映射到
 * BYTE_TO_CHAR 表。供歌词强制对齐把歌词编码成模型 token 侧序列。
 */
export function encodeTextToBpeChars(text: string): string[] {
  const out: string[] = []
  for (const ch of text) {
    if (/\s/u.test(ch)) {
      out.push('▁')
      continue
    }
    const bytes = new TextEncoder().encode(ch)
    for (const b of bytes) out.push(BYTE_TO_CHAR[b])
  }
  return out
}
