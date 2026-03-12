import AppKit
import Foundation

let repoRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let iconsetURL = repoRoot.appendingPathComponent(".build-artifacts/AppIcon.iconset", isDirectory: true)
let iconURL = repoRoot.appendingPathComponent("assets/macos/AppIcon.icns")
let previewURL = repoRoot.appendingPathComponent("assets/macos/AppIcon-1024.png")

let variants: [(name: String, size: Int)] = [
  ("icon_16x16.png", 16),
  ("icon_16x16@2x.png", 32),
  ("icon_32x32.png", 32),
  ("icon_32x32@2x.png", 64),
  ("icon_128x128.png", 128),
  ("icon_128x128@2x.png", 256),
  ("icon_256x256.png", 256),
  ("icon_256x256@2x.png", 512),
  ("icon_512x512.png", 512),
  ("icon_512x512@2x.png", 1024),
]

func makeColor(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat = 1.0) -> NSColor {
  NSColor(calibratedRed: red / 255.0, green: green / 255.0, blue: blue / 255.0, alpha: alpha)
}

func roundedRectPath(_ rect: NSRect, radius: CGFloat) -> NSBezierPath {
  NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
}

func drawSparkShape(in rect: NSRect, color: NSColor) {
  let cx = rect.midX
  let cy = rect.midY
  let outer = min(rect.width, rect.height) / 2
  let inner = outer * 0.32
  let points = [
    NSPoint(x: cx, y: cy + outer),
    NSPoint(x: cx + inner * 0.58, y: cy + inner * 0.58),
    NSPoint(x: cx + outer, y: cy),
    NSPoint(x: cx + inner * 0.58, y: cy - inner * 0.58),
    NSPoint(x: cx, y: cy - outer),
    NSPoint(x: cx - inner * 0.58, y: cy - inner * 0.58),
    NSPoint(x: cx - outer, y: cy),
    NSPoint(x: cx - inner * 0.58, y: cy + inner * 0.58),
  ]
  let path = NSBezierPath()
  path.move(to: points[0])
  for point in points.dropFirst() {
    path.line(to: point)
  }
  path.close()
  color.setFill()
  path.fill()
}

func drawBackground(in rect: NSRect) {
  let basePath = roundedRectPath(rect, radius: rect.width * 0.24)
  basePath.addClip()

  let gradient = NSGradient(colors: [
    makeColor(47, 203, 215),
    makeColor(43, 112, 252),
    makeColor(15, 31, 84),
  ])
  gradient?.draw(in: basePath, angle: 315)

  let glowRect = NSRect(
    x: rect.minX - rect.width * 0.08,
    y: rect.minY + rect.height * 0.46,
    width: rect.width * 0.88,
    height: rect.height * 0.66
  )
  let glow = NSBezierPath(ovalIn: glowRect)
  makeColor(255, 255, 255, 0.16).setFill()
  glow.fill()

  let lowerGlowRect = NSRect(
    x: rect.minX + rect.width * 0.38,
    y: rect.minY - rect.height * 0.1,
    width: rect.width * 0.7,
    height: rect.height * 0.48
  )
  let lowerGlow = NSBezierPath(ovalIn: lowerGlowRect)
  makeColor(16, 230, 198, 0.16).setFill()
  lowerGlow.fill()

  let borderPath = roundedRectPath(rect.insetBy(dx: rect.width * 0.004, dy: rect.height * 0.004), radius: rect.width * 0.23)
  borderPath.lineWidth = max(rect.width * 0.012, 2)
  makeColor(255, 255, 255, 0.12).setStroke()
  borderPath.stroke()
}

func drawLogBars(in rect: NSRect) {
  let barWidth = rect.width * 0.24
  let barHeight = rect.height * 0.045
  let startX = rect.minX + rect.width * 0.12
  let startY = rect.minY + rect.height * 0.18
  let gaps = rect.height * 0.038
  let widths: [CGFloat] = [0.72, 1.0, 0.52]

  for (index, widthScale) in widths.enumerated() {
    let barRect = NSRect(
      x: startX,
      y: startY + CGFloat(index) * (barHeight + gaps),
      width: barWidth * widthScale,
      height: barHeight
    )
    let path = roundedRectPath(barRect, radius: barHeight / 2)
    makeColor(255, 255, 255, index == 1 ? 0.24 : 0.16).setFill()
    path.fill()
  }
}

func drawBubble(in rect: NSRect) {
  let bubbleRect = NSRect(
    x: rect.minX + rect.width * 0.24,
    y: rect.minY + rect.height * 0.28,
    width: rect.width * 0.54,
    height: rect.height * 0.42
  )

  let shadow = NSShadow()
  shadow.shadowBlurRadius = rect.width * 0.05
  shadow.shadowOffset = NSSize(width: 0, height: -rect.height * 0.015)
  shadow.shadowColor = makeColor(8, 18, 56, 0.22)
  shadow.set()

  let bubblePath = roundedRectPath(bubbleRect, radius: bubbleRect.height * 0.34)
  makeColor(255, 255, 255, 0.96).setFill()
  bubblePath.fill()

  let tail = NSBezierPath()
  tail.move(to: NSPoint(x: bubbleRect.minX + bubbleRect.width * 0.18, y: bubbleRect.minY + bubbleRect.height * 0.06))
  tail.line(to: NSPoint(x: bubbleRect.minX + bubbleRect.width * 0.02, y: bubbleRect.minY - bubbleRect.height * 0.14))
  tail.line(to: NSPoint(x: bubbleRect.minX + bubbleRect.width * 0.34, y: bubbleRect.minY + bubbleRect.height * 0.08))
  tail.close()
  tail.fill()

  let waveformRect = NSRect(
    x: bubbleRect.minX + bubbleRect.width * 0.18,
    y: bubbleRect.minY + bubbleRect.height * 0.26,
    width: bubbleRect.width * 0.64,
    height: bubbleRect.height * 0.38
  )
  let waveform = NSBezierPath()
  waveform.move(to: NSPoint(x: waveformRect.minX, y: waveformRect.midY))
  waveform.line(to: NSPoint(x: waveformRect.minX + waveformRect.width * 0.22, y: waveformRect.midY))
  waveform.line(to: NSPoint(x: waveformRect.minX + waveformRect.width * 0.34, y: waveformRect.maxY))
  waveform.line(to: NSPoint(x: waveformRect.minX + waveformRect.width * 0.48, y: waveformRect.minY))
  waveform.line(to: NSPoint(x: waveformRect.minX + waveformRect.width * 0.62, y: waveformRect.midY + waveformRect.height * 0.18))
  waveform.line(to: NSPoint(x: waveformRect.minX + waveformRect.width * 0.72, y: waveformRect.midY))
  waveform.line(to: NSPoint(x: waveformRect.maxX, y: waveformRect.midY))
  waveform.lineJoinStyle = .round
  waveform.lineCapStyle = .round
  waveform.lineWidth = max(waveformRect.height * 0.2, 4)
  makeColor(42, 106, 247, 1.0).setStroke()
  waveform.stroke()
}

func drawSpark(in rect: NSRect) {
  let sparkRect = NSRect(
    x: rect.minX + rect.width * 0.68,
    y: rect.minY + rect.height * 0.64,
    width: rect.width * 0.18,
    height: rect.height * 0.18
  )
  drawSparkShape(in: sparkRect, color: makeColor(255, 210, 88, 1.0))

  let miniSparkRect = NSRect(
    x: sparkRect.minX - sparkRect.width * 0.16,
    y: sparkRect.minY + sparkRect.height * 0.42,
    width: sparkRect.width * 0.34,
    height: sparkRect.height * 0.34
  )
  drawSparkShape(in: miniSparkRect, color: makeColor(255, 230, 165, 0.95))

  let dotRect = NSRect(
    x: rect.minX + rect.width * 0.79,
    y: rect.minY + rect.height * 0.6,
    width: rect.width * 0.04,
    height: rect.width * 0.04
  )
  let dot = NSBezierPath(ovalIn: dotRect)
  makeColor(255, 255, 255, 0.86).setFill()
  dot.fill()
}

func drawBadge(in rect: NSRect) {
  let badgeRect = NSRect(
    x: rect.minX + rect.width * 0.63,
    y: rect.minY + rect.height * 0.18,
    width: rect.width * 0.16,
    height: rect.height * 0.14
  )
  let badge = roundedRectPath(badgeRect, radius: badgeRect.height * 0.46)
  makeColor(20, 35, 92, 0.78).setFill()
  badge.fill()
  badge.lineWidth = max(rect.width * 0.008, 1.2)
  makeColor(140, 228, 214, 0.56).setStroke()
  badge.stroke()

  let bars: [CGFloat] = [0.22, 0.44, 0.7]
  for (index, heightScale) in bars.enumerated() {
    let barW = badgeRect.width * 0.12
    let gap = badgeRect.width * 0.08
    let x = badgeRect.minX + badgeRect.width * 0.2 + CGFloat(index) * (barW + gap)
    let barH = badgeRect.height * heightScale
    let barRect = NSRect(
      x: x,
      y: badgeRect.minY + badgeRect.height * 0.16,
      width: barW,
      height: barH
    )
    let path = roundedRectPath(barRect, radius: barW / 2)
    makeColor(95, 245, 204, 0.94).setFill()
    path.fill()
  }
}

func renderIcon(size: Int) -> Data? {
  guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: size,
    pixelsHigh: size,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else {
    return nil
  }

  rep.size = NSSize(width: size, height: size)
  guard let context = NSGraphicsContext(bitmapImageRep: rep) else {
    return nil
  }

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  context.imageInterpolation = .high
  context.shouldAntialias = true

  let canvas = NSRect(x: 0, y: 0, width: CGFloat(size), height: CGFloat(size))
  NSColor.clear.setFill()
  canvas.fill()

  let inset = CGFloat(size) * 0.055
  let frame = canvas.insetBy(dx: inset, dy: inset)

  drawBackground(in: frame)
  drawLogBars(in: frame)
  drawBubble(in: frame)
  drawSpark(in: frame)
  drawBadge(in: frame)

  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])
}

let fm = FileManager.default
try? fm.removeItem(at: iconsetURL)
try? fm.createDirectory(at: iconsetURL, withIntermediateDirectories: true)
try? fm.createDirectory(at: previewURL.deletingLastPathComponent(), withIntermediateDirectories: true)

for variant in variants {
  guard let png = renderIcon(size: variant.size) else {
    fputs("failed to render \(variant.name)\n", stderr)
    exit(1)
  }
  try png.write(to: iconsetURL.appendingPathComponent(variant.name))
  if variant.size == 1024 {
    try png.write(to: previewURL)
  }
}

let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconsetURL.path, "-o", iconURL.path]
try task.run()
task.waitUntilExit()
if task.terminationStatus != 0 {
  fputs("iconutil failed\n", stderr)
  exit(task.terminationStatus)
}

print("created \(iconURL.path)")
print("preview \(previewURL.path)")
