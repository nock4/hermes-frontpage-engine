#!/usr/bin/env python3
"""Prepare loud source-media surfaces for Daily Frontpage editions.

Uses Roboflow Supervision as the annotation/geometry wrapper around simple
OpenCV saliency. The output is intentionally runtime-clean: cropped poster
assets and JSON metadata. Annotated plates are review-only under tmp/.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import cv2
import numpy as np
import supervision as sv
from PIL import Image, ImageOps

USER_AGENT = "Mozilla/5.0 (compatible; Hermes-Frontpage/1.0; +https://daily.nockgarden.com)"
TARGET_ASPECT = 16 / 9


@dataclass
class SaliencyResult:
    box: tuple[int, int, int, int]
    boxes: list[tuple[int, int, int, int]]
    edge_density: float
    method: str


def norm_path(path: Path, root: Path) -> str:
    return "/" + path.relative_to(root / "public").as_posix()


def safe_id(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in value)[:96] or "source"


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def resolve_image(url: str, root: Path, edition_dir: Path, cache_dir: Path) -> Path:
    if url.startswith("/editions/"):
        candidate = root / "public" / url.lstrip("/")
        if candidate.exists():
            return candidate
    if url.startswith("/"):
        candidate = root / "public" / url.lstrip("/")
        if candidate.exists():
            return candidate

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"Unsupported image URL: {url}")

    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
    suffix = Path(parsed.path).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".avif"}:
        suffix = ".img"
    cache_path = cache_dir / f"{digest}{suffix}"
    if cache_path.exists() and cache_path.stat().st_size > 0:
        return cache_path

    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.5"})
    with urllib.request.urlopen(request, timeout=12) as response:  # noqa: S310 - URLs are edition-owned source_image_url values.
        content_type = response.headers.get("content-type", "")
        data = response.read(16_000_000)
    if content_type and not content_type.lower().startswith("image/"):
        raise ValueError(f"Not an image: {content_type}")
    cache_path.write_bytes(data)
    return cache_path


def load_image(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return ImageOps.exif_transpose(image).convert("RGB")


def detect_saliency(image: Image.Image) -> SaliencyResult:
    width, height = image.size
    rgb = np.array(image)
    max_dim = max(width, height)
    scale = min(1.0, 900 / max_dim)
    small = cv2.resize(rgb, (max(1, int(width * scale)), max(1, int(height * scale))), interpolation=cv2.INTER_AREA) if scale < 1 else rgb
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 55, 150)
    edge_density = float(np.count_nonzero(edges)) / float(edges.size)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    boxes: list[tuple[int, int, int, int]] = []
    scaled_area = small.shape[0] * small.shape[1]
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if area < max(48, scaled_area * 0.0008):
            continue
        if w < 8 or h < 8:
            continue
        x1 = int(x / scale)
        y1 = int(y / scale)
        x2 = int((x + w) / scale)
        y2 = int((y + h) / scale)
        boxes.append((max(0, x1), max(0, y1), min(width, x2), min(height, y2)))

    if not boxes:
        margin_x = int(width * 0.18)
        margin_y = int(height * 0.18)
        return SaliencyResult((margin_x, margin_y, width - margin_x, height - margin_y), [], edge_density, "center-fallback")

    # Keep the largest energetic boxes, then union them. This preserves text/UI/artwork clusters better than a single contour.
    boxes = sorted(boxes, key=lambda box: (box[2] - box[0]) * (box[3] - box[1]), reverse=True)[:24]
    x1 = min(box[0] for box in boxes)
    y1 = min(box[1] for box in boxes)
    x2 = max(box[2] for box in boxes)
    y2 = max(box[3] for box in boxes)
    return SaliencyResult((x1, y1, x2, y2), boxes, edge_density, "supervision-contour-union")


def compute_crop(width: int, height: int, box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    bx1, by1, bx2, by2 = box
    bw = max(1, bx2 - bx1)
    bh = max(1, by2 - by1)
    margin_x = int(bw * 0.18)
    margin_y = int(bh * 0.18)
    sx1 = max(0, bx1 - margin_x)
    sy1 = max(0, by1 - margin_y)
    sx2 = min(width, bx2 + margin_x)
    sy2 = min(height, by2 + margin_y)

    subject_w = max(1, sx2 - sx1)
    subject_h = max(1, sy2 - sy1)
    crop_w = subject_w
    crop_h = subject_h
    if crop_w / crop_h < TARGET_ASPECT:
        crop_w = int(math.ceil(crop_h * TARGET_ASPECT))
    else:
        crop_h = int(math.ceil(crop_w / TARGET_ASPECT))

    crop_w = min(width, max(crop_w, min(width, int(height * TARGET_ASPECT))))
    crop_h = min(height, max(crop_h, min(height, int(width / TARGET_ASPECT))))
    if crop_w / crop_h < TARGET_ASPECT:
        crop_h = min(height, int(crop_w / TARGET_ASPECT))
    else:
        crop_w = min(width, int(crop_h * TARGET_ASPECT))

    cx = (sx1 + sx2) / 2
    cy = (sy1 + sy2) / 2
    x1 = int(round(cx - crop_w / 2))
    y1 = int(round(cy - crop_h / 2))
    x1 = min(max(0, x1), max(0, width - crop_w))
    y1 = min(max(0, y1), max(0, height - crop_h))
    return (x1, y1, int(x1 + crop_w), int(y1 + crop_h))


def draw_review(image: Image.Image, saliency: SaliencyResult, crop: tuple[int, int, int, int], output_path: Path, label: str) -> None:
    scene = np.array(image)
    xyxy = []
    class_ids = []
    labels = []
    if saliency.box:
        xyxy.append(saliency.box)
        class_ids.append(0)
        labels.append("salient union")
    xyxy.append(crop)
    class_ids.append(1)
    labels.append("poster crop")

    detections = sv.Detections(xyxy=np.array(xyxy, dtype=float), class_id=np.array(class_ids, dtype=int))
    try:
        scene = sv.BoxAnnotator(thickness=3).annotate(scene=scene, detections=detections)
        scene = sv.LabelAnnotator(text_scale=0.55, text_thickness=1).annotate(scene=scene, detections=detections, labels=labels)
    except TypeError:
        scene = sv.BoxAnnotator().annotate(scene=scene, detections=detections)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(scene).save(output_path, quality=88)


def analyze_binding(binding: dict[str, Any], root: Path, edition_dir: Path, cache_dir: Path, poster_dir: Path, qa_dir: Path) -> dict[str, Any]:
    source_image_url = binding.get("source_image_url")
    if not source_image_url:
        raise ValueError("No source_image_url")

    image_path = resolve_image(source_image_url, root, edition_dir, cache_dir)
    image = load_image(image_path)
    width, height = image.size
    if width < 64 or height < 64:
        raise ValueError(f"Image too small: {width}x{height}")

    saliency = detect_saliency(image)
    crop = compute_crop(width, height, saliency.box)
    crop_area = (crop[2] - crop[0]) * (crop[3] - crop[1])
    crop_ratio = crop_area / float(width * height)
    risk = "high" if crop_ratio < 0.42 else "medium" if crop_ratio < 0.64 else "low"
    focal_x = ((saliency.box[0] + saliency.box[2]) / 2) / width
    focal_y = ((saliency.box[1] + saliency.box[3]) / 2) / height

    binding_id = safe_id(str(binding.get("id", "source")))
    poster_path = poster_dir / f"{binding_id}.jpg"
    qa_path = qa_dir / f"{binding_id}-source-visual-qa.jpg"
    poster_dir.mkdir(parents=True, exist_ok=True)
    image.crop(crop).resize((1280, 720), Image.Resampling.LANCZOS).save(poster_path, quality=90, optimize=True)
    draw_review(image, saliency, crop, qa_path, binding_id)

    return {
        "binding_id": binding.get("id"),
        "source_image_url": source_image_url,
        "poster_asset_path": norm_path(poster_path, root),
        "review_asset_path": str(qa_path.relative_to(root)),
        "image_width": width,
        "image_height": height,
        "aspect_ratio": round(width / height, 4),
        "render_mode": "poster-crop",
        "crop_risk": risk,
        "focal_point": {"x": round(focal_x, 4), "y": round(focal_y, 4)},
        "poster_crop": {
            "x": round(crop[0] / width, 4),
            "y": round(crop[1] / height, 4),
            "width": round((crop[2] - crop[0]) / width, 4),
            "height": round((crop[3] - crop[1]) / height, 4),
        },
        "analysis": {
            "method": saliency.method,
            "supervision_version": getattr(sv, "__version__", "unknown"),
            "edge_density": round(saliency.edge_density, 5),
            "candidate_box_count": len(saliency.boxes),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--edition-dir", required=True)
    parser.add_argument("--edition-id", required=True)
    parser.add_argument("--write-bindings", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    edition_dir = Path(args.edition_dir).resolve()
    source_bindings_path = edition_dir / "source-bindings.json"
    source_bindings = load_json(source_bindings_path)
    cache_dir = root / "tmp" / "source-visual-cache"
    qa_dir = root / "tmp" / "source-visual-qa" / args.edition_id
    poster_dir = edition_dir / "assets" / "source-posters"
    cache_dir.mkdir(parents=True, exist_ok=True)

    records = []
    failures = []
    by_id: dict[str, dict[str, Any]] = {}
    for binding in source_bindings.get("bindings", []):
        if not binding.get("source_image_url"):
            continue
        try:
            record = analyze_binding(binding, root, edition_dir, cache_dir, poster_dir, qa_dir)
            records.append(record)
            if binding.get("id"):
                by_id[str(binding["id"])] = record
        except Exception as error:  # keep the press running; one bad remote image should not block all source windows.
            failures.append({"binding_id": binding.get("id"), "source_image_url": binding.get("source_image_url"), "error": str(error)})

    metadata = {
        "source_visual_metadata_id": f"source-visuals-{args.edition_id}",
        "edition_id": args.edition_id,
        "generated_by": "prepare-source-visuals/supervision",
        "records": records,
        "failures": failures,
    }
    write_json(edition_dir / "source-visual-metadata.json", metadata)

    if args.write_bindings:
        for binding in source_bindings.get("bindings", []):
            record = by_id.get(str(binding.get("id")))
            if record:
                binding["source_visual"] = {
                    "poster_asset_path": record["poster_asset_path"],
                    "render_mode": record["render_mode"],
                    "crop_risk": record["crop_risk"],
                    "focal_point": record["focal_point"],
                    "poster_crop": record["poster_crop"],
                    "image_width": record["image_width"],
                    "image_height": record["image_height"],
                    "analysis": record["analysis"],
                }
        write_json(source_bindings_path, source_bindings)

    print(json.dumps({"edition_id": args.edition_id, "prepared": len(records), "failures": len(failures), "metadata": str((edition_dir / "source-visual-metadata.json").relative_to(root))}, indent=2))
    return 0 if records else 1


if __name__ == "__main__":
    raise SystemExit(main())
