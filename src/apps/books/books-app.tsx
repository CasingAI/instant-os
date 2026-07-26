import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { IosButton } from '../../ui/ios-button.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { generateBookChaptersStreaming, generateStoreCatalogForCategoryStreaming, generateStoreCatalogStreaming } from './books-agent.ts'
import { deleteBookChapters } from './books-data-storage.ts'
import { cancelBookGeneration } from './books-generation.ts'
import { BooksDeleteConfirmSheet } from './books-delete-confirm-sheet.tsx'
import { BooksReader } from './books-reader.tsx'
import { BooksShelf } from './books-shelf.tsx'
import { BooksStoreView } from './books-store.tsx'
import { BooksStoreSearch } from './books-store-search.tsx'
import { BooksStoreDetail } from './books-store-detail.tsx'
import {
  addBookToLibrary,
  canOpenBook,
  findLibraryBook,
  findLibraryBookById,
  readBooksStore,
  removeBookFromLibrary,
  replaceCatalog,
  resetFailedBookForGeneration,
  updateBookInLibrary,
  upsertCatalog,
  writeBooksStore,
} from './books-storage.ts'
import type { BookCategory, BookDetail, BookListing, BooksIndexStore } from './books-types.ts'
import './books.css'

type BooksScreen = 'shelf' | 'store' | 'store-search' | 'store-detail' | 'reader'

export function BooksApp() {
  const { windows, closeWindowsForApp, minimizeWindow, setAppWindowTitle } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const storeVisitedRef = useRef(false)

  const [store, setStore] = useState<BooksIndexStore>(() => readBooksStore())
  const [screen, setScreen] = useState<BooksScreen>('shelf')
  const [detailSlug, setDetailSlug] = useState<string | undefined>()
  const [detailListings, setDetailListings] = useState<BookListing[]>([])
  const [detailReturnScreen, setDetailReturnScreen] = useState<BooksScreen>('store')
  const [readerBookId, setReaderBookId] = useState<string | undefined>()
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [categoryLoading, setCategoryLoading] = useState<string | undefined>()
  const [addingSlug, setAddingSlug] = useState<string | undefined>()
  const [shelfEditing, setShelfEditing] = useState(false)
  const [deleteConfirmBookId, setDeleteConfirmBookId] = useState<string | undefined>()

  const persistStore = useCallback((next: BooksIndexStore) => {
    writeBooksStore(next)
    setStore(next)
  }, [])

  const librarySlugs = useMemo(
    () => new Set(store.library.map((book) => book.slug)),
    [store.library],
  )

  const detailListing = useMemo(() => {
    if (!detailSlug) {
      return undefined
    }
    return (
      detailListings.find((item) => item.slug === detailSlug) ??
      store.catalog.find((item) => item.slug === detailSlug) ??
      findLibraryBook(store, detailSlug)
    )
  }, [detailSlug, detailListings, store])

  const readerBook = useMemo(
    () => (readerBookId ? findLibraryBookById(store, readerBookId) : undefined),
    [readerBookId, store],
  )

  useEffect(() => {
    setAppWindowTitle('books', '书架')
  }, [setAppWindowTitle])

  useEffect(() => {
    const onStoreChanged = () => setStore(readBooksStore())
    window.addEventListener('instant-os:books-store-changed', onStoreChanged)
    return () => window.removeEventListener('instant-os:books-store-changed', onStoreChanged)
  }, [])

  const refreshCatalog = useCallback(async (replace = false) => {
    setCatalogLoading(true)
    const listings: typeof store.catalog = []
    try {
      await generateStoreCatalogStreaming((listing) => {
        listings.push(listing)
        setStore((current) => {
          const next = replace ? replaceCatalog(current, listings) : upsertCatalog(current, [listing])
          writeBooksStore(next)
          return next
        })
      })
    } finally {
      setCatalogLoading(false)
    }
  }, [])

  const ensureCategoryCatalog = useCallback(async (category: BookCategory) => {
    setCategoryLoading(category)
    try {
      await generateStoreCatalogForCategoryStreaming(category, (listing) => {
        setStore((current) => {
          const next = upsertCatalog(current, [listing])
          writeBooksStore(next)
          return next
        })
      })
    } finally {
      setCategoryLoading(undefined)
    }
  }, [])

  const openStore = useCallback(() => {
    setScreen('store')
    if (!storeVisitedRef.current && store.catalog.length === 0 && !catalogLoading) {
      storeVisitedRef.current = true
      void refreshCatalog(true)
    }
  }, [catalogLoading, refreshCatalog, store.catalog.length])

  useEffect(() => {
    if (screen !== 'shelf') {
      setShelfEditing(false)
    }
  }, [screen])

  useEffect(() => {
    if (store.library.length === 0) {
      setShelfEditing(false)
    }
  }, [store.library.length])

  const deleteConfirmBook = useMemo(
    () => (deleteConfirmBookId ? findLibraryBookById(store, deleteConfirmBookId) : undefined),
    [deleteConfirmBookId, store],
  )

  const handleRemoveBook = useCallback((bookId: string) => {
    setDeleteConfirmBookId(bookId)
  }, [])

  const confirmRemoveBook = useCallback(async () => {
    if (!deleteConfirmBookId) {
      return
    }
    cancelBookGeneration(deleteConfirmBookId)
    const next = await removeBookFromLibrary(store, deleteConfirmBookId)
    persistStore(next)
    setDeleteConfirmBookId(undefined)
  }, [deleteConfirmBookId, persistStore, store])

  const openStoreListing = useCallback(
    (slug: string, sourceListings?: BookListing[], returnScreen: BooksScreen = 'store') => {
      setDetailListings(sourceListings ?? store.catalog)
      setDetailReturnScreen(returnScreen)
      setDetailSlug(slug)
      setScreen('store-detail')
    },
    [store.catalog],
  )

  const openSearch = useCallback(() => {
    setDetailSlug(undefined)
    setScreen('store-search')
  }, [])

  const closeSearch = useCallback(() => {
    setScreen('store')
  }, [])

  const handleAddToShelf = useCallback(
    async (listing: NonNullable<typeof detailListing>, detail: BookDetail) => {
      setAddingSlug(listing.slug)
      let nextStore = readBooksStore()
      const existing = findLibraryBook(nextStore, listing.slug)
      let book = existing

      if (existing?.status === 'failed') {
        await deleteBookChapters(existing.id)
        nextStore = resetFailedBookForGeneration(nextStore, existing.id)
        book = findLibraryBookById(nextStore, existing.id)
      } else {
        const added = addBookToLibrary(nextStore, listing, detail)
        nextStore = added.store
        book = added.book
      }

      if (!book) {
        setAddingSlug(undefined)
        return
      }

      nextStore = updateBookInLibrary(nextStore, book.id, {
        chapterCount: detail.chapterOutline.length,
      })
      writeBooksStore(nextStore)
      setStore(nextStore)

      try {
        await generateBookChaptersStreaming(book.id, listing, detail, () => {
          setStore(readBooksStore())
        })
      } finally {
        setAddingSlug(undefined)
        setStore(readBooksStore())
      }
    },
    [],
  )

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === 'books' && !window.minimized)

    return [
      {
        label: '书架',
        items: [
          ...aboutAppMenuPrefix('关于书架', () => showBuiltinAbout('books')),
          {
            type: 'action',
            label: '隐藏书架',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出书架',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('books'),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar('books', menuBar)

  if (screen === 'reader' && readerBook) {
    return (
      <div class="books">
        <BooksReader
          book={readerBook}
          store={store}
          onStoreChange={persistStore}
          onBack={() => {
            setScreen('shelf')
            setReaderBookId(undefined)
          }}
        />
      </div>
    )
  }

  if (screen === 'store-detail' && detailListing) {
    const libraryBook = findLibraryBook(store, detailListing.slug)
    const backLabel = detailReturnScreen === 'store-search' ? '搜索' : detailReturnScreen === 'shelf' ? '书架' : '书城'
    const closeDetail = () => {
      setScreen(detailReturnScreen)
      setDetailSlug(undefined)
    }

    return (
      <div class="books">
        <header class="books__toolbar">
          <IosNavBackButton iconSize={14} label={backLabel} onClick={closeDetail} />
          <span class="books__toolbar-title books__toolbar-title--center">书籍详情</span>
          <span class="books__toolbar-spacer" />
        </header>
        <div class="books__main">
          <BooksStoreDetail
            listing={detailListing}
            libraryBook={libraryBook}
            isAdding={addingSlug === detailListing.slug}
            onAddToShelf={(detail) => void handleAddToShelf(detailListing, detail)}
            onRead={() => {
              if (libraryBook && canOpenBook(libraryBook)) {
                setReaderBookId(libraryBook.id)
                setScreen('reader')
              }
            }}
          />
        </div>
      </div>
    )
  }

  if (screen === 'store') {
    return (
      <div class="books">
        <header class="books__toolbar">
          <IosNavBackButton iconSize={14} label="书架" onClick={() => setScreen('shelf')} />
          <span class="books__toolbar-title books__toolbar-title--center">书城</span>
          <div class="books__toolbar-actions">
            <IosButton size="compact" onClick={openSearch} aria-label="搜索">
              搜索
            </IosButton>
            <IosButton
              size="compact"
              disabled={catalogLoading}
              onClick={() => void refreshCatalog(true)}
            >
              {catalogLoading ? '刷新中…' : '刷新'}
            </IosButton>
          </div>
        </header>
        <div class="books__main">
          <BooksStoreView
            catalog={store.catalog}
            librarySlugs={librarySlugs}
            isLoading={catalogLoading}
            categoryLoading={categoryLoading}
            onEnsureCategory={(category) => void ensureCategoryCatalog(category)}
            onOpenListing={(slug) => openStoreListing(slug)}
          />
        </div>
      </div>
    )
  }

  if (screen === 'store-search') {
    return (
      <div class="books">
        <header class="books__toolbar">
          <IosNavBackButton iconSize={14} label="书城" onClick={closeSearch} />
          <span class="books__toolbar-title books__toolbar-title--center">搜索</span>
          <span class="books__toolbar-spacer" />
        </header>
        <div class="books__main">
          <BooksStoreSearch
            librarySlugs={librarySlugs}
            onOpenListing={(slug, results) => openStoreListing(slug, results, 'store-search')}
          />
        </div>
      </div>
    )
  }

  return (
    <div class="books">
      <header class="books__toolbar">
        {store.library.length > 0 ? (
          <IosButton size="compact" onClick={() => setShelfEditing((editing) => !editing)}>
            {shelfEditing ? '完成' : '编辑'}
          </IosButton>
        ) : (
          <span class="books__toolbar-spacer" />
        )}
        <span class="books__toolbar-title books__toolbar-title--center">书架</span>
        <IosButton size="compact" disabled={shelfEditing} onClick={openStore}>
          书城
        </IosButton>
      </header>

      <div class="books__main">
        <BooksShelf
          books={store.library}
          editing={shelfEditing}
          onOpenBook={(bookId) => {
            const book = findLibraryBookById(store, bookId)
            if (book && canOpenBook(book)) {
              setReaderBookId(bookId)
              setScreen('reader')
            }
          }}
          onOpenStoreListing={(slug) => openStoreListing(slug, undefined, 'shelf')}
          onDeleteBook={handleRemoveBook}
          onGoStore={openStore}
        />
      </div>

      {deleteConfirmBook && (
        <BooksDeleteConfirmSheet
          bookTitle={deleteConfirmBook.title}
          onCancel={() => setDeleteConfirmBookId(undefined)}
          onConfirm={() => void confirmRemoveBook()}
        />
      )}
    </div>
  )
}
