import { describe, expect, it } from 'vitest'
import { commandFromArgs, isSshTarget, pathFromFileUrl, shQuote, sshFromUrl, windowsArg } from '../src/shared/open'

describe('sshFromUrl', () => {
  it('reads user, host and port', () => {
    expect(sshFromUrl('ssh://me@example.com')).toBe('me@example.com')
    expect(sshFromUrl('ssh://example.com:2222')).toBe('example.com -p 2222')
    expect(sshFromUrl('ssh://deploy@10.0.0.5:22')).toBe('deploy@10.0.0.5 -p 22')
    expect(sshFromUrl('ssh://me@[::1]')).toBe('me@::1')
  })

  it('refuses anything a shell would read as more than a target', () => {
    expect(sshFromUrl('ssh://%24(touch%20%2Ftmp%2Fx)@host')).toBeUndefined()
    expect(sshFromUrl('ssh://a@h;id')).toBeUndefined()
    expect(sshFromUrl('ssh://a@h%20-oProxyCommand=x')).toBeUndefined()
    expect(sshFromUrl('ssh://-oProxyCommand=x@host')).toBeUndefined()
    expect(sshFromUrl('ssh://a@-host')).toBeUndefined()
    expect(sshFromUrl("ssh://a'b@host")).toBeUndefined()
    expect(sshFromUrl('ssh://a%40b@host')).toBeUndefined()
    expect(sshFromUrl('ssh://a@h`id`')).toBeUndefined()
    expect(sshFromUrl('ssh://')).toBeUndefined()
    expect(sshFromUrl('https://example.com')).toBeUndefined()
    expect(sshFromUrl('ssh://%E0%A4%A@host')).toBeUndefined()
  })
})

describe('isSshTarget', () => {
  it('takes a target and an optional port', () => {
    expect(isSshTarget('me@host')).toBe(true)
    expect(isSshTarget('host -p 2222')).toBe(true)
    expect(isSshTarget('host -p 0')).toBe(false)
    expect(isSshTarget('host -p 70000')).toBe(false)
    expect(isSshTarget('host -p 22; id')).toBe(false)
    expect(isSshTarget('$(id)@host')).toBe(false)
    expect(isSshTarget('-oProxyCommand=x')).toBe(false)
  })
})

describe('commandFromArgs', () => {
  it('keeps a single command line as it is', () => {
    expect(commandFromArgs(['vim notes.txt'], false)).toBe('vim notes.txt')
  })
  it('quotes words so their boundaries survive', () => {
    expect(commandFromArgs(['sh', '-c', 'foo bar'], false)).toBe("sh -c 'foo bar'")
    expect(commandFromArgs(['echo', "it's", '$HOME'], false)).toBe(`echo 'it'\\''s' '$HOME'`)
    expect(commandFromArgs(['ls', '/tmp/a.txt'], false)).toBe('ls /tmp/a.txt')
  })
  it('quotes empty words', () => {
    expect(shQuote('')).toBe("''")
  })
})

describe('windowsArg', () => {
  it('reads a drive root from Explorer as the root', () => {
    expect(windowsArg('C:"')).toBe('C:\\')
    expect(windowsArg('d:"')).toBe('d:\\')
    expect(windowsArg('C:\\Users\\me')).toBe('C:\\Users\\me')
  })
})

describe('pathFromFileUrl', () => {
  it('reads a folder a file manager passes as a URL', () => {
    expect(pathFromFileUrl('file:///home/me/My%20Project')).toBe('/home/me/My Project')
    expect(pathFromFileUrl('file://localhost/home/me/%C3%A7al%C4%B1%C5%9Fma')).toBe('/home/me/çalışma')
    expect(pathFromFileUrl('file:///C:/Users/me/app', true)).toBe('C:\\Users\\me\\app')
  })

  it('refuses other hosts, encoded slashes and anything else', () => {
    expect(pathFromFileUrl('file://server/share/x')).toBeUndefined()
    expect(pathFromFileUrl('file:///home/me/a%2F..%2F..%2Fetc')).toBeUndefined()
    expect(pathFromFileUrl('file:///home/me/a%00b')).toBeUndefined()
    expect(pathFromFileUrl('/home/me/plain')).toBeUndefined()
    expect(pathFromFileUrl('https://example.com/x')).toBeUndefined()
    expect(pathFromFileUrl('file:///home/me', true)).toBeUndefined()
  })
})
