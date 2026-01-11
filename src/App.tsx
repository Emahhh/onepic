import type { ChangeEvent, DragEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import Konva from 'konva'
import { Layer, Rect, Stage, Image as KonvaImage, Text as KonvaText } from 'react-konva'
import {
  Alert,
  Backdrop,
  Box,
  Button,
  Container,
  Divider,
  Fab,
  IconButton,
  LinearProgress,
  Link,
  Paper,
  Slider,
  Snackbar,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import { format } from 'date-fns'
import { useResizeObserver } from './hooks/useResizeObserver'
import { computeJustifiedLayout, computeMasonryLayout } from './layouts'
import type { LayoutItem, LayoutMode } from './layouts'

const debounce = <T extends (...args: any[]) => any>(fn: T, delay: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  return ((...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }) as T
}

const MAX_IMAGES_DESKTOP = 100
const MAX_IMAGES_MOBILE = 50
const EXPORT_WIDTH = 3600
const IMPORT_WIDTH_MOBILE = 1800 // Smaller images on mobile to save memory
const DEFAULT_ROW_HEIGHT = 340
const DEFAULT_GUTTER = 32
const FOOTER_HEIGHT = 240
const FRAME_PADDING = 48
const PREVIEW_MAX_WIDTH = 600
const BATCH_SIZE_DESKTOP = 8
const BATCH_SIZE_MOBILE = 3 // Smaller batches on mobile
const compressionPresets = {
  crisp: { label: 'Crisp', helper: 'Best detail', quality: 0.95 },
  balanced: { label: 'Balanced', helper: 'Everyday', quality: 0.85 },
  compact: { label: 'Compact', helper: 'Smallest file', quality: 0.72 },
} as const
type CompressionPreset = keyof typeof compressionPresets

type CanvasSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap

interface PhotoAsset {
  id: string
  name: string
  width: number
  height: number
  image: CanvasSource
}

const isBrowser = typeof window !== 'undefined'
const supportsImageBitmap = isBrowser && 'createImageBitmap' in window

const loadImageElement = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    if (!isBrowser) {
      reject(new Error('Window context unavailable'))
      return
    }

    const url = URL.createObjectURL(file)
    const image = new window.Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'

    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Unable to load ${file.name}`))
    }

    image.src = url
  })

const drawToCanvas = (image: HTMLImageElement, width: number, height: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  context?.drawImage(image, 0, 0, width, height)
  return canvas
}

const releaseImageSource = (source: CanvasSource | undefined) => {
  const maybeBitmap = source as ImageBitmap & { close?: () => void }
  maybeBitmap?.close?.()
}

const disposeAssets = (collection: PhotoAsset[]) => {
  collection.forEach((asset) => releaseImageSource(asset.image))
}

const dataUrlToBytes = (value: string) => {
  const base64 = value.split(',')[1]
  if (!base64) {
    return 0
  }
  const padding = (base64.match(/=*$/)?.[0].length ?? 0)
  return Math.round((base64.length * 3) / 4 - padding)
}

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '—'
  }
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`
}

const isIOS = () => {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

const isMobile = () => {
  if (typeof navigator === 'undefined') return false
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

// iOS Safari has strict canvas limits:
// - ~16 million pixels max per canvas on older devices
// - ~64 million pixels on newer devices  
// - We target 12 million to be safe across all iOS devices
const MAX_CANVAS_PIXELS_IOS = 12_000_000
const MAX_CANVAS_PIXELS_MOBILE = 24_000_000
const MAX_CANVAS_PIXELS_DESKTOP = 100_000_000

const getMaxCanvasPixels = () => {
  if (isIOS()) return MAX_CANVAS_PIXELS_IOS
  if (isMobile()) return MAX_CANVAS_PIXELS_MOBILE
  return MAX_CANVAS_PIXELS_DESKTOP
}

// Calculate safe export scale based on canvas dimensions and device limits
const getSafeExportScale = (width: number, height: number): number => {
  const maxPixels = getMaxCanvasPixels()
  const totalPixels = width * height
  
  if (totalPixels <= maxPixels) {
    return 1
  }
  
  // Calculate scale needed to fit within pixel budget
  const scale = Math.sqrt(maxPixels / totalPixels)
  // Round down to nearest 0.05 to be conservative
  return Math.floor(scale * 20) / 20
}

const canvasToBlobAsync = (canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Failed to create blob from canvas'))
        }
      },
      mimeType,
      quality
    )
  })
}

// Attempt export with automatic retry at lower resolution
const attemptExport = async (
  stage: Konva.Stage,
  fullWidth: number,
  fullHeight: number,
  quality: number,
  onProgress?: (message: string) => void
): Promise<{ blob: Blob; scale: number }> => {
  const safeScale = getSafeExportScale(fullWidth, fullHeight)
  const scales = [safeScale, safeScale * 0.7, safeScale * 0.5, 0.25].filter(s => s > 0.1)
  
  let lastError: Error | null = null
  
  for (const scale of scales) {
    const scaledWidth = Math.round(fullWidth * scale)
    const scaledHeight = Math.round(fullHeight * scale)
    
    onProgress?.(`Exporting at ${Math.round(scale * 100)}% resolution...`)
    
    try {
      stage.scale({ x: scale, y: scale })
      stage.size({ width: scaledWidth, height: scaledHeight })
      stage.batchDraw()
      
      // Small delay to let the browser stabilize
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const canvas = stage.toCanvas() as HTMLCanvasElement
      const blob = await canvasToBlobAsync(canvas, 'image/jpeg', quality)
      
      return { blob, scale }
    } catch (error) {
      console.warn(`Export at ${Math.round(scale * 100)}% failed:`, error)
      lastError = error instanceof Error ? error : new Error('Export failed')
      
      // Force cleanup before retry
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
  
  throw lastError || new Error('Export failed at all resolutions')
}

const readFileAsAsset = async (file: File, index: number): Promise<PhotoAsset> => {
  const id = `${file.name}-${index}-${Date.now()}`
  // Use significantly reduced max width on mobile to save memory
  const maxWidth = isMobile() ? IMPORT_WIDTH_MOBILE : EXPORT_WIDTH

  if (supportsImageBitmap) {
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, maxWidth / bitmap.width)
      const targetWidth = Math.round(bitmap.width * scale)
      const targetHeight = Math.round(bitmap.height * scale)

      if (scale === 1) {
        return {
          id,
          name: file.name,
          width: targetWidth,
          height: targetHeight,
          image: bitmap,
        }
      }

      const resized = await createImageBitmap(bitmap, {
        resizeWidth: targetWidth,
        resizeHeight: targetHeight,
        resizeQuality: 'high',
      })
      bitmap.close()

      return {
        id,
        name: file.name,
        width: targetWidth,
        height: targetHeight,
        image: resized,
      }
    } catch (error) {
      console.warn('Falling back to HTMLImageElement decoding', error)
    }
  }

  const image = await loadImageElement(file)
  const scale = Math.min(1, maxWidth / image.naturalWidth)
  const targetWidth = Math.round(image.naturalWidth * scale)
  const targetHeight = Math.round(image.naturalHeight * scale)

  if (scale === 1) {
    return {
      id,
      name: file.name,
      width: targetWidth,
      height: targetHeight,
      image,
    }
  }

  const canvas = drawToCanvas(image, targetWidth, targetHeight)
  return {
    id,
    name: file.name,
    width: targetWidth,
    height: targetHeight,
    image: canvas,
  }
}

function App() {
  const [assets, setAssets] = useState<PhotoAsset[]>([])
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('masonry')
  const [columns, setColumns] = useState(4)
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT)
  const [isProcessing, setIsProcessing] = useState(false)
  const [footerEnabled, setFooterEnabled] = useState(true)
  const [footerText, setFooterText] = useState(format(new Date(), 'MMMM d, yyyy'))
  const [snackbar, setSnackbar] = useState<string | null>(null)
  const [compressionPreset, setCompressionPreset] = useState<CompressionPreset>('balanced')
  const [estimatedSize, setEstimatedSize] = useState<number | null>(null)
  const [isEstimating, setIsEstimating] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [debouncedColumns, setDebouncedColumns] = useState(4)
  const [debouncedRowHeight, setDebouncedRowHeight] = useState(DEFAULT_ROW_HEIGHT)

  const { ref: previewRef, size: previewSize } = useResizeObserver<HTMLDivElement>()
  const stageRef = useRef<Konva.Stage>(null)
  const assetsRef = useRef<PhotoAsset[]>([])
  const dragCounterRef = useRef(0)
  const compressionQuality = compressionPresets[compressionPreset].quality

  useEffect(() => {
    assetsRef.current = assets
  }, [assets])

  useEffect(() => {
    return () => {
      disposeAssets(assetsRef.current)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    Konva.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
  }, [])

  // Debounce slider changes
  useEffect(() => {
    const handler = debounce(() => setDebouncedColumns(columns), 300)
    handler()
  }, [columns])

  useEffect(() => {
    const handler = debounce(() => setDebouncedRowHeight(rowHeight), 300)
    handler()
  }, [rowHeight])


  const layout = useMemo(() => {
    if (!assets.length) {
      return { width: EXPORT_WIDTH, height: 0, items: [] as LayoutItem[] }
    }

    return layoutMode === 'masonry'
      ? computeMasonryLayout(assets, { columns: debouncedColumns, gutter: DEFAULT_GUTTER, width: EXPORT_WIDTH })
      : computeJustifiedLayout(assets, { rowHeight: debouncedRowHeight, gutter: DEFAULT_GUTTER, width: EXPORT_WIDTH })
  }, [assets, debouncedColumns, layoutMode, debouncedRowHeight])

  const collageHeight = layout.height + (footerEnabled ? FOOTER_HEIGHT : 0)
  const fullExportWidth = EXPORT_WIDTH + FRAME_PADDING * 2
  const fullStageHeight = collageHeight + FRAME_PADDING * 2
  const measuredWidth = previewSize.width ?? PREVIEW_MAX_WIDTH
  const safeWidth = measuredWidth > 0 ? measuredWidth : PREVIEW_MAX_WIDTH
  const previewCanvasWidth = Math.min(PREVIEW_MAX_WIDTH, safeWidth, fullExportWidth)
  const liveScale = previewCanvasWidth / fullExportWidth
  const previewCanvasHeight = Math.max(fullStageHeight * liveScale, 1)
  const stageScaleFactor = liveScale > 0 ? 1 / (liveScale * liveScale) : 1
  const footerOffsetY = FRAME_PADDING + layout.height

  useEffect(() => {
    if (!stageRef.current || !assets.length || fullStageHeight <= 0) {
      setEstimatedSize(null)
      setIsEstimating(false)
      return
    }

    let cancelled = false
    setIsEstimating(true)
    // Heavy debounce for size estimation (3 seconds)
    const timeout = window.setTimeout(() => {
      if (!stageRef.current || cancelled) {
        return
      }

      try {
        const previewUrl = stageRef.current.toDataURL({ mimeType: 'image/jpeg', quality: compressionQuality })
        if (cancelled) {
          return
        }
        const previewBytes = dataUrlToBytes(previewUrl)
        const scaledBytes = previewBytes * stageScaleFactor
        setEstimatedSize(scaledBytes)
      } catch (error) {
        console.warn('Unable to estimate export size', error)
        if (!cancelled) {
          setEstimatedSize(null)
        }
      } finally {
        if (!cancelled) {
          setIsEstimating(false)
        }
      }
    }, 3000)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [assets, compressionQuality, stageScaleFactor, liveScale, collageHeight, footerEnabled, footerText, fullStageHeight])

    const assetMap = useMemo(() => {
      return assets.reduce<Record<string, PhotoAsset>>((acc, asset) => {
        acc[asset.id] = asset
        return acc
      }, {})
    }, [assets])
    const estimatedSizeLabel = isEstimating ? 'Estimating…' : estimatedSize ? formatBytes(estimatedSize) : '—'
    const hasAssets = assets.length > 0

    const renderPrivacyNote = (alignment: 'left' | 'right' | 'center' = 'left') => (
      <Typography
        variant="caption"
        sx={{ 
          textAlign: alignment, 
          maxWidth: 280,
          color: 'rgba(247,247,251,0.5)',
          fontSize: '0.7rem',
          lineHeight: 1.4,
        }}
      >
        🔒 Your photos never leave this device
      </Typography>
    )

    const renderDropHint = (alignment: 'left' | 'right' | 'center' = 'left') => (
      <Typography
        variant="body2"
        sx={{ 
          textAlign: alignment, 
          maxWidth: 360,
          color: 'rgba(247,247,251,0.45)',
          fontSize: '0.8rem',
          display: { xs: 'none', sm: 'block' },
        }}
      >
        or drop images anywhere
      </Typography>
    )

    const renderSelectPhotosButton = (size: 'small' | 'medium' | 'large' = 'medium') => (
      <Button
        component="label"
        variant="contained"
        color="primary"
        size={size}
        startIcon={<AddPhotoAlternateRoundedIcon />}
        sx={{
          borderRadius: 2,
          textTransform: 'none',
          fontWeight: 600,
          px: size === 'large' ? 4 : 3,
          py: size === 'large' ? 1.5 : 1,
          fontSize: size === 'large' ? '1rem' : '0.875rem',
          boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
          '&:hover': {
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
          },
        }}
      >
        {size === 'large' ? 'Choose Photos' : 'Add Photos'}
        <input hidden accept="image/*" multiple type="file" onChange={handleFiles} />
      </Button>
    )

  const processFiles = async (incoming: File[]) => {
    if (!incoming.length) {
      return
    }

    const maxImages = isMobile() ? MAX_IMAGES_MOBILE : MAX_IMAGES_DESKTOP
    const batchSize = isMobile() ? BATCH_SIZE_MOBILE : BATCH_SIZE_DESKTOP
    
    const selected = incoming.slice(0, maxImages)
    if (incoming.length > maxImages) {
      setSnackbar(`Only the first ${maxImages} images were queued.`)
    }

    setIsProcessing(true)
    try {
      // Dispose existing assets first to free memory
      disposeAssets(assetsRef.current)
      setAssets([]) // Clear state immediately
      
      // Small delay to let garbage collection run
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const loaded: PhotoAsset[] = []
      
      // Batch processing with smaller batches on mobile
      for (let i = 0; i < selected.length; i += batchSize) {
        const batch = selected.slice(i, i + batchSize)
        const batchResults = await Promise.all(
          batch.map((file, index) => readFileAsAsset(file, i + index))
        )
        loaded.push(...batchResults)
        // Update UI progressively
        setAssets([...loaded])
        
        // Yield to browser between batches on mobile
        if (isMobile()) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to process images'
      setSnackbar(message)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    await processFiles(fileList ? Array.from(fileList) : [])
    event.target.value = ''
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragCounterRef.current += 1
    if (!isDragOver) {
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragCounterRef.current = 0
    setIsDragOver(false)
    const files = event.dataTransfer?.files
    await processFiles(files ? Array.from(files) : [])
    event.dataTransfer?.clearData()
  }

  const handleDownload = async () => {
    if (!stageRef.current || !assets.length) {
      setSnackbar('Add photos before exporting your recap.')
      return
    }

    const stage = stageRef.current
    const previousScale = stage.scale()
    const previousSize = stage.size()

    setIsProcessing(true)

    try {
      const { blob, scale } = await attemptExport(
        stage,
        fullExportWidth,
        fullStageHeight,
        compressionQuality,
        (msg) => console.log(msg)
      )

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `onepic-${format(new Date(), 'yyyy-MM-dd')}.jpg`
      link.click()

      // Clean up blob URL after a short delay
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      if (scale < 0.9) {
        const pct = Math.round(scale * 100)
        setSnackbar(`Exported at ${pct}% resolution to fit device memory limits.`)
      }
    } catch (error) {
      console.error('Export failed:', error)
      setSnackbar('Export failed. Try with fewer photos or lower quality.')
    } finally {
      // Restore stage to preview state
      stage.scale(previousScale)
      stage.size(previousSize)
      stage.batchDraw()
      setIsProcessing(false)
    }
  }

  const resetState = () => {
    if (assetsRef.current.length) {
      disposeAssets(assetsRef.current)
    }
    setAssets([])
    setSnackbar('Canvas cleared. Ready for a new recap!')
  }

  return (
    <Box
      component="main"
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #0a0c10 0%, #05060a 100%)',
        py: { xs: 2, md: 5 },
        pb: { xs: 14, md: 6 },
      }}
    >
      <Container maxWidth="md">
        <Paper
          elevation={0}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          sx={{
            borderRadius: { xs: 3, md: 4 },
            background: 'rgba(255, 255, 255, 0.03)',
            backdropFilter: 'blur(20px)',
            border: isDragOver ? '1px solid rgba(144,202,249,0.7)' : '1px solid rgba(255,255,255,0.06)',
            boxShadow: isDragOver 
              ? '0 0 0 1px rgba(144,202,249,0.3), 0 20px 60px rgba(0,0,0,0.4)' 
              : '0 20px 60px rgba(0,0,0,0.3)',
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
            p: { xs: 2.5, md: 4 },
            color: '#f7f7fb',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {isDragOver && (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                borderRadius: 'inherit',
                background: 'rgba(13, 71, 161, 0.15)',
                backdropFilter: 'blur(4px)',
                color: '#90caf9',
                fontWeight: 500,
                fontSize: '1.1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                zIndex: 10,
              }}
            >
              Drop to add photos
            </Box>
          )}
          <Stack spacing={3}>
            {hasAssets ? (
              <Stack direction="row" spacing={2} justifyContent="space-between" alignItems="center">
                <Typography 
                  variant="h5" 
                  fontWeight={700} 
                  sx={{ 
                    fontSize: { xs: '1.25rem', md: '1.5rem' },
                    letterSpacing: '-0.02em',
                  }}
                >
                  OnePic
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  {renderSelectPhotosButton('small')}
                  <Tooltip title="Clear all">
                    <IconButton 
                      onClick={resetState}
                      size="small"
                      sx={{ 
                        color: 'rgba(247,247,251,0.5)',
                        '&:hover': { color: 'rgba(247,247,251,0.8)' },
                      }}
                    >
                      <RestartAltRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Stack>
            ) : (
              <Stack spacing={3} alignItems="center" textAlign="center" py={{ xs: 4, md: 6 }}>
                <Stack spacing={1} alignItems="center">
                  <Typography 
                    variant="h3" 
                    fontWeight={700} 
                    sx={{ 
                      fontSize: { xs: '2rem', md: '2.5rem' },
                      letterSpacing: '-0.03em',
                      background: 'linear-gradient(135deg, #f7f7fb 0%, rgba(247,247,251,0.7) 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}
                  >
                    OnePic
                  </Typography>
                    <Typography 
                    variant="body1" 
                    sx={{ 
                      color: 'rgba(247,247,251,0.55)',
                      fontSize: { xs: '0.95rem', md: '1.05rem' },
                      maxWidth: 340,
                      lineHeight: 1.5,
                    }}
                    >
                    Turn up to 100 photos into one beautiful collage. All processing happens locally.
                    </Typography>
                </Stack>
                {renderSelectPhotosButton('large')}
                <Stack spacing={0.5} alignItems="center">
                  {renderDropHint('center')}
                  {renderPrivacyNote('center')}
                </Stack>
              </Stack>
            )}

            {isProcessing && <LinearProgress color="info" />}

            {hasAssets && (
              <>
                <Paper
                  elevation={0}
                  sx={{
                    p: { xs: 2, md: 2.5 },
                    borderRadius: 2.5,
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  <Stack spacing={{ xs: 2, md: 2.5 }} direction={{ xs: 'column', md: 'row' }}>
                    <Stack spacing={1.5} flex={1}>
                      <Typography 
                        variant="overline" 
                        sx={{ 
                          fontSize: '0.65rem', 
                          color: 'rgba(247,247,251,0.4)',
                          letterSpacing: '0.1em',
                          fontWeight: 600,
                        }}
                      >
                        Layout
                      </Typography>
                      <ToggleButtonGroup
                        exclusive
                        size="small"
                        color="primary"
                        value={layoutMode}
                        onChange={(_event, value: LayoutMode | null) => {
                          if (value) {
                            setLayoutMode(value)
                          }
                        }}
                        sx={{
                          '& .MuiToggleButton-root': {
                            fontSize: '0.75rem',
                            py: 0.5,
                            px: 1.5,
                            textTransform: 'none',
                            fontWeight: 500,
                          },
                        }}
                      >
                        <ToggleButton value="masonry">Masonry</ToggleButton>
                        <ToggleButton value="justified">Justified</ToggleButton>
                      </ToggleButtonGroup>
                      {layoutMode === 'masonry' ? (
                        <Box>
                          <Typography 
                            variant="caption" 
                            sx={{ fontSize: '0.7rem', color: 'rgba(247,247,251,0.5)' }}
                          >
                            {columns} columns
                          </Typography>
                          <Slider
                            value={columns}
                            min={2}
                            max={6}
                            step={1}
                            size="small"
                            onChange={(_event, value) => setColumns(value as number)}
                            sx={{ mt: 0.5 }}
                          />
                        </Box>
                      ) : (
                        <Box>
                          <Typography 
                            variant="caption" 
                            sx={{ fontSize: '0.7rem', color: 'rgba(247,247,251,0.5)' }}
                          >
                            {rowHeight}px rows
                          </Typography>
                          <Slider
                            value={rowHeight}
                            min={220}
                            max={480}
                            step={20}
                            size="small"
                            onChange={(_event, value) => setRowHeight(value as number)}
                            sx={{ mt: 0.5 }}
                          />
                        </Box>
                      )}
                    </Stack>
                    <Divider flexItem orientation="vertical" sx={{ display: { xs: 'none', md: 'block' }, borderColor: 'rgba(255,255,255,0.06)' }} />
                    <Stack spacing={1.5} flex={1}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Typography 
                          variant="overline" 
                          sx={{ 
                            fontSize: '0.65rem', 
                            color: 'rgba(247,247,251,0.4)',
                            letterSpacing: '0.1em',
                            fontWeight: 600,
                          }}
                        >
                          Caption
                        </Typography>
                        <Switch
                          size="small"
                          checked={footerEnabled}
                          onChange={(_event, checked) => setFooterEnabled(checked)}
                          color="secondary"
                        />
                      </Stack>
                      <TextField
                        size="small"
                        placeholder="Add a title or date..."
                        disabled={!footerEnabled}
                        value={footerText}
                        onChange={(event) => setFooterText(event.target.value)}
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            fontSize: '0.85rem',
                            color: '#f7f7fb',
                            '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
                            '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
                            '&.Mui-focused fieldset': { borderColor: 'rgba(255,193,7,0.5)' },
                            '&.Mui-disabled': { opacity: 0.4 },
                          },
                        }}
                      />
                    </Stack>
                    <Divider flexItem orientation="vertical" sx={{ display: { xs: 'none', md: 'block' }, borderColor: 'rgba(255,255,255,0.06)' }} />
                    <Stack spacing={1.5} flex={1}>
                      <Typography 
                        variant="overline" 
                        sx={{ 
                          fontSize: '0.65rem', 
                          color: 'rgba(247,247,251,0.4)',
                          letterSpacing: '0.1em',
                          fontWeight: 600,
                        }}
                      >
                        Quality
                      </Typography>
                      <ToggleButtonGroup
                        exclusive
                        size="small"
                        value={compressionPreset}
                        color="secondary"
                        onChange={(_event, value: CompressionPreset | null) => {
                          if (value) {
                            setCompressionPreset(value)
                          }
                        }}
                        sx={{
                          '& .MuiToggleButton-root': {
                            fontSize: '0.75rem',
                            py: 0.5,
                            px: 1.5,
                            textTransform: 'none',
                            fontWeight: 500,
                          },
                        }}
                      >
                        {Object.entries(compressionPresets).map(([key, option]) => (
                          <ToggleButton key={key} value={key}>
                            {option.label}
                          </ToggleButton>
                        ))}
                      </ToggleButtonGroup>
                      <Typography 
                        variant="caption" 
                        sx={{ fontSize: '0.7rem', color: 'rgba(247,247,251,0.5)' }}
                      >
                        {compressionPresets[compressionPreset].helper}
                      </Typography>
                    </Stack>
                  </Stack>
                </Paper>

                <Stack 
                  direction="row" 
                  spacing={1} 
                  alignItems="center" 
                  sx={{ 
                    py: 0.5,
                    color: 'rgba(247,247,251,0.5)',
                    fontSize: '0.8rem',
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 500, color: 'rgba(247,247,251,0.7)' }}>
                    {assets.length} photo{assets.length === 1 ? '' : 's'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(247,247,251,0.3)' }}>•</Typography>
                  <Typography variant="body2">
                    {estimatedSizeLabel}
                  </Typography>
                </Stack>

                <Box
                  ref={previewRef}
                  sx={{
                    width: '100%',
                    overflowX: 'auto',
                    borderRadius: 2,
                    border: '1px solid rgba(255,255,255,0.06)',
                    background: 'rgba(0,0,0,0.2)',
                    p: { xs: 1.5, md: 2 },
                  }}
                >
                  <Box
                    sx={{
                      width: previewCanvasWidth,
                      backgroundColor: '#fff',
                      borderRadius: 0,
                      mx: 'auto',
                    }}
                  >
                    {/* Stage renders at a scaled size for interactivity but exports at full resolution. */}
                    <Stage
                      ref={stageRef}
                      width={previewCanvasWidth}
                      height={previewCanvasHeight}
                      scaleX={liveScale}
                      scaleY={liveScale}
                    >
                      <Layer listening={false} perfectDrawEnabled={false}>
                        <Rect
                          x={0}
                          y={0}
                          width={fullExportWidth}
                          height={fullStageHeight}
                          fill="#ffffffff"
                          stroke="rgba(12,12,16,0.08)"
                          strokeWidth={8}
                        />
                      </Layer>
                      <Layer listening={false} perfectDrawEnabled={false}>
                        {layout.items.map((item) => {
                          const asset = assetMap[item.id]
                          if (!asset) {
                            return null
                          }
                          // KonvaImage draws the pre-decoded bitmap/canvas directly onto the canvas layer.
                          return (
                            <KonvaImage
                              key={item.id}
                              image={asset.image}
                              x={item.x + FRAME_PADDING}
                              y={item.y + FRAME_PADDING}
                              width={item.width}
                              height={item.height}
                              listening={false}
                            />
                          )
                        })}
                      </Layer>
                      {footerEnabled && (
                        <Layer listening={false} perfectDrawEnabled={false}>
                          {/* Dedicated footer layer renders after photos so it overlays edge shadows cleanly. */}
                          <Rect
                            x={FRAME_PADDING}
                            y={footerOffsetY}
                            width={EXPORT_WIDTH}
                            height={FOOTER_HEIGHT}
                            fill="#fff"
                          />
                          <KonvaText
                            text={footerText || 'OnePic'}
                            x={FRAME_PADDING}
                            y={footerOffsetY + FOOTER_HEIGHT / 2 - 32}
                            width={EXPORT_WIDTH}
                            align="center"
                            fontSize={72}
                            fontFamily='"Space Grotesk Variable", "Space Grotesk", sans-serif'
                            fill="#05060a"
                          />
                        </Layer>
                      )}
                    </Stage>
                  </Box>
                </Box>
              </>
            )}
          </Stack>
        </Paper>
      </Container>

      {/* Floating Download Button */}
      {hasAssets && (
        <Fab
          variant="extended"
          color="secondary"
          onClick={handleDownload}
          sx={{
            position: 'fixed',
            bottom: { xs: 20, md: 32 },
            right: { xs: '50%', md: 32 },
            transform: { xs: 'translateX(50%)', md: 'none' },
            zIndex: 1000,
            px: { xs: 3, md: 4 },
            py: { xs: 1.25, md: 1.5 },
            fontSize: { xs: '0.95rem', md: '1rem' },
            fontWeight: 600,
            textTransform: 'none',
            borderRadius: 3,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            '&:hover': {
              transform: { xs: 'translateX(50%) translateY(-2px)', md: 'translateY(-2px)' },
              boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            },
            transition: 'all 0.2s ease',
          }}
        >
          <DownloadRoundedIcon sx={{ mr: 1, fontSize: '1.25rem' }} />
          Save Image
        </Fab>
      )}

      {/* Credit Footer */}
      <Box
        component="footer"
        sx={{
          textAlign: 'center',
          py: 4,
          mt: 2,
        }}
      >
        <Typography 
          variant="caption" 
          sx={{ 
            color: 'rgba(247,247,251,0.3)',
            fontSize: '0.7rem',
          }}
        >
          Made by{' '}
          <Link
            href="https://emanuele.click/"
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              color: 'rgba(247,247,251,0.4)',
              textDecoration: 'none',
              '&:hover': {
                color: 'rgba(247,247,251,0.6)',
              },
            }}
          >
            emanuele.click
          </Link>
        </Typography>
      </Box>

      <Backdrop 
        open={isProcessing} 
        sx={{ 
          zIndex: (theme) => theme.zIndex.modal + 1, 
          color: '#fff',
          backdropFilter: 'blur(8px)',
          background: 'rgba(5,6,10,0.85)',
        }}
      >
        <Stack spacing={2} alignItems="center">
          <LinearProgress sx={{ width: 180, borderRadius: 1 }} color="secondary" />
          <Typography variant="body2" sx={{ color: 'rgba(247,247,251,0.7)', fontSize: '0.85rem' }}>
            Processing photos…
          </Typography>
        </Stack>
      </Backdrop>

      <Snackbar
        open={Boolean(snackbar)}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="info" onClose={() => setSnackbar(null)}>
          {snackbar}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default App
