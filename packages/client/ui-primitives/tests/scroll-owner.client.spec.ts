// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  conversationFlowTop,
  conversationScroller,
  conversationScrollEventTargets,
  conversationViewport,
  isDocumentScroller,
} from '../src/scroll-owner.ts'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('responsive conversation scroll owner', () => {
  it('keeps an isolated view and an assembled desktop host as element scrollers', () => {
    const isolated = document.createElement('div')
    expect(conversationScroller(isolated)).toBe(isolated)
    expect(conversationScrollEventTargets(isolated)).toEqual([isolated])

    const frame = document.createElement('div')
    const host = document.createElement('div')
    const row = document.createElement('div')
    host.dataset.conversationScroll = ''
    host.append(row)
    frame.append(host)
    document.body.append(frame)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ top: 20, right: 320, bottom: 520, left: 10 } as DOMRect)
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ top: 85 } as DOMRect)

    expect(conversationScroller(row)).toBe(host)
    expect(isDocumentScroller(host)).toBe(false)
    expect(conversationScrollEventTargets(row)).toEqual([host, document])
    expect(conversationViewport(host)).toMatchObject({ top: 20, right: 320, bottom: 520, left: 10 })
    expect(conversationFlowTop(row, host)).toBe(65)
  })

  it('routes phone geometry and scrolling through the document element', () => {
    const frame = document.createElement('div')
    frame.dataset.phone = 'true'
    const host = document.createElement('div')
    host.dataset.conversationScroll = ''
    const row = document.createElement('div')
    host.append(row)
    frame.append(host)
    document.body.append(frame)
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ top: 74 } as DOMRect)

    const scroller = conversationScroller(row)
    expect(scroller).toBe(document.scrollingElement ?? document.documentElement)
    expect(isDocumentScroller(scroller)).toBe(true)
    expect(conversationViewport(scroller)).toEqual({
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0,
    })
    expect(conversationFlowTop(row, scroller)).toBe(74)
  })
})
