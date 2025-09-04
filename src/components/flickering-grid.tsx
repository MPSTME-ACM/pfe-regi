"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

interface FlickeringGridProps {
  squareSize?: number
  gridGap?: number
  flickerChance?: number
  color?: string
  className?: string
  maxOpacity?: number
}

const FlickeringGrid: React.FC<FlickeringGridProps> = ({
  squareSize = 8,
  gridGap = 12,
  flickerChance = 0.3,
  color = "rgb(255, 255, 255)",
  className,
  maxOpacity = 0.24,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isInView, setIsInView] = useState(false)

  // Cache canvas setup data to avoid recalculation
  const setupDataRef = useRef<{
    width: number
    height: number
    cols: number
    rows: number
    squares: Float32Array
    dpr: number
  } | null>(null)

  const memoizedColor = useMemo(() => {
    const toRGBA = (c: string) => {
      if (typeof window === "undefined") {
        return `rgba(255, 255, 255,`
      }
      // Reuse canvas instead of creating new one each time
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext("2d", { alpha: false }) // Disable alpha for better performance
      if (!ctx) return "rgba(255, 255, 255,"
      ctx.fillStyle = c
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      return `rgba(${r}, ${g}, ${b},`
    }
    return toRGBA(color)
  }, [color])

  const setupCanvas = useCallback(
    (canvas: HTMLCanvasElement, forceResize = false) => {
      const canvasWidth = document.documentElement.clientWidth
      const canvasHeight = document.documentElement.clientHeight
      const dpr = window.devicePixelRatio || 1

      // Only resize if dimensions actually changed
      if (!forceResize && setupDataRef.current &&
        setupDataRef.current.width === canvasWidth &&
        setupDataRef.current.height === canvasHeight &&
        setupDataRef.current.dpr === dpr) {
        return setupDataRef.current
      }

      canvas.width = canvasWidth * dpr
      canvas.height = canvasHeight * dpr
      canvas.style.width = `${canvasWidth}px`
      canvas.style.height = `${canvasHeight}px`

      const cols = Math.floor(canvasWidth / (squareSize + gridGap))
      const rows = Math.floor(canvasHeight / (squareSize + gridGap))
      const totalSquares = cols * rows

      // Reuse existing Float32Array if same size, otherwise create new one
      let squares: Float32Array
      if (setupDataRef.current?.squares && setupDataRef.current.squares.length === totalSquares) {
        squares = setupDataRef.current.squares
        // Re-initialize with random values
        for (let i = 0; i < squares.length; i++) {
          squares[i] = Math.random() * maxOpacity
        }
      } else {
        squares = new Float32Array(totalSquares)
        for (let i = 0; i < squares.length; i++) {
          squares[i] = Math.random() * maxOpacity
        }
      }

      const setupData = { width: canvasWidth, height: canvasHeight, cols, rows, squares, dpr }
      setupDataRef.current = setupData
      return setupData
    },
    [squareSize, gridGap, maxOpacity],
  )

  const updateSquares = useCallback(
    (squares: Float32Array, deltaTime: number) => {
      // Use a more efficient random check - only process subset of squares per frame
      const flickerRate = flickerChance * deltaTime
      const maxUpdates = Math.min(Math.ceil(squares.length * flickerRate * 2), squares.length)

      for (let i = 0; i < maxUpdates; i++) {
        const index = Math.floor(Math.random() * squares.length)
        if (Math.random() < flickerRate) {
          squares[index] = Math.random() * maxOpacity
        }
      }
    },
    [flickerChance, maxOpacity],
  )

  const drawGrid = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      cols: number,
      rows: number,
      squares: Float32Array,
      dpr: number,
    ) => {
      // Use clearRect only on visible area
      ctx.clearRect(0, 0, width, height)

      // Batch similar opacity squares together for better performance
      const squareSize_dpr = squareSize * dpr
      const gridGap_dpr = gridGap * dpr
      const step = squareSize + gridGap

      for (let i = 0; i < cols; i++) {
        const x = i * step * dpr
        for (let j = 0; j < rows; j++) {
          const opacity = squares[i * rows + j]
          // Skip drawing squares with very low opacity (invisible)
          if (opacity < 0.01) continue

          ctx.fillStyle = `${memoizedColor}${opacity})`
          ctx.fillRect(x, j * step * dpr, squareSize_dpr, squareSize_dpr)
        }
      }
    },
    [memoizedColor, squareSize, gridGap],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Use alpha: false for better performance
    const ctx = canvas.getContext("2d", { alpha: false })
    if (!ctx) return

    let animationFrameId = 0
    let setupData = setupCanvas(canvas)
    let lastTime = 0

    let frameCount = 0
    const animate = (time: number) => {
      if (!isInView) return

      // Limit to 30 FPS instead of 60
      frameCount++
      if (frameCount % 2 !== 0) {
        animationFrameId = requestAnimationFrame(animate)
        return
      }

      const deltaTime = Math.min((time - lastTime) / 1000, 0.1)
      lastTime = time

      updateSquares(setupData.squares, deltaTime)
      drawGrid(ctx, setupData.width * setupData.dpr, setupData.height * setupData.dpr,
        setupData.cols, setupData.rows, setupData.squares, setupData.dpr)

      animationFrameId = requestAnimationFrame(animate)
    }

    // Debounced resize handler
    let resizeTimeout: NodeJS.Timeout
    const handleResize = () => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        setupData = setupCanvas(canvas, true)
      }, 100)
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      { threshold: 0 }
    )

    observer.observe(canvas)
    window.addEventListener("resize", handleResize)

    animationFrameId = requestAnimationFrame(animate)

    return () => {
      window.removeEventListener("resize", handleResize)
      cancelAnimationFrame(animationFrameId)
      observer.disconnect()
      clearTimeout(resizeTimeout)
      setupDataRef.current = null // Clean up cache
    }
  }, [setupCanvas, updateSquares, drawGrid, isInView])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`fixed inset-0 -z-10 pointer-events-none ${className || ""}`}
      style={{ width: "100%", height: "100%" }}
    />
  )
}

export default FlickeringGrid