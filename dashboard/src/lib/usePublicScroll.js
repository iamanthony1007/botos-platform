import { useEffect } from 'react'

// The dashboard shell locks the viewport: index.css sets
// html, body, #root { height: 100%; overflow: hidden } so the app never
// window-scrolls and Layout manages its own inner scroll. Public marketing and
// auth pages render into the same #root, so anything taller than the viewport
// gets clipped with no way to scroll. This hook opts the current page into
// normal document scrolling by toggling a class on <html>, and reverts on
// unmount so the dashboard shell is never affected.
export function usePublicScroll() {
  useEffect(() => {
    const el = document.documentElement
    el.classList.add('public-scroll')
    return () => el.classList.remove('public-scroll')
  }, [])
}
