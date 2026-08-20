import assert from 'node:assert/strict'
import { isOriginAllowed } from './cors.ts'
import { lookupModelObject } from './catalog.ts'
import {
  issueChallenge,
  leadingZeroBits,
  pbkdf2Sha256Hex,
  powInput,
  sha256HexBytes,
  verifyChallenge,
  verifyPowWork,
} from './pow.ts'

{
  assert.equal(lookupModelObject('/nope'), undefined)
  assert.equal(lookupModelObject('/assets/../demucs/models/htdemucs_6s.onnx'), undefined)
  const demucs = lookupModelObject('/assets/demucs/models/htdemucs_6s.onnx')
  assert.equal(demucs?.r2Key, 'demucs/models/htdemucs_6s.onnx')
  assert.equal(demucs?.uncompressedBytes, 284_797_240)
}

{
  assert.equal(leadingZeroBits('0000abcd'), 16)
  assert.equal(leadingZeroBits('abcd'), 0)
}

{
  const secret = 'test-secret'
  const bodyHash = await sha256HexBytes(new TextEncoder().encode('/assets/mdx/models/UVR-MDX-NET-Inst_full_292.onnx'))
  const issued = await issueChallenge(secret, bodyHash, {
    difficulty: 4,
    iters: 64,
    windowSeconds: 120,
    now: 1_700_000_000_000,
  })
  const ok = await verifyChallenge(secret, issued.challenge, bodyHash, {
    now: 1_700_000_000_000,
    windowSeconds: 120,
  })
  assert.equal(ok.ok, true)

  let nonce = 0
  for (; nonce < 1_000_000; nonce++) {
    const hash = await pbkdf2Sha256Hex(powInput(issued.challenge, bodyHash, nonce), 64)
    if (leadingZeroBits(hash) >= 4) break
  }
  const work = await verifyPowWork({
    challenge: issued.challenge,
    bodyHash,
    nonce,
    difficulty: 4,
    iters: 64,
  })
  assert.equal(work.ok, true)
}

console.log('model-gateway catalog/pow tests ok')

{
  const allowed = [
    'http://localhost',
    'http://localhost:6173',
    'http://localhost:5173/',
    'https://casing-ai.com',
    'https://demo.api.casing-ai.com',
    'http://www.casing-ai.com',
    'https://instant-os.pages.dev',
    'https://preview.instant-os.pages.dev',
  ]
  for (const origin of allowed) {
    assert.equal(isOriginAllowed(origin), true, origin)
  }
  const denied = [
    '',
    'https://localhost:6173',
    'http://127.0.0.1:6173',
    'https://example.com',
    'https://notcasing-ai.com',
    'https://casing-ai.com.evil.com',
    'https://evil-instant-os.pages.dev',
    'https://pages.dev',
  ]
  for (const origin of denied) {
    assert.equal(isOriginAllowed(origin), false, origin)
  }
}
