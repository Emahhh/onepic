import type { ChangeEvent, DragEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import Konva from 'konva'
import { Layer, Rect, Stage, Image as KonvaImage, Text as KonvaText } from 'react-konva'
import {
  Alert,
  Backdrop,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Fab,
  FormControlLabel,
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

const MAX_IMAGES = 100
const EXPORT_WIDTH = 3600
const DEFAULT_ROW_HEIGHT = 340
const DEFAULT_GUTTER = 32
const FOOTER_HEIGHT = 240
const FRAME_PADDING = 48
const PREVIEW_MAX_WIDTH = 600
const BATCH_SIZE = 8
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

const readFileAsAsset = async (file: File, index: number): Promise<PhotoAsset> => {
  const id = `${file.name}-${index}-${Date.now()}`

  if (supportsImageBitmap) {
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, EXPORT_WIDTH / bitmap.width)
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
  const scale = Math.min(1, EXPORT_WIDTH / image.naturalWidth)
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
        color="rgba(247,247,251,0.72)"
        sx={{ textAlign: alignment, maxWidth: 320 }}
      >
        Photos stay on this device—nothing is uploaded or sent anywhere.
      </Typography>
    )

    const renderDropHint = (alignment: 'left' | 'right' | 'center' = 'left') => (
      <Typography
        variant="body2"
        color="rgba(247,247,251,0.85)"
        sx={{ textAlign: alignment, maxWidth: 360 }}
      >
        or drag and drop images here
      </Typography>
    )

    const renderSelectPhotosButton = () => (
      <Button
        component="label"
        variant="contained"
        color="primary"
        startIcon={<AddPhotoAlternateRoundedIcon />}
      >
        Select Photos
        <input hidden accept="image/*" multiple type="file" onChange={handleFiles} />
      </Button>
    )

  const processFiles = async (incoming: File[]) => {
    if (!incoming.length) {
      return
    }

    const selected = incoming.slice(0, MAX_IMAGES)
    if (incoming.length > MAX_IMAGES) {
      setSnackbar(`Only the first ${MAX_IMAGES} images were queued.`)
    }

    setIsProcessing(true)
    try {
      disposeAssets(assetsRef.current)
      const loaded: PhotoAsset[] = []
      
      // Batch processing to avoid memory spike
      for (let i = 0; i < selected.length; i += BATCH_SIZE) {
        const batch = selected.slice(i, i + BATCH_SIZE)
        const batchResults = await Promise.all(
          batch.map((file, index) => readFileAsAsset(file, i + index))
        )
        loaded.push(...batchResults)
        // Update UI progressively
        setAssets([...loaded])
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

  const handleDownload = () => {
    if (!stageRef.current || !assets.length) {
      setSnackbar('Add photos before exporting your recap.')
      return
    }

    const stage = stageRef.current
    const previousScale = stage.scale()
    const previousSize = stage.size()

    stage.scale({ x: 1, y: 1 })
    stage.size({ width: fullExportWidth, height: fullStageHeight })
    stage.batchDraw()

    const dataUrl = stage.toDataURL({ mimeType: 'image/jpeg', quality: compressionQuality })

    stage.scale(previousScale)
    stage.size(previousSize)
    stage.batchDraw()

    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `onepic-${format(new Date(), 'yyyy-MM-dd')}.jpg`
    link.click()
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
        background:
          'radial-gradient(circle at top, rgba(255,255,255,0.12), transparent 55%), #05060a',
        py: { xs: 4, md: 6 },
        pb: { xs: 12, md: 6 },
      }}
    >
      <Container maxWidth="lg">
        <Paper
          elevation={0}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          sx={{
            borderRadius: 4,
            background: 'rgba(8, 10, 14, 0.75)',
            border: isDragOver ? '1px solid rgba(144,202,249,0.9)' : '1px solid rgba(255,255,255,0.08)',
            boxShadow: isDragOver ? '0 0 0 1px rgba(144,202,249,0.4)' : undefined,
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
            p: { xs: 3, md: 4 },
            color: '#f7f7fb',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {isDragOver && (
            <Box
              sx={{
                position: 'absolute',
                inset: 8,
                borderRadius: 3,
                border: '1px dashed rgba(144,202,249,0.9)',
                background: 'rgba(13, 71, 161, 0.18)',
                color: '#e3f2fd',
                fontWeight: 600,
                letterSpacing: 1,
                textTransform: 'uppercase',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              Drop photos to add them
            </Box>
          )}
          <Stack spacing={3}>
            {hasAssets ? (
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 2, md: 2 }} justifyContent="space-between">
                <Box>
                  <Typography variant="h4" fontWeight={600} gutterBottom sx={{ fontSize: { xs: '1.75rem', md: '2.125rem' } }}>
                    OnePic
                  </Typography>
                  <Typography variant="body2" color="rgba(247,247,251,0.72)" sx={{ display: { xs: 'none', md: 'block' } }}>
                    Select up to 100 photos, experiment with layouts, and export a single collage.
                  </Typography>
                </Box>
                <Stack spacing={1} alignItems={{ xs: 'stretch', md: 'flex-end' }}>
                  <Stack direction="row" spacing={1} justifyContent={{ xs: 'space-between', md: 'flex-end' }}>
                    {renderSelectPhotosButton()}
                    <Tooltip title="Start over">
                      <span>
                        <IconButton 
                          color="inherit" 
                          disabled={!assets.length} 
                          onClick={resetState}
                          size="small"
                        >
                          <RestartAltRoundedIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                  {renderPrivacyNote('right')}
                  {renderDropHint('right')}
                </Stack>
              </Stack>
            ) : (
              <Stack spacing={2.5} alignItems="center" textAlign="center" py={{ xs: 2, md: 4 }}>
                <Typography variant="h4" fontWeight={600} sx={{ fontSize: { xs: '1.75rem', md: '2.125rem' } }}>
                  OnePic
                </Typography>
                <Typography variant="body1" color="rgba(247,247,251,0.72)" px={{ xs: 2, md: 0 }}>
                  Turn your photos into a single beautiful collage. All your memories in one pic.
                </Typography>
                {renderSelectPhotosButton()}
                {renderDropHint('center')}
                {renderPrivacyNote('center')}
              </Stack>
            )}

            {isProcessing && <LinearProgress color="info" />}

            {hasAssets && (
              <>
                <Paper
                  elevation={0}
                  sx={{
                    p: { xs: 2, md: 3 },
                    borderRadius: 3,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <Stack spacing={{ xs: 2.5, md: 3 }} direction={{ xs: 'column', md: 'row' }}>
                    <Stack spacing={1} flex={1}>
                      <Typography variant="overline" fontSize="0.7rem" color="rgba(247,247,251,0.72)">
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
                      >
                        <ToggleButton value="masonry">Masonry</ToggleButton>
                        <ToggleButton value="justified">Justified</ToggleButton>
                      </ToggleButtonGroup>
                      {layoutMode === 'masonry' ? (
                        <Box>
                          <Typography variant="caption" fontSize="0.7rem" color="rgba(247,247,251,0.6)">
                            Columns: {columns}
                          </Typography>
                          <Slider
                            value={columns}
                            min={2}
                            max={6}
                            step={1}
                            size="small"
                            onChange={(_event, value) => setColumns(value as number)}
                          />
                        </Box>
                      ) : (
                        <Box>
                          <Typography variant="caption" fontSize="0.7rem" color="rgba(247,247,251,0.6)">
                            Row height: {rowHeight}px
                          </Typography>
                          <Slider
                            value={rowHeight}
                            min={220}
                            max={480}
                            step={20}
                            size="small"
                            onChange={(_event, value) => setRowHeight(value as number)}
                          />
                        </Box>
                      )}
                    </Stack>
                    <Divider flexItem orientation="vertical" sx={{ display: { xs: 'none', md: 'block' } }} />
                    <Stack spacing={1} flex={1}>
                      <Typography variant="overline" fontSize="0.7rem" color="rgba(247,247,251,0.72)">
                        Footer
                      </Typography>
                      <FormControlLabel
                        control={
                          <Switch
                            size="small"
                            checked={footerEnabled}
                            onChange={(_event, checked) => setFooterEnabled(checked)}
                            color="secondary"
                          />
                        }
                        label={<Typography variant="body2">{footerEnabled ? 'Enabled' : 'Disabled'}</Typography>}
                      />
                      <TextField
                        size="small"
                        label="Footer text"
                        placeholder="Add a title or date"
                        disabled={!footerEnabled}
                        value={footerText}
                        onChange={(event) => setFooterText(event.target.value)}
                        InputProps={{ sx: { color: '#f7f7fb' } }}
                      />
                    </Stack>
                    <Divider flexItem orientation="vertical" sx={{ display: { xs: 'none', md: 'block' } }} />
                    <Stack spacing={1} flex={1}>
                      <Typography variant="overline" fontSize="0.7rem" color="rgba(247,247,251,0.72)">
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
                      >
                        {Object.entries(compressionPresets).map(([key, option]) => (
                          <ToggleButton key={key} value={key}>
                            {option.label}
                          </ToggleButton>
                        ))}
                      </ToggleButtonGroup>
                      <Typography variant="caption" fontSize="0.7rem" color="rgba(247,247,251,0.6)">
                        {Math.round(compressionQuality * 100)}% · {compressionPresets[compressionPreset].helper}
                      </Typography>
                    </Stack>
                  </Stack>
                </Paper>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="center" flexWrap="wrap">
                  <Chip label={`${assets.length} photo${assets.length === 1 ? '' : 's'}`} color="secondary" size="small" />
                  <Chip 
                    label={`${estimatedSizeLabel} · ${Math.round(compressionQuality * 100)}% quality`} 
                    variant="outlined" 
                    size="small"
                  />
                </Stack>

                <Box
                  ref={previewRef}
                  sx={{
                    width: '100%',
                    overflowX: 'auto',
                    borderRadius: 3,
                    border: '1px dashed rgba(255,255,255,0.24)',
                    background: 'rgba(5,6,10,0.65)',
                    p: 2,
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
            bottom: { xs: 24, md: 40 },
            right: { xs: 24, md: 40 },
            zIndex: 1000,
            px: { xs: 4, md: 5 },
            py: { xs: 2, md: 2.5 },
            fontSize: { xs: '1.125rem', md: '1.25rem' },
            fontWeight: 700,
            textTransform: 'none',
            minWidth: { xs: 160, md: 200 },
            boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
            border: '2px solid rgba(255,255,255,0.1)',
            '&:hover': {
              transform: 'translateY(-3px) scale(1.02)',
              boxShadow: '0 16px 64px rgba(0,0,0,0.7)',
            },
            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <DownloadRoundedIcon sx={{ mr: 1.5, fontSize: { xs: '1.5rem', md: '1.75rem' } }} />
          Save Image
        </Fab>
      )}

      {/* Credit Footer */}
      <Box
        component="footer"
        sx={{
          textAlign: 'center',
          py: 3,
          color: 'rgba(247,247,251,0.5)',
        }}
      >
        <Typography variant="caption">
          Built by{' '}
          <Link
            href="https://emanuele.click/"
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              color: 'rgba(144,202,249,0.8)',
              textDecoration: 'none',
              '&:hover': {
                color: 'rgba(144,202,249,1)',
                textDecoration: 'underline',
              },
            }}
          >
            emanuele.click
          </Link>
        </Typography>
      </Box>

      <Backdrop open={isProcessing} sx={{ zIndex: (theme) => theme.zIndex.modal + 1, color: '#fff' }}>
        <Stack spacing={2} alignItems="center">
          <LinearProgress sx={{ width: 200 }} />
          <Typography variant="body2">Processing originals…</Typography>
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
