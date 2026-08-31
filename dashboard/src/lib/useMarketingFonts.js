import { useEffect } from 'react'

// The funnel pages use two Google families (Playfair Display for the serif
// headlines, Poppins for body), per the mockups. They are injected at runtime
// from the marketing pages instead of being linked in index.html, deliberately:
// index.html is the shared shell for every route including /login, and the
// login surface must stay byte-identical to main while the Meta review thread
// is open. Auth and dashboard pages therefore never pay for these fonts.
//
// The link is added once and never removed: fonts staying cached across an
// in-app navigation is harmless, and removing them would cause a reflow.
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Poppins:wght@400;500;600;700&display=swap'

export function useMarketingFonts() {
  useEffect(() => {
    if (document.querySelector('link[data-mk-fonts]')) return
    for (const href of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) {
      const pre = document.createElement('link')
      pre.rel = 'preconnect'
      pre.href = href
      if (href.includes('gstatic')) pre.crossOrigin = 'anonymous'
      document.head.appendChild(pre)
    }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = FONTS_HREF
    link.setAttribute('data-mk-fonts', 'true')
    document.head.appendChild(link)
  }, [])
}
