export type LayoutMode = 'masonry' | 'justified'

export interface BarePhoto {
  id: string
  width: number
  height: number
}

export interface LayoutItem {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutResult {
  width: number
  height: number
  items: LayoutItem[]
}

interface MasonryOptions {
  columns: number
  gutter: number
  width: number
}

interface JustifiedOptions {
  rowHeight: number
  gutter: number
  width: number
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export function computeMasonryLayout(photos: BarePhoto[], options: MasonryOptions): LayoutResult {
  const columns = Math.max(1, Math.floor(options.columns))
  const gutter = Math.max(0, options.gutter)
  const columnWidth = (options.width - gutter * (columns - 1)) / columns
  const columnHeights = Array.from({ length: columns }, () => 0)
  const items: LayoutItem[] = []

  photos.forEach((photo) => {
    const targetColumn = columnHeights.indexOf(Math.min(...columnHeights))
    const height = (photo.height / photo.width) * columnWidth
    const x = targetColumn * (columnWidth + gutter)
    const y = columnHeights[targetColumn]

    items.push({
      id: photo.id,
      x,
      y,
      width: columnWidth,
      height,
    })

    columnHeights[targetColumn] += height + gutter
  })

  const height = Math.max(0, Math.max(...columnHeights) - gutter)

  return {
    width: options.width,
    height,
    items,
  }
}

export function computeJustifiedLayout(photos: BarePhoto[], options: JustifiedOptions): LayoutResult {
  const targetWidth = options.width
  const gutter = Math.max(0, options.gutter)
  const rows: LayoutItem[][] = []
  let currentRow: BarePhoto[] = []
  let rowAspectSum = 0
  let cursorY = 0

  const flushRow = (isLastRow: boolean) => {
    if (!currentRow.length) {
      return
    }

    const minHeight = options.rowHeight * 0.75
    const maxHeight = options.rowHeight * 1.25
    const availableWidth = targetWidth - gutter * (currentRow.length - 1)
    const idealHeight = availableWidth / rowAspectSum
    const rowHeight = isLastRow
      ? Math.min(options.rowHeight, idealHeight)
      : clamp(idealHeight, minHeight, maxHeight)

    let cursorX = 0

    const placedRow = currentRow.map((photo, index) => {
      const width = rowHeight * (photo.width / photo.height)
      const item: LayoutItem = {
        id: photo.id,
        x: cursorX,
        y: cursorY,
        width,
        height: rowHeight,
      }

      cursorX += width + (index < currentRow.length - 1 ? gutter : 0)
      return item
    })

    rows.push(placedRow)
    cursorY += rowHeight + gutter
    currentRow = []
    rowAspectSum = 0
  }

  photos.forEach((photo, index) => {
    currentRow.push(photo)
    rowAspectSum += photo.width / photo.height
    const virtualRowWidth = options.rowHeight * rowAspectSum + gutter * (currentRow.length - 1)
    const isLastPhoto = index === photos.length - 1

    if (virtualRowWidth >= targetWidth || isLastPhoto) {
      flushRow(isLastPhoto)
    }
  })

  const height = Math.max(0, cursorY - gutter)
  const items = rows.flat()

  return {
    width: targetWidth,
    height,
    items,
  }
}
