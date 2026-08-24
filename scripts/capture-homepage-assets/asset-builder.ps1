# Image comparison and bounded Python/Pillow output assembly.

function Measure-ImageDifferenceRatio {
    param(
        [string]$ReferencePath,
        [string]$CandidatePath
    )
    $reference = [System.Drawing.Bitmap]::FromFile($ReferencePath)
    $candidate = [System.Drawing.Bitmap]::FromFile($CandidatePath)
    try {
        if ($reference.Width -ne $candidate.Width -or $reference.Height -ne $candidate.Height) {
            return 1.0
        }
        $step = 12
        $threshold = 48
        $samples = 0
        $different = 0
        for ($y = 0; $y -lt $reference.Height; $y += $step) {
            for ($x = 0; $x -lt $reference.Width; $x += $step) {
                $a = $reference.GetPixel($x, $y)
                $b = $candidate.GetPixel($x, $y)
                $delta = [Math]::Abs($a.R - $b.R) +
                    [Math]::Abs($a.G - $b.G) +
                    [Math]::Abs($a.B - $b.B)
                if ($delta -gt $threshold) {
                    $different++
                }
                $samples++
            }
        }
        if ($samples -eq 0) {
            return 0.0
        }
        return $different / [double]$samples
    }
    finally {
        $reference.Dispose()
        $candidate.Dispose()
    }
}

function Build-HomepageAssets {
    param(
        [string]$OverviewPath,
        [string]$SelectedPath,
        [string]$ContextPath,
        [string]$OutputDir
    )
    $pythonScript = @'
from PIL import Image
import argparse
import os

MAX_INPUT_PIXELS = 100_000_000
parser = argparse.ArgumentParser()
parser.add_argument("--overview", required=True)
parser.add_argument("--selected", required=True)
parser.add_argument("--context", required=True)
parser.add_argument("--outdir", required=True)
args = parser.parse_args()

def load_rgb_bounded(path):
    with Image.open(path) as source:
        if source.width <= 0 or source.height <= 0 or source.width * source.height > MAX_INPUT_PIXELS:
            raise ValueError(f"unsafe homepage input dimensions: {source.width}x{source.height}")
        return source.convert("RGB")

def resize_to_width(image, width):
    if image.width == width:
        return image.copy()
    height = max(1, round(image.height * (width / image.width)))
    return image.resize((width, height), Image.LANCZOS)

def clamp_crop_box(image, box):
    left, top, right, bottom = box
    left = max(0, min(left, image.width - 1))
    top = max(0, min(top, image.height - 1))
    right = max(left + 1, min(right, image.width))
    bottom = max(top + 1, min(bottom, image.height))
    return (left, top, right, bottom)

overview = load_rgb_bounded(args.overview)
selected = load_rgb_bounded(args.selected)
context = load_rgb_bounded(args.context)
try:
    overview_out = resize_to_width(overview, min(overview.width, 1280))
    overview_out.save(os.path.join(args.outdir, "hook-home-overview-cropped.png"), optimize=True)
    context_crop = clamp_crop_box(context, (120, 150, 980, 760))
    context_out = resize_to_width(context.crop(context_crop), 960)
    context_out.save(os.path.join(args.outdir, "hook-home-context-menu-cropped.png"), optimize=True)
    gif_frames = [
        resize_to_width(frame, min(frame.width, 1120)).convert("P", palette=Image.Palette.ADAPTIVE)
        for frame in (overview, context)
    ]
    gif_frames[0].save(
        os.path.join(args.outdir, "hook-home-demo.gif"),
        save_all=True,
        append_images=gif_frames[1:],
        duration=[1300, 1700],
        loop=0,
        optimize=True,
        disposal=2,
    )
finally:
    overview.close()
    selected.close()
    context.close()
'@
    $pythonScript | & python - --overview $OverviewPath --selected $SelectedPath --context $ContextPath --outdir $OutputDir
    if ($LASTEXITCODE -ne 0) {
        throw "Homepage asset builder failed with exit code $LASTEXITCODE"
    }
}
