#!/usr/bin/env python3
import argparse
import json
import shutil
import sys
import urllib.request
from pathlib import Path


def load_prompt(args: argparse.Namespace) -> str:
    if args.prompt_file:
        return Path(args.prompt_file).read_text(encoding='utf-8').strip()
    return (args.prompt or '').strip()


def copy_or_download_image(image_ref: str, output_path: Path) -> None:
    if image_ref.startswith('http://') or image_ref.startswith('https://'):
        with urllib.request.urlopen(image_ref, timeout=120) as response:
            output_path.write_bytes(response.read())
        return

    source_path = Path(image_ref)
    if not source_path.exists():
        raise FileNotFoundError(f'Provider returned missing image path: {image_ref}')
    output_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_path, output_path)


def main() -> int:
    parser = argparse.ArgumentParser(description='Generate an image through Hermes image providers.')
    parser.add_argument('--prompt', help='Inline prompt text')
    parser.add_argument('--prompt-file', help='Path to a UTF-8 prompt file')
    parser.add_argument('--output', required=True, help='Where to save the final PNG/JPG/WebP file')
    parser.add_argument('--aspect-ratio', default='landscape', choices=['landscape', 'portrait', 'square'])
    parser.add_argument('--provider', help='Explicit Hermes image provider name. Defaults to active provider from Hermes config.')
    args = parser.parse_args()

    prompt = load_prompt(args)
    if not prompt:
        raise SystemExit('Prompt is required via --prompt or --prompt-file')

    from hermes_cli.plugins import _ensure_plugins_discovered
    from agent.image_gen_registry import get_active_provider, get_provider

    _ensure_plugins_discovered(force=True)
    provider = get_provider(args.provider) if args.provider else get_active_provider()
    if provider is None:
        raise SystemExit('No Hermes image generation provider is available. Configure image_gen.provider in ~/.hermes/config.yaml.')
    if not provider.is_available():
        raise SystemExit(f"Hermes image provider '{provider.name}' is configured but unavailable.")

    result = provider.generate(prompt=prompt, aspect_ratio=args.aspect_ratio)
    if not isinstance(result, dict):
        raise SystemExit('Hermes image provider returned a non-dict result.')
    if not result.get('success'):
        raise SystemExit(result.get('error') or 'Hermes image generation failed.')

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    copy_or_download_image(str(result['image']), output_path)

    payload = {
        'provider': result.get('provider') or getattr(provider, 'name', None),
        'model': result.get('model') or getattr(provider, 'default_model', lambda: None)(),
        'source_image': result.get('image'),
        'output': str(output_path),
        'aspect_ratio': args.aspect_ratio,
    }
    print(json.dumps(payload))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
