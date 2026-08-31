// The funnel pages use two Google families (Playfair Display for the serif
// headlines, Poppins for body), per the mockups. They are injected at runtime
// from the marketing pages instead of being linked in index.html, deliberately:
// index.html is the shared shell for every route including /login, and the
// login surface must stay byte-identical to main while the Meta review thread
// is open. Auth and dashboard pages therefore never pay for these fonts.
//
// The injection runs during RENDER, not in an effect: an effect fires after
// the first paint, which cost a full font-swap reflow (CLS 0.372 on the
// homepage before this). It is idempotent, so StrictMode double renders and
// multiple marketing pages are harmless, and the link is never removed:
// fonts staying cached across an in-app navigation is free.
//
// marketing.css pairs this with metric-matched local fallback faces
// (Playfair Fallback / Poppins Fallback) so whatever swap remains does not
// move the layout.
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Poppins:wght@400;500;600;700&display=swap'

export function useMarketingFonts() {
  if (typeof document === 'undefined') return
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
}
