import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDocumentMeta } from './useDocumentMeta'

describe('useDocumentMeta', () => {
  afterEach(() => {
    document.title = ''
    document.head.querySelectorAll('meta[name="robots"]').forEach((el) => el.remove())
    document.head.querySelectorAll('link[rel="canonical"]').forEach((el) => el.remove())
    document.head.querySelectorAll('link[rel="alternate"]').forEach((el) => el.remove())
  })

  it('sets the document title', () => {
    renderHook(() => useDocumentMeta({ title: 'Impressum — 2Fronts' }))
    expect(document.title).toBe('Impressum — 2Fronts')
  })

  it('restores the previous title on unmount', () => {
    document.title = 'Original'
    const { unmount } = renderHook(() => useDocumentMeta({ title: 'Impressum — 2Fronts' }))
    expect(document.title).toBe('Impressum — 2Fronts')
    unmount()
    expect(document.title).toBe('Original')
  })

  it('updates the existing meta description and restores it on unmount', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'description')
    meta.setAttribute('content', 'Original description')
    document.head.appendChild(meta)

    const { unmount } = renderHook(() =>
      useDocumentMeta({ title: 'X', description: 'Page-specific description' })
    )
    expect(meta.getAttribute('content')).toBe('Page-specific description')
    unmount()
    expect(meta.getAttribute('content')).toBe('Original description')

    meta.remove()
  })

  it('adds a noindex meta tag and removes it on unmount', () => {
    const { unmount } = renderHook(() => useDocumentMeta({ title: 'X', noindex: true }))
    const robots = document.head.querySelector('meta[name="robots"]')
    expect(robots?.getAttribute('content')).toBe('noindex, follow')
    unmount()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })

  it('does not add a noindex tag when noindex is false', () => {
    renderHook(() => useDocumentMeta({ title: 'X' }))
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })

  it('adds a self-referencing canonical link and removes it on unmount', () => {
    const { unmount } = renderHook(() =>
      useDocumentMeta({ title: 'X', canonical: 'https://2fronts.de/en' })
    )
    const link = document.head.querySelector('link[rel="canonical"]')
    expect(link?.getAttribute('href')).toBe('https://2fronts.de/en')
    unmount()
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
  })

  it('adds hreflang alternate links and removes them on unmount', () => {
    const { unmount } = renderHook(() =>
      useDocumentMeta({
        title: 'X',
        hreflang: [
          { lang: 'de', href: 'https://2fronts.de/' },
          { lang: 'en', href: 'https://2fronts.de/en' },
          { lang: 'x-default', href: 'https://2fronts.de/' },
        ],
      })
    )
    const links = Array.from(document.head.querySelectorAll('link[rel="alternate"]'))
    expect(links).toHaveLength(3)
    expect(links.map((l) => l.getAttribute('hreflang'))).toEqual(['de', 'en', 'x-default'])
    unmount()
    expect(document.head.querySelectorAll('link[rel="alternate"]')).toHaveLength(0)
  })
})
