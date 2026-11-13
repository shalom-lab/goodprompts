export interface PromptItem {
  prompt_id: string
  content: string
  savedAt: string
  wechat_title: string
  keywords: string[]
  reply_keyword?: string
  /** Public cover path, e.g. images/prompt/xxx.png */
  image?: string
  /** Public gallery paths; keep distinct from `image`. */
  images?: string[]
  /** Aggregate count of effect images (preferred for badge/filter). */
  image_count?: number
}

export function normalizePrompts(data: unknown): PromptItem[] {
  if (!Array.isArray(data)) {
    throw new Error('prompts.json 应为 JSON 数组')
  }
  return data.map((item, index) => {
    const p = item as Partial<PromptItem> & Record<string, unknown>
    const out: PromptItem = {
      prompt_id:
        typeof p.prompt_id === 'string' && p.prompt_id
          ? p.prompt_id
          : `unknown-${index}`,
      content: String(p.content ?? ''),
      savedAt: String(p.savedAt ?? ''),
      wechat_title: String(p.wechat_title ?? ''),
      keywords: Array.isArray(p.keywords) ? p.keywords.map(String) : [],
      reply_keyword:
        p.reply_keyword != null ? String(p.reply_keyword) : undefined,
    }
    if (typeof p.image === 'string' && p.image.trim()) {
      out.image = p.image.trim()
    }
    if (Array.isArray(p.images)) {
      out.images = p.images.map(String).filter((s) => s.trim())
    }
    const rawCount = (item as Record<string, unknown>).image_count
    if (typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount >= 0) {
      out.image_count = Math.floor(rawCount)
    } else if (typeof rawCount === 'string' && rawCount.trim() !== '') {
      const n = Number(rawCount)
      if (Number.isFinite(n) && n >= 0) out.image_count = Math.floor(n)
    }
    return out
  })
}

/** Site URL for a path under this repo's `public/` directory. */
export function publicAssetUrl(rel: string): string {
  const cleaned = rel
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
  if (!cleaned) return ''
  const base = import.meta.env.BASE_URL || '/'
  return `${base}${cleaned}`
}

/** Ordered gallery public paths: prefer `images`, else single `image`. */
export function knownPublicImagePaths(
  image?: string,
  images?: string[],
): string[] {
  const seen = new Set<string>()
  const paths: string[] = []
  const add = (rel?: string) => {
    const s = rel?.trim()
    if (!s || seen.has(s)) return
    seen.add(s)
    paths.push(s)
  }
  if (images && images.length > 0) {
    for (const rel of images) add(rel)
  } else {
    add(image)
  }
  return paths
}

export function promptGallery(p: {
  image?: string
  images?: string[]
}): { coverUrl: string | null; urls: string[] } {
  const paths = knownPublicImagePaths(p.image, p.images)
  const urls = paths.map(publicAssetUrl).filter(Boolean)
  const coverUrl = p.image?.trim()
    ? publicAssetUrl(p.image) || null
    : (urls[0] ?? null)
  return { coverUrl, urls }
}

/** YYYY-MM from savedAt, or prompt_id time prefix as fallback. */
export function promptMonth(p: PromptItem): string | null {
  const fromSaved = String(p.savedAt ?? '').match(/^(\d{4}-\d{2})/)
  if (fromSaved) return fromSaved[1]
  const fromId = String(p.prompt_id ?? '').match(/^(\d{4}-\d{2})/)
  if (fromId) return fromId[1]
  return null
}

/**
 * Declared gallery size for badge/filter.
 * Prefer aggregate `image_count` when present, but never exceed the unique
 * recorded `images` list (guards against an inflated summary count).
 */
export function promptImageCount(p: {
  image_count?: number
  image?: string
  images?: string[]
}): number {
  const listLen = knownPublicImagePaths(p.image, p.images).length

  if (
    typeof p.image_count === 'number' &&
    Number.isFinite(p.image_count) &&
    p.image_count >= 0
  ) {
    const declared = Math.floor(p.image_count)
    if (listLen > 0) return Math.min(declared, listLen)
    return declared
  }
  if (listLen > 0) return listLen
  if (p.image && p.image.trim()) return 1
  return 0
}
