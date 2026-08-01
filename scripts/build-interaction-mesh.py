#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

try:
    from skimage import measure
except Exception:  # pragma: no cover
    measure = None

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_ROOT = ROOT / 'tmp' / 'interaction-mesh-generations'


def load_json(path: Path):
    return json.loads(path.read_text())


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf8')


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def polygon_mask(points: list[list[float]], width: int, height: int) -> np.ndarray:
    canvas = Image.new('L', (width, height), 0)
    draw = ImageDraw.Draw(canvas)
    xy = [(clamp01(x) * width, clamp01(y) * height) for x, y in points]
    if len(xy) >= 3:
        draw.polygon(xy, fill=255)
    return np.array(canvas) > 0


def mask_centroid(mask: np.ndarray, fallback_bounds: dict) -> tuple[float, float]:
    ys, xs = np.where(mask)
    if len(xs):
        return float(xs.mean()), float(ys.mean())
    return (
        (float(fallback_bounds.get('x', 0)) + float(fallback_bounds.get('w', 0)) / 2) * mask.shape[1],
        (float(fallback_bounds.get('y', 0)) + float(fallback_bounds.get('h', 0)) / 2) * mask.shape[0],
    )


def normalized_bounds(mask: np.ndarray, width: int, height: int, padding_px: int = 0) -> dict:
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return {'x': 0.0, 'y': 0.0, 'w': 0.0, 'h': 0.0}
    x0 = max(0, int(xs.min()) - padding_px)
    x1 = min(width, int(xs.max()) + padding_px + 1)
    y0 = max(0, int(ys.min()) - padding_px)
    y1 = min(height, int(ys.max()) + padding_px + 1)
    return {
        'x': round(x0 / width, 4),
        'y': round(y0 / height, 4),
        'w': round(max(1, x1 - x0) / width, 4),
        'h': round(max(1, y1 - y0) / height, 4),
    }


def rdp(points: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    if len(points) < 3:
        return points
    start = np.array(points[0], dtype=np.float32)
    end = np.array(points[-1], dtype=np.float32)
    line = end - start
    norm = float(np.linalg.norm(line))
    max_distance = -1.0
    split = 0
    for i in range(1, len(points) - 1):
        p = np.array(points[i], dtype=np.float32)
        if norm == 0:
            distance = float(np.linalg.norm(p - start))
        else:
            offset = p - start
            distance = float(abs(line[0] * offset[1] - line[1] * offset[0]) / norm)
        if distance > max_distance:
            max_distance = distance
            split = i
    if max_distance > epsilon:
        left = rdp(points[: split + 1], epsilon)
        right = rdp(points[split:], epsilon)
        return left[:-1] + right
    return [points[0], points[-1]]


def convex_hull(points: np.ndarray) -> list[tuple[float, float]]:
    pts = sorted({(float(x), float(y)) for x, y in points.tolist()})
    if len(pts) <= 1:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def mask_to_points(mask: np.ndarray, epsilon: float = 4.0) -> list[tuple[float, float]]:
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return []
    if measure is not None:
        contours = measure.find_contours(mask.astype(np.uint8), 0.5)
        if contours:
            contour = max(contours, key=len)
            pts = [(float(col), float(row)) for row, col in contour]
            if len(pts) >= 3:
                simplified = rdp(pts, epsilon)
                if len(simplified) >= 3:
                    return simplified
    pts = np.column_stack([xs, ys]).astype(np.float32)
    hull = convex_hull(pts)
    return rdp(hull, epsilon) if len(hull) >= 3 else hull


def normalized_polygon(points: list[tuple[float, float]], width: int, height: int) -> list[list[float]]:
    return [[round(clamp01(x / max(1, width)), 4), round(clamp01(y / max(1, height)), 4)] for x, y in points]


def polygon_area(points: list[list[float]]) -> float:
    if len(points) < 3:
        return 0.0
    acc = 0.0
    for idx, (x1, y1) in enumerate(points):
        x2, y2 = points[(idx + 1) % len(points)]
        acc += float(x1) * float(y2) - float(x2) * float(y1)
    return abs(acc) * 0.5


def ensure_minimum_hit_area(mask: np.ndarray, visible: np.ndarray, min_diameter_px: int) -> np.ndarray:
    if mask.sum() >= math.pi * (min_diameter_px / 2) ** 2:
        return mask
    cx, cy = mask_centroid(visible, {'x': 0.5, 'y': 0.5, 'w': 0.01, 'h': 0.01})
    yy, xx = np.indices(mask.shape)
    rescue = ((xx - cx) ** 2 + (yy - cy) ** 2) <= (min_diameter_px / 2) ** 2
    return mask | rescue


def resolve_overlaps(desired: list[np.ndarray], visible: list[np.ndarray], centroids: list[tuple[float, float]]) -> list[np.ndarray]:
    if not desired:
        return []
    height, width = desired[0].shape
    owner = np.full((height, width), -1, dtype=np.int16)
    distance = np.full((height, width), np.inf, dtype=np.float32)
    yy, xx = np.indices((height, width))
    for idx, mask in enumerate(desired):
        cx, cy = centroids[idx]
        dist = ((xx - cx) ** 2 + (yy - cy) ** 2).astype(np.float32)
        update = mask & (dist < distance)
        owner[update] = idx
        distance[update] = dist[update]
    resolved = [owner == idx for idx in range(len(desired))]
    final = []
    for idx, mask in enumerate(resolved):
        if mask.sum() == 0:
            mask = visible[idx].copy()
        final.append(ndimage.binary_fill_holes(mask))
    return final


def build_neighbors(hover_masks: list[np.ndarray], artifacts: list[dict]) -> dict:
    expanded = [ndimage.binary_dilation(mask, iterations=3) for mask in hover_masks]
    neighbors: dict[str, list[dict]] = {}
    for i, artifact in enumerate(artifacts):
        rows = []
        for j, other in enumerate(artifacts):
            if i == j:
                continue
            shared = int((expanded[i] & expanded[j]).sum())
            if shared <= 0:
                continue
            ci = mask_centroid(hover_masks[i], artifact.get('bounds', {}))
            cj = mask_centroid(hover_masks[j], other.get('bounds', {}))
            dx = cj[0] - ci[0]
            dy = cj[1] - ci[1]
            direction = 'right' if abs(dx) >= abs(dy) and dx > 0 else 'left' if abs(dx) >= abs(dy) else 'down' if dy > 0 else 'up'
            rows.append({
                'artifact_id': other['id'],
                'shared_edge_px': shared,
                'direction': direction,
                'distance_px': round(math.sqrt(dx * dx + dy * dy), 2),
            })
        neighbors[artifact['id']] = sorted(rows, key=lambda row: (-row['shared_edge_px'], row['distance_px']))[:4]
    return neighbors


def pil_font(size: int):
    for candidate in ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Supplemental/Helvetica.ttc']:
        p = Path(candidate)
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def color_overlay(base: Image.Image, masks: list[np.ndarray], alpha: int) -> Image.Image:
    overlay = base.convert('RGBA')
    for idx, mask in enumerate(masks):
        color = ((63 + idx * 47) % 255, (172 + idx * 67) % 255, (212 + idx * 31) % 255, alpha)
        layer = np.zeros((mask.shape[0], mask.shape[1], 4), dtype=np.uint8)
        layer[mask] = color
        boundary = mask ^ ndimage.binary_erosion(mask, iterations=1)
        layer[boundary] = (255, 255, 255, 230)
        overlay = Image.alpha_composite(overlay, Image.fromarray(layer, 'RGBA'))
    return overlay


def render_audit_board(plate: Image.Image, visible_masks: list[np.ndarray], hover_masks: list[np.ndarray], output_path: Path, title: str) -> None:
    width, height = plate.size
    board = Image.new('RGB', (width * 2 + 60, height + 120), (18, 18, 20))
    draw = ImageDraw.Draw(board)
    title_font = pil_font(26)
    label_font = pil_font(16)
    draw.text((24, 18), title, fill=(235, 232, 220), font=title_font)
    draw.text((20, 56), 'visible source masks', fill=(190, 190, 198), font=label_font)
    draw.text((width + 40, 56), 'inflated interaction mesh / hover territories', fill=(190, 190, 198), font=label_font)
    board.paste(color_overlay(plate, visible_masks, 105).convert('RGB'), (20, 82))
    board.paste(color_overlay(plate, hover_masks, 92).convert('RGB'), (width + 40, 82))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    board.save(output_path)


def run_edition(edition_id: str, generation_name: str, apply_artifact_map: bool = False) -> dict:
    edition_dir = ROOT / 'public' / 'editions' / edition_id
    edition = load_json(edition_dir / 'edition.json')
    artifact_map_path = edition_dir / 'artifact-map.json'
    artifact_map = load_json(artifact_map_path)
    plate_path = ROOT / 'public' / edition['plate_asset_path'].lstrip('/')
    if not plate_path.exists():
        plate_path = edition_dir / 'assets' / 'plate.png'
    plate = Image.open(plate_path).convert('RGB')
    width, height = plate.size
    artifacts = artifact_map.get('artifacts', [])

    visible_masks = [polygon_mask(artifact.get('polygon', []), width, height) for artifact in artifacts]
    centroids = [mask_centroid(mask, artifact.get('bounds', {})) for mask, artifact in zip(visible_masks, artifacts)]
    desired = []
    for artifact, mask in zip(artifacts, visible_masks):
        expand_px = 34 if artifact.get('kind') == 'hero' else 28
        if artifact.get('artifact_type', '').endswith('seam') or 'seam' in artifact.get('artifact_type', '') or 'slit' in artifact.get('artifact_type', ''):
            expand_px += 12
        hover = ndimage.binary_dilation(mask, iterations=expand_px)
        hover = ensure_minimum_hit_area(hover, mask, min_diameter_px=56)
        desired.append(hover)
    hover_masks = resolve_overlaps(desired, visible_masks, centroids)
    neighbors = build_neighbors(hover_masks, artifacts)

    cells = []
    for artifact, visible, hover in zip(artifacts, visible_masks, hover_masks):
        hover_points = mask_to_points(hover, epsilon=6.0 if artifact.get('kind') == 'hero' else 4.5)
        hover_polygon = normalized_polygon(hover_points, width, height)
        if len(hover_polygon) < 3:
            hover_polygon = artifact.get('polygon', [])
        visible_area = max(1, int(visible.sum()))
        hover_area = int(hover.sum())
        hover_bounds = normalized_bounds(hover, width, height)
        artifact.setdefault('interaction_mesh', {})
        artifact['interaction_mesh'].update({
            'schema_version': 1,
            'visible_polygon': artifact.get('polygon', []),
            'hover_polygon': hover_polygon,
            'hover_bounds': hover_bounds,
            'territory_area_px': hover_area,
            'visible_area_px': int(visible.sum()),
            'expansion_ratio': round(hover_area / visible_area, 3),
            'neighbors': neighbors.get(artifact['id'], []),
        })
        cells.append({
            'artifact_id': artifact['id'],
            'visible_area_px': int(visible.sum()),
            'territory_area_px': hover_area,
            'hover_bounds': hover_bounds,
            'hover_polygon': hover_polygon,
            'neighbors': neighbors.get(artifact['id'], []),
        })

    out_dir = OUTPUT_ROOT / generation_name / edition_id
    out_dir.mkdir(parents=True, exist_ok=True)
    audit_board = out_dir / 'interaction-mesh-audit-board.png'
    render_audit_board(plate, visible_masks, hover_masks, audit_board, f'{edition_id} · interaction mesh')
    mesh = {
        'schema_version': 1,
        'edition_id': edition_id,
        'generation': generation_name,
        'strategy': 'mask-derived hover territories: dilate visible masks, rescue tiny marks, resolve overlaps by nearest source centroid, export adjacency',
        'viewport': {'width': width, 'height': height},
        'audit_board': str(audit_board),
        'cells': cells,
    }
    write_json(out_dir / 'interaction-mesh.json', mesh)
    if apply_artifact_map:
        write_json(edition_dir / 'interaction-mesh.json', mesh)
        write_json(artifact_map_path, artifact_map)
    return {
        'edition': edition_id,
        'generation': generation_name,
        'applied_artifact_map': apply_artifact_map,
        'interaction_mesh': str(out_dir / 'interaction-mesh.json'),
        'audit_board': str(audit_board),
        'cells': len(cells),
        'avg_expansion_ratio': round(sum(cell['territory_area_px'] / max(1, cell['visible_area_px']) for cell in cells) / max(1, len(cells)), 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--generation-name', required=True)
    parser.add_argument('--apply-artifact-map', action='store_true')
    parser.add_argument('editions', nargs='+')
    args = parser.parse_args()
    summaries = [run_edition(edition, args.generation_name, apply_artifact_map=args.apply_artifact_map) for edition in args.editions]
    print(json.dumps({'generated': summaries}, indent=2))


if __name__ == '__main__':
    main()
