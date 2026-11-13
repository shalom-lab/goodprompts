import { useEffect, useMemo, useRef, useState } from 'react'
import { promptGallery } from '../types/prompt'

export type ImageLoadStatus = 'idle' | 'ok' | 'empty'

export type UsePromptImagesOpts = {
  lazy?: boolean
  max?: number
  image?: string
  images?: string[]
}

/**
 * Resolve static public-image URLs for a prompt.
 * No tokens, no remote GitHub fetches — files are shipped in this repo.
 */
export function usePromptImages(opts: UsePromptImagesOpts = {}) {
  const { lazy = true, max, image, images } = opts
  const { coverUrl: resolvedCover, urls: resolvedUrls } = useMemo(
    () => promptGallery({ image, images }),
    [image, images],
  )
  const urlsAll = useMemo(() => {
    if (typeof max === 'number' && max > 0) return resolvedUrls.slice(0, max)
    return resolvedUrls
  }, [resolvedUrls, max])
  const hasImages = Boolean(resolvedCover || urlsAll.length > 0)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(!lazy)

  useEffect(() => {
    if (!lazy) {
      setVisible(true)
      return
    }
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [lazy])

  const ready = visible && hasImages
  const urls = ready ? urlsAll : []
  const coverUrl = ready ? (resolvedCover ?? urlsAll[0] ?? null) : null
  const status: ImageLoadStatus = !hasImages
    ? 'empty'
    : visible
      ? 'ok'
      : 'idle'

  return {
    rootRef,
    urls,
    count: urls.length,
    coverUrl,
    status,
  }
}
