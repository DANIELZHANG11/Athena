import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { Document, Page, pdfjs } from 'react-pdf'
import Epub from 'epubjs'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Loader2, ArrowLeft } from 'lucide-react'

// Configure PDF worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

export default function ReaderPage() {
    const { bookId } = useParams()
    const navigate = useNavigate()
    const [book, setBook] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [numPages, setNumPages] = useState<number>(0)
    const [pageNumber, setPageNumber] = useState(1)
    const [rendition, setRendition] = useState<any>(null)
    const viewerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const at = useAuthStore.getState().accessToken || localStorage.getItem('access_token') || ''

        const init = async () => {
            try {
                // 1. Fetch book details
                const res = await fetch(`/api/v1/books/${bookId}`, {
                    headers: { Authorization: `Bearer ${at}` }
                })
                if (!res.ok) throw new Error('Failed to load book')
                const data = await res.json()
                setBook(data.data)

                // 2. Start reading session
                await fetch('/api/v1/reading-sessions/start', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${at}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ book_id: bookId })
                })

            } catch (e: any) {
                setError(e.message)
            } finally {
                setLoading(false)
            }
        }

        if (bookId) init()
    }, [bookId])

    // Initialize EPUB viewer
    useEffect(() => {
        if (!book || !viewerRef.current || book.original_format === 'pdf') return

        const bookUrl = book.download_url
        const rendition = Epub(bookUrl).renderTo(viewerRef.current, {
            width: '100%',
            height: '100%',
            flow: 'scrolled-doc'
        })

        rendition.display()
        setRendition(rendition)

        return () => {
            if (rendition) rendition.destroy()
        }
    }, [book])

    const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
        setNumPages(numPages)
    }

    const handlePrev = () => {
        if (book?.original_format === 'pdf') {
            setPageNumber(p => Math.max(1, p - 1))
        } else {
            rendition?.prev()
        }
    }

    const handleNext = () => {
        if (book?.original_format === 'pdf') {
            setPageNumber(p => Math.min(numPages, p + 1))
        } else {
            rendition?.next()
        }
    }

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-system-blue" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex h-screen flex-col items-center justify-center gap-4">
                <p className="text-red-500">{error}</p>
                <Button onClick={() => navigate(-1)}>Go Back</Button>
            </div>
        )
    }

    return (
        <div className="flex h-screen flex-col bg-system-background">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-4 py-2 shadow-sm">
                <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                </Button>
                <h1 className="text-sm font-medium truncate max-w-[200px]">{book?.title}</h1>
                <div className="w-[70px]" /> {/* Spacer */}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden relative bg-gray-100 dark:bg-gray-900">
                {book?.original_format === 'pdf' ? (
                    <div className="flex h-full justify-center overflow-auto py-8">
                        <Document
                            file={book.download_url}
                            onLoadSuccess={onDocumentLoadSuccess}
                            className="shadow-lg"
                        >
                            <Page
                                pageNumber={pageNumber}
                                renderTextLayer={false}
                                renderAnnotationLayer={false}
                                width={Math.min(window.innerWidth * 0.9, 800)}
                            />
                        </Document>
                    </div>
                ) : (
                    <div className="h-full w-full bg-white dark:bg-gray-800" ref={viewerRef} />
                )}

                {/* Navigation Controls */}
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-white/90 dark:bg-black/90 px-6 py-2 rounded-full shadow-lg backdrop-blur">
                    <Button variant="ghost" size="sm" onClick={handlePrev} disabled={pageNumber <= 1 && book?.original_format === 'pdf'}>
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <span className="text-sm font-medium min-w-[60px] text-center">
                        {book?.original_format === 'pdf' ? `${pageNumber} / ${numPages}` : 'Reading'}
                    </span>
                    <Button variant="ghost" size="sm" onClick={handleNext} disabled={pageNumber >= numPages && book?.original_format === 'pdf'}>
                        <ChevronRight className="h-5 w-5" />
                    </Button>
                </div>
            </div>
        </div>
    )
}
