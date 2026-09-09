/**
 * Resolve the conversation's live vertical scroll owner across responsive layouts.
 * @param from - A node inside the conversation flow.
 * @returns The document scrolling element on phone or the nearest conversation host elsewhere.
 */
export function conversationScroller(from: HTMLElement): HTMLElement {
  const host = from.closest<HTMLElement>('[data-conversation-scroll]')
  if (host === null) return from
  if (host.closest('[data-phone="true"]') === null) return host
  const scrollingElement = document.scrollingElement
  return scrollingElement instanceof HTMLElement ? scrollingElement : document.documentElement
}

/**
 * Identify document-owned scrolling, whose visible bounds are the browser viewport.
 * @param scroller - The resolved conversation scroll owner.
 * @returns Whether the owner is the document scrolling element.
 */
export function isDocumentScroller(scroller: HTMLElement): boolean {
  return scroller === document.scrollingElement || scroller === document.documentElement
}

/**
 * List the event targets that remain valid when the responsive owner changes after mount.
 * @param from - A node inside the conversation flow.
 * @returns The local scroller alone in isolation, or the assembled host and document.
 */
export function conversationScrollEventTargets(from: HTMLElement): readonly EventTarget[] {
  const host = from.closest<HTMLElement>('[data-conversation-scroll]')
  return host === null ? [from] : [host, document]
}

/**
 * Read the visible scroll bounds in viewport coordinates.
 * @param scroller - The resolved conversation scroll owner.
 * @returns The viewport edges used for semantic anchor selection.
 */
export function conversationViewport(scroller: HTMLElement): {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
} {
  if (isDocumentScroller(scroller)) {
    return { top: 0, right: window.innerWidth, bottom: window.innerHeight, left: 0 }
  }
  return scroller.getBoundingClientRect()
}

/**
 * Measure a row relative to the active scroll viewport.
 * @param row - The stable transcript row being anchored.
 * @param scroller - The resolved conversation scroll owner.
 * @returns The row's top offset inside the visible scroll viewport.
 */
export function conversationFlowTop(row: HTMLElement, scroller: HTMLElement): number {
  const top = row.getBoundingClientRect().top
  return isDocumentScroller(scroller) ? top : top - scroller.getBoundingClientRect().top
}
