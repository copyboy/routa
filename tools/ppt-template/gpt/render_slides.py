#!/usr/bin/env python3
# Copyright (c) OpenAI. All rights reserved.
import argparse
import os
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from os import makedirs, replace
from os.path import abspath, basename, exists, expanduser, join, splitext
from typing import Sequence, cast
from zipfile import ZipFile

from pdf2image import convert_from_path, pdfinfo_from_path

EMU_PER_INCH: int = 914_400


def calc_dpi_via_ooxml(input_path: str, max_w_px: int, max_h_px: int) -> int:
    """Calculate DPI from OOXML `ppt/presentation.xml` slide size (cx/cy in EMUs)."""
    with ZipFile(input_path, "r") as zf:
        xml = zf.read("ppt/presentation.xml")
    root = ET.fromstring(xml)
    ns = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main"}
    sld_sz = root.find("p:sldSz", ns)
    if sld_sz is None:
        raise RuntimeError("Slide size not found in presentation.xml")
    cx = int(sld_sz.get("cx") or 0)
    cy = int(sld_sz.get("cy") or 0)
    if cx <= 0 or cy <= 0:
        raise RuntimeError("Invalid slide size values in presentation.xml")
    width_in = cx / EMU_PER_INCH
    height_in = cy / EMU_PER_INCH
    return round(min(max_w_px / width_in, max_h_px / height_in))


def calc_dpi_via_pdf(input_path: str, max_w_px: int, max_h_px: int) -> int:
    """Compute DPI from PDF page size.

    For non-PDF inputs, first convert to PDF via LibreOffice to read page size.
    For PDFs, use the PDF directly (avoids unnecessary conversion and failures).
    """
    is_pdf = input_path.lower().endswith(".pdf")
    with tempfile.TemporaryDirectory(prefix="soffice_profile_") as user_profile:
        with tempfile.TemporaryDirectory(prefix="soffice_convert_") as convert_tmp_dir:
            stem = splitext(basename(input_path))[0]
            pdf_path = (
                input_path
                if is_pdf
                else convert_to_pdf(input_path, user_profile, convert_tmp_dir, stem)
            )
            if not (pdf_path and exists(pdf_path)):
                raise RuntimeError("Failed to produce/read PDF for DPI computation.")

            info = pdfinfo_from_path(pdf_path)
            size_val = info.get("Page size")
            if not size_val:
                for k, v in info.items():
                    if isinstance(v, str) and "size" in k.lower() and "pts" in v:
                        size_val = v
                        break
            if not isinstance(size_val, str):
                raise RuntimeError("Failed to read PDF page size for DPI computation.")

            def _parse_page_size_to_pts(s: str) -> tuple[float, float]:
                # Common formats from poppler/pdfinfo:
                # - "612 x 792 pts (letter)"
                # - "595.276 x 841.89 pts (A4)"
                # - sometimes inches: "8.5 x 11 in"
                m_pts = re.search(
                    r"([0-9]+(?:\.[0-9]+)?)\s*x\s*([0-9]+(?:\.[0-9]+)?)\s*pts\b",
                    s,
                )
                if m_pts:
                    return float(m_pts.group(1)), float(m_pts.group(2))
                m_in = re.search(
                    r"([0-9]+(?:\.[0-9]+)?)\s*x\s*([0-9]+(?:\.[0-9]+)?)\s*in\b",
                    s,
                )
                if m_in:
                    w_in = float(m_in.group(1))
                    h_in = float(m_in.group(2))
                    return w_in * 72.0, h_in * 72.0
                # Sometimes poppler returns without an explicit unit; treat as points.
                m = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*x\s*([0-9]+(?:\.[0-9]+)?)\b", s)
                if m:
                    return float(m.group(1)), float(m.group(2))
                raise RuntimeError(f"Unrecognized PDF page size format: {s!r}")

            width_pts, height_pts = _parse_page_size_to_pts(size_val)
            width_in = width_pts / 72.0
            height_in = height_pts / 72.0
            if width_in <= 0 or height_in <= 0:
                raise RuntimeError("Invalid PDF page size values.")
            return round(min(max_w_px / width_in, max_h_px / height_in))


def run_cmd_no_check(cmd: list[str]) -> None:
    subprocess.run(
        cmd,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=os.environ.copy(),
    )


def convert_to_pdf(
    pptx_path: str,
    user_profile: str,
    convert_tmp_dir: str,
    stem: str,
) -> str:
    # Try direct PPTX -> PDF
    cmd_pdf = [
        "soffice",
        "-env:UserInstallation=file://" + user_profile,
        "--invisible",
        "--headless",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        convert_tmp_dir,
        pptx_path,
    ]
    run_cmd_no_check(cmd_pdf)

    pdf_path = join(convert_tmp_dir, f"{stem}.pdf")
    if exists(pdf_path):
        return pdf_path

    # Fallback: PPTX -> ODP, then ODP -> PDF
    # Rationale: Saving as ODP normalizes PPTX-specific constructs via the ODF serializer,
    # which often bypasses Impress PDF export issues on problematic decks.
    cmd_odp = [
        "soffice",
        "-env:UserInstallation=file://" + user_profile,
        "--invisible",
        "--headless",
        "--norestore",
        "--convert-to",
        "odp",
        "--outdir",
        convert_tmp_dir,
        pptx_path,
    ]
    run_cmd_no_check(cmd_odp)

    odp_path = join(convert_tmp_dir, f"{stem}.odp")

    if exists(odp_path):
        # ODP -> PDF
        cmd_odp_pdf = [
            "soffice",
            "-env:UserInstallation=file://" + user_profile,
            "--invisible",
            "--headless",
            "--norestore",
            "--convert-to",
            "pdf",
            "--outdir",
            convert_tmp_dir,
            odp_path,
        ]
        run_cmd_no_check(cmd_odp_pdf)
        if exists(pdf_path):
            return pdf_path

    return ""


def rasterize(
    input_path: str,
    out_dir: str,
    dpi: int,
) -> Sequence[str]:
    """Rasterise PPTX/PDF to PNG files placed in out_dir and return the image paths."""
    makedirs(out_dir, exist_ok=True)
    input_path = abspath(input_path)
    stem = splitext(basename(input_path))[0]

    # Use a unique user profile to avoid LibreOffice profile lock when running concurrently
    with tempfile.TemporaryDirectory(prefix="soffice_profile_") as user_profile:
        # Write conversion outputs into a temp directory to avoid any IO oddities
        with tempfile.TemporaryDirectory(prefix="soffice_convert_") as convert_tmp_dir:
            is_pdf = input_path.lower().endswith(".pdf")
            pdf_path = (
                input_path
                if is_pdf
                else convert_to_pdf(input_path, user_profile, convert_tmp_dir, stem)
            )

            if not pdf_path or not exists(pdf_path):
                raise RuntimeError(
                    "Failed to produce PDF for rasterization (direct and ODP fallback)."
                )

            # Perform rasterization while the temp PDF still exists
            paths_raw = cast(
                list[str],
                convert_from_path(
                    pdf_path,
                    dpi=dpi,
                    fmt="png",
                    thread_count=8,
                    output_folder=out_dir,
                    paths_only=True,
                    output_file="slide",
                ),
            )
    # Rename convert_from_path's output format f'slide{thread_id:04d}-{page_num:02d}.png'
    slides = []
    for src_path in paths_raw:
        base = splitext(basename(src_path))[0]
        slide_num_str = base.split("-")[-1]
        slide_num = int(slide_num_str)
        dst_path = join(out_dir, f"slide-{slide_num}.png")
        replace(src_path, dst_path)
        slides.append((slide_num, dst_path))
    slides.sort(key=lambda t: t[0])
    final_paths = [path for _, path in slides]
    return final_paths


def main() -> None:
    parser = argparse.ArgumentParser(description="Render slides to images.")
    parser.add_argument(
        "input_path",
        type=str,
        help="Path to the input PowerPoint or PDF file.",
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default=None,
        help=(
            "Output directory for the rendered images. "
            "Defaults to a folder next to the input named after the input file (without extension)."
        ),

--- slides_test.py ---
#!/usr/bin/env python3
# Copyright (c) OpenAI. All rights reserved.
import argparse
import tempfile
from os.path import abspath, expanduser, join
from typing import Sequence, cast

import numpy as np

# Always run this script in the current directory.
import render_slides  # type: ignore
from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE
from pptx.util import Emu

# Configuration specific to overflow checking
PAD_PX: int = 100  # fixed padding on every side in pixels
PAD_RGB = (200, 200, 200)
EMU_PER_INCH: int = 914_400


def px_to_emu(px: int, dpi: int) -> Emu:
    return Emu(int(px * EMU_PER_INCH // dpi))


def calc_tol(dpi: int) -> int:
    """Calculate per-channel colour tolerance appropriate for *dpi* (anti-aliasing tolerance)."""
    if dpi >= 300:
        return 0
    # 1 at 250 DPI, 5 at 150 DPI, capped to 10.
    tol = round((300 - dpi) / 25)
    return min(max(tol, 1), 10)


def enlarge_deck(src: str, dst: str, pad_emu: Emu) -> tuple[int, int]:
    """Enlarge the input PPTX with a fixed grey padding and return the new page size."""
    prs = Presentation(src)
    w0 = cast(Emu, prs.slide_width)
    [... ELLIPSIZATION ...]in pixels outside the pad."""

    tol = calc_tol(dpi)
    failures: list[int] = []
    pad_colour = np.array(PAD_RGB, dtype=np.uint8)

    for idx, img_path in enumerate(paths, start=1):
        with Image.open(img_path) as img:
            rgb = img.convert("RGB")
            arr = np.asarray(rgb)

        h, w, _ = arr.shape
        # Exclude the innermost 1-pixel band
        pad_x = int(w * pad_ratio_w) - 1
        pad_y = int(h * pad_ratio_h) - 1

        left_margin = arr[:, :pad_x, :]
        right_margin = arr[:, w - pad_x :, :]
        top_margin = arr[:pad_y, :, :]
        bottom_margin = arr[h - pad_y :, :, :]

        def _is_clean(margin: np.ndarray) -> bool:
            diff = np.abs(margin.astype(np.int16) - pad_colour)
            matches = np.all(diff <= tol, axis=-1)
            mismatch_fraction = 1.0 - (np.count_nonzero(matches) / matches.size)
            if dpi >= 300:
                max_mismatch = 0.01
            elif dpi >= 200:
                max_mismatch = 0.02
            else:
                max_mismatch = 0.03
            return mismatch_fraction <= max_mismatch

        if not (
            _is_clean(left_margin)
            and _is_clean(right_margin)
            and _is_clean(top_margin)
            and _is_clean(bottom_margin)
        ):
            failures.append(idx)

    return failures


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Check a PPTX for content overflowing the original canvas by rendering with padding "
            "and inspecting the margins."
        )
    )
    parser.add_argument(
        "input_path",
        type=str,
        help="Path to the input PPTX file.",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=1600,
        help=(
            "Approximate maximum width in pixels after isotropic scaling (default 1600). "
            "The actual value may exceed slightly."
        ),
    )
    parser.add_argument(
        "--height",
        type=int,
        default=900,
        help=(
            "Approximate maximum height in pixels after isotropic scaling (default 900). "
            "The actual value may exceed slightly."
        ),
    )
    parser.add_argument(
        "--pad_px",
        type=int,
        default=PAD_PX,
        help="Padding in pixels to add on each side before rasterization.",
    )
    args = parser.parse_args()

    input_path = abspath(expanduser(args.input_path))
    # Width and height refer to the original, unaltered slide dimensions.
    dpi = render_slides.calc_dpi_via_ooxml(input_path, args.width, args.height)

    # Not using ``tempfile.TemporaryDirectory(delete=False)`` for Python 3.11 compatibility.
    tmpdir = tempfile.mkdtemp()
    enlarged_pptx = join(tmpdir, "enlarged.pptx")
    pad_emu = px_to_emu(args.pad_px, dpi)
    w1, h1 = enlarge_deck(input_path, enlarged_pptx, pad_emu=pad_emu)
    pad_ratio_w = pad_emu / w1
    pad_ratio_h = pad_emu / h1

    img_dir = join(tmpdir, "imgs")
    img_paths = render_slides.rasterize(enlarged_pptx, img_dir, dpi)
    failing = inspect_images(img_paths, pad_ratio_w, pad_ratio_h, dpi)

    if failing:
        print(
            "ERROR: Slides with content overflowing original canvas (1-based indexing): "
            + ", ".join(map(str, failing))
            + "\n"
            + "Rendered images with grey paddings for problematic slides are available at: "
        )
        for i in failing:
            print(img_paths[i - 1])
    else:
        print("Test passed. No overflow detected.")


if __name__ == "__main__":
    main()

--- ensure_raster_image.py ---
#!/usr/bin/env python3
"""Copyright (c) OpenAI. All rights reserved.

Ensures input images are rasterized, converting to PNG when needed. Primarily used to
preview image assets extracted from PowerPoint files.


Dependencies used by this tool:
- Inkscape: SVG/EMF/WMF rasterization
- ImageMagick: format bridging (TIFF→PNG, generic convert)
- Ghostscript: PDF/EPS/PS rasterization (first page)
- libheif-examples: heif-convert for HEIC/HEIF → PNG
- jxr-tools (or libjxr-tools on older distros): JxrDecApp for JPEG XR (JXR/WDP)

Install (Ubuntu/Debian):
  sudo apt-get update
  sudo apt-get install -y inkscape imagemagick ghostscript libheif-examples jxr-tools
  # If jxr-tools not found on your distro, try:
  # sudo apt-get install -y libjxr-tools

Verify:
  inkscape --version
  convert -version | grep -i "ImageMagick"
  gs -v
  heif-convert -h
  JxrDecApp -h
"""

import argparse
import gzip
import shutil
from os import listdir
from os.path import basename, dirname, expanduser, isfile, join, splitext
from subprocess import run

RASTER_EXTS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".bmp",
    ".gif",
    ".tif",
    ".tiff",
    ".webp",
}

CONVERTIBLE_EXTS = {
    # Windows metafiles (and compressed variants)
    ".emf",
    ".wmf",
    ".emz",
    ".wmz",
    # SVG
    ".svg",
    ".svgz",
    # JPEG XR / HD Photo
    ".wdp",
    ".jxr",
    # HEIF family
    ".heic",
    ".heif",
    # Page-description formats (rasterize first page)
    ".pdf",
    ".eps",
    ".ps",
}

SUPPORTED_EXTS = RASTER_EXTS | CONVERTIBLE_EXTS


def _imagemagick_convert(src_path: str, dst_path: str) -> None:
    binary = shutil.which("magick") or "convert"
    run([binary, src_path, dst_path], check=True)


def ensure_raster_image(path: str, out_dir: str | None = None) -> str:
    """Return a raster image path for the given input, converting when needed.

    - EMF/WMF/EMZ/WMZ are rasterized via Inkscape (EMZ/WMZ are decompressed first)
    - SVG/SVGZ are rasterized via Inkscape
    - WDP/JXR are converted via ImageMagick (if codec available)
    - Known raster formats are returned as-is

    Raises ValueError if the extension is not supported.
    """
    base, ext = splitext(path)
    ext_lower = ext.lower()
    out_dir = out_dir or dirname(path)
    out_path = join(out_dir, basename(base) + ".png")

    # Convertible formats
    if ext_lower in (".emf", ".wmf"):
        run(["inkscape", path, "-o", out_path], check=True)
        if isfile(out_path):
            return out_path
        raise RuntimeError("inkscape reported success but output file not found: " + out_path)

    if ext_lower in (".emz", ".wmz"):
        # Decompress into EMF/WMF then rasterize with Inkscape
        decompressed = join(out_dir, basename(base) + (".emf" if ext_lower == ".emz" else ".wmf"))
        with gzip.open(path, "rb") as zin, open(decompressed, "wb") as zout:
            zout.write(zin.read())
        run(
            ["inkscape", decompressed, "-o", out_path],
            check=True,
        )
        if isfile(out_path):
            return out_path
        raise RuntimeError("inkscape reported success but output file not found: " + out_path)

    if ext_lower in (".svg", ".svgz"):
        run(["inkscape", path, "-o", out_path], check=True)
        if isfile(out_path):
            return out_path
        raise RuntimeError("inkscape reported success but output file not found: " + out_path)

    if ext_lower in (".wdp", ".jxr"):
        tmp_tiff = join(out_dir, basename(base) + ".tiff")
        run(["JxrDecApp", "-i", path, "-o", tmp_tiff], check=True)
        _imagemagick_convert(tmp_tiff, out_path)
        if isfile(out_path):
            return out_path
        raise RuntimeError("JPEG XR decode succeeded but PNG not found: " + out_path)

    if ext_lower in (".heic", ".heif"):
        # Use libheif's CLI for robust conversion
        heif_convert = shutil.which("heif-convert") or "heif-convert"
        run([heif_convert, path, out_path], check=True)
        if isfile(out_path):
            return out_path
        raise RuntimeError("heif-convert reported success but output file not found: " + out_path)

    if ext_lower in (".pdf", ".eps", ".ps"):
        # Rasterize first page via Ghostscript
        gs = shutil.which("gs") or "gs"
        run(
            [
                gs,
                "-dSAFER",
                "-dBATCH",
                "-dNOPAUSE",
                "-sDEVICE=pngalpha",
                "-dFirstPage=1",
                "-dLastPage=1",
                "-r200",
                "-o",
                out_path,
                path,
            ],
            check=True,
        )
        if isfile(out_path):
            return out_path
        raise RuntimeError("Ghostscript reported success but output file not found: " + out_path)

    if ext_lower in RASTER_EXTS:
        return path

    raise ValueError(f"Unsupported image format for montage: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=("Ensure input images are rasterized; convert to PNG if needed.")
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--input_files", nargs="+", help="List of input image file paths")
    group.add_argument("--input_dir", help="Directory containing input images")
    parser.add_argument(
        "--output_dir",
        default=None,
        help=(
            "Directory to write converted PNGs. If omitted, converted files are written next to inputs."
        ),
    )
    args = parser.parse_args()

    if args.input_files:
        paths = [expanduser(p) for p in args.input_files]
    else:
        input_dir = expanduser(args.input_dir)
        names = listdir(input_dir)
        paths = [
            join(input_dir, f)
            for f in names
            if isfile(join(input_dir, f)) and splitext(f)[1].lower() in SUPPORTED_EXTS
        ]
        if not paths:
            raise SystemExit("No files with supported extensions in input_dir")

    out_dir = expanduser(args.output_dir) if args.output_dir else None
    converted_paths = []
    for p in paths:
        if ensure_raster_image(p, out_dir) != p:
            converted_paths.append(p)

    if converted_paths:
        print("Converted the following files to PNG:\n" + "\n".join(converted_paths))


if __name__ == "__main__":
    main()