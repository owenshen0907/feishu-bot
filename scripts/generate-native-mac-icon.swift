import AppKit
import Foundation

let repoRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let sourceURL = repoRoot.appendingPathComponent("assets/macos/AppIcon-source.png")
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

guard let sourceImage = NSImage(contentsOf: sourceURL) else {
  fputs("missing source image at \(sourceURL.path)\n", stderr)
  exit(1)
}

func renderVariant(size: Int) -> Data? {
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

  sourceImage.draw(
    in: canvas,
    from: NSRect(origin: .zero, size: sourceImage.size),
    operation: .copy,
    fraction: 1.0,
    respectFlipped: false,
    hints: [.interpolation: NSImageInterpolation.high]
  )

  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])
}

let fm = FileManager.default
try? fm.removeItem(at: iconsetURL)
try? fm.createDirectory(at: iconsetURL, withIntermediateDirectories: true)
try? fm.createDirectory(at: previewURL.deletingLastPathComponent(), withIntermediateDirectories: true)

for variant in variants {
  guard let png = renderVariant(size: variant.size) else {
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
