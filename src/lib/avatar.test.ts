import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AVATAR_BACKGROUNDS,
  AVATAR_LAYER_ORDER,
  AVATAR_PART_COUNTS,
  deterministicAvatar,
} from './avatar.ts'

test('deterministicAvatar is stable for a seed', () => {
  const a = deterministicAvatar('DANRO')
  const b = deterministicAvatar('DANRO')
  assert.deepEqual(a, b)
})

test('deterministicAvatar is case- and whitespace-insensitive like a handle', () => {
  assert.deepEqual(deterministicAvatar('danro'), deterministicAvatar('DANRO'))
  assert.deepEqual(deterministicAvatar('  danro  '), deterministicAvatar('DANRO'))
})

test('deterministicAvatar spreads across different seeds', () => {
  const a = deterministicAvatar('DANRO')
  const b = deterministicAvatar('SOMEONE_ELSE')
  assert.notDeepEqual(a, b)
})

test('deterministicAvatar always picks an in-range index per layer', () => {
  for (const seed of ['', 'A', 'A_VERY_LONG_HANDLE_1234567890', '한글핸들']) {
    const config = deterministicAvatar(seed)
    for (const layer of AVATAR_LAYER_ORDER) {
      const index = config[layer]
      assert.ok(Number.isInteger(index), `${layer} index should be an integer`)
      assert.ok(index >= 0 && index < AVATAR_PART_COUNTS[layer], `${layer} index in range`)
    }
    assert.ok(AVATAR_BACKGROUNDS.includes(config.bg as (typeof AVATAR_BACKGROUNDS)[number]))
  }
})
