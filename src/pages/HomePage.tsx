import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImageCountFilter } from '../components/ImageCountFilter'
import { KeywordFilter } from '../components/KeywordFilter'
import { MonthFilter } from '../components/MonthFilter'
import { PromptCard } from '../components/PromptCard'
import { PromptDetailModal } from '../components/PromptDetailModal'
import { SearchBar } from '../components/SearchBar'
import { SelectedDrawer } from '../components/SelectedDrawer'
import { ToastStack, type ToastItem, type ToastKind } from '../components/Toast'
import { useSelectedPrompts } from '../hooks/useSelectedPrompts'
import {
  normalizePrompts,
  promptGallery,
  promptImageCount,
  promptMonth,
  type PromptItem,
} from '../types/prompt'
import { copyText } from '../utils/copy'
import { downloadPromptCard } from '../utils/downloadPromptCard'

const FILTERS_OPEN_KEY = 'goodprompts-home-filters-open'
const DATA_URL = `${import.meta.env.BASE_URL}data/prompts.json`

function readFiltersOpen(): boolean {
  try {
    const v = localStorage.getItem(FILTERS_OPEN_KEY)
    if (v == null) return true
    return v === '1' || v === 'true'
  } catch {
    return true
  }
}

function matchesQuery(p: PromptItem, q: string): boolean {
  if (!q) return true
  const hay = [p.wechat_title, p.content, p.reply_keyword ?? '', ...p.keywords]
    .join(' ')
    .toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term))
}

async function loadPublicPrompts(): Promise<PromptItem[]> {
  const res = await fetch(DATA_URL, { cache: 'no-cache' })
  if (!res.ok) {
    throw new Error(`无法加载提示词（${res.status}）`)
  }
  const data: unknown = await res.json()
  return normalizePrompts(data)
}

export function HomePage() {
  const [prompts, setPrompts] = useState<PromptItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [replyKeywords, setReplyKeywords] = useState<string[]>([])
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [countMin, setCountMin] = useState(1)
  /** null = use full data range (avoids filtering before bounds sync). */
  const [countMax, setCountMax] = useState<number | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(readFiltersOpen)
  const [detailPrompt, setDetailPrompt] = useState<PromptItem | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastId = useRef(1)
  const [cartBusy, setCartBusy] = useState(false)

  const pushToast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = toastId.current++
    setToasts((prev) => [...prev.slice(-4), { id, message, kind }])
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const {
    selected,
    count: selectedCount,
    isSelected,
    toggle: toggleSelect,
    remove: removeSelected,
    clear: clearSelected,
  } = useSelectedPrompts()

  const handleCartCopy = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      const want = new Set(ids)
      const texts = selected
        .filter((p) => want.has(p.prompt_id))
        .map((p) => p.content)
        .filter(Boolean)
      if (texts.length === 0) return
      const ok = await copyText(texts.join('\n\n---\n\n'))
      pushToast(
        ok ? `已复制 ${texts.length} 条提示词` : '复制失败',
        ok ? 'success' : 'error',
      )
    },
    [selected, pushToast],
  )

  const handleCartDownload = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      const want = new Set(ids)
      const items = selected.filter((p) => want.has(p.prompt_id))
      if (items.length === 0) return
      setCartBusy(true)
      try {
        for (const p of items) {
          const { coverUrl, urls } = promptGallery(p)
          await downloadPromptCard({
            content: p.content,
            replyKeyword: p.reply_keyword?.trim() || undefined,
            title: p.wechat_title?.trim() || undefined,
            keywords: p.keywords,
            imageUrls: urls.length > 0 ? urls : coverUrl ? [coverUrl] : [],
            imageIndex: 0,
          })
        }
        pushToast(`已下载 ${items.length} 张提示词卡片`, 'success')
      } catch {
        pushToast('下载失败，请稍后重试', 'error')
      } finally {
        setCartBusy(false)
      }
    },
    [selected, pushToast],
  )

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_OPEN_KEY, filtersOpen ? '1' : '0')
    } catch {
      /* ignore quota / private mode */
    }
  }, [filtersOpen])

  // Esc exits select mode + clears selection; never steal Esc from open dialogs.
  useEffect(() => {
    if (!selectMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (cartOpen || detailPrompt) return
      if (document.querySelector('[aria-modal="true"]')) return
      e.preventDefault()
      setSelectMode(false)
      void clearSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectMode, cartOpen, detailPrompt, clearSelected])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const list = await loadPublicPrompts()
        if (!cancelled) setPrompts(list)
      } catch (e) {
        if (!cancelled) {
          setPrompts([])
          pushToast(e instanceof Error ? e.message : '加载提示词失败', 'error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pushToast])

  const availableMonths = useMemo(() => {
    const set = new Set<string>()
    for (const p of prompts) {
      const m = promptMonth(p)
      if (m) set.add(m)
    }
    return [...set].sort((a, b) => b.localeCompare(a))
  }, [prompts])

  const imageCountBoundMin = 1

  const imageCountBoundMax = useMemo(() => {
    let hi = 0
    for (const p of prompts) {
      hi = Math.max(hi, promptImageCount(p))
    }
    return hi
  }, [prompts])

  useEffect(() => {
    setCountMin(imageCountBoundMin)
    setCountMax(null)
  }, [imageCountBoundMax])

  const effectiveCountMax = countMax ?? imageCountBoundMax
  const countFilterActive = imageCountBoundMax >= imageCountBoundMin

  const baseFiltered = useMemo(() => {
    return prompts.filter((p) => {
      if (selectedMonth && promptMonth(p) !== selectedMonth) return false
      if (countFilterActive) {
        const n = promptImageCount(p)
        if (n < countMin || n > effectiveCountMax) return false
      }
      return matchesQuery(p, query)
    })
  }, [
    prompts,
    query,
    selectedMonth,
    countMin,
    effectiveCountMax,
    countFilterActive,
  ])

  const topReplyKeywords = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of baseFiltered) {
      const rk = p.reply_keyword?.trim()
      if (!rk) continue
      counts.set(rk, (counts.get(rk) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
      .map(([k]) => k)
  }, [baseFiltered])

  const filtered = useMemo(() => {
    if (replyKeywords.length === 0) return baseFiltered
    const want = new Set(replyKeywords)
    return baseFiltered.filter((p) => {
      const rk = p.reply_keyword?.trim()
      return Boolean(rk && want.has(rk))
    })
  }, [baseFiltered, replyKeywords])

  /** Month facets: apply every filter except year/month, then count by month. */
  const monthFacetBase = useMemo(() => {
    const want = replyKeywords.length > 0 ? new Set(replyKeywords) : null
    return prompts.filter((p) => {
      if (countFilterActive) {
        const n = promptImageCount(p)
        if (n < countMin || n > effectiveCountMax) return false
      }
      if (!matchesQuery(p, query)) return false
      if (want) {
        const rk = p.reply_keyword?.trim()
        if (!rk || !want.has(rk)) return false
      }
      return true
    })
  }, [
    prompts,
    query,
    countMin,
    effectiveCountMax,
    countFilterActive,
    replyKeywords,
  ])

  const monthCounts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of monthFacetBase) {
      const m = promptMonth(p)
      if (!m) continue
      map[m] = (map[m] ?? 0) + 1
    }
    return map
  }, [monthFacetBase])

  const monthTotal = monthFacetBase.length

  const toggleReplyKeyword = useCallback((kw: string) => {
    setReplyKeywords((prev) =>
      prev.includes(kw) ? prev.filter((k) => k !== kw) : [...prev, kw],
    )
  }, [])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) =>
      (b.savedAt || '').localeCompare(a.savedAt || ''),
    )
  }, [filtered])

  return (
    <div className="page home-page">
      <div className="home-sticky">
        <header className="app-header compact">
          <div className="brand">
            <div className="brand-mark" aria-hidden>
              选
            </div>
            <div className="brand-text">
              <h1 className="brand-title">精选提示词</h1>
              <p className="brand-sub">效果图 · 提示词卡片</p>
            </div>
          </div>
          <div className="header-search">
            <SearchBar
              value={query}
              onChange={setQuery}
              count={sorted.length}
              total={prompts.length}
            />
          </div>
          <div className="header-actions">
            {!filtersOpen && (
              <button
                type="button"
                className={`btn sm home-filters-toggle${replyKeywords.length > 0 ? '' : ' ghost'}`}
                onClick={() => setFiltersOpen(true)}
                aria-expanded={false}
                aria-controls="home-filters-panel"
                title="展开筛选（口令）"
              >
                筛选
                {replyKeywords.length > 0 && (
                  <span className="filters-active-dot" aria-hidden />
                )}
                <span className="home-filters-chevron" aria-hidden>
                  ▾
                </span>
              </button>
            )}
            <button
              type="button"
              className={`btn sm filter-toggle${selectMode ? ' primary' : ''}`}
              onClick={() => setSelectMode((v) => !v)}
              aria-pressed={selectMode}
              title="开启后可勾选提示词加入已选"
            >
              选择
            </button>
            <button
              type="button"
              className="btn sm cart-btn"
              onClick={() => setCartOpen(true)}
              title="查看已选提示词"
            >
              已选
              {selectedCount > 0 && (
                <span className="cart-badge">{selectedCount}</span>
              )}
            </button>
          </div>
        </header>

        {filtersOpen && (
          <div className="home-filters is-open" id="home-filters-panel">
            <div className="home-filters-row" id="home-filters-body">
              <button
                type="button"
                className="btn sm ghost home-filters-toggle"
                onClick={() => setFiltersOpen(false)}
                aria-expanded={true}
                title="收起筛选"
              >
                收起
                <span className="home-filters-chevron" aria-hidden>
                  ▴
                </span>
              </button>
            </div>
            <KeywordFilter
              keywords={topReplyKeywords}
              selected={replyKeywords}
              onToggle={toggleReplyKeyword}
              onClear={() => setReplyKeywords([])}
            />
          </div>
        )}
      </div>

      <div className="home-body">
        <aside className="home-sidebar" aria-label="侧栏筛选">
          <ImageCountFilter
            boundMin={imageCountBoundMin}
            boundMax={imageCountBoundMax}
            valueMin={countMin}
            valueMax={effectiveCountMax}
            onChange={(lo, hi) => {
              setCountMin(Math.max(1, lo))
              setCountMax(hi)
            }}
          />
          <MonthFilter
            months={availableMonths}
            selected={selectedMonth}
            onSelect={setSelectedMonth}
            counts={monthCounts}
            total={monthTotal}
          />
        </aside>
        <div className="home-main">
          {loading && prompts.length === 0 ? (
            <div className="empty-state">
              <p>正在加载提示词…</p>
            </div>
          ) : sorted.length === 0 ? (
            <div className="empty-state">
              <p>{prompts.length === 0 ? '暂无数据' : '没有匹配的提示词'}</p>
            </div>
          ) : (
            <div className="prompt-masonry">
              {sorted.map((p) => (
                <PromptCard
                  key={p.prompt_id}
                  prompt={p}
                  onOpenDetail={setDetailPrompt}
                  selectMode={selectMode}
                  selected={isSelected(p.prompt_id)}
                  onToggleSelect={(item) => void toggleSelect(item)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {detailPrompt && !selectMode && (
        <PromptDetailModal
          prompt={detailPrompt}
          onClose={() => setDetailPrompt(null)}
        />
      )}

      <SelectedDrawer
        open={cartOpen}
        items={selected}
        busy={cartBusy}
        onClose={() => setCartOpen(false)}
        onRemove={(id) => void removeSelected(id)}
        onClear={() => void clearSelected()}
        onCopy={(ids) => handleCartCopy(ids)}
        onDownload={(ids) => handleCartDownload(ids)}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
