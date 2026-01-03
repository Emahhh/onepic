import type { ChangeEvent } from 'react'
import { useMemo, useRef, useState } from 'react'
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
  FormControlLabel,
  IconButton,
  LinearProgress,
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
import UploadRoundedIcon from '@mui/icons-material/UploadRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { format } from 'date-fns'
import { useResizeObserver } from './hooks/useResizeObserver'
import { computeJustifiedLayout, computeMasonryLayout } from './layouts'
import type { LayoutItem, LayoutMode } from './layouts'

const MAX_IMAGES = 100
const EXPORT_WIDTH = 3600
const DEFAULT_ROW_HEIGHT = 340
const DEFAULT_GUTTER = 32
const FOOTER_HEIGHT = 240

interface PhotoAsset {
  id: string
  name: string
  width: number
  height: number
  src: string
  image: HTMLImageElement
}

const readFileAsAsset = (file: File, index: number): Promise<PhotoAsset> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file'))

    reader.onload = () => {
      const dataUrl = reader.result as string
      const image = new window.Image()
      image.crossOrigin = 'anonymous'

      image.onload = () => {
        resolve({
          id: `${file.name}-${index}-${Date.now()}`,
          name: file.name,
          width: image.naturalWidth,
          height: image.naturalHeight,
          src: dataUrl,
          image,
        })
      }

      image.onerror = () => reject(new Error(`Unable to load ${file.name}`))
      image.src = dataUrl
    }

    reader.readAsDataURL(file)
  })

function App() {
  const [assets, setAssets] = useState<PhotoAsset[]>([])
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('masonry')
  const [columns, setColumns] = useState(4)
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT)
  const [isProcessing, setIsProcessing] = useState(false)
  const [footerEnabled, setFooterEnabled] = useState(true)
  const [footerText, setFooterText] = useState(format(new Date(), 'MMMM d, yyyy'))
  const [snackbar, setSnackbar] = useState<string | null>(null)

  const { ref: previewRef, size: previewSize } = useResizeObserver<HTMLDivElement>()
  const stageRef = useRef<Konva.Stage>(null)

  const layout = useMemo(() => {
    if (!assets.length) {
      return { width: EXPORT_WIDTH, height: 0, items: [] as LayoutItem[] }
    }

    return layoutMode === 'masonry'
      ? computeMasonryLayout(assets, { columns, gutter: DEFAULT_GUTTER, width: EXPORT_WIDTH })
      : computeJustifiedLayout(assets, { rowHeight, gutter: DEFAULT_GUTTER, width: EXPORT_WIDTH })
  }, [assets, columns, layoutMode, rowHeight])

  const stageHeight = layout.height + (footerEnabled ? FOOTER_HEIGHT : 0)
  const previewScale = previewSize.width ? Math.min(1, previewSize.width / EXPORT_WIDTH) : 1

  const assetMap = useMemo(() => {
    return assets.reduce<Record<string, PhotoAsset>>((acc, asset) => {
      acc[asset.id] = asset
      return acc
    }, {})
  }, [assets])

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    if (!fileList?.length) {
      return
    }

    const selected = Array.from(fileList).slice(0, MAX_IMAGES)
    if (fileList.length > MAX_IMAGES) {
      setSnackbar(`Only the first ${MAX_IMAGES} images were queued.`)
    }

    setIsProcessing(true)
    try {
      const loaded = await Promise.all(selected.map((file, index) => readFileAsAsset(file, index)))
      setAssets(loaded)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to process images'
      setSnackbar(message)
    } finally {
      setIsProcessing(false)
      event.target.value = ''
    }
  }

  const handleDownload = () => {
    if (!stageRef.current || !assets.length) {
      setSnackbar('Upload photos before exporting your recap.')
      return
    }

    const dataUrl = stageRef.current.toDataURL({ mimeType: 'image/jpeg', quality: 0.95 })
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `daily-recap-${Date.now()}.jpg`
    link.click()
  }

  const resetState = () => {
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
      }}
    >
      <Container maxWidth="lg">
        <Paper
          elevation={0}
          sx={{
            borderRadius: 4,
            backdropFilter: 'blur(20px)',
            background: 'rgba(8, 10, 14, 0.75)',
            border: '1px solid rgba(255,255,255,0.08)',
            p: { xs: 3, md: 4 },
            color: '#f7f7fb',
          }}
        >
          <Stack spacing={3}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between">
              <Box>
                <Typography variant="h3" fontWeight={600} gutterBottom>
                  Daily Recap
                </Typography>
                <Typography variant="body1" color="rgba(247,247,251,0.72)">
                  Upload up to 100 photos, experiment with smart layouts, and export a single archival
                  collage.
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Button
                  component="label"
                  variant="contained"
                  color="primary"
                  startIcon={<UploadRoundedIcon />}
                >
                  Upload Photos
                  <input hidden accept="image/*" multiple type="file" onChange={handleFiles} />
                </Button>
                <Tooltip title="Clear canvas">
                  <span>
                    <IconButton color="inherit" disabled={!assets.length} onClick={resetState}>
                      <RestartAltRoundedIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>

            {isProcessing && <LinearProgress color="info" />}

            <Paper
              elevation={0}
              sx={{
                p: 3,
                borderRadius: 3,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <Stack spacing={3} direction={{ xs: 'column', md: 'row' }}>
                <Stack spacing={1} flex={1}>
                  <Typography variant="overline" color="rgba(247,247,251,0.72)">
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
                      <Typography variant="caption" color="rgba(247,247,251,0.6)">
                        Columns: {columns}
                      </Typography>
                      <Slider
                        value={columns}
                        min={2}
                        max={6}
                        step={1}
                        marks
                        onChange={(_event, value) => setColumns(value as number)}
                      />
                    </Box>
                  ) : (
                    <Box>
                      <Typography variant="caption" color="rgba(247,247,251,0.6)">
                        Target row height: {rowHeight}px
                      </Typography>
                      <Slider
                        value={rowHeight}
                        min={220}
                        max={480}
                        step={20}
                        marks
                        onChange={(_event, value) => setRowHeight(value as number)}
                      />
                    </Box>
                  )}
                </Stack>
                <Divider flexItem orientation="vertical" sx={{ display: { xs: 'none', md: 'block' } }} />
                <Stack spacing={1} flex={1}>
                  <Typography variant="overline" color="rgba(247,247,251,0.72)">
                    Polaroid footer
                  </Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={footerEnabled}
                        onChange={(_event, checked) => setFooterEnabled(checked)}
                        color="secondary"
                      />
                    }
                    label={footerEnabled ? 'Footer enabled' : 'Footer hidden'}
                  />
                  <TextField
                    label="Footer text"
                    placeholder="Add a title or date"
                    disabled={!footerEnabled}
                    value={footerText}
                    onChange={(event) => setFooterText(event.target.value)}
                    InputProps={{ sx: { color: '#f7f7fb' } }}
                  />
                </Stack>
              </Stack>
            </Paper>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
              <Chip label={`${assets.length} photo${assets.length === 1 ? '' : 's'}`} color="secondary" />
              <Chip label={`Export: ${EXPORT_WIDTH.toLocaleString()}px wide`} variant="outlined" />
              {assets.length > 0 && (
                <Chip
                  variant="outlined"
                  label={`Approx height: ${Math.round(stageHeight)}px`}
                  icon={<InfoOutlinedIcon />}
                />
              )}
              <Box sx={{ flexGrow: 1 }} />
              <Button
                variant="contained"
                color="secondary"
                disabled={!assets.length}
                startIcon={<DownloadRoundedIcon />}
                onClick={handleDownload}
              >
                Download JPEG
              </Button>
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
              {assets.length === 0 ? (
                <Stack
                  minHeight={240}
                  alignItems="center"
                  justifyContent="center"
                  spacing={1}
                  color="rgba(247,247,251,0.6)"
                >
                  <Typography variant="h6">Drop your photos to preview the collage.</Typography>
                  <Typography variant="body2">High-resolution export stays crisp even when preview is scaled.</Typography>
                </Stack>
              ) : (
                <Box
                  sx={{
                    width: EXPORT_WIDTH,
                    transform: `scale(${previewScale})`,
                    transformOrigin: 'top left',
                    boxShadow: '0 40px 120px rgba(0,0,0,0.45)',
                    backgroundColor: '#fff',
                    borderRadius: footerEnabled ? '32px 32px 40px 40px' : '32px',
                  }}
                >
                  {/* Stage stays at export resolution so downloads are lossless; the wrapper handles scaling. */}
                  <Stage ref={stageRef} width={EXPORT_WIDTH} height={stageHeight}>
                    <Layer>
                      {layout.items.map((item) => {
                        const asset = assetMap[item.id]
                        if (!asset) {
                          return null
                        }
                        // KonvaImage draws the preloaded HTMLImageElement directly onto the canvas layer.
                        return (
                          <KonvaImage
                            key={item.id}
                            image={asset.image}
                            x={item.x}
                            y={item.y}
                            width={item.width}
                            height={item.height}
                            listening={false}
                            shadowColor="rgba(0,0,0,0.25)"
                            shadowBlur={30}
                            cornerRadius={24}
                          />
                        )
                      })}
                    </Layer>
                    {footerEnabled && (
                      <Layer>
                        {/* Dedicated footer layer renders after photos so it overlays edge shadows cleanly. */}
                        <Rect
                          x={0}
                          y={layout.height}
                          width={EXPORT_WIDTH}
                          height={FOOTER_HEIGHT}
                          fill="#fff"
                          shadowColor="rgba(12,12,16,0.4)"
                          shadowBlur={60}
                        />
                        <KonvaText
                          text={footerText || 'Daily Recap'}
                          x={0}
                          y={layout.height + FOOTER_HEIGHT / 2 - 32}
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
              )}
            </Box>
          </Stack>
        </Paper>
      </Container>

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
