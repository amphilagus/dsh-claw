import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultUvCacheDir, defaultUvDataDir } from './paths.ts'

describe('defaultUvCacheDir', () => {
  it('honors UV_CACHE_DIR over XDG and the platform default', () => {
    expect(defaultUvCacheDir({ UV_CACHE_DIR: '/tmp/uv-cache', XDG_CACHE_HOME: '/xdg-cache' }, 'darwin', '/home/u'))
      .toBe('/tmp/uv-cache')
  })

  it('uses XDG_CACHE_HOME/uv when UV_CACHE_DIR is absent', () => {
    expect(defaultUvCacheDir({ XDG_CACHE_HOME: '/xdg-cache' }, 'linux', '/home/u')).toBe(join('/xdg-cache', 'uv'))
  })

  it('uses ~/.cache/uv on POSIX, including darwin', () => {
    expect(defaultUvCacheDir({}, 'darwin', '/Users/u')).toBe(join('/Users/u', '.cache', 'uv'))
    expect(defaultUvCacheDir({}, 'linux', '/home/u')).toBe(join('/home/u', '.cache', 'uv'))
  })

  it('uses %LOCALAPPDATA%\\uv\\cache on Windows', () => {
    expect(defaultUvCacheDir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32', 'C:\\Users\\u'))
      .toBe(join('C:\\Users\\u\\AppData\\Local', 'uv', 'cache'))
  })
})

describe('defaultUvDataDir', () => {
  it('uses XDG_DATA_HOME/uv when set', () => {
    expect(defaultUvDataDir({ XDG_DATA_HOME: '/xdg-data' }, 'linux', '/home/u')).toBe(join('/xdg-data', 'uv'))
  })

  it('uses ~/.local/share/uv on POSIX', () => {
    expect(defaultUvDataDir({}, 'darwin', '/Users/u')).toBe(join('/Users/u', '.local', 'share', 'uv'))
  })

  it('uses %LOCALAPPDATA%\\uv on Windows', () => {
    expect(defaultUvDataDir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32', 'C:\\Users\\u'))
      .toBe(join('C:\\Users\\u\\AppData\\Local', 'uv'))
  })
})
