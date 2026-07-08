import { useEffect } from 'react'

interface HreflangLink {
  lang: string // ISO 639-1, or 'x-default'
  href: string // absolute URL
}

interface DocumentMetaOptions {
  title: string
  description?: string
  noindex?: boolean
  /** Self-referencing canonical URL for this route (absolute). */
  canonical?: string
  /**
   * hreflang alternates for this route, INCLUDING the self-referencing entry
   * and x-default. Per the international-SEO guidance: a missing self-entry,
   * a missing reciprocal link, or a canonical that isn't itself present in
   * this set causes Google to discard the whole hreflang cluster — so pass
   * the complete set every time, not just the "other" languages.
   */
  hreflang?: HreflangLink[]
}

// Per-route <title>/<meta description>/robots/canonical/hreflang override. The
// app has a single static index.html (one title, one description, no
// canonical/hreflang at all), so every route that needs its own sets it here
// on mount and restores/removes it on unmount — otherwise client-side
// navigation leaves stale tags from whichever route rendered previously.
// (see seo-audit-2026-07-08.md findings #2 duplicate titles, #3 hreflang)
export function useDocumentMeta({
  title,
  description,
  noindex = false,
  canonical,
  hreflang,
}: DocumentMetaOptions) {
  useEffect(() => {
    const previousTitle = document.title
    document.title = title

    const descTag = description ? document.querySelector('meta[name="description"]') : null
    const previousDescription = descTag?.getAttribute('content') ?? null
    if (descTag && description) descTag.setAttribute('content', description)

    let robotsTag: HTMLMetaElement | null = null
    if (noindex) {
      robotsTag = document.createElement('meta')
      robotsTag.setAttribute('name', 'robots')
      robotsTag.setAttribute('content', 'noindex, follow')
      document.head.appendChild(robotsTag)
    }

    let canonicalTag: HTMLLinkElement | null = null
    if (canonical) {
      canonicalTag = document.createElement('link')
      canonicalTag.setAttribute('rel', 'canonical')
      canonicalTag.setAttribute('href', canonical)
      document.head.appendChild(canonicalTag)
    }

    const hreflangTags: HTMLLinkElement[] = []
    if (hreflang) {
      for (const { lang, href } of hreflang) {
        const link = document.createElement('link')
        link.setAttribute('rel', 'alternate')
        link.setAttribute('hreflang', lang)
        link.setAttribute('href', href)
        document.head.appendChild(link)
        hreflangTags.push(link)
      }
    }

    return () => {
      document.title = previousTitle
      if (descTag && previousDescription !== null) descTag.setAttribute('content', previousDescription)
      robotsTag?.remove()
      canonicalTag?.remove()
      hreflangTags.forEach((tag) => tag.remove())
    }
  }, [title, description, noindex, canonical, hreflang])
}
