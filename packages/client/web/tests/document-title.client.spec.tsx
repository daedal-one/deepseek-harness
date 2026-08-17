// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DocumentTitle } from '../src/DocumentTitle.tsx'

afterEach(() => {
  cleanup()
  document.title = ''
})

describe('DocumentTitle', () => {
  it('preserves the product title without a durable title and restores it on unmount', () => {
    document.title = 'static shell title'
    const mounted = render(<DocumentTitle productTitle="the harness" />)
    expect(document.title).toBe('the harness')

    mounted.rerender(<DocumentTitle productTitle="the harness" title="First title" />)
    expect(document.title).toBe('First title — the harness')

    mounted.rerender(<DocumentTitle productTitle="Studio" title="Revised title" />)
    expect(document.title).toBe('Revised title — Studio')

    mounted.rerender(<DocumentTitle productTitle="Studio" />)
    expect(document.title).toBe('Studio')
    mounted.unmount()
    expect(document.title).toBe('static shell title')
  })
})
